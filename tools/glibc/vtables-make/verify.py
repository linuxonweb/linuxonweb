#!/usr/bin/env python3
"""Pin the terminal replay and reviewed alias adapters before fresh GNU make."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);C=pathlib.Path(os.environ['GLIBC_CUMULATIVE_PACKET']);A=pathlib.Path(os.environ['GLIBC_ALIAS_PACKET']);R=pathlib.Path(__file__).resolve().parents[3]
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
j=json.loads((C/'logs/terminal-source-proof.json').read_text());assert j['pass']
assert json.loads((C/'logs/cumulative-final-audit.json').read_text())['pass']
rows=[]
for row in j['sourceSnapshots']:
 p=pathlib.Path(row['source']);q=pathlib.Path(row['snapshot']);d={'sha256':row['sha256'],'bytes':row['bytes']};assert digest(p)==digest(q)==d
 rows.append({'source':str(p),'snapshot':str(q),'verified':d})
expected={'normalize.py':'9644293c57a2c16019e0dc8cf337745d07807edd8262aad14b77700249445349','fix-symbol-sizes.py':'03b3a81edeb7c8867248b721a1e5d8338b210c2e543ce612bf50afc95502bf88'}
assert json.loads((A/'acceptance.json').read_text())['pass']
freeze=json.loads((A/'repository-freeze.json').read_text());assert len(freeze)==5
for name,d in freeze.items():
 p=R/name;assert digest(p)==d
 if p.name in expected:
  assert d['sha256']==expected[p.name];q=T/'source-snapshots/alias-tools'/p.name;q.parent.mkdir(exist_ok=True);assert not q.exists();q.write_bytes(p.read_bytes())
  rows.append({'source':str(p),'snapshot':str(q),'verified':d})
for p in [A/'manifest.json',A/'acceptance.json',A/'repository-freeze.json',C/'logs/terminal-source-proof.json',C/'logs/cumulative-final-audit.json']:
 rows.append({'source':str(p),'verified':digest(p)})
(T/'logs/integration-inputs.json').write_text(json.dumps({'pass':True,'rows':rows},indent=2)+'\n')
