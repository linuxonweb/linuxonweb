#!/usr/bin/env python3
"""Actual malformed pre-SjLj IR controls; never public GNU runtime acceptance."""
import argparse,json,os,resource,signal,subprocess,time
from pathlib import Path
from evidence import T,R,sha,budget,group

def main():
 p=argparse.ArgumentParser();p.add_argument('--compiler',required=True);a=p.parse_args();C=Path(a.compiler)
 log=T/'module4-sjlj-diagnostic-1/pre-sjlj.log';text=log.read_text();text=text[text.index('; ModuleID'):text.index('fatal error:')]
 site='  call void @__wasm_gnu_frame_admit_call_v1(ptr @setjmp)\n  %9 = call i32 @setjmp(ptr noundef %8) #10, !wasm.gnu.call.admitted.v1 !5'
 assert text.count(site)==1
 cases={
  'nonadjacent':(site.replace('\n  %9','\n  fence seq_cst\n  %9'),'unauthenticated address use'),
  'missing-source-metadata':(site.replace(', !wasm.gnu.call.admitted.v1 !5',''),'unauthenticated address use'),
  'wrong-admitted-target':(site.replace('ptr @setjmp','ptr @consumer_jump'),'lacks the actual source admission'),
 }
 n=1
 while (T/f'admission-boundaries-{n}').exists():n+=1
 D=T/f'admission-boundaries-{n}';D.mkdir();(D/'input-basis.ll').write_text(text)
 os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0));rows=[]
 pins={str(C):sha(C),str(log):sha(log),str(R/'test-admission-boundaries.py'):sha(R/'test-admission-boundaries.py')}
 proof={'publicRuntimeAcceptance':False,'inputPins':pins,'stages':rows}
 try:
  for name,(replacement,expected) in cases.items():
   src=D/(name+'.ll');src.write_text(text.replace(site,replacement));budget(True)
   argv=[str(C),'--target=wasm32-unknown-linux-gnu','-O0','-fwasm-exceptions','-matomics','-mbulk-memory','-mllvm','-wasm-enable-sjlj','-c',str(src),'-o',str(D/(name+'.o'))]
   with (D/(name+'.log')).open('wb') as stream:
    start=time.monotonic();proc=subprocess.Popen(argv,cwd=D,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
    try:
     row={'name':name,'argv':argv,'cwd':str(D),'pid':proc.pid,'pgid':proc.pid};rows.append(row);(D/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
     while proc.poll() is None:
      budget()
      if time.monotonic()-start>60:raise TimeoutError(name)
      try:proc.wait(timeout=1)
      except subprocess.TimeoutExpired:pass
    finally:
     if proc.poll() is None or group(proc.pid):
      try:os.killpg(proc.pid,signal.SIGKILL)
      except ProcessLookupError:pass
     proc.wait(timeout=10);end=time.monotonic()+10
     while group(proc.pid) and time.monotonic()<end:time.sleep(.05)
     row.update(exit=proc.returncode,members=group(proc.pid),seconds=time.monotonic()-start)
     (D/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
   actual=(D/(name+'.log')).read_text();assert proc.returncode!=0 and expected in actual and not group(proc.pid),(name,actual)
   row.update(expectedDiagnostic=expected,sourceSha256=sha(src),logSha256=sha(D/(name+'.log')))
  assert all(sha(p)==v for p,v in pins.items());proof['pass']=True
 except BaseException as e:
  proof.update(pass_=False,error=repr(e));raise
 finally:(D/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
 print(json.dumps({'path':str(D/'proof.json'),'sha256':sha(D/'proof.json'),'pass':True}))
if __name__=='__main__':main()
