#!/usr/bin/env python3
"""Exact scoped-catch provenance negatives; arbitrary failures cannot pass."""
import sys
sys.dont_write_bytecode=True
import json
from common import T,R,pin,run

compiler=T/'objects/compiler-consumer-coherent1/clang'
source=T.parent/'glibc-native-frame-plan-20261002/cxx-frontend-provenance-1/front.ll'
out=T/'objects/consumer-coherent1-cxx-negative-1';out.mkdir()
snap=T/'source/consumer-coherent1-cxx-negative-1';snap.mkdir()
text=source.read_text()
assert text.count('call ptr @llvm.wasm.get.exception(token %7)')==1
cases={
    'wrong-pad':(text.replace('call ptr @llvm.wasm.get.exception(token %7)',
                              'call ptr @llvm.wasm.get.exception(token none)'),
                 'GNU source exception/selector does not use its actual same-block catchpad'),
    'wrong-personality':(text.replace('@__gxx_wasm_personality_v0','@__gxx_personality_v0'),
                         'GNU source catch operation lacks its actual Wasm personality'),
}
mode=['-wasm-gnu-cancel-prerequisite','-wasm-gnu-frame-records',
      '-wasm-gnu-frame-forced-admission','-wasm-gnu-forced-unwind',
      '-wasm-enable-sjlj','-wasm-native-eh-routing','-verify-machineinstrs']
rows=[]
for name,(value,message) in cases.items():
    path=snap/(name+'.ll');path.write_text(value)
    stage='consumer-coherent1-cxx-negative-'+name
    row=run(stage,[compiler,'--target=wasm32-unknown-linux-gnu','-x','ir',
                   *[x for option in mode for x in ['-mllvm',option]],
                   '-c',path,'-o',out/(name+'.o')],expected=1)
    log=__import__('pathlib').Path(row['log'])
    assert message in log.read_text(),log.read_text()
    assert not (out/(name+'.o')).exists()
    rows.append({'input':{'path':str(path),**pin(path)},'expectedDiagnostic':message,
                 'command':row,'log':{'path':str(log),**pin(log)}})
(T/'logs/consumer-coherent1-cxx-negative-1-result.json').write_text(json.dumps({
    'rejectPass':True,'runtimeAcceptance':False,
    'original':{'path':str(source),**pin(source)},
    'compiler':{'path':str(compiler),**pin(compiler)},
    'recipe':{'path':str(R/'test-coherent-cxx-negative.py'),**pin(R/'test-coherent-cxx-negative.py')},
    'cases':rows},indent=2)+'\n')
