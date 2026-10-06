#!/usr/bin/env python3
"""Create a bounded task-local install tree; never launch or install in guest."""
import argparse,hashlib,json,re,shutil
from pathlib import Path
BUILD_ROOT=Path('/mnt/p6/project/build')
MODULE_ROOT=Path(__file__).resolve().parent
SHA='b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8'
SAMPLE=[(0,'int-loop',19,49995000),(5,'prop-mono',24,4003),(6,'native-call',25,3999)]
def task_root(path):
 root=path.resolve()
 if root!=path.absolute() or root==BUILD_ROOT or not root.is_relative_to(BUILD_ROOT) or not root.is_dir() or root.stat().st_dev!=BUILD_ROOT.stat().st_dev:raise ValueError('existing canonical disk-backed task root required')
 return root
def bodies(data):
 lines=data.decode('utf-8').splitlines(); result={}
 for index,name,line,value in SAMPLE:
  text=lines[line-1];prefix=" ['"+name+"',";suffix=','+str(value)+'],'
  if not text.startswith(prefix) or not text.endswith(suffix):raise ValueError('original lexical line changed')
  body=text[len(prefix):-len(suffix)]
  if not body.startswith('()=>{'):raise ValueError('original arrow missing')
  result[str(index)]=body
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--task-root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--label',required=True);p.add_argument('--option',type=int,choices=[0,1],required=True);p.add_argument('--cpus',type=int,required=True);p.add_argument('--build-id',required=True);a=p.parse_args()
 try:root=task_root(a.task_root)
 except (ValueError,OSError) as e:p.error(str(e))
 if not re.fullmatch('[ab]-[1-6]',a.label) or a.cpus<1 or not re.fullmatch(r'\d{14}',a.build_id):p.error('exact label/CPUs/BuildID required')
 if a.out.resolve()==root or not a.out.resolve().is_relative_to(root) or a.out.exists():p.error('new owned task-local output required')
 if shutil.disk_usage(root).free<20*1024**3:raise RuntimeError('20GiB reserve required')
 source=a.repo/'web/linux/tests/guest-jit-pbl-bench.html';data=source.read_bytes()
 if len(data)!=3175 or hashlib.sha256(data).hexdigest()!=SHA:raise RuntimeError('unchanged full original fixture required')
 base='/home/admin/nightly-jit-safety/original-bench-'+a.label+'/'
 c={'kind':'original-body-diagnostic-contract-v1','label':a.label,'option':a.option,'cpus':a.cpus,'buildID':a.build_id,'base':base,'documentURI':'file://'+base+'pblbench-'+a.label+'.html','fixtureSHA256':SHA,'fixtureBytes':len(data),'sourceBodies':bodies(data),'invocationsPerBody':20,'unchangedSettleMs':15000,'runtimeAcceptance':False}
 a.out.mkdir()
 for name in ['original-content.sys.mjs','OriginalBenchmarkChild.sys.mjs','OriginalBenchmarkParent.sys.mjs','original-hash.sys.mjs','original-entry.sys.mjs','benchmark-diagnostics.sys.mjs']:shutil.copyfile(MODULE_ROOT/name,a.out/name)
 (a.out/('pblbench-'+a.label+'.html')).write_bytes(data)
 (a.out/'original-source.sys.mjs').write_text('export const sourceBodies='+json.dumps(c['sourceBodies'],separators=(',',':'))+';\n')
 (a.out/'contract.json').write_text(json.dumps(c,indent=2)+'\n')
 rows=[{'path':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(a.out.iterdir())]
 if sum(x['bytes'] for x in rows)>16*1024**2:raise RuntimeError('bounded install tree exceeds 16MiB')
 (a.out/'install-manifest.json').write_text(json.dumps({'kind':'uninstalled-original-body-diagnostic-v1','guestDestination':base,'files':rows,'runtimeAcceptance':False},indent=2)+'\n')
 print(json.dumps({'prepared':str(a.out),'files':len(rows),'guestLaunch':False}))
if __name__=='__main__':main()
