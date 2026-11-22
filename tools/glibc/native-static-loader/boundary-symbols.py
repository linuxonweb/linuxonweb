#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
links=json.loads((T/'logs/gnu-full-link-results.json').read_text())
inputs=[arg for arg in links[0]['command']['argv'] if pathlib.Path(arg).suffix in ['.o','.a'] and pathlib.Path(arg).is_file()]
run('boundary-defined-symbols',[L/'bin/llvm-nm','-A','--defined-only',*inputs])
boundaries=json.loads((T/'logs/gnu-native-results.json').read_text())['boundaries']
records={name:[] for name in boundaries}
for line in pathlib.Path(rows[-1]['log']).read_text().splitlines():
 parts=line.rsplit(None,3)
 if len(parts)==4 and parts[-1] in records:
  provider=parts[0].rstrip(':')
  # Canonicalize the archive name against the actual pinned input list;
  # retain raw text because llvm-nm output can interleave archive diagnostics.
  for arg in inputs:
   base=pathlib.Path(arg).name+':'
   if base in provider:provider=arg+':'+provider.split(base,1)[1]
  records[parts[-1]].append({'provider':provider,'address':parts[1],'type':parts[2],'raw':line})
for name,header,module,field in [
 ('__wasm_linux_get_thread_area','sysdeps/wasm32/tls.h','linux','get_thread_area'),
 ('__wasm_linux_syscall','sysdeps/unix/sysv/linux/wasm32/sysdep.h','linux','syscall')]:
 p=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')/header
 b=p.read_bytes();assert name.encode() in b and ('import_name("'+field+'")').encode() in b
 records[name].append({'provider':'native Linux runtime import','module':module,'field':field,'declaration':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
assert all(records[name] for name in boundaries if name!='setjmp'),records
assert not records['setjmp'] # Native LLVM SjLj intrinsic, not a real wrapper.
(T/'logs/boundary-defined-providers.json').write_text(json.dumps({'providers':records,'setjmp':'LLVM native Wasm SjLj lowering; no returning wrapper','command':rows[-1]},indent=2)+'\n')
print('actual boundary providers',len(records)-1,'plus native setjmp intrinsic')
