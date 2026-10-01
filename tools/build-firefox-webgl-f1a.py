#!/usr/bin/env python3
"""Packet F1a: relink guest Firefox with static Mesa EGL + Zink + the guest Vulkan ICD.

No Firefox source changes. The W1 link (tools/build-firefox-webgpu-gates.py,
relink-run1) is reused verbatim and only extended with
  - zink-egl-static.o  (web/linux/firefox-shims/zink-egl-static.c): constructor
    registering NSPR static libraries "libEGL.so" / "libGL.so" + Mesa env defaults
  - zink_static_vk.o   (tools/zink/shims/zink_static_vk.c): util_dl_* replacement
    that hands Zink the statically linked ICD as "libvulkan.so.1"
  - copies of the B3 static archives (libEGL_mesa.a, libgallium_zink.a,
    libguest_vk_icd.a), never the B3 tree itself.
It also builds the guest /opt/firefox/glxtest adapter (glxtest-egl.c).

With --diagnose the baseline (W1 inputs) and the candidate are additionally
linked WITHOUT --allow-multiple-definition so the silent duplicate definitions
can be compared; the duplicates only present in the candidate are the Mesa/ICD
collisions.

usage: TMPDIR=<disk> build-firefox-webgl-f1a.py OUT [--diagnose]
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W1 = Path('/mnt/p6/build/firefox-webgpu-w1-20260929/relink-run1')
W1_FIREFOX_SHA = '3a1af53d'  # prefix, checked against report.json below
B3 = Path('/mnt/p6/build/zink-b3-20260930/link/run3/lib')
B3_ARCHIVES = ['libEGL_mesa.a', 'libgallium_zink.a', 'libguest_vk_icd.a']
MESA_INCLUDE = Path('/mnt/p6/build/zink-b3-20260930/mesa-26.2.3/include')
WRAP = Path('/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin')
CC = WRAP / 'wasm32-unknown-linux-musl-clang'
CFLAGS = ['-O2', '-pthread', '-matomics', '-mbulk-memory', '-Wall', '-Wextra', '-Werror']
GUEST_LINK = ['-pthread', '-matomics', '-mbulk-memory', '-static',
              '-Wl,--import-memory,--export-table,--shared-memory',
              '-Wl,--initial-memory=1048576,--max-memory=4294967296,-z,stack-size=65536']
SOURCES = {
    'zink-egl-static.c': ROOT / 'web/linux/firefox-shims/zink-egl-static.c',
    'zink_static_vk.c': ROOT / 'tools/zink/shims/zink_static_vk.c',
    'glxtest-egl.c': ROOT / 'web/linux/firefox-shims/glxtest-egl.c',
}


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


SYSTEM_LIBS = ('/libc.a(', '/libc++.a(', '/libc++abi.a(', '/libclang_rt.builtins.a(', '<internal>')


def nm_symbols(target, members=None):
    """(defined, undefined) extern symbols of an object, or of selected archive members."""
    text = subprocess.run(['llvm-nm', '--extern-only', '-A', str(target)], capture_output=True,
                          text=True, check=True).stdout
    defined, undefined = set(), set()
    for line in text.splitlines():
        pre, _, rest = line.rpartition(': ')
        if members is not None and pre.split(':', 1)[-1] not in members:
            continue
        parts = rest.split()
        if len(parts) < 2:
            continue
        (undefined if parts[-2] in ('U', 'w') else defined).add(parts[-1])
    return defined, undefined


def trace_collisions(out, cand, cwd, run):
    """Symbol-level audit of what the Mesa/ICD additions share with Firefox.

    --allow-multiple-definition hides duplicates, and archive members whose
    symbols are already defined are never loaded, so duplicate-symbol errors
    alone miss displaced definitions. Trace every symbol defined or referenced
    by the loaded Mesa/ICD members and the adapters through the real link.
    """
    mine = str(out) + '/'
    mp = (out / 'link.map').read_text(errors='replace')
    pulled = {}
    for a, m in set(re.findall(re.escape(mine) + r'lib/(lib[A-Za-z_]+\.a)\(([^)]+)\)', mp)):
        pulled.setdefault(a, set()).add(m)
    mdef, mund = set(), set()
    for a, ms in pulled.items():
        d, u = nm_symbols(out / 'lib' / a, ms)
        mdef |= d
        mund |= u
    for o in ('zink-egl-static.o', 'zink_static_vk.o'):
        d, u = nm_symbols(out / 'obj' / o)
        mdef |= d
        mund |= u
    mund -= mdef
    (out / 'trace.rsp').write_text(''.join(f'--trace-symbol={x}\n' for x in sorted(mdef | mund)))
    av = [a for a in cand if not a.startswith('-Map=')]
    av[av.index('-o') + 1] = str(out / 'trace.wasm')
    av.append(f'@{out / "trace.rsp"}')
    run(av, 'trace', cwd, 1200)
    (out / 'trace.wasm').unlink()
    defs, refs = {}, {}
    for line in (out / 'trace.log').read_text(errors='replace').splitlines():
        m = re.match(r'(.*): (lazy definition|definition|reference to) (?:of )?(\S+)$', line.strip())
        if not m:
            continue
        f, kind, sym = m.groups()
        if kind == 'reference to':
            refs.setdefault(sym, []).append(f)
        else:
            defs.setdefault(sym, []).append([f, kind])
    clash = {s: defs[s] for s in sorted(mdef) if any(not f.startswith(mine) for f, _ in defs.get(s, []))}
    firefox_refs = {s: sorted({f.rsplit('/', 1)[-1] for f in refs.get(s, []) if not f.startswith(mine)})
                    for s in sorted(mdef)}
    firefox_refs = {s: v for s, v in firefox_refs.items() if v}
    resolved = {}
    for s in sorted(mund):
        d = [f for f, k in defs.get(s, []) if k == 'definition']
        resolved[s] = d[0] if d else None
    non_system = {s: f for s, f in resolved.items()
                  if f is None or (not f.startswith(mine) and not any(x in f for x in SYSTEM_LIBS))}
    result = {'pulledMembers': {a: len(m) for a, m in pulled.items()},
              'mesaDefined': len(mdef), 'mesaUndefined': len(mund),
              'definedAlsoOutsideMesa': clash, 'firefoxReferencesToMesaDefinitions': firefox_refs,
              'mesaReferencesResolvedOutsideSystemLibs': non_system}
    (out / 'collisions.json').write_text(json.dumps(result, indent=1) + '\n')
    return {k: (v if isinstance(v, (int, dict)) and k == 'pulledMembers' or isinstance(v, int) else len(v))
            for k, v in result.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--diagnose', action='store_true')
    ap.add_argument('--initial-memory', type=int, default=0,
                    help='override --initial-memory (bytes); 0 keeps W1 value')
    args = ap.parse_args()
    out = Path(args.out).resolve()
    tmp = os.environ.get('TMPDIR', '')
    if not tmp or tmp.startswith(('/tmp', '/dev/shm')) or str(out).startswith(('/tmp', '/dev/shm')):
        sys.exit('TMPDIR and OUT must be disk-backed (not /tmp or /dev/shm)')
    out.mkdir(parents=True, exist_ok=False)
    (out / 'obj').mkdir()
    (out / 'lib').mkdir()
    started = time.monotonic()
    report = {'pass': False, 'inputs': {}, 'steps': {}}

    def run(cmd, name, cwd, limit, check=True):
        (out / f'{name}-command.json').write_text(json.dumps({'cwd': str(cwd), 'argv': cmd}, indent=1) + '\n')
        t = time.monotonic()
        with open(out / f'{name}.log', 'wb') as log:
            p = subprocess.run(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=limit)
        report['steps'][name] = {'rc': p.returncode, 'seconds': round(time.monotonic() - t, 2)}
        if check and p.returncode:
            raise RuntimeError(f'{name} failed rc={p.returncode}; see {out / (name + ".log")}')
        return p.returncode

    try:
        w1 = json.loads((W1 / 'report.json').read_text())
        if not w1.get('sha256', '').startswith(W1_FIREFOX_SHA):
            raise RuntimeError('W1 relink-run1 report does not match the pinned firefox.wasm')
        report['inputs']['w1Firefox'] = {'path': str(W1 / 'firefox.wasm'), 'sha256': w1['sha256'],
                                         'bytes': w1['bytes']}
        for name, src in SOURCES.items():
            report['inputs'][name] = {'path': str(src), 'sha256': digest(src)}
        # Copies of the B3 archives (the B3 tree is never modified).
        libs = []
        for a in B3_ARCHIVES:
            dst = out / 'lib' / a
            shutil.copy2(B3 / a, dst)
            report['inputs'][a] = {'source': str(B3 / a), 'sha256': digest(dst), 'bytes': dst.stat().st_size}
            libs.append(str(dst))

        # Adapters.
        egl_o = out / 'obj/zink-egl-static.o'
        vk_o = out / 'obj/zink_static_vk.o'
        run([str(CC), *CFLAGS, '-std=c11', f'-I{MESA_INCLUDE}', '-c', str(SOURCES['zink-egl-static.c']),
             '-o', str(egl_o)], 'cc-zink-egl-static', out, 300)
        run([str(CC), *CFLAGS, '-std=c11', '-c', str(SOURCES['zink_static_vk.c']), '-o', str(vk_o)],
            'cc-zink-static-vk', out, 300)
        glxtest = out / 'glxtest.wasm'
        run([str(CC), *CFLAGS, '-std=c11', *GUEST_LINK, str(SOURCES['glxtest-egl.c']), '-o', str(glxtest)],
            'cc-glxtest', out, 300)
        run(['wasm-validate', '--enable-all', str(glxtest)], 'validate-glxtest', out, 120)
        report['glxtest'] = {'path': str(glxtest), 'sha256': digest(glxtest), 'bytes': glxtest.stat().st_size}

        # Link command: W1 argv with adapters after the W0/TLS shims and the
        # Mesa archives right after Firefox's libc++/libc++abi. wasm-ld resolves
        # archives in any order, but the first loaded definition of a weak
        # (linkonce) symbol wins: placing Mesa after libc++ keeps Firefox's own
        # copies of inline libc++ helpers (std::__throw_length_error[abi:...],
        # which Mesa's glsl lower_precision.cpp.o also emits) selected.
        base = json.loads((W1 / 'link-command.json').read_text())
        cwd = Path(base['cwd'])
        argv = list(base['argv'])
        anchor = '/mnt/p6/project/linux/.cache/libcxxabi-wasm-abi-20260925/lib/libc++abi.a'
        unwind = '/mnt/p6/build/firefox-tls-20260926/resume-build-run1/unwind-stubs.o'
        if argv.count(anchor) != 1 or argv.count(unwind) != 1 or argv.count('-o') != 1:
            raise RuntimeError('unexpected W1 link command layout')
        cand = list(argv)
        cand.insert(cand.index(unwind) + 1, str(vk_o))
        cand.insert(cand.index(unwind) + 1, str(egl_o))
        i = cand.index(anchor) + 1
        cand[i:i] = libs
        if args.initial_memory:
            j = [k for k, a in enumerate(cand) if a.startswith('--initial-memory=')]
            cand[j[0]] = f'--initial-memory={args.initial_memory}'
        raw = out / 'firefox-raw.wasm'
        cand[cand.index('-o') + 1] = str(raw)
        cand += [f'-Map={out / "link.map"}']
        report['linkArgvAdded'] = [a for a in cand if a not in argv]

        if args.diagnose:
            def dups(name, av):
                av = [a for a in av if a != '--allow-multiple-definition' and not a.startswith('-Map=')]
                diag = out / f'{name}.wasm'
                av[av.index('-o') + 1] = str(diag)
                av.append('--error-limit=0')
                run(av, name, cwd, 1200, check=False)
                if diag.exists():
                    diag.unlink()
                text = (out / f'{name}.log').read_text(errors='replace')
                return sorted(set(re.findall(r'duplicate symbol: (\S+)', text))), text
            base_dups, _ = dups('diag-baseline', argv)
            cand_dups, ctext = dups('diag-candidate', cand)
            new = sorted(set(cand_dups) - set(base_dups))
            (out / 'duplicates-new.txt').write_text('\n'.join(new) + '\n')
            # Where each new duplicate is defined (first two definitions from the log).
            where = {}
            for m in re.finditer(r'duplicate symbol: (\S+)\n>>> defined in (\S+)\n>>> defined in (\S+)', ctext):
                if m.group(1) in new:
                    where.setdefault(m.group(1), [m.group(2), m.group(3)])
            (out / 'duplicates-new.json').write_text(json.dumps(where, indent=1) + '\n')
            report['duplicates'] = {'baseline': len(base_dups), 'candidate': len(cand_dups), 'new': len(new)}

        run(cand, 'link', cwd, 1200)
        if args.diagnose:
            report['collisions'] = trace_collisions(out, cand, cwd, run)
        final = out / 'firefox.wasm'
        run(['wasm-opt', '--all-features', '--disable-compact-imports', '--pass-arg=max-func-params@23',
             '--fpcast-emu', str(raw), '-o', str(final)], 'fpcast', out, 1800)
        run(['wasm-validate', '--enable-all', str(final)], 'validate', out, 600)
        report['rawBytes'] = raw.stat().st_size
        raw.unlink()  # large intermediate; command and log are kept
        run(['wasm-objdump', '-x', '-j', 'Import', str(final)], 'imports', out, 600)
        imports = sorted(set(re.findall(r' <- (\S+)', (out / 'imports.log').read_text())))
        (out / 'imports.txt').write_text('\n'.join(imports) + '\n')
        run(['wasm-objdump', '-x', '-j', 'Import', str(W1 / 'firefox.wasm')], 'imports-w1', out, 600)
        w1_imports = sorted(set(re.findall(r' <- (\S+)', (out / 'imports-w1.log').read_text())))
        report['imports'] = {'count': len(imports), 'w1Count': len(w1_imports),
                             'added': sorted(set(imports) - set(w1_imports)),
                             'removed': sorted(set(w1_imports) - set(imports))}
        # Members pulled from each Mesa/ICD archive (from the link map).
        mp = (out / 'link.map').read_text(errors='replace')
        report['archiveMembersLinked'] = {a: len(set(re.findall(re.escape(str(out / 'lib' / a)) + r'\(([^)]+)\)', mp)))
                                         for a in B3_ARCHIVES}
        report.update({'candidate': str(final), 'sha256': digest(final), 'bytes': final.stat().st_size,
                       'growthBytes': final.stat().st_size - w1['bytes']})
        report['pass'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({k: v for k, v in report.items() if k != 'steps'}, indent=1))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
