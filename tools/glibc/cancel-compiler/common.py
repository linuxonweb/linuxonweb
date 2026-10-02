"""Owned finite stages, ext4 budget, exact commands, terminal groups."""
import os,pathlib,subprocess,json,time,signal,shutil,hashlib,resource
T=pathlib.Path(os.environ.get('GLIBC_TASK','/mnt/p6/build/glibc-cancel-compiler-20261002'))
S=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
L=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
P=pathlib.Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler')
for d in ['logs','objects/compiler','tmp','cache']:(T/d).mkdir(parents=True,exist_ok=True)
os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'))
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def group(g):
 out=[]
 for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   f=p.read_text().rsplit(')',1)[1].split()
   if int(f[2])==g and f[0]!='Z':out.append(int(p.parent.name))
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
 return out
def budget(launch=False):
 free=shutil.disk_usage(T).free;used=int(subprocess.check_output(['du','-sk',str(T)]).split()[0])*1024
 assert free> (8 if launch else 5)*1024**3,(free,'disk reserve')
 assert used<2*1024**3,(used,'task cap')
 assert subprocess.check_output(['stat','-f','-c','%T',str(T)]).decode().strip()=='ext2/ext3'
 return {'free':free,'taskBytes':used}
def run(name,argv,timeout=300,expected=0):
 budget(True);base=name;attempt=1
 while pathlib.Path(str(T/'logs'/name)+'.command.json').exists():
  attempt+=1;name=base+'-attempt'+str(attempt)
 stem=T/'logs'/name
 snapshots=T/'source-snapshots'/name;snapshots.mkdir(parents=True,exist_ok=True)
 for source in pathlib.Path(__file__).resolve().parent.iterdir():
  if source.is_file():shutil.copyfile(source,snapshots/source.name)
 outputs=[]
 if '-o' in [str(a) for a in argv]:
  out=pathlib.Path(argv[[str(a) for a in argv].index('-o')+1]);outputs.append(out)
  if out.is_file():shutil.copyfile(out,snapshots/('before-'+out.name))
 start=time.monotonic();p=subprocess.Popen([str(a) for a in argv],cwd=T,stdout=pathlib.Path(str(stem)+'.log').open('wb'),stderr=subprocess.STDOUT,start_new_session=True)
 row={'argv':[str(a) for a in argv],'cwd':str(T),'pid':p.pid,'pgid':p.pid,'status':'running'};pathlib.Path(str(stem)+'.command.json').write_text(json.dumps(row,indent=2)+'\n');print(name,p.pid,flush=True)
 try:code=p.wait(timeout=timeout)
 except subprocess.TimeoutExpired:
  os.killpg(p.pid,signal.SIGTERM)
  try:code=p.wait(timeout=2)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait()
 if group(p.pid):
  os.killpg(p.pid,signal.SIGTERM);time.sleep(.2)
  if group(p.pid):os.killpg(p.pid,signal.SIGKILL)
 assert not group(p.pid)
 artifacts=[]
 for out in outputs:
  if out.is_file():
   snap=snapshots/('after-'+out.name);shutil.copyfile(out,snap);artifacts.append({'path':str(out),'snapshot':str(snap),'sha256':sha(out)})
 row.update(artifacts=artifacts,status='terminal',exit=code,elapsedSeconds=time.monotonic()-start,groupMembers=group(p.pid),budget=budget());pathlib.Path(str(stem)+'.command.json').write_text(json.dumps(row,indent=2)+'\n')
 if expected is not None:assert code==expected,(name,code,pathlib.Path(str(stem)+'.log'))
 return row
