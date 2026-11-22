#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
args=json.loads((T/'logs/gnu-compile-flags.json').read_text())['args']
run('metadata-front',[CLANG,'--target=wasm32-unknown-linux-gnu',*args,'-c',R/'metadata.c','-MF',T/'objects/metadata.d','-o',T/'objects/metadata.o'])
run('metadata-provider-backend',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-filetype=obj',T/'objects/native-loader.opt.bc','-o',T/'objects/native-provider.o'])
P=pathlib.Path('/mnt/p6/build/glibc-checked-jump-runtime-20261002')
pins=json.loads((P/'logs/final-runtime-inputs.json').read_text())['inputs'];selected=[]
for name in ['string-strcmp.o','string-memset.o']:
 p=P/'objects/guest'/name;b=p.read_bytes();row=pins[str(p)];assert row['sha256']==hashlib.sha256(b).hexdigest() and row['bytes']==len(b)
 q=T/'objects'/('metadata-'+name);q.write_bytes(b);selected.append({'original':str(p),'copy':str(q),**row})
(T/'logs/metadata-gnu-leaf-pins.json').write_text(json.dumps(selected,indent=2)+'\n')
run('metadata-link',[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216','--export=metadata_entry','--export=metadata_checks','--export=caller_entry','--export=__wasm_init_tls','--export=__tls_size','--export=__tls_align','--export=__tls_base','--export=__heap_base',T/'objects/metadata.o',T/'objects/native-provider.o',T/'objects/caller.o',T/'objects/caller-uncovered.o',*[r['copy'] for r in selected],'-o',T/'objects/metadata.wasm'])
run('metadata-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'metadata.mjs',T])
