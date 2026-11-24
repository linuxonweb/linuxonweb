#!/usr/bin/env python3
"""Compile the actual GNU-selected memory units and unchanged core helpers."""
import json,os,pathlib,subprocess,sys,hashlib,re
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake'
label=sys.argv[1];assert re.fullmatch(r'[A-Za-z0-9_-]+',label)
dest=T/'logs'/('memory-make-'+label+'.json');assert not dest.exists();rows=[]
for subdir,names in [('misc',['brk','sbrk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']),('csu',['errno','errno-loc']),('string',['memcpy','memset','wordcopy'])]:
 targets=[O/subdir/(n+'.o')for n in names]
 argv=['make','-C',str(S/subdir),'objdir='+str(O),'-j2',*[str(p)for p in targets]]
 row={'argv':argv,'cwd':str(pathlib.Path.cwd()),'targets':[str(p)for p in targets]};rows.append(row);dest.write_text(json.dumps(rows,indent=2)+'\n')
 with (T/'logs'/('memory-'+label+'-'+subdir+'.log')).open('wb')as f:p=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
 row['exit']=p.returncode
 if not p.returncode:row['outputs']={str(q):{'bytes':q.stat().st_size,'sha256':hashlib.sha256(q.read_bytes()).hexdigest()}for q in targets}
 dest.write_text(json.dumps(rows,indent=2)+'\n')
 if p.returncode:raise SystemExit(p.returncode)
print(json.dumps({'pass':True,'actualGNUObjects':sum(len(r['targets'])for r in rows),'record':str(dest)}))
