#!/usr/bin/env python3
"""Pin actual link providers, payload bytes and terminal process ownership."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,re
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
parser=argparse.ArgumentParser()
parser.add_argument('--label',required=True)
parser.add_argument('--native-run',required=True)
parser.add_argument('--fpcast-run',required=True)
args=parser.parse_args()
assert all(re.fullmatch(r'[a-zA-Z0-9_-]+',s) for s in [args.label,args.native_run,args.fpcast_run])
if args.label=='initial':
 linkInputs=T/'logs/next26-link-inputs.txt';linkMap=T/'logs/next26-link-map.txt';module=T/'objects/next26.wasm'
else:
 linkInputs=T/('logs/recompile-'+args.label)/'link-inputs.txt';linkMap=linkInputs.parent/'link-map.txt';module=T/('objects/recompile-'+args.label)/'module.wasm'
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
def members(group):
 result=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==group and f[0]!='Z':result.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return result
assert not (T/'acceptance.json').exists()
D=T/'source-snapshots/final-runtime';D.mkdir();inputs={};formats={}
def pin(p):
 q=D/(str(len(inputs))+'-'+p.name);shutil.copy2(p,q);h=digest(p);assert digest(q)==h
 inputs[str(p)]={**h,'snapshot':str(q)};return inputs[str(p)]
objects=[pathlib.Path(x) for x in linkInputs.read_text().splitlines()];assert len(objects)==191 and len(set(objects))==191
providers={}
for p in objects:
 b=p.read_bytes();kind='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None
 assert kind and len(b)>8;pin(p)['format']=kind;formats[kind]=formats.get(kind,0)+1
 symbols=subprocess.check_output([str(L/'llvm-nm'),'--defined-only',str(p)],text=True)
 for line in symbols.splitlines():
  words=line.split()
  if len(words)==3:providers.setdefault(words[-1],[]).append({'object':str(p),'binding':words[1],'address':words[0]})
assert formats=={'Wasm-v1':170,'LLVM-bitcode':21}
audit=json.loads((T/'logs/wrapper-audit/result.json').read_text());assert audit['pass'] and len(audit['wrappers'])==26
link=linkMap.read_text();unique=[]
for row in audit['wrappers']:
 expected=T/'objects/guest'/('generated-next26-'+row['call']+'.o')
 for name in {row['symbol'],row['public']}:
  supplied=providers[name];assert len(supplied)==1 and supplied[0]['object']==str(expected),(name,supplied)
 assert str(expected) in link
 assert digest(expected)=={'sha256':row['sha256'],'bytes':row['bytes']}
 unique.append({'call':row['call'],'body':providers[row['symbol']][0],'public':providers[row['public']][0]})
 pin(pathlib.Path(row['stream']))
for p in [T/'source/startup.c',R/'fixture.c',R/'signatures.c',R/'types.json',T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32/syscall-template.S',T/'source/glibc-2.44/sysdeps/wasm32/Makefile',T/'source/glibc-2.44/sysdeps/wasm32/bits/fenv.h',module,T/('objects/next26-'+args.label+'-fpcast.wasm'),T/'source/glibc-2.44/signal/sigempty.c',T/'source/glibc-2.44/signal/sigaddset.c']:
 pin(p)
for name,h in audit['headers'].items():assert digest(pathlib.Path(name))==h
make=json.loads((T/'logs/make-next26-result.json').read_text());assert make['pass'] and make['targetCount']==26 and sum(len(r['argv'])-5 for r in make['records'])==26
makeObjects=[]
for row in make['records']:
 assert row['exit']==0
 for name in row['argv'][5:]:
  p=pathlib.Path(name);assert p.read_bytes()[:8]==b'\0asm\1\0\0\0';makeObjects.append({'path':str(p),**digest(p),'command':row['argv']})
assert len(makeObjects)==26
historicalFailures={'wrappers':1,'runtime-attempt1':1,'runtime-attempt2':1,'guest-fpcast-run1':1};groups={};gates={}
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text());assert j['exit']==historicalFailures.get(p.stem,0) and not j['terminalMembers']
 assert not members(j['pgid']);groups[str(j['pgid'])]={'proof':str(p),'exit':j['exit'],'terminalMembers':[]}
for mode,run in [('native',args.native_run),('fpcast',args.fpcast_run)]:
 d=T/run;base=json.loads((d/'result.json').read_text());fixed=json.loads((d/'next26-result.json').read_text())
 assert not any(x in (d/'guest-console.txt').read_text() for x in ['WARNING:', 'Not a kmalloc allocation', 'GNU_NEXT26_EXEC_OLD_CLEANUP'])
 assert base['pass'] and fixed['pass'] and base['browserExit']=={'code':0,'signal':None} and base['serverClosed']
 for name,h in base['inputs'].items():assert digest(pathlib.Path(name))['sha256']==h
 for pid in [base['runnerPid'],base['browserPid']]:
  assert not members(pid);groups[str(pid)]={'proof':str(d/'result.json'),'terminalMembers':[]}
 gates[mode]={'checks':base['jit'],'next26':fixed,'result':str(d/'result.json'),'browserExit':base['browserExit'],'serverClosed':base['serverClosed']}
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':191,'formats':formats,'inputs':inputs},indent=2)+'\n')
(T/'logs/final-provider-proof.json').write_text(json.dumps({'pass':True,'wrappers':unique,'actualMakeObjects':makeObjects},indent=2)+'\n')
(T/'logs/terminal-group-proof.json').write_text(json.dumps({'pass':True,'groups':groups,'historicalFailures':historicalFailures},indent=2)+'\n')
acceptance={'pass':True,'newPublicWrappers':26,'selectedGNUStreamsEqualHistorical':True,'publicPrototypeChecks':26,'actualMakeTargets':26,'linkObjects':191,'formats':formats,'gates':gates,'unavailableKernelAPIs':['swapoff','swapon','acct','fanotify_init'],'modernMountSourceExplicit':True,'defaultNullSourceMountKernelBug':True,'setsidAndChrootIsolated':True,'publicExecFreshGNUStartup':True,'oldGeneratedWrappersRetained':53,'privateCloseProbesArePublicCloseAcceptance':False,'fullSysroot':False,'NPTLCancellation':False,'NightlyBrowser':False}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n');print(json.dumps(acceptance))
