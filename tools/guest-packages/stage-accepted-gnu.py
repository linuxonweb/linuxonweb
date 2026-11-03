#!/usr/bin/env python3
"""Select only exact native-accepted GNU archives, preserving all public versions.
Signing/index publication is separate and never reads credentials here.
"""
import argparse,hashlib,json,pathlib,shutil
p=argparse.ArgumentParser()
for n in ['candidate','previous-public','evidence','out']:p.add_argument('--'+n,type=pathlib.Path,required=True)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False);(a.out/'wasm32').mkdir()
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def copy(source,target):
 if source.is_symlink() or not source.is_file():raise ValueError('regular public artifact required')
 if target.exists():
  if source.read_bytes()!=target.read_bytes():raise ValueError('immutable public bytes would change')
 else:shutil.copyfile(source,target)
key='linuxonweb-dev.rsa.pub'
if sha(a.candidate/key)!=sha(a.previous_public/key):raise ValueError('signing trust differs from live repository')
copy(a.previous_public/key,a.out/key)
selected=[]
for source in sorted((a.previous_public/'wasm32').glob('*.apk')):
 copy(source,a.out/'wasm32'/source.name)
 if source.with_suffix('.json').exists():copy(source.with_suffix('.json'),(a.out/'wasm32'/source.name).with_suffix('.json'))
 selected.append({'file':source.name,'sha256':sha(source),'origin':'previously public immutable version'})
evidence=json.loads(a.evidence.read_text())
if evidence.get('nativeBehaviorAccepted') is not True:raise ValueError('native behavior evidence is not accepted')
for name in ['findutils-4.10.0-r1.apk','tar-1.35-r1.apk','wget-1.25.0-r0.apk']:
 source=a.candidate/'wasm32'/name;accepted=evidence['packages'][name]
 if source.stat().st_size!=accepted['bytes'] or sha(source)!=accepted['sha256']:raise ValueError('archive differs from native-tested bytes')
 copy(source,a.out/'wasm32'/name);copy(source.with_suffix('.json'),(a.out/'wasm32'/name).with_suffix('.json'))
 selected.append({'file':name,'sha256':accepted['sha256'],'origin':'exact native tested GNU candidate'})
if any((a.out/'wasm32'/name).exists() for name in ['findutils-4.10.0-r0.apk','tar-1.35-r0.apk']):raise ValueError('rejected/unvalidated new candidate leaked into selection')
receipt={'candidateOnly':True,'published':False,'nativeEvidenceSha256':sha(a.evidence),'publicKeySha256':sha(a.out/key),'files':selected}
(a.out/'selection.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'files':len(selected),'publicKeySha256':receipt['publicKeySha256'],'candidateOnly':True}))
