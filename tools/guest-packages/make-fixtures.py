#!/usr/bin/env python3
"""Create positive and negative signed-package fixtures; never disable verification."""
import argparse,gzip,hashlib,importlib.util,json,pathlib,subprocess,zlib
q=argparse.ArgumentParser();q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--key',type=pathlib.Path,required=True);q.add_argument('--public-key-name',default='linuxonweb-dev.rsa.pub');a=q.parse_args();a.out.mkdir(parents=True,exist_ok=True)
s=importlib.util.spec_from_file_location('apk_package',pathlib.Path(__file__).with_name('package-apk.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
(a.out/'message.txt').write_text('linuxonweb real signed APK fixture\n')
(a.out/'success.sh').write_text('#!/bin/sh\n/bin/busybox printf "script executed after real spawn and chroot\\n" > /script-worked\n')
(a.out/'failure.sh').write_text('#!/bin/sh\nexit 7\n')
for name,script in [('apk-smoke-good','success.sh'),('apk-smoke-fail','failure.sh')]:
 spec={'name':name,'version':'1.0-r0','description':'Linux on Web package runtime test fixture','url':'https://gitlab.alpinelinux.org/alpine/apk-tools','license':'MIT','depends':['busybox'],'files':{'usr/share/'+name+'.txt':{'path':str(a.out/'message.txt'),'mode':'644'}},'scripts':{'post-install':str(a.out/script)}}
 m.package(spec,a.out/(name+'-1.0-r0.apk'),a.key,a.public_key_name)
# Valid compressed archive, but signed by an untrusted different private key.
unknown=a.out/'unknown-signing-key.rsa';subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(unknown)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);unknown.chmod(0o600)
spec={'name':'apk-smoke-untrusted','version':'1.0-r0','description':'Unknown signing key rejection fixture','url':'https://gitlab.alpinelinux.org/alpine/apk-tools','license':'MIT','files':{'usr/share/untrusted.txt':{'path':str(a.out/'message.txt')}}};m.package(spec,a.out/'apk-smoke-untrusted-1.0-r0.apk',unknown,'unknown.rsa.pub')
good=(a.out/'apk-smoke-good-1.0-r0.apk').read_bytes();streams=[];remaining=good
while remaining:
 z=zlib.decompressobj(31);plain=z.decompress(remaining)+z.flush();used=len(remaining)-len(z.unused_data);streams.append((remaining[:used],plain));remaining=z.unused_data
if len(streams)!=3:raise ValueError('expected three gzip streams')
# Recompress valid control metadata without updating its signature.
# Change within tar data without changing its size to retain a well-formed tar header.
control=streams[1][1].replace(b'package runtime test',b'PACKAGE runtime test')
(a.out/'apk-smoke-badsig-1.0-r0.apk').write_bytes(streams[0][0]+m.gz(control)+streams[2][0])
# A correctly signed package with deliberately wrong per-file checksum metadata.
data_plain=streams[2][1];needle=b'APK-TOOLS.checksum.SHA1=';i=data_plain.index(needle)+len(needle)
data_plain=data_plain[:i]+b'0'*40+data_plain[i+40:];bad_data=m.gz(data_plain)
old_hash=hashlib.sha256(streams[2][0]).hexdigest().encode();new_hash=hashlib.sha256(bad_data).hexdigest().encode()
bad_control=m.gz(streams[1][1].replace(old_hash,new_hash))
(a.out/'apk-smoke-badfile-1.0-r0.apk').write_bytes(m.signature(bad_control,a.key,a.public_key_name)+bad_control+bad_data)
print(json.dumps({'fixtures':['apk-smoke-good','apk-smoke-fail','apk-smoke-untrusted'],'signaturesRequired':True}))
