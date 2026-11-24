#!/usr/bin/env python3
"""Verify the immutable replay and driver bytes before borrowing them."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);C=pathlib.Path(os.environ['GLIBC_CUMULATIVE_PACKET']);repo=pathlib.Path(__file__).resolve().parents[3]
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(C/'manifest.json')['sha256']=='dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09'
m=json.loads((C/'manifest.json').read_text())['files'];rows=[]
for name,h in json.loads((C/'repository-freeze.json').read_text()).items():
 p=repo/name;assert digest(p)==h==m[str(p)];rows.append({'source':str(p),'verified':h})
own=pathlib.Path(__file__).resolve().parent
assert (own/'compiler.py').read_bytes()==(repo/'tools/glibc/cumulative-make/compiler.py').read_bytes()
assert (own/'supervise.py').read_bytes()==(repo/'tools/glibc/cumulative-make/supervise.py').read_bytes()
(T/'logs/replay-inputs.json').write_text(json.dumps({'pass':True,'anchor':str(C/'manifest.json'),'rows':rows},indent=2)+'\n')
