#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
P=pathlib.Path('/mnt/p6/build/glibc-checked-jump-runtime-20261002')
pins=json.loads((P/'logs/final-runtime-inputs.json').read_text())['inputs']
selected=[]
for name in ['malloc-malloc.o','elf-dl-tunables.o','startup-run2.o']:
 p=P/'objects/guest'/name;b=p.read_bytes();r=pins[str(p)]
 assert hashlib.sha256(b).hexdigest()==r['sha256'] and len(b)==r['bytes']
 q=T/'objects'/('accepted-'+name);q.write_bytes(b)
 selected.append({'original':str(p),'copy':str(q),'sha256':r['sha256'],'bytes':r['bytes']})
for packet,rel in [('glibc-vtables-make-20261002','libio/vtables.o'),*[('glibc-sched-sem-20261002','posix/sched_'+n+'.o') for n in ['sets','setp','getp']]]:
 d=pathlib.Path('/mnt/p6/build')/packet
 p=d/'objects/fullmake'/rel;b=p.read_bytes();r=json.loads((d/'manifest.json').read_text())['files'][str(p)]
 assert hashlib.sha256(b).hexdigest()==r['sha256'] and len(b)==r['bytes']
 q=T/'objects'/('accepted-'+rel.replace('/','-'));q.write_bytes(b)
 selected.append({'original':str(p),'copy':str(q),'sha256':r['sha256'],'bytes':r['bytes'],'manifest':str(d/'manifest.json'),'manifestSha256':hashlib.sha256((d/'manifest.json').read_bytes()).hexdigest()})
(T/'logs/accepted-selected.json').write_text(json.dumps(selected,indent=2)+'\n')
run('tags',[L/'bin/clang',*base,'-matomics','-mbulk-memory','-mexception-handling','-c',R/'tags.S','-o',T/'objects/tags.o'])
units=['cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers','private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo','cxa_demangle','stdlib_new_delete','unwind-wasm-gnu','probe','tags']
builtins=L/'lib/clang/22/lib/wasm32/libclang_rt.builtins.a';q=T/'objects/libclang_rt.builtins.a';q.write_bytes(builtins.read_bytes())
(T/'logs/compiler-rt-pin.json').write_text(json.dumps({'source':str(builtins),'copy':str(q),'sha256':hashlib.sha256(q.read_bytes()).hexdigest(),'bytes':q.stat().st_size},indent=2)+'\n')
run('typed-foreign-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--import-memory','--initial-memory=2097152','--max-memory=16777216','--export=typed_probe','--export=foreign_probe','--export=prototype_stack_pointer','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__heap_base','--error-limit=0','--why-extract='+str(T/'logs/why-extract.txt'),'-Map',T/'logs/typed-foreign-map.txt',*[T/'objects'/f'{u}.o' for u in units],*[r['copy'] for r in selected],T/'objects/scratch_buffer_grow_preserve.o',T/'objects/scratch_buffer_set_array_size.o',T/'objects/libgnu-selected.a',q,'-o',T/'objects/typed-foreign.wasm'])
