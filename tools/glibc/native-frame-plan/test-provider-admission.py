#!/usr/bin/env python3
"""Finite actual primitive/root and malformed-input controls, no GNU owner claim."""
import argparse,json,os,resource,signal,subprocess,time,re
from pathlib import Path
from evidence import T,R,L,sha,budget,group

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--compiler',required=True);a=ap.parse_args();C=Path(a.compiler)
 n=1
 while (T/f'provider-controls-{n}').exists():n+=1
 D=T/f'provider-controls-{n}';D.mkdir();rows=[];pins={str(C):sha(C),str(R/'test-provider-admission.py'):sha(R/'test-provider-admission.py')};proof={'gnuOwnerRuntime':False,'forcedUnwind':False,'stages':rows,'inputPins':pins}
 os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 common=['--target=wasm32-unknown-linux-gnu','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory','-ffreestanding','-nostdinc','-fno-builtin','-fno-stack-protector','-O2']
 mode=['-mllvm','-wasm-gnu-frame-records','-mllvm','-wasm-gnu-frame-forced-admission','-mllvm','-verify-machineinstrs']
 def save(): (D/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
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
    row.update(exit=p.returncode,status='terminal',members=group(p.pid),seconds=time.monotonic()-start);save()
  text=(D/(name+'.log')).read_text(errors='replace');assert not row['members']
  assert (p.returncode==0 if expected is None else p.returncode!=0 and expected in text),(name,text)
  if expected:row['expectedDiagnostic']=expected
  return text
 def inspect(name,source):
  facts=D/(name+'-facts.json')
  run(name+'-inspect',[C,*common,*mode,'-mllvm','-wasm-gnu-provider-inspect='+str(facts),'-c',source,'-o',D/(name+'-inspect.o')],'inspection is source evidence only')
  doc=json.loads(facts.read_text())
  for symbol in doc['symbols'].values():
   if symbol['flags']==4:symbol['flags']=2
  manifest=D/(name+'-manifest.json');manifest.write_text(json.dumps(doc,indent=2)+'\n');return manifest
 def backend(name,source,manifest,expected=None):
  run(name,[C,*common,*mode,'-mllvm','-wasm-gnu-provider-manifest='+str(manifest),'-c',source,'-o',D/(name+'.o')],expected)
 try:
  src=D/'primitive.c';src.write_text('unsigned primitive(unsigned x){return x+7;}\n')
  front=D/'primitive.ll';run('frontend',[C,*common,'-mllvm','-wasm-gnu-cancel-prerequisite','-S','-emit-llvm',src,'-o',front])
  original=front.read_text();assert 'wasm.gnu.cancel.poll.v1' in original
  manifest=inspect('valid',front);backend('valid',front,manifest)
  run('assembly',[C,*common,*mode,'-mllvm','-wasm-gnu-provider-manifest='+str(manifest),'-S',front,'-o',D/'valid.s'])
  assembly=(D/'valid.s').read_text();assert not re.search(r'global\.set\s+__stack_pointer',assembly)
  run('link',[L/'bin/wasm-ld','--no-entry','--export-all','--export-memory','--shared-memory','--initial-memory=262144','--max-memory=262144',D/'valid.o','-o',D/'valid.wasm'])
  node=D/'native.mjs';node.write_text("import fs from 'node:fs';const {instance}=await WebAssembly.instantiate(fs.readFileSync(process.argv[2]),{});const e=instance.exports,v=new DataView(e.memory.buffer);if(e.primitive(35)!==42)throw Error('primitive');const r=e.__wasm_boundary_native_root_v3();if(v.getUint32(r,true)!==1||v.getUint32(r+4,true)!==4||v.getUint32(r+8,true)!==1||v.getUint32(r+16,true)!==2||v.getUint32(r+20,true)!==0)throw Error('root');const t=v.getUint32(r+12,true);for(let i=0;i<2;i++){const d=v.getUint32(t+4*i,true);if(v.getUint32(d,true)!==1||v.getUint32(d+4,true)!==32||v.getUint32(d+8,true)!==2||v.getUint32(d+12,true)!==r||v.getUint32(d+20,true)!==0||v.getUint32(d+24,true)!==0)throw Error('descriptor');}console.log(JSON.stringify({primitive:42,root:r,descriptors:2,gnuOwner:false}));\n")
  run('native',['node',node,D/'valid.wasm'])
  wrong=json.loads(manifest.read_text());wrong['moduleSha256']='0'*64;p=D/'wrong-module.json';p.write_text(json.dumps(wrong));backend('wrong-module',front,p,'does not bind actual input module')
  wrong=json.loads(manifest.read_text());wrong['symbols']['primitive']['sha256']='0'*64;p=D/'wrong-body.json';p.write_text(json.dumps(wrong));backend('wrong-body',front,p,'body/type/class pin mismatch')
  # Each malformed input is independently inspected and re-pinned. Rejection
  # therefore exercises the primitive parser, not an earlier hash mismatch.
  poll=re.search(r'call void @__wasm_gnu_cancel_poll_v1\(i32 ([^,]+), i32 0\)([^\n]*)',original);assert poll
  mutations={
   'wrong-capture':original.replace(poll.group(0),poll.group(0).replace(poll.group(1),'123',1)),
   'wrong-reason':original.replace(poll.group(0),poll.group(0).replace('i32 0)','i32 4)')),
   'manual-poll':original.replace(poll.group(0),re.sub(r', !wasm.gnu.cancel.poll.v1 !\d+','',poll.group(0))),
  }
  expected={'wrong-capture':'poll does not use actual entry capture','wrong-reason':'malformed early poll','manual-poll':'malformed early poll'}
  for name,text in mutations.items():
   p=D/(name+'.ll');p.write_text(text);m=inspect(name,p);backend(name,p,m,expected[name])
  forged=D/'forged-seal.ll';forged.write_text(original.replace('attributes #0 = {','attributes #0 = { "wasm-gnu-provider-sealed"="2"',1))
  run('forged-seal-flags-off',[C,*common,'-c',forged,'-o',D/'forged.o'],'lacks actual producer authentication')
  assert all(sha(p)==h for p,h in pins.items())
  proof['pass']=True
 except BaseException as exc:proof.update(pass_=False,error=repr(exc));raise
 finally:
  proof['artifacts']={str(p):sha(p) for p in D.iterdir() if p.is_file() and p.name!='proof.json'};save()
 print(json.dumps({'proof':str(D/'proof.json'),'sha256':sha(D/'proof.json'),'pass':True}))
if __name__=='__main__':main()
