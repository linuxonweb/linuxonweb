#!/usr/bin/env python3
"""Meaningful admission faults on genuine retained primitive report evidence."""
import copy,json,subprocess,sys,shutil,hashlib
from pathlib import Path
TASK=Path('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003')
source=Path(__file__).resolve().parent
base=json.loads((TASK/'browser-hardware6/result.json').read_text())
def rebound(j):
 helper=next(k for k in j['runnerSources'] if k.endswith('/firefox-browser-affinity.mjs'));j['runnerSources'].pop(helper);p=source/'README.md';j['runnerSources'][str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
mutations={
 'missing-request':lambda j:j.update(requests=[]),
 'missing-helper':lambda j:j['runnerSources'].pop(next(k for k in j['runnerSources'] if k.endswith('/firefox-browser-affinity.mjs'))),
 'rebound-helper':rebound,
 'empty-affinity':lambda j:j['affinity'].update(checks={}),
 'duplicate-cpus':lambda j:j['affinity'].update(assignedCpus=[0]*6),
 'false-affinity':lambda j:j['affinity']['checks'].update(actualBrowserAffinity=False),
 'leaked-resource':lambda j:j['result']['runs'][0].update(resourcesAfterClose=1),
}
rows=[]
for name,mutate in mutations.items():
 folder=TASK/('checker-fault-'+name);folder.mkdir();j=copy.deepcopy(base);mutate(j);(folder/'result.json').write_text(json.dumps(j))
 try:
  p=subprocess.run([sys.executable,str(source/'check.py'),folder.name],capture_output=True,text=True,timeout=20)
  assert p.returncode!=0,name
  rows.append({'name':name,'exit':p.returncode,'diagnostic':p.stderr.splitlines()[-1]})
 finally:shutil.rmtree(folder)
result={'pass':True,'checks':len(rows),'faults':rows};(TASK/'checker-negative-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
