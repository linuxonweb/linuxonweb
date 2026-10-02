#!/usr/bin/env python3
"""Object controls and unchanged native C++ frontend path; no libc++abi runtime claim."""
import pathlib,os,subprocess,json,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);D=T/'logs/controls';S=T/'source-snapshots/controls';rows=[]
cpp=S/'cpp.cpp';cpp.write_text('extern void may_throw(); extern void release(int*); struct Guard {int v; ~Guard(){release(&v);} }; int cpp_scope(){Guard g{23};may_throw();return g.v;}\n')
def command(cmd):
 p=subprocess.run(cmd,capture_output=True);rows.append({'argv':cmd,'cwd':os.getcwd(),'exit':p.returncode,'stderr':p.stderr.decode()});assert p.returncode==0
for kind,cc in [('original',L/'bin/clang'),('owned',T/'objects/compiler/clang')]:
 out=D/('cpp-EH-'+kind+'.ll');command([str(cc),'--target=wasm32-unknown-linux-gnu','-std=c++17','-nostdinc','-O0','-fexceptions','-fwasm-exceptions','-Xclang','-disable-llvm-passes','-S','-emit-llvm',str(cpp),'-o',str(out)])
assert (D/'cpp-EH-original.ll').read_bytes()==(D/'cpp-EH-owned.ll').read_bytes()
objectHashes={}
for name in ['ordinary','disabled-EH']:
 hashes=[]
 for kind in ['original','owned']:
  ir=D/(name+'-'+kind+'.ll');opt=D/(name+'-'+kind+'.opt.bc');obj=D/(name+'-'+kind+'.o')
  command([str(L/'bin/opt'),'-passes=default<O2>',str(ir),'-o',str(opt)])
  command([str(L/'bin/llc'),'-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',str(opt),'-o',str(obj)])
  data=obj.read_bytes();assert data[:8]==b'\0asm\1\0\0\0';hashes.append(hashlib.sha256(data).hexdigest())
 assert hashes[0]==hashes[1],name;objectHashes[name]=hashes[0]
(D/'object-result.json').write_text(json.dumps({'pass':True,'ordinaryAndDisabledEHObjectsIdentical':objectHashes,'CXXRawIRIdentical':True,'scope':'unchanged C++ frontend raw IR, no C++ throw/runtime/ABI closure claim','commands':rows},indent=2)+'\n');print('object and C++ frontend controls PASS')
