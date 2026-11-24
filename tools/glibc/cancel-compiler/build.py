#!/usr/bin/env python3
"""Sparse owned frontend/backend rebuild, ordered archive replacement and driver relink."""
from common import *
import shlex,importlib.util,concurrent.futures
R=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('audit',R.parent/'c-cleanup/archive-audit.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
budget(True);D=T/'source-snapshots/compiler';O=T/'objects/compiler';G=T/'objects/generated';G.mkdir(exist_ok=True)
changes=json.loads((T/'source-changes.json').read_text())
for rel,row in changes.items():assert sha(S/rel)==row['original'] and sha(row['path'])==row['owned']
overlay={'version':0,'roots':[{'type':'file','name':str(S/rel),'external-contents':row['path']} for rel,row in changes.items()]};(T/'overlay.json').write_text(json.dumps(overlay,indent=2)+'\n')
flags=shlex.split(subprocess.check_output([str(L/'bin/llvm-config'),'--cxxflags']).decode())+['-DNDEBUG','-O1','-g0','-ivfsoverlay',str(T/'overlay.json'),'-I'+str(S/'clang/lib/CodeGen'),'-I'+str(G),'-I'+str(S/'llvm/lib/Target/WebAssembly')]
for kind,action in [('RegisterInfo','-gen-register-info'),('InstrInfo','-gen-instr-info'),('SubtargetInfo','-gen-subtarget'),('SDNodeInfo','-gen-sd-node-info')]:
 run('tablegen-'+kind,[L/'bin/llvm-tblgen',action,'-I',S/'llvm/include','-I',S/'llvm/lib/Target/WebAssembly',S/'llvm/lib/Target/WebAssembly/WebAssembly.td','-o',G/('WebAssemblyGen'+kind+'.inc')])
units=['clang/lib/CodeGen/CGStmt.cpp','clang/lib/CodeGen/CodeGenFunction.cpp','llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp']
def compile(rel):
 name=pathlib.Path(rel).name+'.o';return run('compile-'+name,['/usr/bin/clang++',*flags,'-MD','-MF',T/'logs'/(name+'.d'),'-c',S/rel,'-o',O/name])
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(compile,units))
archives=[(P/'libclangCodeGen.a',O/'libclangCodeGen.a',['CGStmt.cpp.o','CodeGenFunction.cpp.o']),(L/'lib/libLLVMWebAssemblyCodeGen.a',O/'libLLVMWebAssemblyCodeGen.a',['WebAssemblyFrameLowering.cpp.o'])]
proof=[]
for base,owned,members in archives:
 before=audit.members(base);shutil.copyfile(base,owned)
 run('replace-'+owned.stem,[L/'bin/llvm-ar','r',owned,*[O/m for m in members]])
 after=audit.members(owned);assert [x['name'] for x in before]==[x['name'] for x in after]
 changed=[i for i,(a,b) in enumerate(zip(before,after)) if a!=b];assert sorted(before[i]['name'] for i in changed)==sorted(members)
 proof.append({'base':str(base),'baseSha256':sha(base),'owned':str(owned),'ownedSha256':sha(owned),'before':before,'after':after,'changedIndices':changed})
(T/'logs/archive-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
clanglibs=[str(p) for p in sorted((L/'lib').glob('libclang*.a')) if p.name!='libclangCodeGen.a']
llvmlibs=shlex.split(subprocess.check_output([str(L/'bin/llvm-config'),'--libfiles','all']).decode());llvmlibs=[str(O/'libLLVMWebAssemblyCodeGen.a') if pathlib.Path(p).name=='libLLVMWebAssemblyCodeGen.a' else p for p in llvmlibs]
syslibs=shlex.split(subprocess.check_output([str(L/'bin/llvm-config'),'--system-libs']).decode())
driver=[P/n for n in ['driver.cpp.o','cc1_main.cpp.o','cc1as_main.cpp.o','cc1gen_reproducer_main.cpp.o','main.cpp.o']]
inputs=driver+[O/'libclangCodeGen.a']+[pathlib.Path(p) for p in clanglibs+llvmlibs]
pins={str(p):sha(p) for p in inputs};(T/'logs/link-inputs.json').write_text(json.dumps(pins,indent=2)+'\n')
run('link-driver',['/usr/bin/g++','-fuse-ld=lld','-o',O/'clang',*driver,'-Wl,--start-group',O/'libclangCodeGen.a',*clanglibs,*llvmlibs,'-Wl,--end-group',*syslibs,'-pthread'])
assert all(sha(p)==h for p,h in pins.items())
run('driver-version',[O/'clang','--version'])
(T/'build-result.json').write_text(json.dumps({'pass':True,'compiler':str(O/'clang'),'sha256':sha(O/'clang'),'archiveProof':sha(T/'logs/archive-proof.json'),'sources':changes,'storage':budget()},indent=2)+'\n')
