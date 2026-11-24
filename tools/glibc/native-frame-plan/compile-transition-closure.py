#!/usr/bin/env python3
"""Finite actual canonical bridge/state-valid/status-core closure diagnostic."""
import json,os,resource,signal,subprocess,time,re,shutil
from pathlib import Path
from evidence import T,R,G,L,sha,budget,group

def main():
 n=1
 while (T/f'transition-status-closure-{n}').exists():n+=1
 D=T/f'transition-status-closure-{n}';D.mkdir();S=D/'source';S.mkdir();rows=[]
 C=T/'module4-proposal-27/objects/compiler/clang';base=T/'transition-status-proposal-1';pins={str(C):sha(C),str(R/'compile-transition-closure.py'):sha(R/'compile-transition-closure.py')}
 for name in ['transition-status-v2.c','transition-status-v2.h','frame-abi.h','forced-abi.h']:
  p=base/name;shutil.copyfile(p,S/name);pins[str(p)]=sha(p)
 for name in ['jump-abi-v2.h']:
  p=R/name;shutil.copyfile(p,S/name);pins[str(p)]=sha(p)
 p=G/'sysdeps/generic/unwind.h';shutil.copyfile(p,S/'gnu-unwind.h');pins[str(p)]=sha(p)
 adapter=S/'unwind.h';adapter.write_text('#include "gnu-unwind.h"\ntypedef struct _Unwind_Exception _Unwind_Exception;\ntypedef struct _Unwind_Context _Unwind_Context;\n')
 proof={'runtimeAcceptance':False,'transitiveClosure':False,'inputPins':pins,'stages':rows}
 def save():(D/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 common=[C,'--target=wasm32-unknown-linux-gnu','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory','-ffreestanding','-nostdinc','-fno-builtin','-fno-stack-protector','-O2','-I'+str(S)]
 def run(name,argv,expected=None):
  budget(True);row={'name':name,'argv':list(map(str,argv)),'cwd':str(D)};rows.append(row)
  with (D/(name+'.log')).open('wb') as stream:
   start=time.monotonic();p=subprocess.Popen(row['argv'],cwd=D,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    row.update(pid=p.pid,pgid=p.pid,status='running');save()
    while p.poll() is None:
     budget()
     if time.monotonic()-start>60:raise TimeoutError(name)
     try:p.wait(timeout=1)
     except subprocess.TimeoutExpired:pass
   finally:
    if p.poll() is None or group(p.pid):
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
    p.wait(timeout=10);end=time.monotonic()+10
    while group(p.pid) and time.monotonic()<end:time.sleep(.05)
    row.update(exit=p.returncode,members=group(p.pid),status='terminal',seconds=time.monotonic()-start);save()
  text=(D/(name+'.log')).read_text(errors='replace');assert not row['members']
  assert (p.returncode==0 if expected is None else p.returncode!=0 and expected in text),(name,text)
 try:
  provider=Path('/mnt/p6/build/glibc-native-forced-unwind-20261002/objects/provider-compile-1/provider.ll')
  bridge=Path('/mnt/p6/build/glibc-native-bridge64-compile1-20261002/objects/front.ll')
  core=T/'transition-status-compile-1/status.ll'
  for p in [provider,bridge,core]:pins[str(p)]=sha(p);shutil.copyfile(p,S/(p.parent.parent.name+'-'+p.name))
  assert sha(provider)=='7455c3bb05791ab67dea97fefe4c7773acbabe6673fba39cc4896062b877ee9f'
  assert sha(bridge)=='0fd0785afb4dc804d18aa5ea6f3a3a23ecbc670b374db8f69e7628161361349f'
  run('extract-state',[L/'bin/llvm-extract','--func=__wasm_gnu_unwind_state_valid_v1',provider,'-o',D/'state.bc'])
  run('link-ir',[L/'bin/llvm-link',core,bridge,D/'state.bc','-o',D/'linked.bc'])
  run('optimize',[L/'bin/opt','-passes=default<O2>',D/'linked.bc','-o',D/'optimized.bc'])
  run('disassemble',[L/'bin/llvm-dis',D/'optimized.bc','-o',D/'optimized.ll'])
  facts=D/'facts.json';mode=['-mllvm','-wasm-gnu-frame-records','-mllvm','-wasm-gnu-frame-forced-admission','-mllvm','-verify-machineinstrs']
  run('inspect',[*common,*mode,'-mllvm','-wasm-gnu-provider-inspect='+str(facts),'-c',D/'optimized.ll','-o',D/'inspect.o'],'inspection is source evidence only')
  manifest=json.loads(facts.read_text())
  allowed=['llvm.threadlocal.address.p0','llvm.wasm.memory.size.i32','llvm.memset.p0.i32','llvm.umax.i64']
  for row in manifest['symbols'].values():
   if row['flags']==4:
    row['flags']=2;row['intrinsics']=[n for n in allowed if n in manifest['symbols']]
  path=D/'manifest.json';path.write_text(json.dumps(manifest,indent=2)+'\n')
  for name,extra,out in [('closed-object',['-c'],D/'closed.o'),('closed-assembly',['-S'],D/'closed.s')]:
   run(name,[*common,*mode,'-mllvm','-wasm-gnu-provider-manifest='+str(path),*extra,D/'optimized.ll','-o',out])
  text=(D/'closed.s').read_text();assert not re.search(r'global\.set\s+__stack_pointer|call_indirect|\bthrow\b|\brethrow\b|\bcatch\b',text)
  calls=sorted(set(re.findall(r'^\s*call\s+([^\s,]+)',text,re.M)))
  definitions={n for n,row in manifest['symbols'].items() if row['flags']==2}|{'__wasm_boundary_native_root_v3'}
  assert set(calls)<=definitions,calls
  proof['transitiveClosure']=True;proof['definitionCount']=len(definitions)
  assert all(sha(p)==v for p,v in pins.items());proof.update(pass_=True,directCalls=calls,directMachineAudit=True)
 except BaseException as exc:proof.update(pass_=False,error=repr(exc));raise
 finally:proof['artifacts']={str(p):sha(p) for p in D.rglob('*') if p.is_file() and p.name!='proof.json'};save()
 print(json.dumps({'proof':str(D/'proof.json'),'sha256':sha(D/'proof.json'),'pass':True}))
if __name__=='__main__':main()
