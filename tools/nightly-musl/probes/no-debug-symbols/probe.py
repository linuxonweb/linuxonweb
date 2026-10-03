#!/usr/bin/env python3
"""Small real native-Wasm no-DWARF checks; never configures a browser tree."""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tomllib
from types import SimpleNamespace

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
if (out / 'result.json').exists():
    raise SystemExit('Refusing to overwrite evidence')
(out / 'tmp').mkdir(exist_ok=True)
repo = Path(__file__).resolve().parents[4]
env_data = subprocess.check_output([
    'bash', '-c', 'source "$1"; export TMPDIR="$2" TMP="$2" TEMP="$2"; env -0',
    'no-debug-probe', str(repo / 'tools/nightly-musl/recipe/environment.sh'), str(out / 'tmp')])
env = dict(item.decode().split('=', 1) for item in env_data.split(b'\0') if item)
commands = []
checks = []


def check(name, condition):
    checks.append({'name': name, 'pass': bool(condition)})
    if not condition:
        raise AssertionError(name)


def run(argv, name):
    result = subprocess.run(list(map(str, argv)), env=env, capture_output=True, text=True)
    log = out / (name + '.log')
    log.write_text(result.stdout + result.stderr)
    commands.append({'argv': list(map(str, argv)), 'exit_code': result.returncode, 'log': str(log)})
    check(name + ' exits zero', result.returncode == 0)
    return result


def pin(path):
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def function(path, name, class_name=None):
    tree = ast.parse(path.read_text())
    candidates = tree.body
    if class_name:
        candidates = next(n for n in candidates if isinstance(n, ast.ClassDef) and n.name == class_name).body
    node = copy.deepcopy(next(n for n in candidates if isinstance(n, ast.FunctionDef) and n.name == name))
    node.decorator_list = []
    namespace = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[name]


def sections(path):
    data = path.read_bytes()
    check(path.name + ' native Wasm magic', data[:8] == b'\0asm\1\0\0\0')
    offset = 8
    result = []

    def leb(pos):
        value = shift = 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, pos
            shift += 7

    while offset < len(data):
        kind = data[offset]
        size, body = leb(offset + 1)
        end = body + size
        name = None
        if kind == 0:
            length, text_start = leb(body)
            name = data[text_start:text_start + length].decode()
        result.append((kind, name, data[body:end]))
        offset = end
    check(path.name + ' exact section boundaries', offset == len(data))
    return result


rust_config = source / 'build/moz.configure/rust.configure'
frontend = source / 'python/mozbuild/mozbuild/frontend/context.py'
rust_flags = function(rust_config, 'rust_compile_flags')
debug = rust_flags('2', False, SimpleNamespace(kernel='Linux', cpu='wasm32'), True, True, [], [])
shipping = rust_flags('2', False, SimpleNamespace(kernel='Linux', cpu='wasm32'), False, True, [], [])
check('actual Rust debug configure branch emits debuginfo=2 and strip=none', 'debuginfo=2' in debug and 'strip=none' in debug)
check('actual Rust shipping branch omits DWARF flags', not any('debuginfo=' in flag or 'strip=' in flag for flag in shipping))
check('actual Rust shipping branch retains frame pointers', 'force-frame-pointers=yes' in shipping)
old_config = source.parent.parent / 'obj-nightly/config.status.json'
(out / 'retained-config.status.json').write_bytes(old_config.read_bytes())
old = json.loads((out / 'retained-config.status.json').read_text())['substs']
profile = tomllib.loads((source / 'Cargo.toml').read_text())['profile']['release']
check('actual Cargo release profile has no debug override', not profile.get('debug', False))
check('probe environment has no Cargo profile debug override', not any(key.startswith('CARGO_PROFILE_') and key.endswith('_DEBUG') for key in env))
for class_name in ['TargetCompileFlags', 'AsmFlags']:
    debug_flags = function(frontend, '_debug_flags', class_name)
    for enabled in [True, False]:
        substs = dict(old, MOZ_DEBUG=None, MOZ_DEBUG_SYMBOLS=enabled)
        context = SimpleNamespace(config=SimpleNamespace(substs=substs), get=lambda key: False)
        actual = debug_flags(SimpleNamespace(_context=context))
        check(class_name + ' actual no-symbol flag gating ' + str(enabled), bool(actual) == enabled)
check('retained baseline explicitly generated DWARF', bool(old.get('MOZ_DEBUG_SYMBOLS')) and '-gdwarf-4' in old['MOZ_DEBUG_FLAGS'])
check('shipping mozconfig disables debug symbols', 'ac_add_options --disable-debug-symbols' in (repo / 'tools/nightly-musl/recipe/mozconfig').read_text())
makefile = out / 'scope.mk'
makefile.write_text('OS_ARCH=Linux\nTARGET_CPU=wasm32\nPROGRAM=firefox\nCOMPUTED_LDFLAGS=-O2\ninclude ' + str(repo / 'tools/nightly-musl/adapters/defs.mk') + '\nall:\n\t@printf "%s\\n" "$(LDFLAGS)"\n')
for program in ['firefox', 'plugin-container', 'xpcshell', 'gfxtest']:
    flags = shlex.split(run(['make', '--no-print-directory', '-f', makefile, 'PROGRAM=' + program], 'scope-' + program).stdout)
    check(program + ' actual make strip-debug scope', ('-Wl,--strip-debug' in flags) == (program != 'gfxtest'))
    check(program + ' retains optimization flags', '-O2' in flags)
flags = run(['make', '--no-print-directory', '-f', makefile, 'TARGET_CPU=x86_64'], 'scope-other-architecture').stdout
check('non-Wasm platform receives no strip-debug flag', '--strip-debug' not in flags)
c = out / 'fixture.c'
c.write_text('int add(int x) { return x + 3; }\nint (*volatile indirect)(int) = add;\nint dispatch(int x) { return indirect(x); }\n')
cpp = out / 'fixture.cpp'
cpp.write_text('extern "C" int external();\nextern "C" int run(int n) { try { return external() + n; } catch (...) { return n - 1; } }\n')
for name, path, compiler, flags in [('c', c, env['CC'], []), ('cpp', cpp, env['CXX'], ['-fwasm-exceptions', '-Xclang', '-fc++-abi=webassembly'])]:
    for enabled in [True, False]:
        obj = out / (name + ('-debug' if enabled else '-shipping') + '.o')
        run([compiler, '-O2', *flags, *(['-gdwarf-4'] if enabled else []), '-c', path, '-o', obj], obj.stem)
        names = [s[1] for s in sections(obj)]
        check(obj.name + ' real DWARF emission follows configure', any(n and n.startswith('.debug_') for n in names) == enabled)
archive = out / 'libfixture-debug.a'
run([env['AR'], 'rcs', archive, out / 'c-debug.o', out / 'cpp-debug.o'], 'archive')
common = ['-O2', '-nostdlib', str(archive), '-Wl,--no-entry,--allow-undefined,--export=add,--export=dispatch,--export=run',
          '-Wl,--import-memory,--shared-memory,--max-memory=4294967296,--export-table,--growable-table,--export=__stack_pointer,-z,stack-size=8388608']
linked = {}
for strip in [False, True]:
    label = 'stripped' if strip else 'debug'
    output = out / (label + '.wasm')
    argv = [env['CC'], *common, *(['-Wl,--strip-debug'] if strip else []), '-o', output]
    trace = run([argv[0], '-###', *argv[1:]], label + '-driver-trace').stderr
    rows = [shlex.split(line) for line in trace.splitlines() if line.startswith(' "')]
    ld = next(row for row in rows if Path(row[0]).name == 'wasm-ld')
    optimizer = next(row for row in rows if Path(row[0]).name == 'wasm-opt')
    check(label + ' original automatic Binaryen -O2 retained', Path(optimizer[0]).name == 'wasm-opt' and optimizer[1:] == [str(output), '-O2', '-o', str(output)])
    check(label + ' strip-debug only at final linker', ('--strip-debug' in ld) == strip)
    preopt = out / (label + '-preopt.wasm')
    ld[ld.index('-o') + 1] = str(preopt)
    run(ld, label + '-preopt-link')
    run(argv, label + '-automatic-o2-link')
    for artifact in [preopt, output]:
        run(['wasm-validate', '--enable-all', artifact], artifact.stem + '-validate')
        linked[artifact.name] = sections(artifact)
        check(artifact.name + ' real archive DWARF removed before optimizer', any(n and n.startswith('.debug_') for _, n, _ in linked[artifact.name]) != strip)
for suffix in ['-preopt.wasm', '.wasm']:
    a = linked['debug' + suffix]
    b = linked['stripped' + suffix]
    # Binaryen coalesces local declarations without DWARF; code bytes can
    # differ after -O2 while retaining identical actual instructions.
    excluded = {0, 10} if suffix == '.wasm' else {0}
    check('noncustom link contract identical ' + suffix, [s for s in a if s[0] not in excluded] == [s for s in b if s[0] not in excluded])
    for kind, name in [(2, 'imports'), (4, 'table'), (6, 'globals/stack'), (7, 'exports'), (9, 'static elements'), (10, 'code')]:
        check('real ' + name + ' section present ' + suffix, any(s[0] == kind for s in b))
    check('native exception tag import retained ' + suffix, any(s[0] == 2 and b'__cpp_exception' in s[2] for s in b))
    disassembly = run(['wasm-objdump', '-d', out / ('stripped' + suffix)], 'stripped' + suffix + '-disassembly').stdout
    check('native Wasm catch instruction retained ' + suffix, 'catch ' in disassembly)
    if suffix == '.wasm':
        control_disassembly = run(['wasm-objdump', '-d', out / ('debug' + suffix)], 'debug' + suffix + '-disassembly').stdout
        instructions = lambda text: [line.split('|', 1)[1].strip() for line in text.splitlines() if '|' in line and 'local[' not in line and line.split('|', 1)[1].strip()]
        check('optimized actual instruction sequences identical', instructions(control_disassembly) == instructions(disassembly))
    check('target_features retained ' + suffix, [s for s in a if s[1] == 'target_features'] == [s for s in b if s[1] == 'target_features'])
js = out / 'execute.mjs'
js.write_text('''import fs from 'node:fs';
for (const path of process.argv.slice(2)) {
  const tag = new WebAssembly.Tag({parameters:['i32']});
  let throws = false;
  const env = { memory: new WebAssembly.Memory({initial:129, maximum:65536, shared:true}),
    __cpp_exception: tag, external: () => {if (throws) throw new WebAssembly.Exception(tag,[0]); return 10;},
    __cxa_begin_catch: value => value, __cxa_end_catch: () => {} };
  const {instance:{exports:e}} = await WebAssembly.instantiate(fs.readFileSync(path), {env});
  if (e.add(5) !== 8 || e.dispatch(6) !== 9 || e.run(8) !== 18) throw new Error('normal call failed');
  throws = true;
  if (e.run(8) !== 7) throw new Error('native Wasm catch failed');
  console.log(JSON.stringify({path,normal:true,indirect:true,nativeCatch:true}));
}
''')
run(['node', js, out / 'debug.wasm', out / 'stripped.wasm'], 'real-native-wasm-execution')
rust = out / 'fixture.rs'
rust.write_text('#![no_std]\n#[unsafe(no_mangle)]\npub extern "C" fn rust_add(x: i32) -> i32 { x.wrapping_add(3) }\n')
env['RUST_TARGET_PATH'] = str(repo / 'tools/nightly-musl/recipe/rust-target')
rustc = '/nix/store/m1lr4f6ghlmi7qls1x6x3gig8cxahjjl-rust-nightly-complete-with-components-2026-07-22/bin/rustc'
for enabled in [True, False]:
    output = out / ('rust-debug.o' if enabled else 'rust-shipping.o')
    run([rustc, '--sysroot', '/nix/store/il527fj9xjncr0p64rwvlh3m9qs9jqza-rust-sysroot-wasm32-unknown-linux-musl', '-Zunstable-options', '--target', 'wasm32-unknown-linux-musl', '--crate-type=lib', '--emit=obj', '-C', 'opt-level=2', *(debug if enabled else shipping), rust, '-o', output], output.stem)
    check(output.name + ' real Rust DWARF follows configure branch', any(n and n.startswith('.debug_') for _, n, _ in sections(output)) == enabled)
result = {'claim': 'Fresh no-DWARF configuration preparation and real small native-Wasm archive/link checks; no full-browser or guest acceptance',
          'releaseAcceptance': False, 'source': str(source), 'output': str(out), 'checks': checks,
          'passed': len(checks), 'failed': 0, 'rust_debug_flags': debug, 'rust_shipping_flags': shipping,
          'commands': commands, 'pins': [pin(p) for p in [rust_config, frontend, source / 'Cargo.toml', repo / 'tools/nightly-musl/recipe/mozconfig', repo / 'tools/nightly-musl/adapters/defs.mk', Path(__file__).resolve()]] + [pin(p) for p in out.iterdir() if p.is_file()]}
(out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'passed': len(checks), 'failed': 0, 'result': str(out / 'result.json')}))
