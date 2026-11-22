#!/usr/bin/env python3
import json,os,pathlib,subprocess,sys,hashlib,re,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake';label=sys.argv[1];assert re.fullmatch(r'[A-Za-z0-9_-]+',label)
dest=T/'logs'/('memory-make-'+label+'.json');assert not dest.exists()
targets=[O/'misc'/(n+'.o')for n in ['brk','sbrk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']]
argv=['make','-C',str(S/'misc'),'objdir='+str(O),'-j2',*[str(p)for p in targets]]
row={'argv':argv,'targets':[str(p)for p in targets]};dest.write_text(json.dumps(row,indent=2)+'\n')
with (T/'logs'/('memory-make-'+label+'.log')).open('wb')as f:p=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
row['exit']=p.returncode
if not p.returncode:
 row['outputs']={str(q):{'bytes':q.stat().st_size,'sha256':hashlib.sha256(q.read_bytes()).hexdigest()}for q in targets}
 for q in targets:
  out=T/'objects/guest'/q.name;shutil.copy2(q,out)
dest.write_text(json.dumps(row,indent=2)+'\n');sys.exit(p.returncode)
