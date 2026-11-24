#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
target=S/'llvm/lib/Target/WebAssembly'
files=[target/name for name in ['WebAssemblyCFGStackify.cpp','WebAssemblyLateEHPrepare.cpp','WebAssemblyFrameLowering.cpp','WebAssemblyLowerEmscriptenEHSjLj.cpp','WebAssemblyTargetMachine.cpp','WebAssemblyISelDAGToDAG.cpp','WebAssemblyInstrControl.td','WebAssemblyMachineFunctionInfo.h','WebAssemblyInstrInfo.h','WebAssemblyRegisterInfo.h','WebAssemblySubtarget.h','WebAssemblySelectionDAGInfo.h','MCTargetDesc/WebAssemblyMCTargetDesc.h']]
files += [L/'bin'/name for name in ['llvm-config','llvm-tblgen','llvm-ar','llc','llvm-nm','wasm-ld','clang']]
files += [C,L/'lib/libLLVMWebAssemblyCodeGen.a',P/'logs/prepared-acceptance.json',P/'logs/object-pins.json',P/'objects/routes.bc',P/'logs/routes-results.json']
files += [p for p in R.iterdir() if p.is_file()]
files += [p for p in (T/'source').glob('*') if p.is_file()]
version=sys.argv[1] if len(sys.argv)>1 else "initial"
rows=[]
for n,p in enumerate(files):
 row={'path':str(p),**pin(p)}
 if p.suffix in ['.cpp','.h','.td','.py','.bc','.json'] and p.stat().st_size<8388608:
  q=T/('source/plan-pins-'+version)/str(n)/p.name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());row['snapshot']=str(q)
 rows.append(row)
(T/'logs'/('plan-source-pins-'+version+'.json')).write_text(json.dumps(rows,indent=2)+'\n')
print('plan rows',len(rows),'manifest',pin(T/'logs'/('plan-source-pins-'+version+'.json')),'patch',pin(T/'logs/compiler.patch'))
