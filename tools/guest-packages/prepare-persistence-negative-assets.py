#!/usr/bin/env python3
"""Create private negative fixtures, never a public repository or private-key copy."""
import argparse,base64,gzip,hashlib,importlib.util,io,json,pathlib,tarfile
p=argparse.ArgumentParser()
for n in ['archive','key','public-key-name','out']:p.add_argument('--'+n,required=True,type=str if n=='public-key-name' else pathlib.Path)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
here=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('package',here/'package-apk.py');package=importlib.util.module_from_spec(s);s.loader.exec_module(package)
import zlib
raw=a.archive.read_bytes();segments=[]
while raw:
 decoder=zlib.decompressobj(31);decoder.decompress(raw);decoder.flush();used=len(raw)-len(decoder.unused_data)
 if used<=0:raise ValueError('bad signed APK gzip stream')
 segments.append(raw[:used]);raw=decoder.unused_data
if len(segments)!=3:raise ValueError('three signed APK streams required')
control=[];identity={}
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(segments[1])),mode='r:') as archive:
 for item in archive:
  if not item.isfile():raise ValueError('unexpected control member')
  data=archive.extractfile(item).read()
  if item.name=='.PKGINFO':
   text=data.decode();identity=dict(line.split(' = ',1) for line in text.splitlines() if ' = ' in line)
   old='pkgdesc = '+identity['pkgdesc']+'\n';assert text.count(old)==1
   data=text.replace(old,old.rstrip('\n')+' [private same-version identity fixture]\n').encode()
  control.append((item.name,data,item.mode,tarfile.REGTYPE,''))
new_control=package.gz(package.tar_segment(control))
same=package.signature(new_control,a.key,a.public_key_name)+new_control+segments[2]
(a.out/'same-version.apk').write_bytes(same)
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(segments[0])),mode='r:') as archive:
 items=archive.getmembers()
 if len(items)!=1 or items[0].name!='.SIGN.RSA.'+a.public_key_name:raise ValueError('unexpected signature identity')
 signature=bytearray(archive.extractfile(items[0]).read());signature[len(signature)//2]^=0x80
 bad_signature=package.gz(package.tar_segment([(items[0].name,bytes(signature),items[0].mode,tarfile.REGTYPE,'')]))
(a.out/'bad-signature.apk').write_bytes(bad_signature+segments[1]+segments[2])
(a.out/'script-fail').write_text('#!/bin/sh\nexit 23\n')
(a.out/'script-fail-payload').write_text('Private failure fixture; never publish.\n')
spec={'name':'persist-script-fail','version':'1-r0','description':'Private native maintainer failure fixture; never publish','url':'https://example.invalid/private-test','license':'MIT','files':{'usr/share/persist-script-fail':str(a.out/'script-fail-payload')},'scripts':{'pre-install':str(a.out/'script-fail')},'provenance':{'testOnly':True,'mustNotPublish':True}}
package.package(spec,a.out/'persist-script-fail-1-r0.apk',a.key,a.public_key_name)
receipt={'testOnly':True,'mustNotPublish':True,'original':{'name':identity['pkgname'],'version':identity['pkgver'],'C':'Q1'+base64.b64encode(hashlib.sha1(segments[1]).digest()).decode(),'sha256':hashlib.sha256(a.archive.read_bytes()).hexdigest()},'sameVersion':{'name':identity['pkgname'],'version':identity['pkgver'],'C':'Q1'+base64.b64encode(hashlib.sha1(new_control).digest()).decode(),'sha256':hashlib.sha256(same).hexdigest(),'signature':'signed with existing development trust; control description changed, executable payload unchanged'},'badSignature':{'sha256':hashlib.sha256((a.out/'bad-signature.apk').read_bytes()).hexdigest(),'format':'valid gzip/tar; one RSA signature byte changed; original control/payload unchanged'},'privateKeyCopied':False}
(a.out/'negative-assets.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
