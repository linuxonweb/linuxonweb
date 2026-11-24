#!/usr/bin/env python3
"""Compile immutable delivery bodies and audit their emitted call closure."""
import sys
sys.dont_write_bytecode = True
import json, re, shutil
from common import T, R, C, L, pin, run

source = T/'source/delivery-compile-2'
objects = T/'objects/delivery-compile-2'
planpath = T/'logs/delivery-compile-2-plan.json'
peer = T.parent/'glibc-native-frame-plan-20261002/module4-proposal-16'
if '--prepare' in sys.argv:
    source.mkdir(); objects.mkdir()
    inputs = [peer/'jump-delivery-v2.c', peer/'frame-abi.h', peer/'jump-abi-v2.h',
              R/'delivery-compile-v2.py', R/'unwind.h', R/'gnu-unwind.h', R/'common.py', C, L/'bin/llvm-readobj']
    rows = []
    for index, path in enumerate(inputs):
        row = {'path':str(path), **pin(path)}
        if path.stat().st_size < 8388608:
            copy = source/(path.name if path.suffix in ['.c','.h'] else f'{index}-{path.name}')
            shutil.copyfile(path,copy); row['snapshot'] = str(copy)
        rows.append(row)
    args = [str(C),'--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc',
            '-O2','-fno-builtin','-fno-stack-protector','-matomics','-mbulk-memory',
            '-fwasm-exceptions','-fexceptions','-std=gnu11','-I',str(source)]
    planpath.write_text(json.dumps({'inputPins':rows,'compilePrefix':args,
        'runtimeAccepted':False,'mixedAdmissionImplemented':False,
        'scope':'Actual metadata delivery bodies only; no records, synthetic owner or execution.'},indent=2)+'\n')
    print(json.dumps({'plan':str(planpath), **pin(planpath)},indent=2))
    sys.exit(0)
plan = json.loads(planpath.read_text())
for row in plan['inputPins']:
    assert pin(row['path'])['sha256'] == row['sha256'],row['path']
    if 'snapshot' in row: assert pin(row['snapshot'])['sha256'] == row['sha256']
assert not (objects/'delivery.o').exists(), 'preserve attempts; do not overwrite'
commands=[]
for mode, extra, suffix in [('object',['-c'],'.o'),('llvm',['-S','-emit-llvm'],'.ll'),
                            ('assembly',['-S'],'.s')]:
    commands.append(run('delivery-'+mode,plan['compilePrefix']+extra+
        ['-MD','-MF',str(objects/(mode+'.d')),str(source/'jump-delivery-v2.c'),
         '-o',str(objects/('delivery'+suffix))]))
commands.append(run('delivery-readobj',[str(L/'bin/llvm-readobj'),
    '--file-headers','--symbols','--sections',str(objects/'delivery.o')]))
text = (objects/'delivery.s').read_text()
matches = list(re.finditer(r'^([A-Za-z_][A-Za-z0-9_]*):[^\n]*\n(.*?\bend_function\b)',text,re.M|re.S))
definitions={m.group(1) for m in matches}
accessors={'__wasm_gnu_frame_thread_v1','__wasm_gnu_frame_owner_tp_v1'}
bodies=[]
for match in matches:
    name=match.group(1); body=match.group(0)
    calls=re.findall(r'^\s*call\s+(\S+)',body,re.M)
    assert set(calls) <= definitions|accessors,(name,calls)
    assert not re.search(r'\bglobal\.set\s+__stack_pointer\b',body),name
    assert not re.search(r'^\s*(?:call_indirect|return_call|throw|rethrow)\b',body,re.M),name
    assert not re.search(r'\b(?:import_module|import_name)\b',body),name
    signature=re.search(r'\.functype\s+'+re.escape(name)+r'\s+([^\n]+)',body).group(1).strip()
    path=source/(name+'.s');path.write_text(body+'\n')
    bodies.append({'symbol':name,'signature':signature,'directCalls':calls,
                   'linearSPWrites':0,'nativeThrows':0,'body':str(path),**pin(path)})
expected={'__wasm_gnu_jump_delivery_allocate_v2':'(i32, i32) -> (i32)',
          '__wasm_gnu_jump_delivery_resolve_v2':'(i32) -> (i32)',
          '__wasm_gnu_jump_delivery_retire_v2':'(i32, i32, i32) -> (i32)'}
for name, signature in expected.items():
    assert next(body for body in bodies if body['symbol']==name)['signature']==signature
pins=[]
for index,path in enumerate(sorted(objects.iterdir())):
    copy=source/(f'output-{index}-'+path.name);shutil.copyfile(path,copy)
    pins.append({'path':str(path),**pin(path),'snapshot':str(copy)})
proof=T/'logs/delivery-compile-2-result.json'
proof.write_text(json.dumps({'actualBodiesPass':True,'runtimeAccepted':False,
    'mixedAdmissionImplemented':False,'plan':{'path':str(planpath),**pin(planpath)},
    'inputPins':plan['inputPins'],'objects':pins,'actualBodies':bodies,
    'remainingExternalCallees':sorted(accessors),'commands':commands,
    'limits':'TLS primary singleton, actual root descriptors and owner admission are unexecuted. No generation/exhaustion/concurrency runtime claim.'},indent=2)+'\n')
print(json.dumps({'proof':str(proof),**pin(proof),'actualBodies':len(bodies)},indent=2))
