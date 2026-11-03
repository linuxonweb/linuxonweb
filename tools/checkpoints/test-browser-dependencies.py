#!/usr/bin/env python3
"""Actual small supplement restore/idempotence and conflict checks under Python -O."""
import argparse,json,pathlib,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('--directory',type=pathlib.Path,required=True);p.add_argument('--runtime-manifest',type=pathlib.Path,required=True);a=p.parse_args()
pub=a.directory/'publish';work=a.directory/'private-verify';work.mkdir(exist_ok=False)
def run(directory,dest,expect=None):
 cmd=['python3','-O',str(directory/'restore-browser-dependencies.py'),'--runtime-manifest',str(a.runtime_manifest),'--destination',str(dest)]
 r=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
 if expect:
  if r.returncode==0 or expect not in r.stderr:raise RuntimeError('Expected refusal: '+expect)
  return {'pass':True,'refusal':expect}
 if r.returncode:raise RuntimeError(r.stderr[-800:])
 return json.loads(r.stdout)
results=[]
dest=work/'restored'
first=run(pub,dest);second=run(pub,dest)
if first['written']!=6 or second['written']!=0 or second['reusedIdentical']!=6:raise RuntimeError('restore/idempotence counts differ')
results.extend([{'case':'actual-optimized-restore',**first},{'case':'identical-existing-idempotent',**second}])
target='web/linux/node_modules/@xterm/xterm/lib/xterm.js'
d=work/'different';q=d/target;q.parent.mkdir(parents=True);q.write_bytes(b'owned different file')
results.append({'case':'differing-existing-preserved',**run(pub,d,'file identity mismatch')})
if q.read_bytes()!=b'owned different file' or (d/'web/linux/dist').exists():raise RuntimeError('conflicting restore mutated files')
d=work/'ancestor';q=d/'web/linux/node_modules/@xterm';q.parent.mkdir(parents=True);q.write_bytes(b'owned non-directory')
results.append({'case':'non-directory-ancestor-preflight',**run(pub,d,'non-directory restore ancestor')})
if q.read_bytes()!=b'owned non-directory' or (d/'web/linux/dist').exists():raise RuntimeError('ancestor failure changed another file')
d=work/'symlink';d.mkdir();(d/'web').symlink_to(dest/'web',target_is_directory=True)
results.append({'case':'symlink-destination-refused',**run(pub,d,'symlink in restore destination')})
m=json.loads((pub/'BROWSER-DEPENDENCIES-MANIFEST.json').read_text())
bad=work/'bad-archive';shutil.copytree(pub,bad);archive=bad/m['archive']['name'];data=archive.read_bytes();archive.write_bytes(bytes([data[0]^1])+data[1:])
results.append({'case':'corrupt-archive-optimized',**run(bad,work/'bad-archive-dest','file identity mismatch')})
bad=work/'bad-manifest';shutil.copytree(pub,bad);m['files'][0]['restorePath']='../escaped';(bad/'BROWSER-DEPENDENCIES-MANIFEST.json').write_text(json.dumps(m))
results.append({'case':'tampered-manifest-optimized',**run(bad,work/'bad-manifest-dest','pinned restore contract')})
receipt={'schema':1,'pass':all(row['pass'] for row in results),'cases':results,'scope':'Actual exact small payload reconstruction twice plus five conflict/integrity refusals under Python-O; no new native guest or whole encrypted recovery claim'}
(a.directory/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'pass':receipt['pass'],'cases':len(results),'filesVerified':first['filesVerified'],'idempotentReused':second['reusedIdentical']}))
