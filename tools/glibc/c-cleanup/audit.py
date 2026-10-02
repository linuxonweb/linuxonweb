#!/usr/bin/env python3
"""Pin actual successful compiler/GNU objects and final guest closure; retain failures."""
import os,pathlib,json,hashlib,subprocess,importlib.util
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(pathlib.Path(p).read_text())
def members(group):
 result=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==group and f[0]!='Z':result.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return result
compiler=read(T/'logs/compiler/result.json');assert compiler['pass'] and sha(compiler['compiler'])==compiler['sha256']
spec=importlib.util.spec_from_file_location('archive_audit',R/'archive-audit.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
proof=read(T/'logs/compiler/archive-ordered-proof.json');L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);assert mod.members(L/'lib/libclangCodeGen.a')==proof['original'] and mod.members(T/'objects/compiler/libclangCodeGen.a')==proof['owned']
assert proof['actualMemberCount']==101 and proof['unchangedOccurrences']==100 and proof['changedIndices']==[17]
units=read(T/'logs/gnu-cleanup-units/result.json');assert units['pass'] and units['passedUnits']==50 and len(units['rows'])==50
for row in units['rows']:
 p=T/'objects/fullmake'/row['unit'];b=p.read_bytes();assert b[:8]==b'\0asm\1\0\0\0' and len(b)==row['objectBytes'] and sha(p)==row['objectSha256'] and sha(row['source'])==row['sourceSha256']
assert len(units['rawIRProof'])==50 and all(x['rawScopedPads'] for x in units['rawIRProof'])
for p in [T/'logs/controls/result.json',T/'logs/controls/object-result.json',T/'logs/host-controls/node-result.json',T/'logs/host-controls/chromium-result.json']:assert read(p)['pass']
gates={};terminal=[]
for name in ['native','fpcast']:
 d=T/os.environ.get('GLIBC_'+name.upper()+'_RUN','guest-'+name+'-production-run1');base=read(d/'result.json');gate=read(d/'c-cleanup-result.json')
 assert base['pass'] and gate['pass'] and gate['runs']==6 and gate['cleanupThrowGNUAbort'] and gate['execReplacement']['pass'] and not gate['fullCancellation'] and not gate['CXXRuntime']
 assert base['browserExit']=={'code':0,'signal':None} and base['serverClosed'] and not members(base['browserPid']) and not members(base['runnerPid'])
 for p,h in base['inputs'].items():assert sha(p)==h,(p,'accepted guest input changed')
 assert not any('runtime trap' in row['text'] for row in base['consoleMessages'])
 gates[name]={'passes':base['jit']['passes'],'failures':base['jit']['failures'],'result':str(d/'result.json'),'cleanup':str(d/'c-cleanup-result.json')}
 terminal.append({'run':name,'runnerPid':base['runnerPid'],'browserPidPgid':base['browserPid'],'terminalMembers':[],'browserExit':base['browserExit'],'serverClosed':True})
# Historical reports keep their original paths and hashes; changed baselines resolve
# only through exact retained snapshots, never through rewritten report metadata.
historical=[]
candidates=[p for p in (T/'source-snapshots').rglob('*') if p.is_file()]
for name in ['guest-native-control-run5','guest-fpcast-control-run1']:
 if not (T/name/'result.json').exists():continue
 base=read(T/name/'result.json');rows=[]
 for p,h in base['inputs'].items():
  current=pathlib.Path(p)
  if current.exists() and sha(current)==h:rows.append({'originalPath':p,'sha256':h,'verifiedPath':p});continue
  matches=[x for x in candidates if x.name==current.name and sha(x)==h];assert matches,(name,p,h)
  rows.append({'originalPath':p,'sha256':h,'verifiedSnapshot':str(matches[0]),'reconstructed':False})
 historical.append({'report':str(T/name/'result.json'),'inputs':rows})
(T/'logs/historical-input-mapping.json').write_text(json.dumps(historical,indent=2)+'\n')
D=T/'source-snapshots/runtime-final';assert not D.exists();D.mkdir();objects={};types={}
for i,p in enumerate(sorted((T/'objects/guest').glob('*.o'))):
 b=p.read_bytes();kind='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert kind,p
 types[kind]=types.get(kind,0)+1;q=D/(str(i)+'-'+p.name);q.write_bytes(b);objects[str(p)]={'sha256':sha(p),'bytes':len(b),'format':kind,'snapshot':str(q)}
assert len(objects)==120 and types=={'Wasm-v1':99,'LLVM-bitcode':21},types
once=next(x for x in units['rows'] if x['unit']=='nptl/pthread_once.o');assert sha(T/'objects/guest/cleanup-once.o')==once['objectSha256']
for p in [T/'objects/c-cleanup.wasm',T/'objects/c-cleanup-fpcast.wasm',T/'source/startup.c',R/'fixture.c',R/'native-tag.S',R/'build-runtime.sh',R/'compiler.py',R/'package.py',R/'run-guest.mjs',repo/'web/linux/dist/wasm.js',repo/'web/linux/dist/worker.js',repo/'web/linux/dist/wasm.d.ts']:
 q=D/p.name;assert not q.exists();q.write_bytes(p.read_bytes());objects[str(p)]={'sha256':sha(p),'bytes':p.stat().st_size,'snapshot':str(q)}
(T/'logs/runtime-inputs.json').write_text(json.dumps({'linkObjectCount':120,'formats':types,'inputs':objects,'GNUOnceSelection':once},indent=2)+'\n')
for p in (T/'logs/supervision').glob('*.json'):
 row=read(p);assert 'exit' in row and row['terminalMembers']==[] and not members(row['pgid']),p
for p in (T/'logs/compiler').glob('*.command.json'):
 row=read(p);assert row['exit']==0 and not members(row['pgid']),p
hb=read(T/'logs/host-controls/browser-terminal.json');assert hb['closed'] and hb['exit']==[0,None] and not members(hb['pid'])
(T/'logs/terminal-runtime-proof.json').write_text(json.dumps({'acceptedGuests':terminal,'hostBrowser':hb},indent=2)+'\n')
accept={'pass':True,'scope':'owned native C cleanup frontend + 50 GNU units + real native/FPCAST GNU runtime foundation','compiler':compiler['compiler'],'compilerSha256':compiler['sha256'],'orderedCodeGenMembers':101,'unchangedCodeGenOccurrences':100,'GNUCompileUnits':50,'runtimeLinkObjects':120,'runtimeObjectFormats':types,'gates':gates,'publicGNUOnce':True,'actualGNUAbort134':True,'rawKernelExec221FreshTarget42':True,'publicGNUExecveAccepted':False,'CXXRuntime':False,'NPTLForcedUnwind':False,'fullGNUSysroot':False,'Nightly':False,'failedBaseBuildExit':143,'replayBaseFactorization':'source-reviewed/syntax checked; accepted earlier first closure reused for fresh final links','historicalFailuresRetained':True}
assert not (T/'acceptance.json').exists();(T/'acceptance.json').write_text(json.dumps(accept,indent=2)+'\n')
print(json.dumps(accept))
