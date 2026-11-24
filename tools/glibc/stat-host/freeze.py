#!/usr/bin/env python3
"""Audit and freeze synthetic public GNU stat controls and actual input lineage."""
import hashlib,json,os,pathlib,re,shlex,shutil,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
S=pathlib.Path('/mnt/p6/build/glibc-stat-20261002')
N=pathlib.Path('/mnt/p6/build/glibc-syscalls-next26-20261002')
R=pathlib.Path(__file__).resolve().parent;repo=R.parents[2]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
assert not (T/'manifest.json').exists()
assert digest(S/'manifest.json')['sha256']=='e6efcd1c146eb5d559ab782aa5013908cb83f8d487c8005860c727fc19119a1a'
parent=json.loads((S/'manifest.json').read_text())['files'];files=set()
for name,h in parent.items():
 p=pathlib.Path(name);assert digest(p)==h,name;files.add(p.resolve())
files.add(S/'manifest.json')
assert digest(N/'manifest.json')['sha256']=='8a7fd6467b2e0f4811d855472845bd55ffad61e15aaebf02475c871c30be5766'
n=json.loads((N/'manifest.json').read_text())['files'];driver=R.parent/'syscalls-next26/compiler.py'
assert digest(driver)==n[str(driver.resolve())];files.update([driver.resolve(),N/'manifest.json'])
result=json.loads((T/'result.json').read_text());assert result['pass'] and result['checks']==10308
assert len(result['results'])==2 and all(r['checks']==5150 and r['pass'] for r in result['results'])
for row in result['results']:assert digest(pathlib.Path(row['module']))['sha256']==row['sha256']
linked=json.loads((T/'logs/link-command.json').read_text());objects=[pathlib.Path(p) for p in linked if p.endswith('.o')]
assert len(objects)==15 and all(p.is_file() for p in objects)
assert '--no-entry' in linked and not any('allow-undefined' in p or 'unresolved-symbols' in p for p in linked)
reuse=json.loads((T/'logs/reused-inputs.json').read_text());assert reuse['pass']
for row in reuse['rows']:
 p=pathlib.Path(row['source']);h={k:row[k] for k in ['sha256','bytes']}
 assert digest(p)==h;files.add(p.resolve())
 q=pathlib.Path(row.get('copy',row.get('snapshot')));assert digest(q)==h
groups=[]
for p in (T/'logs/supervision').glob('*.json'):
 j=json.loads(p.read_text());assert j['exit']==0 and not j['terminalMembers'];groups.append(j['pgid'])
assert len(groups)==2
live=[]
for p in pathlib.Path('/proc').glob('[0-9]*/stat'):
 try:
  fields=p.read_text().rsplit(')',1)[1].split()
  if int(fields[2]) in groups:live.append(int(p.parent.name))
 except (OSError,ValueError):pass
assert not live
attempts=list((T/'logs/c-attempts').glob('*/attempt.json'));assert len(attempts)==1
j=json.loads(attempts[0].read_text());assert j['pass'] and len(j['stages'])==5 and all(s['exit']==0 for s in j['stages'])
assert digest(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256']==digest(driver)['sha256']
assert pathlib.Path(j['source']).read_bytes()==pathlib.Path(j['sourceSnapshot']).read_bytes()==(T/'source-snapshots/probe.c').read_bytes()
for word in shlex.split(pathlib.Path(j['output']+'.dt').read_text().replace('\\\n',' ').split(':',1)[1]):
 if word.endswith(':'):continue
 p=pathlib.Path(word)
 if not p.is_absolute():p=pathlib.Path(j['cwd'])/p
 assert p.is_file(),str(p);files.add(p.resolve())
for name in ['build.py','probe.c','test.mjs']:
 assert (R/name).read_bytes()==(T/'source-snapshots'/name).read_bytes()
for binary in [pathlib.Path(shutil.which('node')),pathlib.Path(shutil.which('wasm-opt'))]:
 files.add(binary.resolve());output=subprocess.check_output(['ldd',str(binary)],text=True)
 for word in re.findall(r'(/[^\s()]+)',output):
  p=pathlib.Path(word)
  if p.is_file():files.add(p.resolve())
for name in ['python3','bash','wasm-validate']:files.add(pathlib.Path(shutil.which(name)).resolve())
acceptance={'pass':True,'checks':10308,'publicAPIs':8,'linkObjects':15,'native':result['results'][0],'fpcast':result['results'][1],'terminalGroups':groups,'liveMembers':live,
 'syntheticTransport':True,'realGuestAcceptance':False,'scope':'actual GNU public stat/function table with independent synthetic 64-bit fields/error canaries; not real Linux guest/sysroot/Nightly'}
(T/'acceptance.json').write_text(json.dumps(acceptance,indent=2)+'\n')
repoFiles=sorted([p for p in R.rglob('*') if p.is_file()]+[repo/'docs/glibc-stat-host-20261002.md'])
assert len(repoFiles)==6
(T/'repository-freeze.json').write_text(json.dumps({str(p.relative_to(repo)):digest(p) for p in repoFiles},indent=2)+'\n')
files.update(p.resolve() for p in repoFiles)
for p in T.rglob('*'):
 if p.is_file() and not {'cache','profile','xdg'}.intersection(p.relative_to(T).parts):files.add(p.resolve())
entries={str(p):digest(p) for p in sorted(files)}
for p,h in entries.items():assert digest(pathlib.Path(p))==h,p
(T/'manifest.json').write_text(json.dumps({'scope':acceptance['scope'],'files':entries},indent=2)+'\n')
for p,h in entries.items():assert digest(pathlib.Path(p))==h,p
print(json.dumps({'pass':True,'entries':len(entries),'repositoryPaths':len(repoFiles),'manifestSha256':digest(T/'manifest.json')['sha256'],'acceptanceSha256':digest(T/'acceptance.json')['sha256'],'repositoryFreezeSha256':digest(T/'repository-freeze.json')['sha256']}))
