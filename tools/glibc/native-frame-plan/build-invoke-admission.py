#!/usr/bin/env python3
"""Fresh bounded one-unit Lower32 composition with actual consumer13 archives."""
import argparse,importlib.util,json,os,resource,shlex,shutil,signal,subprocess,time
from pathlib import Path
from evidence import T as PREV,R,S,L,sha,group
N=PREV.parent/'glibc-native-frame-plan-continuation32-20261002'
PLAN=N/'plan32b.json';O=N/'objects/compiler32'
def budget(launch=False):
 assert subprocess.check_output(['stat','-f','-c','%T',str(N)]).decode().strip()=='ext2/ext3'
 used=int(subprocess.check_output(['du','-sk',str(N)]).split()[0])*1024;free=shutil.disk_usage(N).free
 assert used<2*1024**3 and free>=(8 if launch else 5)*1024**3
 return {'taskBytes':used,'freeBytes':free}
def prepare():
 assert not PLAN.exists();N.mkdir(exist_ok=False)
 for d in ['tmp','cache','logs','source']: (N/d).mkdir()
 packet=PREV/'module4-proposal-32';prepared=json.loads((packet/'prepared.json').read_text());assert prepared['patchSha256']=='0c6760e75c703d77c08cc2175749e3f0d982aeca0412999ce55461fbee9fd0b0'
 peer=PREV.parent/'glibc-native-forced-unwind-consumer13-20261002';pplan=peer/'logs/consumer13-continuation-build-plan.json';result=peer/'logs/consumer13-continuation-build-result.json'
 prior=json.loads(pplan.read_text());r=json.loads(result.read_text());assert r['compiled'] and sha(r['compiler'])==r['sha256']
 link=prior['linkCommand'][:];link[link.index('-o')+1]=str(O/'clang');positions=[i for i,v in enumerate(link) if Path(v).name=='libLLVMWebAssemblyCodeGen.a'];assert len(positions)==1
 base=Path(link[positions[0]]);link[positions[0]]=str(O/base.name)
 overlay=N/'overlay.json';overlay.write_text(json.dumps({'version':0,'roots':[{'type':'file','name':str(S/rel),'external-contents':row['path']} for rel,row in prepared['sourcePairs'].items()]},indent=2)+'\n')
 flags=shlex.split(subprocess.check_output([str(L/'bin/llvm-config'),'--cxxflags']).decode());flags+=['-DNDEBUG','-O1','-g0','-ivfsoverlay',str(overlay),'-I'+str(PREV.parent/'glibc-cancel-compiler-20261002/objects/generated'),'-I'+str(S/'llvm/lib/Target/WebAssembly')]
 rel='llvm/lib/Target/WebAssembly/WebAssemblyLowerEmscriptenEHSjLj.cpp';unit='WebAssemblyLowerEmscriptenEHSjLj.cpp.o'
 compile=['/usr/bin/clang++',*flags,'-MD','-MF',str(N/'logs/lower32.d'),'-c',str(S/rel),'-o',str(O/unit)]
 dep_command=['/usr/bin/clang++',*flags,'-M','-MF',str(N/'logs/lower32-preflight.d'),'-MT',unit,str(S/rel)]
 dep_row={'argv':dep_command,'cwd':str(N)}
 with (N/'logs/lower32-preflight.log').open('wb') as log:
  dep=subprocess.Popen(dep_command,cwd=N,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'TMPDIR':str(N/'tmp'),'TMP':str(N/'tmp'),'TEMP':str(N/'tmp'),'XDG_CACHE_HOME':str(N/'cache'),'PYTHONDONTWRITEBYTECODE':'1'})
  try:
   dep_row.update(pid=dep.pid,pgid=dep.pid);dep.wait(timeout=60)
  finally:
   if dep.poll() is None or group(dep.pid):
    try:os.killpg(dep.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   dep.wait(timeout=10);until=time.monotonic()+10
   while group(dep.pid) and time.monotonic()<until:time.sleep(.05)
   dep_row.update(exit=dep.returncode,members=group(dep.pid));(N/'logs/lower32-preflight.json').write_text(json.dumps(dep_row,indent=2)+'\n')
  assert dep.returncode==0 and not dep_row['members']
 dependencies=shlex.split((N/'logs/lower32-preflight.d').read_text().replace('\\\n',' ').split(':',1)[1]);assert dependencies
 paths={Path(v) for v in prior['linkCommand'] if Path(v).is_file()};paths.update([base,pplan,result,packet/'prepared.json',packet/'compiler.patch',overlay,Path(__file__),R/'evidence.py',R.parent/'c-cleanup/archive-audit.py',L/'bin/llvm-config',L/'bin/llvm-ar',Path('/usr/bin/clang++'),Path('/usr/bin/g++'),Path('/usr/bin/ld.lld')])
 for row in prepared['sourcePairs'].values():paths.update(Path(row[k]) for k in ['path','basis','basisSnapshot'])
 for directory in [L/'include',PREV.parent/'glibc-cancel-compiler-20261002/objects/generated']:paths.update(p for p in directory.rglob('*') if p.is_file())
 paths.update(Path(p) for p in dependencies)
 paths.update(p for p in (S/'llvm/lib/Target/WebAssembly').rglob('*') if p.is_file() and p.suffix in {'.h','.inc','.def','.cpp','.td'})
 paths.update([N/'logs/lower32-preflight.d',N/'logs/lower32-preflight.json'])
 pins={str(p):sha(p) for p in paths}
 for i,p in enumerate(sorted(paths)):
  if p.suffix in {'.cpp','.py','.json','.patch'} and p.stat().st_size<8388608:shutil.copyfile(p,N/'source'/f'{i}-{p.name}')
 plan={'dependencyPreflight':dep_row,'dependencies':dependencies,'pins':pins,'compile':compile,'link':link,'archiveBase':str(base),'member':unit,'extraGNUFramesObject':prior['extraGNUFramesObject'],'patchSha256':prepared['patchSha256'],'source32':str(packet),'capacityBytes':2*1024**3,'runtimeAcceptance':False,'storage':budget(True)};PLAN.write_text(json.dumps(plan,indent=2)+'\n');print(json.dumps({'plan':str(PLAN),'sha256':sha(PLAN),'pins':len(pins),'compilerRecipe':sha(__file__)}))
def execute(reviewed):
 assert sha(PLAN)==reviewed;plan=json.loads(PLAN.read_text());assert all(sha(p)==h for p,h in plan['pins'].items());budget(True);O.mkdir(parents=True,exist_ok=False)
 os.environ.update(TMPDIR=str(N/'tmp'),TMP=str(N/'tmp'),TEMP=str(N/'tmp'),XDG_CACHE_HOME=str(N/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0));stages=[]
 def run(name,argv):
  budget(True);row={'name':name,'argv':[str(x) for x in argv],'cwd':str(N)};start=time.monotonic()
  with (N/'logs'/(name+'.log')).open('wb') as log:
   p=subprocess.Popen(row['argv'],cwd=N,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    row.update(pid=p.pid,pgid=p.pid);(N/'logs'/(name+'.json')).write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row),flush=True)
    while p.poll() is None:
     budget();assert time.monotonic()-start<300
     try:p.wait(timeout=1)
     except subprocess.TimeoutExpired:pass
   finally:
    if p.poll() is None or group(p.pid):
     try:os.killpg(p.pid,signal.SIGTERM)
     except ProcessLookupError:pass
     until=time.monotonic()+2
     while group(p.pid) and time.monotonic()<until:time.sleep(.05)
     if group(p.pid):
      try:os.killpg(p.pid,signal.SIGKILL)
      except ProcessLookupError:pass
    p.wait(timeout=10);until=time.monotonic()+10
    while group(p.pid) and time.monotonic()<until:time.sleep(.05)
    row.update(exit=p.returncode,members=group(p.pid),seconds=time.monotonic()-start);(N/'logs'/(name+'.json')).write_text(json.dumps(row,indent=2)+'\n')
   assert p.returncode==0 and not row['members'];stages.append(row)
 run('compile-lower32',plan['compile'])
 dependencies=shlex.split((N/'logs/lower32.d').read_text().replace('\\\n',' ').split(':',1)[1]);assert dependencies
 assert all(str(Path(p)) in plan['pins'] for p in dependencies),[p for p in dependencies if str(Path(p)) not in plan['pins']]
 assert all(sha(p)==plan['pins'][str(Path(p))] for p in dependencies)
 (N/'logs/lower32-dependency-proof.json').write_text(json.dumps({'depfileSha256':sha(N/'logs/lower32.d'),'dependencies':{str(Path(p)):sha(p) for p in dependencies},'allPrePinned':True},indent=2)+'\n')
 spec=importlib.util.spec_from_file_location('ar_audit',R.parent/'c-cleanup/archive-audit.py');ar=importlib.util.module_from_spec(spec);spec.loader.exec_module(ar)
 base=Path(plan['archiveBase']);archive=O/base.name;before=ar.members(base);shutil.copyfile(base,archive);run('replace-lower32',[L/'bin/llvm-ar','r',archive,O/plan['member']]);after=ar.members(archive)
 assert [m['name'] for m in before]==[m['name'] for m in after];changed=[i for i,(a,b) in enumerate(zip(before,after)) if a!=b];assert len(changed)==1 and before[changed[0]]['name']==plan['member']
 (N/'logs/archive-proof.json').write_text(json.dumps({'before':before,'after':after,'changedIndices':changed,'baseSha256':sha(base),'archiveSha256':sha(archive)},indent=2)+'\n');run('link-compiler32',plan['link']);run('compiler32-version',[O/'clang','--version']);assert all(sha(p)==h for p,h in plan['pins'].items());proof={'compiled':True,'runtimeAcceptance':False,'planSha256':reviewed,'compiler':str(O/'clang'),'sha256':sha(O/'clang'),'stages':stages,'archiveSha256':sha(archive),'storage':budget()};(N/'build-result32.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'result':str(N/'build-result32.json'),'sha256':sha(N/'build-result32.json')}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--execute-reviewed-plan');a=p.parse_args();execute(a.execute_reviewed_plan) if a.execute_reviewed_plan else prepare()
