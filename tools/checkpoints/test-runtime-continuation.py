#!/usr/bin/env python3
"""Focused restore integrity checks; tiny synthetic files, no runtime acceptance."""
import ast,copy,gzip,hashlib,io,json,pathlib,subprocess,tarfile,tempfile
source=pathlib.Path(__file__).with_name('prepare-runtime-continuation.py').read_text()
module=ast.parse(source);restore=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='restore' for t in n.targets))
base=pathlib.Path('../../../codex-build/lwc').resolve()
def rec(data):return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
def archive(directory,name,members):
 p=directory/name
 with tarfile.open(p,'w:gz') as t:
  for path,data in members.items():
   info=tarfile.TarInfo(path);info.size=len(data);t.addfile(info,io.BytesIO(data))
 return {'name':name,**rec(p.read_bytes())}
with tempfile.TemporaryDirectory(prefix='restore-integrity-',dir=base) as task:
 task=pathlib.Path(task);results=[]
 for kind in ('valid-optimized','hash-optimized','image-path-escape','image-backslash','part-path-escape','cross-archive-collision','unlisted-tar-member'):
  d=task/kind;d.mkdir();(d/'restore-runtime.py').write_text(restore);image=b'synthetic image';(d/'image.part001').write_bytes(image);boot=b'{}';repo=b'fixture package'
  bpath='web/desktop/latest-build/boot-manifest.json';rpath='wasm32/fixture.apk';ipath='web/desktop/latest-build/initramfs-firefox.cpio.gz'
  m={'schema':2,'firefoxImage':{**rec(image),'restorePath':ipath,'parts':[{'name':'image.part001',**rec(image)}]},'bootAssetArchive':archive(d,'boot.tar.gz',{bpath:boot}),'bootAssets':[{'restorePath':bpath,**rec(boot)}],'repositoryArchive':archive(d,'repo.tar.gz',{'signed-repository/'+rpath:repo}),'repositoryFiles':[{'path':rpath,**rec(repo)}],'extraAssets':[],'extraAssetArchive':None}
  expected=None
  if kind=='hash-optimized':(d/'image.part001').write_bytes(b'X'+image[1:]);expected='SHA256 mismatch'
  if kind=='image-path-escape':m['firefoxImage']['restorePath']='../escaped';expected='Unsafe artifact path'
  if kind=='image-backslash':m['firefoxImage']['restorePath']='web\\escaped';expected='Unsafe artifact path'
  if kind=='part-path-escape':m['firefoxImage']['parts'][0]['name']='../image.part001';expected='Unsafe artifact path'
  if kind=='cross-archive-collision':m['extraAssets']=[{'restorePath':ipath,**rec(image)}];expected='colliding restore path'
  if kind=='unlisted-tar-member':m['bootAssetArchive']=archive(d,'boot.tar.gz',{bpath:boot,'web/unlisted.js':b'not declared'});expected='Archive inventory differs'
  (d/'RUNTIME-MANIFEST.json').write_text(json.dumps(m));p=subprocess.run(['python3','-O','restore-runtime.py'],cwd=d,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
  if expected:
   if p.returncode==0 or expected not in p.stderr:raise RuntimeError(kind+' did not fail as required: '+p.stderr[-400:])
  else:
   if p.returncode or (d/'restored-runtime'/ipath).read_bytes()!=image:raise RuntimeError('valid optimized restore failed: '+p.stderr[-400:])
  if (task/'escaped').exists():raise RuntimeError('path escape wrote outside restore root')
  results.append({'case':kind,'pass':True})
 print(json.dumps({'pass':True,'cases':results,'scope':'Synthetic restore integrity only; no native guest or encrypted end-to-end claim'}))
