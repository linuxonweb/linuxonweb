#!/usr/bin/env python3
"""Build an isolated minimal busybox + glrtest initramfs, without persistent home."""
import argparse,hashlib,importlib.util,json,stat,sys
from pathlib import Path
sys.dont_write_bytecode=True
p=argparse.ArgumentParser();p.add_argument('--binary',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cpio',root/'web/linux/tests/guest-gpu-hostcall/build.py');cpio=importlib.util.module_from_spec(spec);spec.loader.exec_module(cpio)
raw=(root/'web/linux/initramfs.cpio').read_bytes();manifest=json.loads((root/'web/linux/boot-manifest.json').read_text())['assets']['plain']
sha=lambda b:hashlib.sha256(b).hexdigest()
assert len(raw)==manifest['bytes'] and sha(raw)==manifest['sha256']
busybox=next(body for key,_,_,body,_ in cpio.records(raw) if key=='bin/busybox')
chunks=[];ino=0

def add(name,mode,body=b'',major=0,minor=0):
 global ino
 ino+=1;n=name.encode()+b'\0';fields=[ino,mode,0,0,1,0,len(body),0,0,major,minor,len(n),0]
 header=b'070701'+b''.join(f'{v:08x}'.encode() for v in fields)
 chunks.append(cpio.record(header,n,body))
for name in ('.','bin','dev','proc','sys','tmp'):add(name,stat.S_IFDIR|0o755)
add('bin/busybox',stat.S_IFREG|0o755,busybox)
add('bin/sh',stat.S_IFLNK|0o777,b'busybox')
binary=a.binary.read_bytes();add('bin/glrtest',stat.S_IFREG|0o755,binary)
for name,major,minor in [('console',5,1),('null',1,3),('urandom',1,9)]:add('dev/'+name,stat.S_IFCHR|0o600,major=major,minor=minor)
init=b'''#!/bin/busybox sh
export PATH=/bin
busybox mount -t devtmpfs devtmpfs /dev
busybox mount -t proc proc /proc
busybox mount -t sysfs sysfs /sys
/bin/glrtest
result=$?
echo "GLRTEST_EXIT status=$result"
busybox poweroff -f
while :; do busybox sleep 5; done
'''
add('init',stat.S_IFREG|0o755,init);add('TRAILER!!!',0)
archive=b''.join(chunks);archive+=b'\0'*(-len(archive)%512)
a.output.mkdir(parents=True,exist_ok=False)
(a.output/'initramfs.cpio').write_bytes(archive)
r={'testOnly':True,'pass':True,'archiveBytes':len(archive),'archiveSha256':sha(archive),'binarySha256':sha(binary),'busyboxSha256':sha(busybox),'plainSha256':sha(raw),'runtimeSha256':{n:sha((root/'web/linux/dist'/n).read_bytes()) for n in ['index.js','worker.js','guest-gpu-owner.js','guest-gl-remote.js']}}
(a.output/'build.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
