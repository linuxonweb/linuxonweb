#!/usr/bin/env python3
"""Rebuild the signed native guest repository from explicit, hash-pinned artifacts."""
import argparse,hashlib,importlib.util,json,pathlib,shutil,subprocess,sys
q=argparse.ArgumentParser();q.add_argument('--artifacts',type=pathlib.Path,required=True);q.add_argument('--output',type=pathlib.Path,required=True);q.add_argument('--key',type=pathlib.Path,required=True);q.add_argument('--public-key',type=pathlib.Path,required=True);q.add_argument('--host-apk',type=pathlib.Path,required=True);a=q.parse_args();here=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('apk_package',here/'package-apk.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a.output.mkdir(parents=True,exist_ok=False);repo=a.output/'wasm32';repo.mkdir();shutil.copyfile(a.public_key,a.output/a.public_key.name)
for recipe in sorted((here/'recipes').glob('*.json')):
 d=json.loads(recipe.read_text())
 for item in d['files'].values():
  if 'path' not in item:continue
  name=item['path']
  if pathlib.Path(name).name!=name:raise ValueError('artifact must be a basename')
  p=a.artifacts/name
  if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('artifact hash mismatch: '+name)
  item['path']=str(p)
 m.package(d,repo/(d['name']+'-'+d['version']+'.apk'),a.key,a.public_key.name)
subprocess.run([sys.executable,str(here/'build-index.py'),'--apk',str(a.host_apk),'--repo',str(repo),'--key',str(a.key),'--public-key',str(a.output/a.public_key.name)],check=True)
