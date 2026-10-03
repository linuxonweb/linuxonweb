#!/usr/bin/env python3
"""Isolated genuine kernel package; current fixtures are never Firefox frontend acceptance."""
from pathlib import Path
import sys,json,hashlib,os,shutil
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[5];TASK=Path('/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003');OLD=Path('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003')
sys.path.insert(0,str(ROOT/'web/linux/tests/guest-vulkan-graphics'));from package import records,record
sha=lambda b:hashlib.sha256(b).hexdigest()
pins=json.loads((OLD/'source-pins.json').read_text());assert pins['revision']=='4f4dc63098fae64a0e6d1d3dc6f4f328da8fd5c8'
for row in pins['files']:assert sha(Path(row['path']).read_bytes())==row['sha256'],row['path']
manifest=json.loads((ROOT/'web/linux/boot-manifest.json').read_text())['assets']['plain'];raw=(ROOT/'web/linux/initramfs.cpio').read_bytes();assert len(raw)==manifest['bytes'] and sha(raw)==manifest['sha256']
output=TASK/'package';assert not output.exists() and shutil.disk_usage(TASK).free>20*1024**3;output.mkdir()
init=b'#!/bin/sh\nexport PATH=/bin:/sbin:/usr/bin:/usr/sbin\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\nmount -t devtmpfs devtmpfs /dev\ncase "$(cat /proc/cmdline)" in *gpu_webgl=1*) export CURRENT_GPU_WEBGL=1;; esac\n/bin/current-gpu-native\nstatus=$?\necho CURRENT_GPU_INIT_EXIT status=$status\nwhile :; do sleep 60; done\n'
additions={'bin/current-gpu-native':(TASK/'guest.wasm').read_bytes(),'current-gpu':None}
for name in ['copy.bin','compute.bin','copy-gl.bin','stale.bin','protocol.txt']:additions['current-gpu/'+name]=(TASK/name).read_bytes()
rows=list(records(raw));chunks=[];counter=0x70000000
for key,h,name,body,encoded in rows:
 if key=='init':chunks.append(record(h,name,init))
 elif key=='TRAILER!!!':
  for key,body in additions.items():
   n=key.encode()+b'\0';mode=0o40755 if body is None else 0o100755 if key.startswith('bin/') else 0o100644;body=body or b'';fields=[counter,mode,0,0,1,0,len(body),0,0,0,0,len(n),0];counter+=1;header=b'070701'+b''.join(f'{v:08x}'.encode()for v in fields);chunks.append(record(header,n,body))
  chunks.append(encoded)
 else:chunks.append(encoded)
tail=raw[sum(len(r[4])for r in rows):];archive=b''.join(chunks)+tail;after={r[0]:r[4]for r in records(archive)};before={r[0]:r[4]for r in rows};assert set(after)-set(before)==set(additions) and [k for k in before if before[k]!=after[k]]==['init']
(output/'initramfs.cpio').write_bytes(archive)
artifacts={}
for name in ['nightly_webgpu_current.js','nightly_webgpu_current_bg.wasm']:
 b=(OLD/'candidate'/name).read_bytes();(output/name).write_bytes(b);artifacts[name]={'bytes':len(b),'sha256':sha(b),'source':str(OLD/'candidate'/name)}
inputs=[TASK/'guest.wasm',TASK/'guest-raw.wasm',TASK/'guest.o',OLD/'source-pins.json',OLD/'schema.rs',OLD/'wgpu_ffi_generated.h',ROOT/'web/linux/initramfs.cpio']+[TASK/name for name in ['copy.bin','compute.bin','copy-gl.bin','stale.bin','protocol.txt','copy-full.bin','compute-full.bin','copy-gl-full.bin']]+list(Path(__file__).resolve().parent.glob('*'))
report={'testOnly':True,'passPackage':True,'bytes':len(archive),'archiveSha256':sha(archive),'sourceArchiveSha256':sha(raw),'added':list(additions),'modified':['init'],'artifacts':artifacts,'inputs':[{ 'path':str(p.resolve()),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}for p in inputs if p.is_file()],'currentPins':pins,'actualFirefoxClientSerializer':False,'scope':'standalone native current golden transport; no Firefox launch'}
(output/'package.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passPackage':True,'bytes':len(archive)}))
