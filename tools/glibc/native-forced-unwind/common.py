#!/usr/bin/env python3
import fcntl,hashlib,json,os,pathlib,resource,signal,subprocess,time
T=pathlib.Path('/mnt/p6/build/glibc-native-forced-unwind-20261002')
R=pathlib.Path(__file__).resolve().parent
S=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
L=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
C=pathlib.Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang')
P=pathlib.Path('/mnt/p6/build/glibc-native-static-loader-20261002')
NODE=pathlib.Path('/home/a/.config/nvm/versions/node/v22.22.2/bin/node')
os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
for d in ['logs','objects','source','tmp','cache']:(T/d).mkdir(exist_ok=True,parents=True)
lock=(T/'logs/supervisor.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
rows=json.loads((T/'logs/commands.json').read_text()) if (T/'logs/commands.json').exists() else []
def pin(p):
 b=pathlib.Path(p).read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def group(pgid):
 members=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=p.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid:members.append({'pid':int(p.parent.name),'state':fields[0]})
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return members
def storage():
 used=sum(p.stat().st_size for p in T.rglob('*') if p.is_file())
 # Root authorized 3GiB for this owned sparse compiler packet only.
 assert used<3221225472,used
 free=os.statvfs(T).f_bavail*os.statvfs(T).f_frsize
 assert free>5368709120,free
 return used,free
def run(stage,args,expected=0):
 used,free=storage();assert free>=8589934592
 attempt=1+sum(row['stage']==stage for row in rows)
 stem=f'{stage}-attempt{attempt}';out=T/'logs'/(stem+'.log');snap=T/'source'/stem;snap.mkdir()
 for p in R.iterdir():
  if p.is_file():(snap/p.name).write_bytes(p.read_bytes())
 artifacts=T/'objects/attempts'/stem;artifacts.mkdir(parents=True)
 outputs=[]
 for flag in ['-o','-MF','-d']:
  if flag in args:outputs.append(pathlib.Path(args[args.index(flag)+1]))
 inputs=[]
 for n,arg in enumerate(args):
  p=pathlib.Path(str(arg))
  if p.is_file() and p not in outputs:
   row={'path':str(p),**pin(p)}
   if p.suffix in ['.c','.cpp','.h','.S','.ll','.bc','.td','.txt','.mjs'] and p.stat().st_size<8388608:
    q=artifacts/f'input-{n}-{p.name}';q.write_bytes(p.read_bytes());row['snapshot']=str(q)
   inputs.append(row)
 for p in outputs:
  if p.is_file():(artifacts/('before-'+p.name)).write_bytes(p.read_bytes())
 if 'execute' in stage:
  for p in (T/'logs').glob('*results.json'):(artifacts/('before-'+p.name)).write_bytes(p.read_bytes())
 start=time.monotonic()
 with out.open('wb') as stream:
  child=subprocess.Popen([str(x) for x in args],cwd=T,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  row=None;code=None;error=None;reason=None
  try:
   row={'stage':stage,'attempt':attempt,'argv':[str(x) for x in args],'cwd':str(T),'pid':child.pid,'pgid':child.pid,'sourceSnapshot':str(snap),'inputs':inputs,'log':str(out)};rows.append(row)
   (T/'logs/commands.json').write_text(json.dumps(rows,indent=2)+'\n')
   deadline=start+300;next_storage=start
   while child.poll() is None:
    now=time.monotonic()
    if now>=next_storage:storage();next_storage=now+5
    if now>=deadline:reason='deadline';break
    time.sleep(.1)
  except BaseException as exc:error=repr(exc)
  finally:
   def stop(sig):
    try:os.killpg(child.pid,sig)
    except ProcessLookupError:pass
   try:
    if child.poll() is None or error or reason:stop(signal.SIGTERM)
    try:code=child.wait(timeout=2)
    except subprocess.TimeoutExpired:stop(signal.SIGKILL);code=child.wait(timeout=2)
   finally:
    stop(signal.SIGKILL)
    limit=time.monotonic()+3
    while group(child.pid) and time.monotonic()<limit:time.sleep(.05)
 if row is None:
  row={'stage':stage,'attempt':attempt,'argv':[str(x) for x in args],'cwd':str(T),'pid':child.pid,'pgid':child.pid,'sourceSnapshot':str(snap),'inputs':inputs,'log':str(out)}
  rows.append(row)
 row.update(supervisorError=error,stopReason=reason,exit=code,elapsedSeconds=time.monotonic()-start,terminalGroupMembers=group(child.pid))
 (T/'logs/commands.json').write_text(json.dumps(rows,indent=2)+'\n')
 assert not row['terminalGroupMembers'],row
 assert not error and not reason,row
 row['artifacts']=[]
 for p in outputs:
  if p.is_file():
   q=artifacts/('after-'+p.name);q.write_bytes(p.read_bytes());row['artifacts'].append({'path':str(q),**pin(q)})
 if 'execute' in stage:
  for p in (T/'logs').glob('*results.json'):
   q=artifacts/('after-'+p.name);q.write_bytes(p.read_bytes());row['artifacts'].append({'path':str(q),**pin(q)})
 (T/'logs/commands.json').write_text(json.dumps(rows,indent=2)+'\n');storage()
 print(stage,'exit',code,'PID/PGID',child.pid,'members',row['terminalGroupMembers'],flush=True)
 assert code==expected,(stage,code,out)
 return row
