#!/usr/bin/env python3
"""Audit actual emitted transition bodies; transitive admission is separate."""
import sys
sys.dont_write_bytecode=True
import json,re,shlex,shutil
from common import T,R,pin
out=T/'source/provider-primitive-audit-1';out.mkdir()
assembly=T/'objects/provider-compile-1/provider.s'
text=assembly.read_text()
expected={
 '__wasm_gnu_unwind_state_valid_v1':'(i32) -> (i32)',
 '__wasm_gnu_unwind_escape_v2':'(i32, i32, i32, i32) -> (i32)',
 '__wasm_gnu_unwind_target_v2':'(i32, i32, i32, i32) -> (i32)',
 '__wasm_gnu_unwind_register_v1':'(i32, i32, i32, i32, i32, i32) -> (i32)',
}
allowed={'__wasm_gnu_frame_thread_v1','__wasm_gnu_frame_owner_tp_v1',
         '__wasm_gnu_jump_delivery_resolve_v2','__wasm_gnu_jump_delivery_retire_v2'}
bodies=[]
for symbol,signature in expected.items():
 match=re.search(r'^'+re.escape(symbol)+r':[^\n]*\n(.*?\bend_function\b)',text,re.M|re.S)
 assert match,symbol
 body=match.group(0)
 assert re.search(r'\.functype\s+'+re.escape(symbol)+r'\s+'+re.escape(signature),body)
 assert not re.search(r'\b(global\.set\s+__stack_pointer|call_indirect|return_call|throw|rethrow)\b',body),symbol
 calls=re.findall(r'^\s*call\s+(\S+)',body,re.M)
 assert set(calls)<=allowed,(symbol,calls)
 assert not re.search(r'\b(import_module|import_name)\b',body),symbol
 path=out/(symbol+'.s');path.write_text(body+'\n')
 bodies.append({'symbol':symbol,'signature':signature,'body':str(path),**pin(path),
                'directCalls':calls,'linearSPWrites':0,'nativeThrows':0})
dependencies=set()
for depfile in (T/'objects/provider-compile-1').glob('*.d'):
 raw=depfile.read_text().replace('\\\n',' ').split(':',1)[1]
 dependencies.update(shlex.split(raw))
rows=[]
paths=set(map(str,[assembly,R/'audit-provider-primitives.py',
                  *list((T/'objects/provider-compile-1').glob('*'))]))|dependencies
for i,p in enumerate(sorted(paths)):
 row={'path':p,**pin(p)}
 if pin(p)['bytes']<8388608:
  snapshot=out/f'{i}-source';shutil.copyfile(p,snapshot);row['snapshot']=str(snapshot)
 rows.append(row)
proof={'actualOwnBodyAuditPass':True,'runtimeAccepted':False,
       'transitiveSealAccepted':False,'sourceToolObjectPins':rows,'bodies':bodies,
       'unclosedExactCallees':sorted(allowed),
       'remaining':'Pin/audit coherent canonical-accessor and delivery bodies; bind exact loader descriptors and module/owner/epoch before any native execution.'}
path=T/'logs/provider-primitive-audit-1.json';assert not path.exists()
path.write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({'proof':str(path),**pin(path),'pins':len(rows)},indent=2))
