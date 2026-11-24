#!/usr/bin/env python3
"""Finite actual frontend provenance controls; no native runtime acceptance."""
import json,os,resource,signal,subprocess,time
from evidence import T,R,sha,budget,group

def main():
 d=T/'cxx-frontend-provenance-1';assert not d.exists();d.mkdir()
 source=d/'control.cpp';source.write_text('extern void may_throw();\nint typed(){try{may_throw();}catch(int x){return x;}return 0;}\n')
 compiler=T/'module4-proposal-20/objects/compiler/clang'
 output=d/'front.ll';log=d/'frontend.log'
 argv=[str(compiler),'--target=wasm32-unknown-linux-gnu','-fc++-abi=webassembly','-O0','-fwasm-exceptions','-matomics','-mbulk-memory','-S','-emit-llvm','-Xclang','-disable-llvm-passes',str(source),'-o',str(output)]
 os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0));budget(True)
 proof={'runtimeAcceptance':False,'argv':argv,'sourceSha256':sha(source),'compilerSha256':sha(compiler)}
 with log.open('wb') as stream:
  start=time.monotonic();p=subprocess.Popen(argv,cwd=d,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   proof.update(pid=p.pid,pgid=p.pid);(d/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
   while p.poll() is None:
    budget()
    if time.monotonic()-start>60:raise TimeoutError()
    try:p.wait(timeout=1)
    except subprocess.TimeoutExpired:pass
  finally:
   if p.poll() is None or group(p.pid):
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   p.wait(timeout=10);end=time.monotonic()+10
   while group(p.pid) and time.monotonic()<end:time.sleep(.05)
   proof.update(exit=p.returncode,members=group(p.pid),seconds=time.monotonic()-start,logSha256=sha(log));(d/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 assert p.returncode==0 and not group(p.pid)
 proof.update(pass_=True,irSha256=sha(output));(d/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
if __name__=='__main__':main()
