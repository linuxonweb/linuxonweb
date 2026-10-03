from pathlib import Path
import hashlib,json,subprocess
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');P=T/'llama-mapping-preflight';S=T/'source/firefox-159.0a1';base=S/'third_party/llama.cpp'
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
flags=['-std=c++17','-Xclang','-fc++-abi=webassembly','-D_GNU_SOURCE','-DGGML_USE_CPU','-DGGML_CPU_GENERIC','-I'+str(T/'recipe/shim'),*['-I'+str(base/d) for d in ('','ggml','ggml/include','ggml/src','ggml/src/ggml-cpu','include','src')]]
source=base/'src/llama-mmap.cpp';results={}
for fixed in (False,True):
 name='fixed' if fixed else 'original';p=source if fixed else P/'original-llama-mmap.cpp';argv=[env['CXX'],*flags,'-c',str(p),'-o',str(P/(name+'.o'))]
 run=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=120);(P/(name+'.log')).write_text(run.stdout+run.stderr)
 if fixed:assert run.returncode==0 and (P/'fixed.o').read_bytes()[:8]==b'\0asm\x01\0\0\0',run.stderr
 else:assert run.returncode!=0 and all("undeclared identifier '"+s+"'" in run.stderr for s in ('MAP_POPULATE','mlock','munlock')),run.stderr
 results[name]=dict(exit=run.returncode,argv=argv)
nm=Path(env['AR']).with_name('nm');run=subprocess.run([str(nm),'--undefined-only',str(P/'fixed.o')],env=env,capture_output=True,text=True,timeout=30);assert run.returncode==0,run.stderr
(P/'undefined-symbols.txt').write_text(run.stdout);symbols={l.split()[-1] for l in run.stdout.splitlines() if l.split()}
assert not symbols.intersection({'mlock','munlock'}) and {'mmap','munmap','posix_madvise','posix_fadvise'}<=symbols
wrapper=P/'capabilities.cpp';wrapper.write_text('#include "llama-mmap.h"\nextern "C" int mapping_supported() { return llama_mmap::SUPPORTED; }\nextern "C" int locking_supported() { return llama_mlock::SUPPORTED; }\n')
argv=[env['CXX'],*flags,'-nostdlib','-Wl,--no-entry','-Wl,--export=mapping_supported','-Wl,--export=locking_supported',str(wrapper),str(P/'fixed.o'),'-o',str(P/'capabilities.wasm')]
run=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=30);(P/'link.log').write_text(run.stdout+run.stderr);assert run.returncode==0,run.stderr
js="const fs=require('fs');const m=new WebAssembly.Module(fs.readFileSync(process.argv[1]));if(WebAssembly.Module.imports(m).length)throw Error('imports');const e=new WebAssembly.Instance(m).exports;if(e.mapping_supported()!==1||e.locking_supported()!==0)throw Error('capabilities');process.stdout.write(JSON.stringify({mappingSupported:true,lockingSupported:false,imports:0,nativeWasmRuntime:true}));"
run=subprocess.run(['node','-e',js,str(P/'capabilities.wasm')],env=env,capture_output=True,text=True,timeout=30);(P/'runtime.log').write_text(run.stdout+run.stderr);assert run.returncode==0,run.stderr
# Ordinary host Linux retains its real mlock/munlock calls.
argv_host=['c++','-std=c++17','-D_GNU_SOURCE',*['-I'+str(base/d) for d in ('','ggml','ggml/include','ggml/src','ggml/src/ggml-cpu','include','src')],'-c',str(source),'-o',str(P/'host.o')]
host=subprocess.run(argv_host,env=env,capture_output=True,text=True,timeout=120);(P/'host.log').write_text(host.stdout+host.stderr);assert host.returncode==0,host.stderr
hostnm=subprocess.run(['nm','--undefined-only',str(P/'host.o')],env=env,capture_output=True,text=True,timeout=30);assert hostnm.returncode==0 and ' mlock' in hostnm.stdout,hostnm.stderr;(P/'host-undefined.txt').write_text(hostnm.stdout)
hostpp=subprocess.run(['c++',*argv_host[1:-4],'-E',str(source)],env=env,capture_output=True,text=True,timeout=30);assert hostpp.returncode==0 and 'if (!mlock(addr, size))' in hostpp.stdout and 'if (munlock(addr, size))' in hostpp.stdout; (P/'host-preprocessed.cpp').write_text(hostpp.stdout)
pins=[]
for p in [Path(__file__),source,T/'recipe/environment.sh',*P.iterdir()]:
 if p.is_file() and p.name!='result.json':
  b=p.read_bytes();pins.append(dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
(P/'result.json').write_text(json.dumps(dict(claim='Paired actual source native compilation, actual module capability exports and host Linux symbol preservation; no guest mapping/locking/inference/browser acceptance',results=results,native_link_argv=argv,nm_argv=[str(nm),'--undefined-only',str(P/'fixed.o')],native_runtime=json.loads(run.stdout),host_compile_argv=argv_host,host_exit=host.returncode,pins=pins,guestAcceptance=False,releaseAcceptance=False),indent=2)+'\n')
print(json.dumps(dict(native_runtime=json.loads(run.stdout),host_exit=host.returncode)))
