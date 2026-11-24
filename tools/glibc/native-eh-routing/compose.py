#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import shutil,importlib.util,shlex
accepted=pathlib.Path('/mnt/p6/build/glibc-cancel-compiler-20261002/objects/compiler/WebAssemblyFrameLowering.cpp.o')
assert pin(accepted)['sha256']=='cd5c088f0596ee87989c964e1f63644d124dcb11120ed20aa8d07801ab195e5f'
spec=importlib.util.spec_from_file_location('ordered_archive_audit',R.parent/'c-cleanup/archive-audit.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
D=T/'objects/composed';D.mkdir() # Refuse rerun: retain this attempt; retries require a new owned path.
original=L/'lib/libLLVMWebAssemblyCodeGen.a';private=D/'libLLVMWebAssemblyCodeGen.a';before=audit.members(original);shutil.copyfile(original,private)
run('compose-replace-two-members',[L/'bin/llvm-ar','r',private,T/'objects/WebAssemblyCFGStackify.cpp.o',accepted])
after=audit.members(private);assert len(before)==45 and [x['name'] for x in before]==[x['name'] for x in after]
changed=[i for i,(a,b) in enumerate(zip(before,after)) if a!=b]
assert sorted(before[i]['name'] for i in changed)==['WebAssemblyCFGStackify.cpp.o','WebAssemblyFrameLowering.cpp.o']
(T/'logs/compose-archive-proof.json').write_text(json.dumps({'before':before,'after':after,'changedIndices':changed,'original':str(original),'originalPin':pin(original),'privatePin':pin(private),'acceptedFrameLowering':str(accepted),'acceptedPin':pin(accepted)},indent=2)+'\n')
run('compose-llvm-libfiles',[L/'bin/llvm-config','--libfiles','all']);libs=shlex.split(pathlib.Path(rows[-1]['log']).read_text());libs=[str(private) if pathlib.Path(p).name==private.name else p for p in libs]
run('compose-llvm-systemlibs',[L/'bin/llvm-config','--system-libs']);syslibs=shlex.split(pathlib.Path(rows[-1]['log']).read_text())
run('compose-link-private-llc',['/usr/bin/g++','-fuse-ld=lld','-o',D/'llc',T/'objects/llc.cpp.o',T/'objects/NewPMDriver.cpp.o','-Wl,--start-group',*libs,'-Wl,--end-group',*syslibs,'-pthread'])
run('compose-version',[D/'llc','--version'])
