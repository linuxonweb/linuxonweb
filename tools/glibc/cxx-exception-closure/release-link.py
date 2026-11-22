#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
P=pathlib.Path('/mnt/p6/build/glibc-checked-jump-runtime-20261002')
pins=json.loads((P/'logs/final-runtime-inputs.json').read_text())['inputs'];A=T/'objects/release-guest';A.mkdir(exist_ok=True)
selected=[]
for name,row in pins.items():
 p=pathlib.Path(name)
 if p.parent!=P/'objects/guest':continue
 b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'] and len(b)==row['bytes']
 q=A/p.name;q.write_bytes(b);selected.append({'original':str(p),'copy':str(q),'sha256':row['sha256'],'bytes':row['bytes']})
assert len(selected)==232
(T/'logs/release-base-232.json').write_text(json.dumps(selected,indent=2)+'\n')
units=['cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers','private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo','cxa_demangle','stdlib_new_delete']
run('release-cxxabi-archive',[L/'bin/llvm-ar','rcs',T/'objects/release/libcxxabi-gnu.a',*[T/'objects/release'/f'{u}.o' for u in units]])
run('release-tags',[L/'bin/clang',*base,'-matomics','-mbulk-memory','-mexception-handling','-c',R/'release-tags.S','-o',T/'objects/release/tags.o'])
members=json.loads((T/'logs/selected-gnu-members.json').read_text())['selected']
run('release-gnu-archive',[L/'bin/llvm-ar','rcs',T/'objects/release/libgnu-no-memory.a',*[r['copy'] for r in members if r['origin']=='frozen cumulative GNUmake']])
run('release-typed-foreign-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--import-memory','--initial-memory=2097152','--max-memory=16777216','--export-table','-z','stack-size=65536','--export=typed_probe','--export=foreign_probe','--export=prototype_stack_pointer','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__heap_base','--export=__errno_location','--export=cleanup_test_tag','--export=cleanup_throw','--error-limit=0','--thinlto-cache-dir='+str(T/'cache/release-lto'),'--why-extract='+str(T/'logs/release-why-extract.txt'),'-Map',T/'logs/release-map.txt',*[r['copy'] for r in selected],T/'objects/probe.o',T/'objects/release/tags.o',T/'objects/release/unwind-wasm-gnu.o',T/'objects/release/libcxxabi-gnu.a',T/'objects/release/libgnu-no-memory.a',T/'objects/libclang_rt.builtins.a','-o',T/'objects/release-typed-foreign.wasm'])
