#!/usr/bin/env python3
import os,pathlib,json,subprocess,shutil,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
rows=json.loads((T/'logs/arity-source-plan.json').read_text())['wrappers'];targets=[str(T/'objects/fullmake'/r['unit'])for r in rows]
command=['make','-C',str(T/'source/glibc-2.44/misc'),'objdir='+str(T/'objects/fullmake'),'-j2',*targets]
with(T/'logs/make-arity.log').open('wb')as f:p=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
r={'argv':command,'cwd':str(pathlib.Path.cwd()),'exit':p.returncode,'targets':targets};(T/'logs/make-arity-result.json').write_text(json.dumps(r,indent=2)+'\n');assert p.returncode==0
attempts=[]
for row in rows:
 out=T/'objects/fullmake'/row['unit'];matches=[]
 for q in(T/'logs/c-attempts').glob('*/attempt.json'):
  j=json.loads(q.read_text())
  if j.get('pass')and j['output']==str(out):matches.append(j)
 matches=[j for j in matches if j['source']==row['architectureOverride']and j['sourceSha256']==row['overrideSha256']and j['objectSha256']==hashlib.sha256(out.read_bytes()).hexdigest()];assert matches,(row['unit'],matches);j=matches[-1];assert all(s['exit']==0 for s in j['stages'])
 q=T/'objects/guest'/('arity-'+out.name);shutil.copy2(out,q);assert hashlib.sha256(q.read_bytes()).hexdigest()==j['objectSha256'];attempts.append({**row,'makeAttempt':j,'linkedObject':str(q)})
(T/'logs/selected-arity-objects.json').write_text(json.dumps({'pass':True,'targets':5,'selected':attempts},indent=2)+'\n')
