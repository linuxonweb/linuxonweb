#!/usr/bin/env python3
"""Build selected genuine GNU units, retaining every make command and exit."""
import hashlib,json,os,pathlib,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake';R=pathlib.Path(__file__).resolve().parent
dest=T/'logs/selected-make.json';assert not dest.exists();rows=[]
for subdir,names in [('io',['xstatconv']),('csu',['errno','errno-loc']),('string',['memcpy','memset','wordcopy'])]:
 targets=[O/subdir/(n+'.o') for n in names];assert not any(p.exists() for p in targets)
 argv=['make','-C',str(S/subdir),'objdir='+str(O),'-j2','CC=python3 '+str(R/'compiler.py')+' -nostdlib -nostdinc -isystem '+os.environ['GLIBC_TOOLCHAIN']+'/lib/clang/22/include',*[str(p) for p in targets]]
 row={'argv':argv,'cwd':str(pathlib.Path.cwd()),'targets':[str(p) for p in targets]};rows.append(row);dest.write_text(json.dumps(rows,indent=2)+'\n')
 with (T/'logs'/('make-'+subdir+'.log')).open('wb') as f:p=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
 row['exit']=p.returncode
 if p.returncode==0:row['outputs']={str(q):{'bytes':q.stat().st_size,'sha256':hashlib.sha256(q.read_bytes()).hexdigest()} for q in targets}
 dest.write_text(json.dumps(rows,indent=2)+'\n')
 if p.returncode:raise SystemExit(p.returncode)
