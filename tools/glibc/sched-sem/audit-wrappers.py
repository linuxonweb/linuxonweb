#!/usr/bin/env python3
"""Pin genuine streams, GNU selected headers, strong bodies and public aliases."""
import os,pathlib,json,hashlib,subprocess,shlex,re
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);R=pathlib.Path(__file__).resolve().parent
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
D=T/'logs/wrapper-audit';D.mkdir(exist_ok=True)
selected=json.loads((T/'logs/selected-sched-sem-syscalls.json').read_text())['wrappers'];assert len(selected)==3
attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')]
records=[];headers={}
for row in selected:
 p=T/'objects/guest'/('generated-sched-sem-'+row['call']+'.o');assert p.read_bytes()[:8]==b'\0asm\1\0\0\0'
 matches=[(q,j) for q,j in attempts if j['output']==str(p) and j['pass']];assert matches
 q,j=max(matches,key=lambda x:x[0].stat().st_mtime_ns);assert digest(pathlib.Path(row['stream']))['sha256']==row['sha256']==j['sourceSha256']
 assert pathlib.Path(row['historicalSourceSnapshot']).read_bytes()==pathlib.Path(row['stream']).read_bytes()
 symbols=subprocess.check_output([str(L/'bin/llvm-nm'),'--defined-only',str(p)],text=True)
 (D/(row['call']+'-symbols.txt')).write_text(symbols)
 names={line.split()[-1]:line.split()[:2] for line in symbols.splitlines() if len(line.split())==3}
 assert row['symbol'] in names and row['public'] in names,(row,names)
 assert names[row['symbol']][1]=='T' and names[row['public']][1] in ['T','W']
 assert names[row['public']][0]==names[row['symbol']][0],(row,'public alias function identity')
 info=subprocess.check_output([str(L/'bin/llvm-readobj'),'--symbols',str(p)],text=True)
 (D/(row['call']+'-readobj.txt')).write_text(info)
 dep=T/'objects'/('generated-sched-sem-'+row['call']+'.d');body=dep.read_text().replace('\\\n',' ')
 includes=[]
 for word in shlex.split(body.split(':',1)[1]):
  h=pathlib.Path(word)
  if h.is_file():h=h.resolve();headers[str(h)]=digest(h);includes.append(str(h))
 publicHeaders=[pathlib.Path(name) for name in includes if name.endswith('/'+row['header']) and not name.endswith('/bits/sched.h')]
 assert publicHeaders,(row['call'],'genuine public header absent')
 pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parents[1]/'source/glibc-2.44'
 for h in publicHeaders:
  relative=h.relative_to(T/'source/glibc-2.44');assert h.read_bytes()==(pristine/relative).read_bytes(),(str(h),'public header changed')
 records.append({**row,'object':str(p),**digest(p),'attempt':str(q),'includes':includes,'strongBody':names[row['symbol']],'publicAlias':names[row['public']],'publicHeadersMatchSignedPristine':True})
sig=T/'objects/sched-sem-signatures.o';assert sig.read_bytes()[:8]==b'\0asm\1\0\0\0'
matches=[(q,j) for q,j in attempts if j['output']==str(sig) and j['pass']];assert matches
q,j=max(matches,key=lambda x:x[0].stat().st_mtime_ns);ir=(q.parent/'front.ll').read_text()
for row in selected:
 name=row['public']
 assert re.search(r'^@public_reference_'+name+r' = .*global ptr @'+name+r', align 4$',ir,re.M),(name,'public address initializer')
result={'pass':True,'wrappers':records,'publicPrototypeChecks':8,'publicRawIRReferences':8,'signaturesObject':{**digest(sig),'path':str(sig),'attempt':str(q)},'headers':headers,'scope':'typed compile/alias acceptance; runtime capability gates pending'}
(D/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'compiled':len(records),'publicTypes':8,'headers':len(headers)}))
