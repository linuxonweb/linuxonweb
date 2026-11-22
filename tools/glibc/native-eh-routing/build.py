#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import shlex,shutil,importlib.util
G=T/'objects/generated';G.mkdir(exist_ok=True)
target=S/'llvm/lib/Target/WebAssembly'
run('llvm-cxx-flags',[L/'bin/llvm-config','--cxxflags'])
flags=shlex.split(pathlib.Path(rows[-1]['log']).read_text())+['-DNDEBUG','-O1','-g0','-I'+str(G),'-I'+str(target)]
assert '-fno-exceptions' in flags and '-fno-rtti' in flags
for kind,action in [('RegisterInfo','-gen-register-info'),('InstrInfo','-gen-instr-info'),('SubtargetInfo','-gen-subtarget'),('SDNodeInfo','-gen-sd-node-info')]:
 run('tablegen-'+kind,[L/'bin/llvm-tblgen',action,'-I',S/'llvm/include','-I',target,target/'WebAssembly.td','-d',T/'logs'/('tablegen-'+kind+'.d'),'-o',G/('WebAssemblyGen'+kind+'.inc')])
for name in ['WebAssemblyCFGStackify.cpp','llc.cpp','NewPMDriver.cpp']:
 run('compile-'+name,['/usr/bin/g++',*flags,'-MD','-MF',T/'logs'/(name+'.d'),'-c',T/'source'/name,'-o',T/'objects'/(name+'.o')])
spec=importlib.util.spec_from_file_location('ordered_archive_audit',R.parent/'c-cleanup/archive-audit.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
original=L/'lib/libLLVMWebAssemblyCodeGen.a';private=T/'objects/libLLVMWebAssemblyCodeGen.a';before=audit.members(original);shutil.copyfile(original,private)
run('replace-target-member',[L/'bin/llvm-ar','r',private,T/'objects/WebAssemblyCFGStackify.cpp.o'])
after=audit.members(private);assert [x['name'] for x in before]==[x['name'] for x in after]
changed=[i for i,(a,b) in enumerate(zip(before,after)) if a!=b]
assert [before[i]['name'] for i in changed]==['WebAssemblyCFGStackify.cpp.o']
(T/'logs/archive-proof.json').write_text(json.dumps({'original':str(original),'originalPin':pin(original),'private':str(private),'privatePin':pin(private),'before':before,'after':after,'changedIndices':changed},indent=2)+'\n')
run('llvm-all-libfiles',[L/'bin/llvm-config','--libfiles','all']);libs=shlex.split(pathlib.Path(rows[-1]['log']).read_text())
libs=[str(private) if pathlib.Path(p).name==private.name else p for p in libs]
run('llvm-system-libs',[L/'bin/llvm-config','--system-libs']);syslibs=shlex.split(pathlib.Path(rows[-1]['log']).read_text())
run('link-private-llc',['/usr/bin/g++','-fuse-ld=lld','-o',T/'objects/llc',T/'objects/llc.cpp.o',T/'objects/NewPMDriver.cpp.o','-Wl,--start-group',*libs,'-Wl,--end-group',*syslibs,'-pthread'])
run('private-llc-version',[T/'objects/llc','--version'])
(T/'logs/build-results.json').write_text(json.dumps({'pass':True,'privateLLC':str(T/'objects/llc'),'compilerPin':pin(T/'objects/llc'),'changedMember':'WebAssemblyCFGStackify.cpp.o','archiveProof':pin(T/'logs/archive-proof.json'),'scope':'Sparse opt-in legacy EH backend prototype only; no frontend or GNU source changes'},indent=2)+'\n')
