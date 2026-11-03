#!/usr/bin/env python3
"""Package a current SDK sample as a bounded overlay for the existing plain desktop."""
import argparse,pathlib,json,hashlib,sys,importlib.util
sys.dont_write_bytecode=True
p=argparse.ArgumentParser();p.add_argument('--binary',type=pathlib.Path,required=True);p.add_argument('--trace',action='store_true');p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('smoke',root/'tools/guest-packages/make-smoke.py');smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
sha=lambda b:hashlib.sha256(b).hexdigest();binary=a.binary.read_bytes();assert binary.startswith(b'\0asm\x01\0\0\0') and b'VKGEARS_SWAPCHAIN' in binary
waiter=b'''#!/bin/busybox sh
export PATH=/bin DISPLAY=:0
count=0
while [ "$count" -lt 40 ]; do
  [ -e /tmp/.X11-unix/X0 ] && break
  count=$((count+1)); busybox sleep 1
done
if [ ! -e /tmp/.X11-unix/X0 ]; then
  echo "VULKAN_WSI_SMOKE_EXIT status=90 reason=no-xserver"
  exit 90
fi
/bin/vkgears-wsi -wsi -info -seconds 6 -interval 2 -size 128x128
status=$?
echo "VULKAN_WSI_SMOKE_EXIT status=$status"
'''
if a.trace:
 assert waiter.count(b'export PATH=/bin DISPLAY=:0')==1
 waiter=waiter.replace(b'export PATH=/bin DISPLAY=:0',b'export PATH=/bin DISPLAY=:0 GUEST_VK_TRACE=1')
init=b'''#!/bin/busybox sh
/bin/busybox sh /gpt6-astra-vulkan-waiter &
exec /init "$@"
'''
files=[('gpt6-astra-vulkan-init',init,0o100755),('gpt6-astra-vulkan-waiter',waiter,0o100755),('bin/vkgears-wsi',binary,0o100755)]
overlay=b''.join(smoke.entry(n,b,m,ino=i+1) for i,(n,b,m) in enumerate(files))+smoke.entry('TRAILER!!!',mode=0);overlay+=b'\0'*((-len(overlay))%512)
base=(root/'web/linux/initramfs.cpio').read_bytes();manifest=json.loads((root/'web/linux/boot-manifest.json').read_text())['assets']['plain'];assert len(base)==manifest['bytes'] and sha(base)==manifest['sha256'];combined=base+b'\0'*((-len(base))%4)+overlay;(out/'initramfs.cpio').write_bytes(combined)
report={'pass':True,'testOnly':True,'trace':a.trace,'archiveBytes':len(combined),'archiveSha256':sha(combined),'baseSha256':sha(base),'binarySha256':sha(binary),'overlaySha256':sha(overlay),'cmdline':'console=hvc0 rdinit=/gpt6-astra-vulkan-init','boundedSeconds':6,'xserverDeadlineSeconds':40,'scope':'Fresh guest Vulkan public acquire/render/present WSI smoke; not conformance or throughput comparison'};(out/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
