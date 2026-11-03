#!/usr/bin/env python3
"""Build and sign an APK v2 repository, verifying each input package first."""
import argparse,hashlib,importlib.util,io,json,os,pathlib,subprocess,tarfile,tempfile
q=argparse.ArgumentParser();q.add_argument('--apk',type=pathlib.Path,required=True);q.add_argument('--repo',type=pathlib.Path,required=True);q.add_argument('--key',type=pathlib.Path,required=True);q.add_argument('--public-key',type=pathlib.Path,required=True);a=q.parse_args();a.repo.mkdir(parents=True,exist_ok=True);apk=a.apk.resolve();env={**os.environ,'LD_LIBRARY_PATH':str(apk.parent)};pkgs=sorted(a.repo.glob('*.apk'))
if not pkgs:raise SystemExit('empty repository')
for p in pkgs:subprocess.run([str(apk),'--no-progress','--keys-dir',str(a.public_key.resolve().parent),'verify',str(p.resolve())],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
with tempfile.TemporaryDirectory(prefix='index-',dir=a.repo) as tmp:
 unsigned=pathlib.Path(tmp)/'APKINDEX.tar.gz';r=subprocess.run([str(apk),'--arch','wasm32','--no-progress','--keys-dir',str(a.public_key.resolve().parent),'index','-o',str(unsigned.resolve()),*[str(p.resolve()) for p in pkgs]],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 s=importlib.util.spec_from_file_location('apk_package',pathlib.Path(__file__).with_name('package-apk.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);raw=unsigned.read_bytes()
 with tarfile.open(fileobj=io.BytesIO(raw)) as t:index_text=t.extractfile('APKINDEX').read().decode()
 expected={json.loads(p.with_suffix('.json').read_text())['name'] for p in pkgs};actual={line[2:] for line in index_text.splitlines() if line.startswith('P:')}
 if actual!=expected or any(line!='A:wasm32' for line in index_text.splitlines() if line.startswith('A:')):raise RuntimeError('index package set or architecture mismatch')
 signed=m.signature(raw,a.key,a.public_key.name)+raw
 index=a.repo/'APKINDEX.tar.gz';index.write_bytes(signed)
 receipt={'indexSha256':hashlib.sha256(signed).hexdigest(),'publicKeyName':a.public_key.name,'inputSignaturesVerified':True,'packages':[{'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in pkgs]};(a.repo/'index-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
