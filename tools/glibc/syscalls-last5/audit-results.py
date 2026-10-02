#!/usr/bin/env python3
"""Freeze prepared evidence without claiming a complete GNU libc or mount API."""
import os,pathlib,json,hashlib,shutil,subprocess,re,shlex
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
def members(group):
 out=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   a=p.read_text().rsplit(')',1)[1].split()
   if int(a[2])==group and a[0]!='Z':out.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return out
snapshot=T/'source-snapshots/final-runtime';snapshot.mkdir(exist_ok=True);inputs={}
def retain(p):
 p=p.resolve();d=digest(p);q=snapshot/(d['sha256']+'-'+p.name)
 if q.exists():assert q.read_bytes()==p.read_bytes()
 else:shutil.copy2(p,q)
 inputs[str(p)]={**d,'snapshot':str(q)};return d
objects=[];formats={'Wasm-v1':0,'LLVM-bitcode':0}
for name in (T/'logs/last5-attempt2-link-inputs.txt').read_text().splitlines():
 p=pathlib.Path(name);b=p.read_bytes();kind='Wasm-v1' if b[:8]==b'\0asm\1\0\0\0' else 'LLVM-bitcode' if b[:4]==b'BC\xc0\xde' else None;assert kind
 formats[kind]+=1;objects.append({'path':str(p),'format':kind,**retain(p)})
assert len(objects)==239 and formats=={'Wasm-v1':218,'LLVM-bitcode':21}
for p in [R/'fixture.c',R/'signatures.c',R/'last5-signal.h',R/'syscall-template.S',R/'compiler.py',T/'source/startup.c',T/'source/worker.js',T/'source/index.html',T/'objects/last5-attempt2.wasm',T/'objects/last5-fpcast.wasm']:
 retain(p)
make=json.loads((T/'logs/make-last5-attempt2-result.json').read_text());assert make['pass'] and make['targetCount']==5
wrappers=json.loads((T/'logs/wrapper-audit/result.json').read_text());assert wrappers['pass']
for path,d in wrappers['headers'].items():assert digest(pathlib.Path(path))==d
for row in json.loads((T/'logs/layout-dependency-commands.json').read_text()):
 assert row['exit']==0
 for name in shlex.split(pathlib.Path(row['dependency']).read_text().replace('\\\n',' ').split(':',1)[1]):
  p=pathlib.Path(name);p=p if p.is_absolute() else pathlib.Path(row['cwd'])/p
  if p.is_file():wrappers['headers'][str(p.resolve())]=digest(p)
attempts=[]
for p in (T/'logs/c-attempts').glob('*/attempt.json'):
 j=json.loads(p.read_text())
 for key in ['sourceSnapshot','driverSnapshot']:
  q=pathlib.Path(j[key]);assert q.is_file();retain(q)
 assert digest(pathlib.Path(j['sourceSnapshot']))['sha256']==j['sourceSha256']
 assert digest(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256']
 attempts.append({'record':str(p),'driverSha256':j['driverSha256'],'sourceSha256':j['sourceSha256'],'pass':j['pass'],'stages':j['stages']})
nm=subprocess.check_output([str(pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin/llvm-nm'),'--defined-only',*[r['path'] for r in objects]],text=True)
(T/'logs/final-provider-symbols.txt').write_text(nm)
for name in ['capget','capset','mount_setattr','pidfd_send_signal','pivot_root']:
 assert len(re.findall(r'^\w+ T '+name+'$',nm,re.M))==1,name
def cpio(raw):
 result={};offset=0
 while True:
  h=raw[offset:offset+110];assert h[:6]==b'070701';size=int(h[54:62],16);n=int(h[94:102],16);offset+=110
  name=raw[offset:offset+n-1].decode().removeprefix('./').lstrip('/');offset+=n;offset+=(-offset)%4
  result[name]=raw[offset:offset+size];offset+=size;offset+=(-offset)%4
  if name=='TRAILER!!!':return result
repo=R.parents[2];original=cpio((repo/'web/linux/initramfs.cpio').read_bytes());runs=[];groups=[]
for folder,package,module in [('guest-native2','native-package','last5-attempt2.wasm'),('guest-fpcast1','fpcast-package','last5-fpcast.wasm')]:
 D=T/folder;j=json.loads((D/'result.json').read_text());s=json.loads((D/'last5-result.json').read_text());assert j['pass'] and s['pass'] and j['browserExit']=={'code':0,'signal':None} and j['serverClosed']
 lines=(D/'guest-console.txt').read_text();assert not re.search(r'WARNING:|Not a kmalloc|\bFAIL\b',lines)
 for path,sha in j['inputs'].items():assert digest(pathlib.Path(path))['sha256']==sha
 groups.append({'pgid':j['browserPid'],'members':members(j['browserPid'])});assert not groups[-1]['members']
 build=json.loads((T/package/'build.json').read_text());assert digest(T/package/'initramfs.cpio')['sha256']==build['archiveSha256']
 new=cpio((T/package/'initramfs.cpio').read_bytes());assert set(new)-set(original)=={'bin/gnu-allocator-probe'}
 assert [n for n in original if original[n]!=new[n]]==['init']
 assert new['bin/gnu-allocator-probe']==(T/'objects'/module).read_bytes()
 runs.append({'directory':str(D),'passes':j['jit']['passes'],'failures':j['jit']['failures'],'strict':s,'browserPid':j['browserPid'],'servedInputCount':len(j['inputs']),'module':str(T/'objects'/module),'moduleHash':digest(T/'objects'/module),'archiveHash':digest(T/package/'initramfs.cpio')})
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text())
 if j['pgid']==os.getpgrp():continue
 assert 'exit' in j and j['terminalMembers']==[];a=members(j['pgid']);assert not a;groups.append({'record':str(p),'pgid':j['pgid'],'members':a,'exit':j['exit']})
(T/'logs/final-runtime-inputs.json').write_text(json.dumps({'linkObjects':239,'formats':formats,'inputs':inputs},indent=2)+'\n')
result={'pass':True,'phase':'prepared for independent review; freeze not authorized','runs':runs,'objects':objects,'linkObjects':239,'formats':formats,'includes':wrappers['headers'],'driverAttempts':attempts,'terminalGroups':groups,'GNUmake':make,'baseManifest':'12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d','limits':['no full GNU sysroot, CRT, NPTL or Nightly','pidfd nonNULL SI_USER/SI_QUEUE/SI_TKILL only; other classes EOPNOTSUPP','configured-source ramfs only; NULL/default-source kernel rodata free defect remains','raw unmount/read/write and old rootfs launcher outside new GNU API acceptance','historical capget/capset/pivot_root have typed exports, no GNU public header'],'partialFailureCleanup':'forward pivot failure detaches only owned new mount and records failure; actual successful gates prove reverse/unmount/root restoration','retainedFailures':['prepare runtime copy collision','layout signed-LLVM text audit mismatch','initial overlay configparms absence (old helper bytes unavailable)','first generated-template allowlist ordering','first duplicate startup provider link','first runner CLI before browser/server'],'taskKiB':int(subprocess.check_output(['du','-sk',str(T)]).split()[0])}
(T/'logs/prepared-acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'objects':239,'formats':formats,'runs':[r['passes'] for r in runs],'includes':len(wrappers['headers']),'terminalGroups':len(groups)}))
