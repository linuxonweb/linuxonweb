#!/usr/bin/env python3
"""Pin actual GNU make streams, objects, strong exports and public addresses."""
import os,pathlib,json,hashlib,subprocess,shlex,re
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);R=pathlib.Path(__file__).resolve().parent
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
rows=json.loads((T/'logs/selected-last5-syscalls.json').read_text())['wrappers'];assert len(rows)==5
attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')]
D=T/'logs/wrapper-audit';D.mkdir(exist_ok=True);headers={};records=[]
for row in rows:
 p=T/'objects/fullmake/misc'/(row['call']+'.o');assert p.read_bytes()[:8]==b'\0asm\1\0\0\0'
 matches=[(q,j) for q,j in attempts if j['output']==str(p) and j['pass']];assert len(matches)==1
 q,j=matches[0];source=pathlib.Path(j['source']);assert source.read_bytes()==pathlib.Path(row['stream']).read_bytes()==pathlib.Path(row['historicalSourceSnapshot']).read_bytes()
 nm=subprocess.check_output([str(L/'bin/llvm-nm'),'--defined-only',str(p)],text=True);(D/(row['call']+'-nm.txt')).write_text(nm)
 assert re.search(r'^\w+ T '+row['symbol']+'$',nm,re.M),nm
 info=subprocess.check_output([str(L/'bin/llvm-readobj'),'--symbols',str(p)],text=True);(D/(row['call']+'-symbols.txt')).write_text(info)
 ir=(q.parent/'front.ll').read_text();assert re.search(r'^define .*@'+row['symbol']+r'\(',ir,re.M)
 dep=pathlib.Path(str(p)+'.dt');includes=[]
 body=dep.read_text().replace('\\\n',' ')
 # GNU -MP adds empty per-header rules after the first dependency rule.
 body=body.split('\n',1)[0].split(':',1)[1]
 for word in shlex.split(body):
  h=pathlib.Path(word);h=h if h.is_absolute() else pathlib.Path(j['cwd'])/h
  if h.is_file():h=h.resolve();headers[str(h)]=digest(h);includes.append(str(h))
 assert includes
 records.append({**row,'object':str(p),**digest(p),'attempt':str(q),'actualStream':str(source),'includes':includes,'strongExport':row['symbol']})
p=T/'objects/guest/last5-signatures.o';q,j=[(q,j) for q,j in attempts if j['output']==str(p) and j['pass']][0];ir=(q.parent/'front.ll').read_text()
for r in rows:
 assert re.search(r'^@public_reference_'+r['call']+r' = .*global ptr @'+r['call']+r', align 4$',ir,re.M),r['call']
for name in ['last5-signatures','last5-fixture','last5-startup']:
 p=T/'objects'/(name+'.d');body=p.read_text().replace('\\\n',' ').split(':',1)[1]
 for word in shlex.split(body):
  h=pathlib.Path(word)
  if h.is_file():headers[str(h.resolve())]=digest(h)
pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parents[1]/'source/glibc-2.44'
for relative in ['sysdeps/unix/sysv/linux/sys/pidfd.h','sysdeps/unix/sysv/linux/sys/mount.h','sysdeps/unix/sysv/linux/bits/types/siginfo_t.h']:
 p=T/'source/glibc-2.44'/relative;assert p.read_bytes()==(pristine/relative).read_bytes()
(D/'result.json').write_text(json.dumps({'pass':True,'wrappers':records,'headers':headers,'signatureObject':digest(T/'objects/guest/last5-signatures.o'),'signatureAttempt':str(q),'publicReferences':5,'GNUDeclaredPublicFunctions':2,'historicalTypedExports':3,'layout':json.loads((T/'logs/layout.json').read_text()),'scope':'actual make/type/stream acceptance; guest results separately required'},indent=2)+'\n')
print(json.dumps({'pass':True,'actualGNUmake':5,'headers':len(headers)}))
