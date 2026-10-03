#!/usr/bin/env python3
"""Finite compile/IR controls, explicitly no runtime or public ABI acceptance."""
import sys
sys.dont_write_bytecode=True
import json
from common import T,R,L,C,pin,run
compiler=T/'objects/compiler-consumer21/clang'
peer=T.parent/'glibc-native-frame-plan-20261002/module4-proposal-20/objects/compiler/clang'
out=T/'objects/consumer21-controls-1';out.mkdir()
source=R/'consumer-controls.c'
flags=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-fno-builtin',
       '-fno-stack-protector','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory']
mode=['-mllvm','-wasm-gnu-cancel-prerequisite','-mllvm','-wasm-gnu-frame-records',
      '-mllvm','-wasm-gnu-frame-forced-admission','-mllvm','-wasm-gnu-forced-unwind',
      '-mllvm','-wasm-enable-sjlj','-mllvm','-wasm-native-eh-routing',
      '-mllvm','-verify-machineinstrs']
pins={str(p):pin(p) for p in [compiler,peer,C,source,R/'test-consumer21.py',R/'common.py']}
plan={'scope':'compiler controls only','runtimeAcceptance':False,'pins':pins,'mode':mode,'flags':flags}
(T/'logs/consumer21-controls-1-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
try:
 for opt in [0,2,3]:
  for tool,name in [(compiler,'candidate'),(peer,'peer')]:
   run(f'consumer21-controls-O{opt}-off-{name}',[tool,*flags,f'-O{opt}','-c',source,'-o',out/f'O{opt}-{name}-off.o'])
  assert (out/f'O{opt}-candidate-off.o').read_bytes()==(out/f'O{opt}-peer-off.o').read_bytes()
  run(f'consumer21-controls-O{opt}-front',[compiler,*flags,*mode,f'-O{opt}',
       '-emit-llvm','-c',source,'-o',out/f'O{opt}.bc'])
  run(f'consumer21-controls-O{opt}-ir',[L/'bin/llvm-dis',out/f'O{opt}.bc','-o',out/f'O{opt}.ll'])
  run(f'consumer21-controls-O{opt}-flagged',[compiler,*flags,*mode,f'-O{opt}',
       '-c',source,'-o',out/f'O{opt}.o'])
  run(f'consumer21-controls-O{opt}-assembly',[compiler,*flags,*mode,f'-O{opt}',
       '-S',source,'-o',out/f'O{opt}.s'])
 assert all(pin(p)==v for p,v in pins.items())
 (T/'logs/consumer21-controls-1-result.json').write_text(json.dumps({'compilePass':True,'runtimeAcceptance':False},indent=2)+'\n')
except BaseException as error:
 (T/'logs/consumer21-controls-1-result.json').write_text(json.dumps({'compilePass':False,'runtimeAcceptance':False,'error':repr(error)},indent=2)+'\n')
 raise
