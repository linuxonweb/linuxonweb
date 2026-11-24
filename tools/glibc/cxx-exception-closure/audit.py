#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
import shlex
def pin(p):
 p=pathlib.Path(p).resolve();b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
sources=set([CLANG,L/'bin/clang',L/'bin/wasm-ld',L/'bin/llvm-ar',L/'bin/llvm-nm',pathlib.Path('/home/a/.config/nvm/versions/node/v22.22.2/bin/node')])
for p in (T/'objects').rglob('*.d'):
 s=p.read_text().replace('\\\n',' ').split(':',1)[1]
 for name in shlex.split(s):
  q=pathlib.Path(name)
  if q.is_file():sources.add(q.resolve())
for rel in ['libcxxabi/CMakeLists.txt','libcxxabi/src/CMakeLists.txt','libcxxabi/src/cxa_default_handlers.cpp','libcxxabi/src/cxa_handlers.cpp','libcxxabi/src/abort_message.cpp','libcxxabi/src/cxa_exception.h','libunwind/src/Unwind-wasm.c']:
 sources.add(LLVM_SRC/rel)
C=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002')
for rel in ['assert/assert.c','stdlib/abort.c','malloc/malloc.c','malloc/scratch_buffer_grow_preserve.c','malloc/scratch_buffer_set_array_size.c','nptl/pthread_mutex_lock.c','nptl/pthread_mutex_unlock.c','stdio-common/fprintf.c','stdio-common/vfprintf.c','stdio-common/vfprintf-internal.c','libio/stdio.c','libio/stdfiles.c','libio/fileops.c','iconv/gconv_dl.c','debug/readonly-area.c','elf/dl-readonly-area.c','elf/dl-libc.c','nptl/cancellation.c','sysdeps/unix/sysv/linux/write.c','sysdeps/unix/sysv/linux/openat64.c']:
 sources.add(C/'source/glibc-2.44'/rel)
sourcepins={str(p):pin(p) for p in sorted(sources)}
(T/'logs/source-tool-pins.json').write_text(json.dumps(sourcepins,indent=2)+'\n')
objects={}
for jname,field in [('selected-gnu-members.json','selected'),('accepted-selected.json',None),('release-base-232.json',None)]:
 j=json.loads((T/'logs'/jname).read_text());members=j[field] if field else j
 for row in members:
  expected={k:row[k] for k in ['sha256','bytes']}
  assert pin(row['original'])==expected==pin(row['copy']),row
  objects[row['original']]=expected;objects[row['copy']]=expected
for p in (T/'objects').rglob('*'):
 if p.is_file() and p.suffix in ['.o','.a','.wasm']:objects[str(p)]=pin(p)
(T/'logs/object-pins.json').write_text(json.dumps(objects,indent=2)+'\n')
rows=json.loads((T/'logs/commands.json').read_text());assert all('exit' in r and r['group_empty'] for r in rows)
live=[]
for r in rows:
 try:os.killpg(r['pgid'],0);live.append(r['pgid'])
 except ProcessLookupError:pass
assert not live
for name,r in sourcepins.items():assert pin(name)==r,name
for name,r in objects.items():assert pin(name)==r,name
log=(T/'logs/typed-foreign-link-attempt3.log').read_text()
import re
missing=sorted(set(re.findall(r'undefined symbol: (\S+)',log)))
assert missing==sorted(['__libc_dlopen_mode','__libc_dlsym','__libc_dlclose','__syscall_cancel_arch','_dl_readonly_area'])
report={'phase':'prepared; not frozen; awaiting root review','compilePass':True,'defaultFullLinkPass':False,'releaseFullLinkPass':False,'typedForeignRuntimePass':False,'typedForeignRuntimeExecuted':False,'fullLibcPass':False,'ForcedUnwindPass':False,'sourceToolPins':len(sourcepins),'objectPins':len(objects),'pinDifferences':0,'missingDefaultSymbols':missing,'commands':len(rows),'groups':[{k:r[k] for k in ['stage','pid','pgid','exit','group_empty']} for r in rows],'liveOwnedGroups':live,'taskBytes':sum(p.stat().st_size for p in T.rglob('*') if p.is_file()),'layout':json.loads((T/'logs/cxxabi-layout-results.json').read_text()),'knownRetentionGap':'first two default why-extract/maps reused output paths before supervisor began retaining side outputs; their full stderr and argv/source/output snapshots survive, final default attempt3 map/extraction is retained independently','scope':'genuine C++ and GNU dependency compile/selection plus retained link failures; no cancellation/loader substitutes, typed runtime, pthread lifecycle or Nightly acceptance'}
(T/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['groups']},indent=2))
