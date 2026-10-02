#!/usr/bin/env python3
"""Check actual GNU source selection and bounded native memory behavior."""
import hashlib,json,os,pathlib,re,shlex
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';R=pathlib.Path(__file__).resolve().parent
dest=T/'logs/memory-audit.json';assert not dest.exists()
def digest(p):
 p=pathlib.Path(p);b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44'
build=json.loads((T/'logs/memory-make-run2.json').read_text());assert len(build)==3 and all(r['exit']==0 for r in build)
targets={p:d for row in build for p,d in row['outputs'].items()};assert len(targets)==13
attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')]
units=[];headers={};drivers={}
for name,h in targets.items():
 obj=pathlib.Path(name);assert digest(obj)==h and obj.read_bytes()[:8]==b'\0asm\1\0\0\0'
 choices=[(p,j)for p,j in attempts if j['output']==name and j['pass'] and j['objectSha256']==h['sha256']]
 assert len(choices)==1,name
 proof,j=choices[0];source=pathlib.Path(j['source']);snapshot=pathlib.Path(j['sourceSnapshot'])
 assert digest(source)==digest(snapshot) and digest(source)['sha256']==j['sourceSha256']
 driver=pathlib.Path(j['driverSnapshot']);assert digest(driver)['sha256']==j['driverSha256'];drivers[str(driver)]=digest(driver)
 assert all(st['exit']==0 for st in j['stages'])
 owned='/wasm32/' in str(source)
 if not owned:assert source.read_bytes()==(pristine/source.relative_to(S)).read_bytes()
 elif source.name!='wasm-memory-authority.c':assert source.read_bytes()==(R/source.name).read_bytes()
 frontend=next(st for st in j['stages']if st['stage']=='frontend');argv=frontend['argv']
 dep=pathlib.Path(argv[argv.index('-MF')+1])
 for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
  p=pathlib.Path(word.removesuffix(':'))
  if not p.is_absolute():p=pathlib.Path(j['cwd'])/p
  if p.is_file():headers[str(p.resolve())]=digest(p)
 units.append({'source':str(source),'sourceSnapshot':str(snapshot),'sourceHash':digest(source),'object':name,'objectHash':h,'proof':str(proof),'ownedArchitectureProvider':owned})
assert sum(u['ownedArchitectureProvider']for u in units)==7
assert next(u for u in units if u['source'].endswith('/misc/sbrk.c'))['ownedArchitectureProvider'] is False
selection=(T/'objects/fullmake/sysd-syscalls').read_text()
for name in ['mprotect','madvise']:
 rows=re.findall(r'^#### CALL='+name+r' .*$',selection,re.M)
 assert len(rows)==1 and rows[0].split('SOURCE=',1)[1].removeprefix('../')=='sysdeps/unix/sysv/linux/wasm32/'+name+'.c'
 assert 'unix-syscalls += '+name+'\n' not in selection
old=(T/'source-snapshots/build1-failure/sysd-syscalls').read_text()
assert all('unix-syscalls += '+name+'\n' in old for name in ['mprotect','madvise'])
host=[]
for name in ['host-run2-result.json','host-run2-fpcast-result.json']:
 j=json.loads((T/'logs'/name).read_text());assert j['pass']and j['checks']==291 and j['failures']==0 and not j['imports'];host.append(j)
modules={str(p):digest(p)for p in (T/'objects/host-run2').glob('*.wasm')};assert len(modules)==2
fixture=T/'objects/host-run2/fixture.o';assert fixture.read_bytes()[:8]==b'\0asm\1\0\0\0'
for word in shlex.split((T/'objects/host-run2/fixture.d').read_text().replace('\\\n',' ').split(':',1)[1]):
 p=pathlib.Path(word.removesuffix(':'))
 if p.is_file():headers[str(p.resolve())]=digest(p)
groups=[]
for p in sorted((T/'logs/supervision').glob('*.json')):
 j=json.loads(p.read_text());assert j['exit']==(2 if p.stem=='build1' else 0)and not j['terminalMembers'];groups.append({'proof':str(p),'pgid':j['pgid'],'exit':j['exit']})
assert len(groups)==5
result={'pass':True,'scope':'actual GNU selected memory units and closed single-thread native/FPCAST host gate','units':units,'headers':headers,'drivers':drivers,'host':host,'modules':modules,'fixture':{'object':str(fixture),'hash':digest(fixture),'source':str(R/'fixture.c'),'sourceHash':digest(R/'fixture.c')},'groups':groups,'retainedFailure':'build1 generated stale kernel mprotect/madvise rules; preserved rules and frontend failures; regenerated GNU selection without generator patch','limitations':host[0]['limitations']+['no real Linux guest test for these exact objects','no full archive/sysroot or concurrent initialization acceptance']}
dest.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'pass':True,'GNUunits':len(units),'pristineGNUunits':6,'ownedArchitectureUnits':7,'includes':len(headers),'checksPerMode':291}))
