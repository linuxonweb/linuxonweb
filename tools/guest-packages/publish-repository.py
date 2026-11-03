#!/usr/bin/env python3
"""Verify an APK repository and atomically advance its public signed index.
Versioned packages and the public key are immutable. No signing private key is read.
"""
import argparse,hashlib,io,json,os,pathlib,re,subprocess,tarfile,tempfile,zlib
p=argparse.ArgumentParser();p.add_argument('--source',type=pathlib.Path,required=True);p.add_argument('--destination',type=pathlib.Path,required=True);p.add_argument('--host-apk',type=pathlib.Path,required=True);a=p.parse_args()
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def checked(p):
 if p.is_symlink() or not p.is_file():raise ValueError('regular source required: '+str(p))
 return p.read_bytes()
def write(path,data,immutable=False):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.is_symlink():raise ValueError('symlink destination rejected')
 if path.exists() and immutable:
  if path.read_bytes()!=data:raise ValueError('immutable package or key changed: '+path.name)
  return
 fd,tmp=tempfile.mkstemp(prefix='.publish-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,0o644);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
index=a.source/'wasm32/APKINDEX.tar.gz';receipt=json.loads(checked(a.source/'wasm32/index-receipt.json'));key=a.source/receipt['publicKeyName']
if receipt['publicKeyName']!='linuxonweb-dev.rsa.pub' or digest(index)!=receipt['indexSha256']:raise ValueError('index receipt mismatch')
# APK v2 indexes sign the complete unsigned gzip member with RSA/SHA1.
# Verify the cryptographic signature, not only the neighboring JSON receipt.
blob=checked(index);decoder=zlib.decompressobj(31);signature_tar=decoder.decompress(blob);unsigned=decoder.unused_data
if not decoder.eof or not unsigned:raise ValueError('index signature stream missing')
with tarfile.open(fileobj=io.BytesIO(signature_tar)) as archive:
 entries=archive.getmembers()
 if len(entries)!=1 or entries[0].name!='.SIGN.RSA.'+key.name or not entries[0].isfile():raise ValueError('unexpected index signature member')
 signature=archive.extractfile(entries[0]).read()
with tempfile.NamedTemporaryFile(prefix='index-signature-') as sig:
 sig.write(signature);sig.flush()
 subprocess.run(['openssl','dgst','-sha1','-verify',str(key.resolve()),'-signature',sig.name],input=unsigned,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
apk=a.host_apk.resolve();env={**os.environ,'LD_LIBRARY_PATH':str(apk.parent)}
for item in receipt['packages']:
 if not re.fullmatch(r'[A-Za-z0-9_.+-]+\.apk',item['file']):raise ValueError('unsafe package name')
 f=a.source/'wasm32'/item['file'];checked(f)
 if f.stat().st_size!=item['bytes'] or digest(f)!=item['sha256']:raise ValueError('package receipt mismatch')
 subprocess.run([str(apk),'--keys-dir',str(key.resolve().parent),'verify',str(f.resolve())],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
write(a.destination/key.name,checked(key),True)
for item in receipt['packages']:
 write(a.destination/'wasm32'/item['file'],checked(a.source/'wasm32'/item['file']),True)
 # Immutable per-version provenance is public, separate from the signed archive.
 f=a.source/'wasm32'/pathlib.Path(item['file']).with_suffix('.json')
 if f.exists():write(a.destination/'wasm32'/f.name,checked(f),True)
write(a.destination/'wasm32/index-receipt.json',checked(a.source/'wasm32/index-receipt.json'))
write(a.destination/'wasm32/APKINDEX.tar.gz',checked(index))
print(json.dumps({'pass':True,'indexSha256':receipt['indexSha256'],'packages':len(receipt['packages']),'versionedArtifactsImmutable':True,'signedIndexAtomic':True,'indexSignatureVerified':True}))
