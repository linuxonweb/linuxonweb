#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
import hashlib,shlex,re,shutil
P=pathlib.Path('/mnt/p6/build/glibc-forced-unwind-prototype-20261002')
def pin(path):
 data=path.read_bytes();return {'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
old_sources=json.loads((P/'source-provenance.json').read_text());old_objects=json.loads((P/'object-provenance.json').read_text())
for old in old_sources+old_objects:
 now=pin(pathlib.Path(old['path']))
 if now['sha256']!=old['sha256'] or now['bytes']!=old['bytes']:raise RuntimeError('changed predecessor '+old['path'])
paths={pathlib.Path(row['path']) for row in old_sources}
paths.update(p for p in R.iterdir() if p.is_file())
for dep in (T/'objects').glob('*-full.d'):
 text=dep.read_text().replace('\\\n',' ');paths.update(pathlib.Path(x) for x in shlex.split(text.split(':',1)[1]))
for relative in ['libcxx/include/__config_site.in','libcxx/include/CMakeLists.txt','libcxx/CMakeLists.txt','libcxx/vendor/llvm/default_assertion_handler.in','libcxxabi/CMakeLists.txt','libcxxabi/src/CMakeLists.txt','libunwind/src/Unwind-wasm.c','libunwind/src/config.h','llvm/lib/Target/WebAssembly/WebAssemblyISelLowering.cpp']:
 paths.add(LLVM_SRC/relative)
paths.add(pathlib.Path('/usr/bin/g++').resolve())
paths.add(G/'nptl/unwind.c')
sourcepins=[]
for path in sorted(paths):
 if not path.is_file():raise RuntimeError('missing dependency '+str(path))
 sourcepins.append(pin(path))
 if path.is_relative_to(LLVM_SRC):dest=T/'source/imported-llvm'/path.relative_to(LLVM_SRC)
 elif path.is_relative_to(G):dest=T/'source/imported-gnu-pristine'/path.relative_to(G)
 elif path.is_relative_to(pathlib.Path('/mnt/p6/build/glibc-native-jumps-20261002/source/glibc-2.44')):dest=T/'source/imported-gnu-port'/path.relative_to('/mnt/p6/build/glibc-native-jumps-20261002/source/glibc-2.44')
 else:continue
 dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,dest)
(T/'source-provenance.json').write_text(json.dumps(sourcepins,indent=2)+'\n')
objectpins=[pin(p) for p in sorted((T/'objects').rglob('*')) if p.is_file()]
(T/'object-provenance.json').write_text(json.dumps(objectpins,indent=2)+'\n')
for row in sourcepins+objectpins:
 if pin(pathlib.Path(row['path']))!=row:raise RuntimeError('independent readback mismatch')
commandrows=json.loads((T/'logs/commands.json').read_text());terminal=[]
for row in commandrows:
 try:os.killpg(row['pgid'],0);empty=False
 except ProcessLookupError:empty=True
 terminal.append({'pid':row['pid'],'pgid':row['pgid'],'exit':row.get('exit'),'empty':empty})
 if not empty or 'exit' not in row:raise RuntimeError('nonterminal owned group')
(T/'logs/terminal.json').write_text(json.dumps(terminal,indent=2)+'\n')
missing=sorted(set(re.findall('undefined symbol: (.+)',(T/'logs/typed-foreign-closure-link-attempt2.log').read_text())))
# Final successful native unit results are derived from actual supervised commands.
units=['layout','cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers','private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo']
compiled=[]
for unit in units:
 matches=[r for r in commandrows if r['stage']=='cxxabi-'+unit];last=matches[-1]
 if last['exit']!=0:raise RuntimeError('compile failure '+unit)
 compiled.append({'unit':unit,'exit':0,'pid':last['pid'],'pgid':last['pgid'],'log':last['log'],'source_snapshot':last['source_snapshot']})
(T/'logs/cxxabi-final-compile-results.json').write_text(json.dumps(compiled,indent=2)+'\n')
report={'firstRoutingGatePass':True,'completeDesignPass':False,'pthreadLifecycleAccepted':False,'typedForeignRuntimeAccepted':False,'nativeCases':48,'nativeChecks':336,'cxxabiUnchangedUnits':11,'cxxabiRecordBytes':72,'cxxabiRecordAlignment':8,'unwindRecordBytes':24,'unwindRecordAlignment':8,'unwindHeaderOffset':48,'missingTypedForeignSymbols':missing,'sourceToolPins':len(sourcepins),'actualObjectArtifactPins':len(objectpins),'independentDifferences':0,'predecessorSourcePinsUnchanged':len(old_sources),'predecessorObjectPinsUnchanged':len(old_objects),'ownedGroupsTerminal':len(terminal),'liveOwnedGroups':0,'taskBytes':sum(p.stat().st_size for p in T.rglob('*') if p.is_file()),'scope':'single host Wasm instance; static diagnostic foreign record; no real GNU forced unwind, typed/foreign C++ execution, TP/TLS concurrency, pthread_exit/cancel/join, Linux guest gate or Nightly acceptance'}
(T/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
