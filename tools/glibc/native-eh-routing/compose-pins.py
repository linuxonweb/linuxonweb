#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
version=sys.argv[1] if len(sys.argv)>1 else ''
manifest=T/'logs'/('compose-source-pins'+('-'+version if version else '')+'.json')
assert not manifest.exists(), 'versioned/new manifest required for retry'
A=pathlib.Path('/mnt/p6/build/glibc-cancel-compiler-20261002');out=[]
files=[R/n for n in ['common.py','compose.py','compose-tests.py','compose-test.mjs']]
files += [A/n for n in ['compiler.patch','review.json','build-result.json','actual-inputs.json','test-result.json']]
files += [A/'objects/compiler'/n for n in ['WebAssemblyFrameLowering.cpp.o','clang']]
files += [R.parent/'cancel-compiler'/n for n in ['test.mjs','stack.S','runtime.c','controls.c','controls.cpp']]
files += [A/'objects/controls'/f'{opt}-{src}.ll' for opt in ['O0','O2','O3'] for src in ['controls.c','controls.cpp']]
files += [A/'objects/controls/runtime.o',L/'lib/libLLVMWebAssemblyCodeGen.a',T/'objects/WebAssemblyCFGStackify.cpp.o',T/'source/WebAssemblyCFGStackify.cpp',T/'logs/compiler.patch',T/'objects/llc.cpp.o',T/'objects/NewPMDriver.cpp.o']
for i,p in enumerate(files):
 q=T/'source'/('compose-pins'+('-'+version if version else ''))/str(i)/p.name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());out.append({'path':str(p),'snapshot':str(q),**pin(p)})
manifest.write_text(json.dumps(out,indent=2)+'\n');print(len(out),pin(manifest))
