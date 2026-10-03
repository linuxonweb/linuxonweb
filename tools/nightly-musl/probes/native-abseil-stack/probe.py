from pathlib import Path
import hashlib, json, os, subprocess

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
P = T/'abseil-stack-preflight'
S = T/'source/firefox-159.0a1'
env = dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
results = {}
for fixed in (False, True):
    name = 'fixed' if fixed else 'original'
    source = S/'third_party/abseil-cpp/absl/debugging/internal/examine_stack.cc' if fixed else P/'original-examine_stack.cc'
    argv = [env['CXX'],'-std=c++20','-Xclang','-fc++-abi=webassembly','-D_GNU_SOURCE','-I'+str(T/'recipe/shim'),'-I'+str(S/'third_party/abseil-cpp'),'-c',str(source),'-o',str(P/(name+'.o'))]
    run = subprocess.run(argv, env=env, capture_output=True, text=True)
    (P/(name+'.log')).write_text(run.stdout+run.stderr)
    if fixed:
        assert run.returncode == 0, run.stderr
        assert (P/(name+'.o')).read_bytes()[:8] == b'\0asm\x01\0\0\0'
    else:
        assert run.returncode != 0 and 'Undefined Architecture.' in run.stderr, run.stderr
    results[name] = dict(exit=run.returncode, argv=argv)
source = (S/'third_party/abseil-cpp/absl/debugging/internal/examine_stack.cc').read_text()
start = source.index('void* GetProgramCounter(void* const vuc) {')
end = source.index('\nvoid DumpPCAndFrameSizesAndStackTrace',start)
function = source[start:end]
unit = '#include <sys/ucontext.h>\n#include <iterator>\n'+function+'\nextern "C" void* program_counter(void* p) { return GetProgramCounter(p); }\n'
(P/'native-counter.cpp').write_text(unit)
argv = [env['CXX'],'-std=c++20','-D_GNU_SOURCE','-Xclang','-fc++-abi=webassembly','-nostdlib','-Wl,--no-entry','-Wl,--export=program_counter',str(P/'native-counter.cpp'),'-o',str(P/'native-counter.wasm')]
run = subprocess.run(argv,env=env,capture_output=True,text=True)
(P/'native-counter-link.log').write_text(run.stdout+run.stderr)
assert run.returncode == 0, run.stderr
js = '''const fs = require('fs');
const m = new WebAssembly.Module(fs.readFileSync(process.argv[1]));
if (WebAssembly.Module.imports(m).length) throw Error('unexpected imports');
const e = new WebAssembly.Instance(m).exports;
const inputs = [0, 1, 16, 0x7fffffff, -1];
for (const p of inputs) if (e.program_counter(p) !== 0) throw Error('unexpected PC');
process.stdout.write(JSON.stringify({inputs, result: 0, imports: 0, nativeWasmRuntime: true}));'''
run = subprocess.run(['node','-e',js,str(P/'native-counter.wasm')],env=env,capture_output=True,text=True)
(P/'native-counter-runtime.log').write_text(run.stdout+run.stderr)
assert run.returncode == 0, run.stderr
runtime = json.loads(run.stdout)
pins = []
for p in [Path(__file__),S/'third_party/abseil-cpp/absl/debugging/internal/examine_stack.cc',T/'recipe/environment.sh',Path('/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/bits/signal.h'),*P.iterdir()]:
    if p.is_file():
        b=p.read_bytes(); pins.append(dict(path=str(p), bytes=len(b), sha256=hashlib.sha256(b).hexdigest()))
proof = dict(claim='Paired actual source compilation and host execution of extracted native-Wasm unknown-PC fallback only; no guest signal or browser acceptance',results=results,native_counter_link_argv=argv,runtime=runtime,pins=pins,guestAcceptance=False,releaseAcceptance=False)
(P/'result.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(results=results,runtime=runtime)))
