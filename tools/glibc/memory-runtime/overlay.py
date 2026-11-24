#!/usr/bin/env python3
"""Derive exactly two memory provider sources from verified frozen lineage."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);B=pathlib.Path(os.environ['GLIBC_MEMORY_MAKE_PACKET']);R=pathlib.Path(__file__).resolve().parent
A=T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32';P=B/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
assert hashlib.sha256((B/'manifest.json').read_bytes()).hexdigest()=='cb26cde7b2306b44409d43e4568fe380be897e02c35de252755bc12edb70dd86'
m=json.loads((B/'manifest.json').read_text())['files'];rows=[]
for n in ['brk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']:
 p=P/(n+'.c');data=p.read_bytes();pin={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};assert m[str(p)]==pin
 q=T/'source-snapshots'/('memory-make-'+n+'.c');assert not q.exists();q.write_bytes(data)
 if n=='mremap':data=(R/'mremap.c').read_bytes()
 if n=='wasm-memory-authority':
  s=data.decode();a=s.index('int __wasm_memory_madvise(');b=s.index('uintptr_t __wasm_memory_cursor',a)
  s=s[:a]+(R/'madvise-ownership.inc').read_text()+'\n'+s[b:]
  assert s.count('memcpy(replacement,addr,old_size);')==1
  data=s.replace('memcpy(replacement,addr,old_size);','memcpy(replacement,addr,oldn);').encode()
 out=A/(n+'.c');out.write_bytes(data);rows.append({'original':str(p),'originalPin':pin,'snapshot':str(q),'selected':str(out),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'derivative':n in ['mremap','wasm-memory-authority']})
p=A/'Makefile';p.write_text(p.read_text()+'\nifeq ($(subdir),misc)\nsysdep_routines += wasm-memory-authority\nendif\n')
(T/'logs/memory-overlay.json').write_text(json.dumps({'pass':True,'files':rows,'gnuSbrk':'unchanged misc/sbrk.c','changes':['mremap flags before optional arguments','madvise live ownership union and partial holes','moving remap preserves rounded old live extent']},indent=2)+'\n')
