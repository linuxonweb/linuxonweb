from pathlib import Path
import hashlib,json,subprocess
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
P=T/'fenv-preflight'; S=T/'source/firefox-159.0a1'
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
def extract(source):
    start=source.index('  const char* mode_str = "unknown";',source.index('static nsCString GetFPUControlState()'))
    end=source.index('  result.AppendLiteral("std:");',start)
    return source[start:end]
source=S/'toolkit/components/resistfingerprinting/nsUserCharacteristics.cpp'
results={}
for fixed in (False,True):
    name='fixed' if fixed else 'original'
    p=source if fixed else P/'original-nsUserCharacteristics.cpp'
    unit='#include <cfenv>\nextern "C" int mode_for(int std_mode) {\n'+extract(p.read_text())+'return mode_str[0]==\'u\' ? -1 : mode_str[0]-\'0\';\n}\n'
    (P/(name+'.cpp')).write_text(unit)
    argv=[env['CXX'],'-std=c++20','-Xclang','-fc++-abi=webassembly','-c',str(P/(name+'.cpp')),'-o',str(P/(name+'.o'))]
    run=subprocess.run(argv,env=env,capture_output=True,text=True)
    (P/(name+'.log')).write_text(run.stdout+run.stderr)
    if fixed:
        assert run.returncode==0 and (P/(name+'.o')).read_bytes()[:8]==b'\0asm\x01\0\0\0',run.stderr
    else:
        assert run.returncode!=0 and all(s in run.stderr for s in ('FE_DOWNWARD','FE_UPWARD','FE_TOWARDZERO')),run.stderr
    results[name]=dict(exit=run.returncode,argv=argv)
argv=[env['CXX'],'-nostdlib','-Wl,--no-entry','-Wl,--export=mode_for',str(P/'fixed.o'),'-o',str(P/'rounding.wasm')]
run=subprocess.run(argv,env=env,capture_output=True,text=True);assert run.returncode==0,run.stderr
(P/'native-link.log').write_text(run.stdout+run.stderr)
js='''const fs=require('fs'); const m=new WebAssembly.Module(fs.readFileSync(process.argv[1]));
if(WebAssembly.Module.imports(m).length) throw Error('unexpected imports');
const e=new WebAssembly.Instance(m).exports;
const expected=[[0,0],[1,-1],[2,-1],[3,-1],[-1,-1],[2147483647,-1]];
for(const [input,result] of expected) if(e.mode_for(input)!==result) throw Error('wrong telemetry');
process.stdout.write(JSON.stringify({cases:expected,imports:0,nativeWasmRuntime:true}));'''
run=subprocess.run(['node','-e',js,str(P/'rounding.wasm')],env=env,capture_output=True,text=True);assert run.returncode==0,run.stderr
(P/'native-runtime.log').write_text(run.stdout+run.stderr)
host='#include <cfenv>\n#include <cassert>\nextern "C" int mode_for(int std_mode) {\n'+extract(source.read_text())+'return mode_str[0]==\'u\' ? -1 : mode_str[0]-\'0\';\n}\nint main() { int old=std::fegetround(); for(auto pair : {std::pair{FE_TONEAREST,0},std::pair{FE_DOWNWARD,1},std::pair{FE_UPWARD,2},std::pair{FE_TOWARDZERO,3}}) { assert(std::fesetround(pair.first)==0); assert(mode_for(std::fegetround())==pair.second); } assert(mode_for(-1)==-1); assert(std::fesetround(old)==0); }\n'
host=host.replace('#include <cassert>','#include <cassert>\n#include <utility>\n#include <initializer_list>')
(P/'host.cpp').write_text(host)
host_argv=['/usr/bin/c++','-std=c++20',str(P/'host.cpp'),'-o',str(P/'host')]
run=subprocess.run(host_argv,env=env,capture_output=True,text=True);assert run.returncode==0,run.stderr
(P/'host-compile.log').write_text(run.stdout+run.stderr)
run=subprocess.run([str(P/'host')],env=env,capture_output=True,text=True);assert run.returncode==0,run.stderr
(P/'host-runtime.log').write_text(run.stdout+run.stderr)
pins=[]
for p in [Path(__file__),source,Path('/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/bits/fenv.h'),T/'recipe/environment.sh',*P.iterdir()]:
    if p.is_file() and p.name != 'result.json':
        b=p.read_bytes();pins.append(dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
proof=dict(claim='Actual telemetry switch native compilation/execution and host real four-rounding-mode preservation; browser and guest FPU acceptance pending',results=results,native_link_argv=argv,native_runtime=json.loads((P/'native-runtime.log').read_text()),host_argv=host_argv,host_runtime_exit=run.returncode,pins=pins,guestAcceptance=False,releaseAcceptance=False)
(P/'result.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(results=results,native_runtime=proof['native_runtime'],host_runtime_exit=run.returncode)))
