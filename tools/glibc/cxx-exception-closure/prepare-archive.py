#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
import hashlib,shutil
C=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002')
M=pathlib.Path('/mnt/p6/build/glibc-memory-make-20261002')
manifest=json.loads((C/'manifest.json').read_text())['files']
selected=[];excluded=[];gnu_count=0
A=T/'objects/gnu-members';A.mkdir(exist_ok=True)
def take(p,name,origin):
 b=p.read_bytes();q=A/name;q.write_bytes(b);selected.append({'original':str(p),'copy':str(q),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'origin':origin})
replaced={'misc/'+x+'.o' for x in ['brk','sbrk','mmap','mmap64','munmap','mremap','mprotect','madvise']}
for p in sorted((C/'objects/fullmake').rglob('*')):
 if not p.is_file() or p.suffix not in ['.o','.os','.oS']:continue
 b=p.read_bytes()
 if b[:8]!=b'\0asm\1\0\0\0':continue
 gnu_count+=1;h=hashlib.sha256(b).hexdigest();assert manifest[str(p)]=={'sha256':h,'bytes':len(b)},p
 rel=p.relative_to(C/'objects/fullmake').as_posix()
 if rel in replaced:excluded.append({'path':str(p),'reason':'explicit owned logical memory provider selection','sha256':h});continue
 take(p,'gnu-'+rel.replace('/','-'),'frozen cumulative GNUmake')
assert gnu_count==1690
for n in ['brk','sbrk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']:
 p=M/'objects/fullmake/misc'/f'{n}.o';assert p.read_bytes()[:8]==b'\0asm\1\0\0\0';take(p,'memory-'+n+'.o','prepared memory provider; copied/pinned, no presumed runtime acceptance')
(T/'logs/selected-gnu-members.json').write_text(json.dumps({'originalGNUComplete':gnu_count,'selected':selected,'excluded':excluded,'memoryScope':'actual selected owned architecture providers; real protection ENOTSUP remains'},indent=2)+'\n')
run('gnu-archive',[L/'bin/llvm-ar','rcs',T/'objects/libgnu-selected.a',*[r['copy'] for r in selected]])
run('gnu-symbols',[L/'bin/llvm-nm','--defined-only','--format=posix',T/'objects/libgnu-selected.a'])
