#!/usr/bin/env python3
"""Source attributes cannot acquire compiler-authenticated primitive membership."""
import sys
sys.dont_write_bytecode = True
import json, shutil
from common_consumer13 import T, R, pin, run

compiler = T/'objects/compiler-consumer13-continuation/clang'
source = R/'forged-primitive.ll'
out = T/'objects/consumer13-continuation-forged-2'
snap = T/'source/consumer13-continuation-forged-2'
out.mkdir(); snap.mkdir()
rows = []
for index, path in enumerate([compiler, source, R/'test-consumer13-forged.py', R/'common_consumer13.py']):
    row = {'path':str(path), **pin(path)}
    if path.stat().st_size < 8388608:
        copy = snap/(str(index)+'-'+path.name)
        shutil.copyfile(path, copy); row['snapshot'] = str(copy)
    rows.append(row)
cases = {
    'records-off-forced': ['-wasm-gnu-forced-unwind','-wasm-native-eh-routing'],
    'records-off-routing': ['-wasm-native-eh-routing'],
    'records-on-forced': ['-wasm-gnu-frame-records','-wasm-gnu-frame-forced-admission',
                          '-wasm-gnu-forced-unwind','-wasm-native-eh-routing'],
}
plan = {'inputPins':rows, 'cases':cases, 'runtimeAcceptance':False}
(T/'logs/consumer13-continuation-forged-2-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
proofs = []
for name, options in cases.items():
    mode = [x for option in options for x in ['-mllvm',option]]
    stage = 'consumer13-continuation-forged-v2-'+name
    row = run(stage, [compiler,'--target=wasm32-unknown-linux-gnu','-x','ir',
                      *mode,'-mllvm','-verify-machineinstrs','-c',source,
                      '-o',out/(name+'.o')], expected=1)
    log = next(p for p in (T/'logs').glob(stage+'-attempt*.log'))
    text = log.read_text()
    messages = (['source supplies GNU provider seal'] if name == 'records-on-forced'
                else ['GNU primitive skip lacks actual producer authentication',
                      'GNU native primitive skip lacks actual producer authentication',
                      'GNU primitive machine audit lacks actual producer authentication'])
    assert any(message in text for message in messages), text
    assert not (out/(name+'.o')).exists()
    proofs.append({'case':name,'command':row,'log':{'path':str(log),**pin(log)}})
assert all(pin(row['path'])['sha256']==row['sha256'] for row in rows)
(T/'logs/consumer13-continuation-forged-2-result.json').write_text(json.dumps({
    'rejectPass':True,'runtimeAcceptance':False,'inputPins':rows,'cases':proofs},indent=2)+'\n')
