from pathlib import Path
import hashlib,json,subprocess
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
P=T/'ggml-backtrace-preflight'; S=T/'source/firefox-159.0a1'
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
base=S/'third_party/llama.cpp';source=base/'ggml/src/ggml-c.c';results={}
for fixed in (False,True):
    name='fixed' if fixed else 'original';p=source if fixed else P/'original-ggml-c.c'
    argv=[env['CC'],'-std=c11','-D_GNU_SOURCE','-DGGML_USE_CPU','-DGGML_CPU_GENERIC','-DGGML_VERSION="nightly-probe"','-DGGML_COMMIT="nightly-probe"','-I'+str(T/'recipe/shim'),*['-I'+str(base/d) for d in ('ggml','ggml/include','ggml/src','ggml/src/ggml-cpu','include','src')],'-c',str(p),'-o',str(P/(name+'.o'))]
    run=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=120)
    (P/(name+'.log')).write_text(run.stdout+run.stderr)
    if fixed:
        assert run.returncode==0 and (P/(name+'.o')).read_bytes()[:8]==b'\0asm\x01\0\0\0',run.stderr
    else:
        assert run.returncode!=0 and "undeclared function 'fork'" in run.stderr,run.stderr
    results[name]=dict(exit=run.returncode,argv=argv)
nm=Path(env['AR']).with_name('nm')
run=subprocess.run([str(nm),'--undefined-only',str(P/'fixed.o')],env=env,capture_output=True,text=True,timeout=30);assert run.returncode==0,run.stderr
(P/'undefined-symbols.txt').write_text(run.stdout)
check_symbols=[line.split()[-1] for line in run.stdout.splitlines() if line.split()]
assert 'abort' in check_symbols and all(s not in check_symbols for s in ('fork','execlp','waitpid'))
argv=[env['CC'],'-nostdlib','-Wl,--no-entry','-Wl,--export=ggml_print_backtrace',str(P/'fixed.o'),'-o',str(P/'backtrace.wasm')]
run=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=30);assert run.returncode==0,run.stderr
(P/'native-link.log').write_text(run.stdout+run.stderr)
js='''const fs=require('fs');const m=new WebAssembly.Module(fs.readFileSync(process.argv[1]));
if(WebAssembly.Module.imports(m).length)throw Error('unexpected imports');
const e=new WebAssembly.Instance(m).exports;
for(let i=0;i<100;i++)if(e.ggml_print_backtrace()!==undefined)throw Error('unexpected result');
process.stdout.write(JSON.stringify({calls:100,imports:0,nativeWasmRuntime:true}));'''
run=subprocess.run(['node','-e',js,str(P/'backtrace.wasm')],env=env,capture_output=True,text=True,timeout=30);assert run.returncode==0,run.stderr
(P/'native-runtime.log').write_text(run.stdout+run.stderr)
pins=[]
for p in [Path(__file__),source,T/'recipe/environment.sh',*P.iterdir()]:
    if p.is_file() and p.name!='result.json':
        b=p.read_bytes();pins.append(dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
proof=dict(claim='Paired actual ggml source native compilation, preserved abort undefined symbol and isolated native fallback execution; no guest inference/browser/fatal-path acceptance',results=results,native_link_argv=argv,nm_argv=[str(nm),'--undefined-only',str(P/'fixed.o')],native_runtime=json.loads(run.stdout),pins=pins,guestAcceptance=False,releaseAcceptance=False)
(P/'result.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(dict(results=results,native_runtime=proof['native_runtime'])))
