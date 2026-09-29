#!/usr/bin/env python3
"""Firefox WebGPU W1: relax the two RELEASE_OR_BETA WebGPU gates under __wasm__.

Recompiles exactly two translation units of the preserved Firefox 128.14 ESR
object tree and relinks the W0 candidate (firefox-mmap-w0-20260929/relink-run1)
with only those two objects replaced:

  gfx/thebes/gfxPlatform.o              (gfxPlatform::InitWebGPUConfig ForceDisable)
  dom/webgpu/Unified_cpp_dom_webgpu0.o  (Instance::RequestAdapter error string)

Each gate `#ifdef RELEASE_OR_BETA` becomes
`#if defined(RELEASE_OR_BETA) && !defined(__wasm__)`.  The preserved source
tree is never modified: patched copies live in OUT/src.

Every run first recompiles the UNMODIFIED units with the original build's nix
cc-wrapper environment and requires byte-identical objects, proving the
compile recipe.  `--control` then links those reproduced objects and requires
the result to equal W0 relink-run1 modulo the random build_id payload;
otherwise the patched objects are linked.

Usage: build-firefox-webgpu-gates.py OUT [--control]
OUT must not exist and must be on disk-backed storage (never /tmp).
"""
import argparse, difflib, hashlib, json, os, shlex, shutil, subprocess, sys, time
from pathlib import Path

CACHE = Path('/mnt/p6/project/linux/.cache')
OBJ = CACHE / 'firefox-fresh-obj-20260924-071600'
NIXBUILD = Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/var/nix/builds/nix-721784-2625232085/build')
FF = NIXBUILD / 'firefox-128.14.0'
W0 = Path('/mnt/p6/build/firefox-mmap-w0-20260929/relink-run1')
RESUME = Path('/mnt/p6/build/firefox-tls-20260926/resume-build-run1')
# The original objects were compiled with -I/tmp/firefox-mmap-shim; neither unit
# includes sys/mman.h, but a disk-backed copy of that exact header is used.
SHIM_HEADER = Path('/mnt/p6/build/firefox-webgpu-w1-20260929/explore-control-run2/shimhdr/sys/mman.h')
PINS = {
    NIXBUILD / 'env-vars': '9060a69aceecb8b1e29af68dc09920a4688dd4f631b8aca13be6a5cc0e9adeb0',
    FF / 'dom/webgpu/Instance.cpp': 'd0727d947b47f1b28caf2b7dee78022d8f4b155a046ff83ea63c2806bb6a5cc0',
    FF / 'gfx/thebes/gfxPlatform.cpp': '06c23a2454db76e9e13491f4baf72bead9a0bd057e3aa54d45f5425f89573536',
    OBJ / 'dom/webgpu/Unified_cpp_dom_webgpu0.o': '7521423c8ff7408a07102ff235fa398eacdd8ba83759156bef413e11139e4e11',
    OBJ / 'gfx/thebes/gfxPlatform.o': 'bc3a9f8d5bcd9703b23235e482e7df5ee3bdf7b718071d5ecd243823538573ff',
    OBJ / 'dom/webgpu/Unified_cpp_dom_webgpu0.cpp': None,
    OBJ / 'clangd/compile_commands.json': None,
    W0 / 'link-command.json': '0f122323ed39c48526bba7249d8b591029e810a02f60965a503231b9d2984310',
    W0 / 'mmap-shim.o': 'ebb24527743326bddd9a5aa50addcc3a798651351b696c35c50f6b726262f1ca',
    W0 / 'firefox.wasm': '4f7492e4c7666039f559c8cec55a438093fdf5093224dcd93c4ff95dede4305d',
    RESUME / 'firefox-nss.list': 'c70cbf6acb95679d32cd525a6180857d57feee4f7466499cca8ccedcfe3b6ba8',
    RESUME / 'unwind-stubs.o': 'dc4cb55ed3f5e88c24a7c40f1c73455996efda89217ccd326f7109d052613175',
    SHIM_HEADER: '47983e6461ef20ebaf2fb5be0dc64864352dadb6943163eda402a8cc64d0cd1b',
}
NIX_VARS = ['NIX_CFLAGS_COMPILE', 'NIX_CXXSTDLIB_COMPILE', 'NIX_HARDENING_ENABLE',
            'NIX_CC_WRAPPER_TARGET_HOST_wasm32_unknown_linux_musl', 'NIX_ENFORCE_NO_NATIVE']
GATE_OLD = '#ifdef RELEASE_OR_BETA\n'
GATE_NEW = '#if defined(RELEASE_OR_BETA) && !defined(__wasm__)\n'
# (source member, line number of the gate, context line that must follow it)
PATCHES = {
    'dom/webgpu/Instance.cpp': (69, 'not yet available in Release or Beta'),
    'gfx/thebes/gfxPlatform.cpp': (3178, 'WEBGPU_DISABLE_RELEASE_OR_BETA'),
}
UNITS = {
    'webgpu0': {'entry': 'dom/webgpu/Instance.cpp', 'object': 'dom/webgpu/Unified_cpp_dom_webgpu0.o',
                'list': '../../dom/webgpu/Unified_cpp_dom_webgpu0.o'},
    'gfxPlatform': {'entry': 'gfx/thebes/gfxPlatform.cpp', 'object': 'gfx/thebes/gfxPlatform.o',
                    'list': '../../gfx/thebes/gfxPlatform.o'},
}


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def leb(data, pos):
    value = shift = 0
    while True:
        byte = data[pos]; pos += 1
        value |= (byte & 0x7f) << shift; shift += 7
        if not byte & 0x80:
            return value, pos


def masked_digest(path):
    """SHA-256 with the payload of the custom `build_id` section zeroed."""
    data = bytearray(Path(path).read_bytes())
    pos, masked = 8, 0
    while pos < len(data):
        sid = data[pos]; size, body = leb(data, pos + 1)
        if sid == 0:
            nlen, npos = leb(data, body)
            if bytes(data[npos:npos + nlen]) == b'build_id':
                start = npos + nlen
                data[start:body + size] = bytes(body + size - start)
                masked += 1
        pos = body + size
    return hashlib.sha256(data).hexdigest(), masked


def nix_env():
    script = 'source "$1" >/dev/null 2>&1; for v in ' + ' '.join(NIX_VARS) + \
             '; do printf "%s\\t%s\\n" "$v" "${!v}"; done'
    text = subprocess.run(['bash', '-c', script, 'nixenv', str(NIXBUILD / 'env-vars')],
                          capture_output=True, text=True, check=True, cwd=NIXBUILD).stdout
    env = dict(line.split('\t', 1) for line in text.splitlines())
    if set(env) != set(NIX_VARS) or not all(env.values()):
        raise RuntimeError('missing nix wrapper variables in env-vars')
    return env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--control', action='store_true')
    args = ap.parse_args()
    out = Path(args.out).resolve()
    tmp = os.environ.get('TMPDIR', '')
    if not tmp or tmp.startswith(('/tmp', '/dev/shm')) or str(out).startswith(('/tmp', '/dev/shm')):
        sys.exit('TMPDIR and OUT must be disk-backed (not /tmp or /dev/shm)')
    out.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {'pass': False, 'mode': 'control' if args.control else 'candidate', 'inputs': {},
              'objects': {}}
    logs = {}

    def run(cmd, name, cwd, limit, env=None):
        (out / f'{name}-command.json').write_text(json.dumps({'cwd': str(cwd), 'argv': cmd}, indent=1) + '\n')
        with open(out / f'{name}.log', 'wb') as log:
            t = time.monotonic()
            p = subprocess.run(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=limit, env=env)
            logs[name] = {'exit': p.returncode, 'seconds': round(time.monotonic() - t, 2)}
        if p.returncode:
            raise RuntimeError(f'{name} failed ({p.returncode}); see {out / (name + ".log")}')

    try:
        for path, want in PINS.items():
            got = digest(path)
            report['inputs'][str(path)] = got
            if want and got != want:
                raise RuntimeError(f'pinned input changed: {path} {got}')
        nix = nix_env()
        (out / 'nix-env.json').write_text(json.dumps(nix, indent=1) + '\n')
        env = {k: v for k, v in os.environ.items() if not k.startswith('NIX_')}
        env.update(nix)
        shimhdr = out / 'shimhdr/sys'
        shimhdr.mkdir(parents=True)
        shutil.copy2(SHIM_HEADER, shimhdr / 'mman.h')

        # Patched source copies and the exact upstream diff.
        src = out / 'src'
        diff = []
        for member, (line, context) in PATCHES.items():
            old = (FF / member).read_text()
            lines = old.splitlines(keepends=True)
            if lines[line - 1] != GATE_OLD:
                raise RuntimeError(f'{member}:{line} is not the expected gate')
            if context not in ''.join(lines[line:line + 3]):
                raise RuntimeError(f'{member}:{line} gate context changed')
            new_lines = list(lines)
            new_lines[line - 1] = GATE_NEW
            dest = src / member
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(''.join(new_lines))
            diff += difflib.unified_diff(lines, new_lines, f'a/{member}', f'b/{member}')
        # The unified unit includes Instance.cpp by absolute path; point only
        # that include at the patched copy.
        unified = (OBJ / 'dom/webgpu/Unified_cpp_dom_webgpu0.cpp').read_text()
        inc_old = f'#include "{FF}/dom/webgpu/Instance.cpp"\n'
        inc_new = f'#include "{src}/dom/webgpu/Instance.cpp"\n'
        if unified.count(inc_old) != 1:
            raise RuntimeError('unexpected unified include layout')
        (src / 'dom/webgpu/Unified_cpp_dom_webgpu0.cpp').write_text(unified.replace(inc_old, inc_new))
        (out / 'webgpu-gates.patch').write_text(''.join(diff))
        report['patchSha256'] = digest(out / 'webgpu-gates.patch')
        report['patchedSources'] = {m: digest(src / m) for m in PATCHES}

        db = json.loads((OBJ / 'clangd/compile_commands.json').read_text())
        objects = {}
        for name, unit in UNITS.items():
            entries = [e for e in db if e['file'].endswith(unit['entry'])]
            if len(entries) != 1:
                raise RuntimeError(f'expected one compile entry for {unit["entry"]}')
            entry = entries[0]
            base = shlex.split(entry['command'])
            if base[1:4] != ['-o', '/dev/null', '-c'] or base.count('-I/tmp/firefox-mmap-shim') != 1 \
                    or base[-1] != str(FF / unit['entry']):
                raise RuntimeError(f'unexpected compile command layout for {name}')
            base = ['-I' + str(out / 'shimhdr') if a == '-I/tmp/firefox-mmap-shim' else a for a in base]
            if any(a.startswith(('/tmp', '-I/tmp')) for a in base):
                raise RuntimeError('compile command still references /tmp')
            for variant in ('original', 'patched'):
                cmd = list(base)
                obj = out / f'{name}-{variant}.o'
                cmd[2] = str(obj)
                if name == 'webgpu0':
                    # make passes the unified file relative to the object dir.
                    cmd[-1] = ('Unified_cpp_dom_webgpu0.cpp' if variant == 'original'
                               else str(src / 'dom/webgpu/Unified_cpp_dom_webgpu0.cpp'))
                else:
                    cmd[-1] = str(FF / unit['entry']) if variant == 'original' else str(src / unit['entry'])
                run(cmd, f'compile-{name}-{variant}', entry['directory'], 1800, env)
                objects[(name, variant)] = obj
                report['objects'][f'{name}-{variant}'] = {'sha256': digest(obj), 'bytes': obj.stat().st_size}
            want = PINS[OBJ / unit['object']]
            got = report['objects'][f'{name}-original']['sha256']
            report['objects'][f'{name}-original']['reproducesOriginal'] = got == want
            if got != want:
                raise RuntimeError(f'{name}: unmodified recompile does not reproduce {unit["object"]}')

        # Link list: W0's response file with only the two units replaced.
        variant = 'original' if args.control else 'patched'
        old_list = (RESUME / 'firefox-nss.list').read_text().splitlines(keepends=True)
        new_list = list(old_list)
        for name, unit in UNITS.items():
            idx = [i for i, l in enumerate(old_list) if l.rstrip('\n') == unit['list']]
            if len(idx) != 1:
                raise RuntimeError(f'{unit["list"]} not unique in link list')
            new_list[idx[0]] = str(objects[(name, variant)]) + '\n'
        (out / 'firefox-nss.list').write_text(''.join(new_list))
        w0 = json.loads((W0 / 'link-command.json').read_text())
        link = list(w0['argv'])
        old_at = '@' + str(RESUME / 'firefox-nss.list')
        if link.count(old_at) != 1 or link.count('-o') != 1:
            raise RuntimeError('unexpected W0 link command layout')
        link[link.index(old_at)] = '@' + str(out / 'firefox-nss.list')
        raw = out / 'firefox-raw.wasm'
        link[link.index('-o') + 1] = str(raw)
        report['linkInputDiff'] = {
            'argv': [[i, a, b] for i, (a, b) in enumerate(zip(w0['argv'], link)) if a != b],
            'argvLength': [len(w0['argv']), len(link)],
            'list': [[i + 1, a.rstrip('\n'), b.rstrip('\n')]
                     for i, (a, b) in enumerate(zip(old_list, new_list)) if a != b],
            'listLength': [len(old_list), len(new_list)],
        }
        run(link, 'link', Path(w0['cwd']), 1200)
        final = out / 'firefox.wasm'
        run(['wasm-opt', '--all-features', '--disable-compact-imports', '--pass-arg=max-func-params@23',
             '--fpcast-emu', str(raw), '-o', str(final)], 'fpcast', out, 1800)
        run(['wasm-validate', '--enable-all', str(final)], 'validate', out, 600)
        raw.unlink()  # ~198 MB intermediate; command and log are kept
        report.update({'candidate': str(final), 'sha256': digest(final), 'bytes': final.stat().st_size})
        masked, count = masked_digest(final)
        ref_masked, ref_count = masked_digest(W0 / 'firefox.wasm')
        report['maskedBuildIdSha256'] = masked
        report['w0MaskedBuildIdSha256'] = ref_masked
        report['buildIdSections'] = [count, ref_count]
        report['matchesW0ModuloBuildId'] = masked == ref_masked
        if args.control and masked != ref_masked:
            raise RuntimeError('control relink does not reproduce W0 relink-run1')
        if not args.control and masked == ref_masked:
            raise RuntimeError('patched relink unexpectedly identical to W0')
        report['pass'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['steps'] = logs
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=1))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
