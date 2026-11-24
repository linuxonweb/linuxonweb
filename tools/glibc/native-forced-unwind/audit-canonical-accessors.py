#!/usr/bin/env python3
"""Read back genuine owner bridge evidence and its exact accessor bodies."""
import sys
sys.dont_write_bytecode = True
import json, re, shutil
from common import T, R, pin

bridge=T.parent/'glibc-cancel-native-bridge2-20261002'
proofpath=bridge/'proof.json'
assert pin(proofpath)['sha256']=='ecc07ebb5f92a8d3ed77a27e03a062d63653bab0ac919bc429ee6980338c0073'
proof=json.loads(proofpath.read_text())
out=T/'source/canonical-accessor-audit-1';out.mkdir()
checked=[]
for row in proof['sourcePins']+proof['objects']:
    assert pin(row['path'])['sha256']==row['sha256'],row['path']
    if 'snapshot' in row:
        assert pin(row['snapshot'])['sha256']==row['sha256'],row['snapshot']
    checked.append({'path':row['path'],'sha256':row['sha256']})
assert all(row['exit']==0 and not row['terminalMembers'] for row in proof['commands'])
asm=bridge/'objects/native-bridge.s';text=asm.read_text();bodies=[]
for symbol in ['__wasm_gnu_frame_thread_v1','__wasm_gnu_frame_owner_tp_v1']:
    match=re.search(r'^'+re.escape(symbol)+r':[^\n]*\n(.*?\bend_function\b)',text,re.M|re.S)
    assert match,symbol
    body=match.group(0)
    assert re.search(r'\.functype\s+'+re.escape(symbol)+r'\s+\(\) -> \(i32\)',body)
    assert not re.search(r'^\s*(?:call|call_indirect|return_call|throw|rethrow)\b',body,re.M)
    assert not re.search(r'\bglobal\.set\s+__stack_pointer\b',body)
    assert not re.search(r'\b(?:import_module|import_name)\b',body)
    path=out/(symbol+'.s');path.write_text(body+'\n')
    bodies.append({'symbol':symbol,'signature':'() -> (i32)',
                   'body':str(path),**pin(path),'calls':0,'linearSPWrites':0,
                   'nativeThrows':0,'imports':0})
paths=[proofpath,asm,bridge/'objects/native-bridge.o',bridge/'objects/native-bridge-opt.bc',
       bridge/'objects/native-bridge.ll',bridge/'source/native-bridge.c',
       bridge/'source/native-bridge.h',bridge/'source/frame-abi.h',R/'audit-canonical-accessors.py']
rows=[]
for i,path in enumerate(paths):
    copy=out/(str(i)+'-'+path.name);shutil.copyfile(path,copy)
    rows.append({'path':str(path),**pin(path),'snapshot':str(copy)})
result={'actualAccessorBodiesPass':True,'runtimeAccepted':False,
        'mixedProviderAdmissionImplemented':False,'parentProofCheckedEntries':len(checked),
        'parentStageCount':len(proof['commands']),'parentStageGroupsReportedEmpty':True,
        'inputPins':rows,'actualBodies':bodies,
        'remaining':'Exact module/root descriptor admission and delivery resolve/retire machine-body closure. Canonical storage originates from genuine raw GNU TP admission; no synthetic owner is provided here.'}
destination=T/'logs/canonical-accessor-audit-1.json';assert not destination.exists()
destination.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'proof':str(destination),**pin(destination),'rereadEntries':len(checked)},indent=2))
