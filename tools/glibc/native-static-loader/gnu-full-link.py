#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
P=pathlib.Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002')
pins=json.loads((P/'logs/object-pins.json').read_text())
commands=json.loads((P/'logs/commands.json').read_text())
selected=[];results=[]
args=json.loads((T/'logs/gnu-compile-flags.json').read_text())['args']
src=G/'elf/dl-support.c';data=src.read_bytes();q=T/'source/imported/gnu-elf-dl-support.c';q.write_bytes(data)
assert b'char **_dl_argv = &__progname;' in data
(T/'logs/startup-data-source-pin.json').write_text(json.dumps({'original':str(src),'snapshot':str(q),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'selectedLines':[49,50],'scope':'Exact unchanged GNU static diagnostic initializer; actual argv setup is separate startup integration'},indent=2)+'\n')
run('gnu-startup-data',[CLANG,'--target=wasm32-unknown-linux-gnu',*args,'-c',R/'native-startup-data.c','-o',T/'objects/native-startup-data.o'])
for mode,stage in [('default','typed-foreign-link'),('release','typed-foreign-link')]:
 prior=[r for r in commands if r['stage']==stage][-1]
 assert prior['exit']==1 and prior['group_empty']
 cmd=[]
 for arg in prior['argv']:
  p=pathlib.Path(arg)
  if mode=='release' and p.parent==P/'objects' and p.stem in {
   'cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers',
   'private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo','cxa_demangle','stdlib_new_delete','unwind-wasm-gnu'}:
   p=P/'objects/release'/p.name
  if str(p).startswith(str(P/'objects')) and p.is_file():
   b=p.read_bytes();row=pins[str(p)];assert row=={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
   q=T/'objects/imported-cxx'/p.relative_to(P/'objects');q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b)
   selected.append({'original':str(p),'copy':str(q),**row});cmd.append(str(q))
  elif str(P) in arg:cmd.append(arg.replace(str(P),str(T)))
  else:cmd.append(arg)
 # The prior output is not an input file, and lives in this task after rewrite.
 out=T/'objects'/f'public-cxx-{mode}.wasm'
 cmd[cmd.index('-o')+1]=str(out)
 if '-Map' in cmd:cmd[cmd.index('-Map')+1]=str(T/'logs'/f'public-cxx-{mode}-map.txt')
 cmd=[a if not a.startswith('--why-extract=') else '--why-extract='+str(T/'logs'/f'public-cxx-{mode}-why.txt') for a in cmd]
 cmd[1:1]=[str(T/'objects/gnu-loader.o'),str(T/'objects/native-startup-data.o'),'--export=native_loader_entry','--export=native_loader_checks']
 try:run('gnu-public-cxx-'+mode+'-link',cmd);result=True
 except RuntimeError:result=False
 results.append({'mode':mode,'link':result,'priorCommand':prior,'command':rows[-1],
  'publicRuntime':False,'scope':'Real public GNU/C++ dependency extraction with coherent default GNU allocator/memory selection; Release changes only genuine upstream libc++abi configuration, no runtime acceptance from a link'})
(T/'logs/full-link-imported-pins.json').write_text(json.dumps(selected,indent=2)+'\n')
(T/'logs/gnu-full-link-results.json').write_text(json.dumps(results,indent=2)+'\n')
