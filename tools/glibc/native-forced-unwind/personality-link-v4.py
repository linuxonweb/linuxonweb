#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
recipe=json.loads((T/'logs/personality-gate-recipe-5.json').read_text())
for row in recipe['pins']:
 assert pin(row['path'])=={'sha256':row['sha256'],'bytes':row['bytes']},row['path']
B=T/'objects/personality-gate-4';B.mkdir()
P=pathlib.Path('/mnt/p6/build/glibc-port-integration-20261002')
old=pathlib.Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002')
A=T/'objects/personality-gate-2'
assert '.functype\t__abort_message (i32, i32) -> ()' in (A/'cxa_handlers.s').read_text()
run('personality-v4-tags',[L/'bin/clang','--target=wasm32-unknown-linux-gnu','-matomics','-mbulk-memory','-mexception-handling','-c',R/'personality-gate-v3.S','-o',B/'tags.o'])
objects=[A/(u+'.o') for u in ['cxa_exception','cxa_exception_storage','private_typeinfo','stdlib_typeinfo','cxa_handlers','cxa_default_handlers','gate','typed','unwind']]
donors=[P/( 'objects/host/'+n+'.o') for n in ['elf-dl-misc','elf-dl-printf']]
manifest=json.loads((P/'manifest.json').read_text())['files']
for p in donors:assert pin(p)==manifest[str(p)],str(p)
extra=donors+[old/'objects/release'/f'{u}.o' for u in ['fallback_malloc','stdlib_exception','stdlib_new_delete']]
exports=['foreign_direct','foreign_rethrow','foreign_escape','foreign_delete','foreign_query','exception_size','exception_align','observe_stack','__cpp_exception','__tls_base','__wasm_init_tls','__tls_size','__tls_align','__heap_base','fixture_init','fixture_thread_pointer','native_int_rethrow','native_int_query']
for mode in ['baseline','patched']:
 run('personality-v4-'+mode+'-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--import-memory','--initial-memory=2097152','--max-memory=16777216','--error-limit=0',*['--export='+x for x in exports],*objects,A/('personality-'+mode+'.o'),B/'tags.o',*extra,old/'objects/accepted-malloc-malloc.o',old/'objects/accepted-elf-dl-tunables.o',pathlib.Path('/mnt/p6/build/glibc-port-integration-20261002/objects/host/fixture.o'),*[old/'objects'/('accepted-posix-sched_'+n+'.o') for n in ['sets','setp','getp']],old/'objects/libgnu-selected.a',old/'objects/libclang_rt.builtins.a','--why-extract='+str(B/(mode+'-why.txt')),'-Map',B/(mode+'-map.txt'),'-o',B/(mode+'.wasm')])
 run('personality-v4-'+mode+'-execute',[NODE,R/'personality-test-v4.mjs',T,mode])
