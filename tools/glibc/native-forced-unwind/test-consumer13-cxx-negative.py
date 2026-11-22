#!/usr/bin/env python3
"""Malformed scoped catch controls from the actual prerequisite frontend IR."""
import sys
sys.dont_write_bytecode=True
import json,re
from common_consumer13 import T,R,pin,run

compiler=T/'objects/compiler-consumer13-continuation/clang'
source=R/'consumer-cxx-controls.cpp'
out=T/'objects/consumer13-continuation-cxx-negative-2';out.mkdir()
snap=T/'source/consumer13-continuation-cxx-negative-2';snap.mkdir()
mode=['-wasm-gnu-cancel-prerequisite','-wasm-gnu-frame-records',
      '-wasm-gnu-frame-forced-admission','-wasm-gnu-forced-unwind',
      '-wasm-enable-sjlj','-wasm-native-eh-routing','-verify-machineinstrs']
options=[x for option in mode for x in ['-mllvm',option]]
front=snap/'front.ll'
run('consumer13-continuation-cxx-negative-v2-front',[compiler,
    '--target=wasm32-unknown-linux-gnu','-fc++-abi=webassembly','-ffreestanding',
    '-nostdinc','-fno-builtin','-fno-stack-protector','-fexceptions','-fwasm-exceptions',
    '-matomics','-mbulk-memory',*options,'-O0','-S','-emit-llvm',source,'-o',front])
text=front.read_text()
assert 'wasm-gnu-cancel-prerequisite' in text
wrong,n=re.subn(r'call ptr @llvm\.wasm\.get\.exception\(token %[0-9]+\)',
                'call ptr @llvm.wasm.get.exception(token none)',text,count=1)
assert n==1 and '@__gxx_wasm_personality_v0' in text
cases={
    'wrong-pad':(wrong,'GNU source exception/selector does not use its actual same-block catchpad'),
    'wrong-personality':(text.replace('@__gxx_wasm_personality_v0','@__gxx_personality_v0'),
                         'GNU source catch operation lacks its actual Wasm personality'),
}
rows=[]
for name,(value,message) in cases.items():
    path=snap/(name+'.ll');path.write_text(value)
    stage='consumer13-continuation-cxx-negative-v2-'+name
    row=run(stage,[compiler,'--target=wasm32-unknown-linux-gnu','-x','ir',
                   *options,'-c',path,'-o',out/(name+'.o')],expected=1)
    log=__import__('pathlib').Path(row['log'])
    assert message in log.read_text(),log.read_text()
    assert not (out/(name+'.o')).exists()
    rows.append({'input':{'path':str(path),**pin(path)},'expectedDiagnostic':message,
                 'command':row,'log':{'path':str(log),**pin(log)}})
(T/'logs/consumer13-continuation-cxx-negative-2-result.json').write_text(json.dumps({
    'rejectPass':True,'runtimeAcceptance':False,'original':{'path':str(front),**pin(front)},
    'compiler':{'path':str(compiler),**pin(compiler)},
    'recipe':{'path':str(R/'test-consumer13-cxx-negative.py'),**pin(R/'test-consumer13-cxx-negative.py')},
    'cases':rows},indent=2)+'\n')
