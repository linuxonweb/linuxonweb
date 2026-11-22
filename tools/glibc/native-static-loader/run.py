#!/usr/bin/env python3
"""Finite command supervisor; every child has an owned process group."""
import os,pathlib,subprocess,time,json,sys,signal,shutil,hashlib
T=pathlib.Path('/mnt/p6/build/glibc-native-static-loader-20261002')
L=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
LLVM_SRC=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
G=pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
R=pathlib.Path(__file__).resolve().parent
CLANG=pathlib.Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang')
os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
DEADLINE=time.monotonic()+300
rows=json.loads((T/'logs'/'commands.json').read_text()) if (T/'logs'/'commands.json').exists() else []
def run(name,cmd):
 if sum(p.stat().st_size for p in T.rglob('*') if p.is_file())>=2147483648:raise RuntimeError('2GiB cap')
 if os.statvfs(T).f_bavail*os.statvfs(T).f_frsize<=5368709120:raise RuntimeError('5GiB hard stop')
 if os.statvfs(T).f_bavail*os.statvfs(T).f_frsize<8589934592:raise RuntimeError('8GiB launch reserve')
 attempt=sum(row['stage']==name for row in rows)+1
 log=T/'logs'/f'{name}.log' if attempt==1 else T/'logs'/f'{name}-attempt{attempt}.log'
 snapshot=T/'source'/f'{name}-attempt{attempt}'
 snapshot.mkdir(parents=True,exist_ok=True)
 for source in R.iterdir():
  if source.is_file():(snapshot/source.name).write_bytes(source.read_bytes())
 outputs=[]
 for option in ['-o','-MF','-Map']:
  if option in cmd:
   candidate=pathlib.Path(cmd[cmd.index(option)+1])
   outputs.append(candidate)
 for option in cmd:
  if str(option).startswith('--why-extract='):outputs.append(pathlib.Path(str(option).split('=',1)[1]))
 artifacts=T/'objects/attempts'/f'{name}-attempt{attempt}'
 artifacts.mkdir(parents=True,exist_ok=True)
 inputs=[]
 for n,arg in enumerate(cmd):
  p=pathlib.Path(str(arg))
  if p.is_file() and p not in outputs:
   b=p.read_bytes();entry={'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
   if p.suffix in ['.c','.cpp','.h','.S','.ll','.bc','.modules','.boundaries','.txt'] and len(b)<4194304:
    q=artifacts/f'input-{n}-{p.name}';q.write_bytes(b);entry['snapshot']=str(q)
   inputs.append(entry)
 if 'execute' in name:
  for p in (T/'logs').glob('*results.json'):
   q=artifacts/('before-'+p.name);q.write_bytes(p.read_bytes())
 for output in outputs:
  if output.is_file():shutil.copyfile(output,artifacts/('before-'+output.name))
 with log.open('wb') as out:
  p=subprocess.Popen([str(x) for x in cmd],stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
  row={'stage':name,'argv':[str(x) for x in cmd],'pid':p.pid,'pgid':os.getpgid(p.pid),'log':str(log),'source_snapshot':str(snapshot),'inputs':inputs};rows.append(row)
  (T/'logs'/'commands.json').write_text(json.dumps(rows,indent=2)+'\n')
  try:code=p.wait(timeout=max(1,DEADLINE-time.monotonic()))
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait();code=124
  row['exit']=code
  row['artifacts']=[]
  if 'execute' in name:
   for result in (T/'logs').glob('*results.json'):
    q=artifacts/('after-'+result.name);q.write_bytes(result.read_bytes())
    row['artifacts'].append({'path':str(q),'sha256':hashlib.sha256(q.read_bytes()).hexdigest(),'bytes':q.stat().st_size})
  for output in outputs:
   if output.is_file():
    copy=artifacts/('after-'+output.name);shutil.copyfile(output,copy)
    row['artifacts'].append({'path':str(copy),'sha256':hashlib.sha256(copy.read_bytes()).hexdigest(),'bytes':copy.stat().st_size})
  try:os.killpg(row['pgid'],0);row['group_empty']=False
  except ProcessLookupError:row['group_empty']=True
  (T/'logs'/'commands.json').write_text(json.dumps(rows,indent=2)+'\n')
  print(name,code,'pid',row['pid'],'pgid',row['pgid'],'empty',row['group_empty'],flush=True)
  if code:raise RuntimeError(name+' exit '+str(code))
base=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-isystem',L/'lib/clang/22/include','-O2','-fno-builtin','-fno-stack-protector']
