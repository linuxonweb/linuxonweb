#!/usr/bin/env python3
"""Record final objects, source snapshots and terminal owned groups before review."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
def members(group):
 out=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==group and f[0]!='Z':out.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return out
assert not (T/'acceptance.json').exists();snap=T/'source-snapshots/final-runtime';snap.mkdir();inputs={};formats={}
objects=sorted((T/'objects/guest').glob('*.o'));assert len(objects)==123
for n,p in enumerate(objects):
 b=p.read_bytes();kind='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert kind and len(b)>8
 q=snap/(str(n)+'-'+p.name);shutil.copy2(p,q);d=digest(p);assert digest(q)==d;inputs[str(p)]={**d,'format':kind,'snapshot':str(q)};formats[kind]=formats.get(kind,0)+1
assert formats=={'Wasm-v1':102,'LLVM-bitcode':21}
for p in [T/'source/startup.c',T/'source/glibc-2.44/sysdeps/wasm32/bits/fenv.h',T/'source/glibc-2.44/math/fegetround.c',T/'source/glibc-2.44/math/fesetround.c',R/'fixture.c',T/'objects/fenv.wasm',T/'objects/fenv-fpcast.wasm']:
 q=snap/p.name;shutil.copy2(p,q);d=digest(p);assert digest(q)==d;inputs[str(p)]={**d,'snapshot':str(q)}
units=json.loads((T/'logs/fenv-units/result.json').read_text());assert units['pass'] and units['passedUnits']==8
groups={};gates={}
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text());assert j['exit']==0 and not j['terminalMembers'];live=members(j['pgid']);assert not live;groups[str(j['pgid'])]={'proof':str(p),'terminalMembers':live}
for mode in ['native','fpcast']:
 D=T/('guest-'+mode+'-run1');base=json.loads((D/'result.json').read_text());rounding=json.loads((D/'fenv-result.json').read_text());assert base['pass'] and rounding['pass']
 assert base['browserExit']=={'code':0,'signal':None} and base['serverClosed']
 for p,h in base['inputs'].items():assert digest(pathlib.Path(p))['sha256']==h
 for pid in [base['runnerPid'],base['browserPid']]:
  live=members(pid);assert not live;groups[str(pid)]={'proof':str(D/'result.json'),'terminalMembers':live}
 gates[mode]={'passes':base['jit']['passes'],'failures':base['jit']['failures'],'rounding':rounding,'result':str(D/'result.json'),'browserExit':base['browserExit'],'serverClosed':base['serverClosed']}
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':123,'formats':formats,'inputs':inputs},indent=2)+'\n')
(T/'logs/terminal-group-proof.json').write_text(json.dumps({'pass':True,'groups':groups},indent=2)+'\n')
result={'pass':True,'unitBuilds':8,'gates':gates,'publicGNUFunctions':['fegetround','fesetround'],'roundingMode':'fixed nearest, ties to even','supportedExceptionFlags':0,'selectableOtherModes':False,'sourceArchiveSha256':'37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667','privateCompilerReused':True,'linkObjects':123,'formats':formats,'fullLibm':False,'conversionRuntime':False,'fullSysroot':False,'NPTLCancellation':False,'NightlyBrowser':False}
(T/'acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
