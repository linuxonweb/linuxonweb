#!/usr/bin/env python3
"""Actual coherent Wasm C++ ABI, LSDA and personality object controls."""
import sys
sys.dont_write_bytecode=True
import json, re, shutil
from common import T,R,L,pin,run

compiler=T/'objects/compiler-consumer18/clang'
peer=T.parent/'glibc-native-frame-plan-20261002/module4-proposal-18/objects/compiler/clang'
out=T/'objects/consumer18-controls-cxx-1';out.mkdir()
source=R/'consumer-cxx-controls.cpp'
flags=['--target=wasm32-unknown-linux-gnu','-fc++-abi=webassembly',
       '-ffreestanding','-nostdinc','-fno-builtin','-fno-stack-protector',
       '-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory']
mode=['-mllvm','-wasm-gnu-cancel-prerequisite','-mllvm','-wasm-gnu-frame-records',
      '-mllvm','-wasm-gnu-frame-forced-admission','-mllvm','-wasm-gnu-forced-unwind',
      '-mllvm','-wasm-enable-sjlj','-mllvm','-wasm-native-eh-routing',
      '-mllvm','-verify-machineinstrs']
snap=T/'source/consumer18-controls-cxx-1';snap.mkdir()
rows=[]
for index,path in enumerate([compiler,peer,L/'bin/llvm-readobj',source,
                            R/'test-consumer18-cxx.py',R/'common.py']):
    row={'path':str(path),**pin(path)}
    if path.stat().st_size<8388608:
        copy=snap/(str(index)+'-'+path.name);shutil.copyfile(path,copy)
        row['snapshot']=str(copy)
    rows.append(row)
plan=T/'logs/consumer18-controls-cxx-1-plan.json'
plan.write_text(json.dumps({'inputPins':rows,'flags':flags,'mode':mode,
    'runtimeAcceptance':False},indent=2)+'\n')
commands=[];proofs=[]
try:
    for opt in [0,2,3]:
        for tool,name in [(compiler,'candidate'),(peer,'peer')]:
            commands.append(run(f'consumer18-cxx-O{opt}-off-{name}',
                [tool,*flags,f'-O{opt}','-c',source,'-o',out/f'O{opt}-{name}-off.o']))
        assert (out/f'O{opt}-candidate-off.o').read_bytes()==(out/f'O{opt}-peer-off.o').read_bytes()
        for extra,suffix in [(['-c'],'.o'),(['-S'],'.s')]:
            commands.append(run(f'consumer18-cxx-O{opt}-'+('object' if suffix=='.o' else 'assembly'),
                [compiler,*flags,*mode,f'-O{opt}',*extra,source,'-o',out/f'O{opt}{suffix}']))
        commands.append(run(f'consumer18-cxx-O{opt}-relocations',
            [L/'bin/llvm-readobj','--sections','--symbols','--relocations',out/f'O{opt}.o']))
        text=(out/f'O{opt}.s').read_text()
        assert '__gxx_personality_wasm0' in text
        assert '_Unwind_CallPersonality' in text
        assert re.search(r'GCC_except_table|\.gcc_except_table|exception_table',text)
        assert 'catch' in text and 'rethrow' in text
        proofs.append({'opt':opt,'assembly':{'path':str(out/f'O{opt}.s'),**pin(out/f'O{opt}.s')},
            'object':{'path':str(out/f'O{opt}.o'),**pin(out/f'O{opt}.o')},
            'actualPersonalityAndLSDA':True,'flagsOffByteIdentical':True})
    assert all(pin(row['path'])['sha256']==row['sha256'] for row in rows)
    result={'compilePass':True,'runtimeAcceptance':False,'inputPins':rows,
            'modes':proofs,'commands':commands}
except BaseException as error:
    result={'compilePass':False,'runtimeAcceptance':False,'error':repr(error),
            'inputPins':rows,'modes':proofs,'commands':commands}
    (T/'logs/consumer18-controls-cxx-1-result.json').write_text(json.dumps(result,indent=2)+'\n')
    raise
destination=T/'logs/consumer18-controls-cxx-1-result.json'
destination.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'proof':str(destination),**pin(destination)},indent=2))
