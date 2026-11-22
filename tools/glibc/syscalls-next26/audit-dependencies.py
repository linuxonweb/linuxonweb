#!/usr/bin/env python3
"""Audit genuine mask helper sources, actual dependencies and driver versions."""
import hashlib,json,os,pathlib,shlex
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
S=T/'source/glibc-2.44'
P=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parents[1]/'source/glibc-2.44'
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
destination=T/'logs/dependency-audit.json';assert not destination.exists()
attempts=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json')]
headers={};helpers=[]
for name,source in [('sigempty','sigempty.c'),('sigaddset','sigaddset.c')]:
 output=T/('objects/fullmake/signal/'+name+'.o')
 matches=[(p,j) for p,j in attempts if j.get('output')==str(output) and j.get('pass')]
 assert len(matches)==1
 p,j=matches[0];assert all(stage['exit']==0 for stage in j['stages'])
 unit=S/'signal'/source;assert unit.read_bytes()==(P/'signal'/source).read_bytes()
 assert digest(unit)['sha256']==j['sourceSha256']
 assert digest(output)['sha256']==j['objectSha256']
 linked=T/('objects/guest/next26-'+name+'.o');assert linked.read_bytes()==output.read_bytes()
 dep=output.with_suffix('.o.dt');body=dep.read_text().replace('\\\n',' ')
 includes=[]
 for word in shlex.split(body.split(':',1)[1]):
  if word.endswith(':'):continue
  h=pathlib.Path(word)
  if not h.is_absolute():h=pathlib.Path(j['cwd'])/h
  h=h.resolve();assert h.is_file(),str(h)
  headers[str(h)]=digest(h);includes.append(str(h))
 raw=p.parent/'front.ll';assert raw.is_file()
 helpers.append({'source':str(unit),**digest(unit),'object':str(output),'objectHash':digest(output),'linkedCopy':str(linked),'compilerAttempt':str(p),'rawIR':str(raw),'rawIRHash':digest(raw),'dependency':str(dep),'dependencyHash':digest(dep),'includes':includes})
# Retain relative dependencies of every selected GNU make wrapper as well.
make=json.loads((T/'logs/make-next26-result.json').read_text())
for record in make['records']:
 for target in record['argv'][5:]:
  matches=[(p,j) for p,j in attempts if j.get('output')==target and j.get('pass')]
  assert len(matches)==1
  p,j=matches[0];dep=pathlib.Path(target+'.dt');assert dep.is_file()
  for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
   if word.endswith(':'):continue
   h=pathlib.Path(word)
   if not h.is_absolute():h=pathlib.Path(j['cwd'])/h
   h=h.resolve();assert h.is_file();headers[str(h)]=digest(h)
historical={row['report']:row for row in json.loads((T/'logs/historical-driver-mapping.json').read_text())['rows']}
drivers=[]
for p,j in attempts:
 if 'driverSnapshot' in j:snapshot=pathlib.Path(j['driverSnapshot']);expected=j['driverSha256']
 else:
  row=historical[str(p)];snapshot=pathlib.Path(row['executedDriverSnapshot']);expected=row['executedDriverSha256']
 assert digest(snapshot)['sha256']==expected
 assert digest(pathlib.Path(j['sourceSnapshot']))['sha256']==j['sourceSha256']
 drivers.append({'attempt':str(p),'driverSnapshot':str(snapshot),'driverSha256':expected,'sourceSnapshot':j['sourceSnapshot'],'pass':j['pass'],'stages':j['stages']})
result={'pass':True,'helpers':helpers,'headers':headers,'driverAttempts':drivers,'scope':'every genuine mask-helper and selected GNU make-wrapper dependency; exact executed driver/source versions; no additional runtime claim'}
destination.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'pass':True,'maskHelpers':len(helpers),'includeFiles':len(headers),'driverAttempts':len(drivers)}))
