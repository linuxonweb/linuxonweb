#!/usr/bin/env python3
"""Read-only existing composed compiler pre-PEI operand evidence."""
import json,os,resource,signal,subprocess,time
from evidence import T,sha,budget,group

def main():
 budget(True);o=T/'fixed-address-probe-1';o.mkdir();resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
 peer=T.parent/'glibc-native-forced-unwind-20261002';compiler=peer/'objects/compiler-consumer-coherent1/clang';source=__import__('pathlib').Path('/mnt/p6/project/linux/linuxonweb/tools/glibc/native-forced-unwind/consumer-controls-normal.c')
 argv=[str(compiler),'--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-fno-builtin','-fno-stack-protector','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory','-O2']
 for mode in ['wasm-gnu-cancel-prerequisite','wasm-gnu-frame-records','wasm-gnu-frame-forced-admission','wasm-gnu-forced-unwind','wasm-enable-sjlj','wasm-native-eh-routing','verify-machineinstrs','print-before=prologepilog']:argv+=['-mllvm','-'+mode]
 argv+=['-c',str(source),'-o',str(o/'normal-O2.o')];row={'argv':argv,'pins':{str(p):sha(p) for p in [compiler,source,__import__('pathlib').Path(__file__)]},'runtimeAcceptance':False}
 start=time.monotonic()
 with (o/'normal-O2.log').open('wb') as log:
  p=subprocess.Popen(argv,cwd=T,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   row.update(pid=p.pid,pgid=p.pid);(o/'proof.json').write_text(json.dumps(row,indent=2)+'\n')
   while p.poll() is None:
    budget();assert time.monotonic()-start<60
    try:p.wait(timeout=1)
    except subprocess.TimeoutExpired:pass
  finally:
   if p.poll() is None or group(p.pid):
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   p.wait(timeout=10);end=time.monotonic()+10
   while group(p.pid) and time.monotonic()<end:time.sleep(.05)
   row.update(exit=p.returncode,members=group(p.pid),seconds=time.monotonic()-start)
   (o/'proof.json').write_text(json.dumps(row,indent=2)+'\n')
 assert p.returncode==0 and not row['members'];row['outputs']={str(p):sha(p) for p in [o/'normal-O2.o',o/'normal-O2.log']};(o/'proof.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row))
if __name__=='__main__':main()
