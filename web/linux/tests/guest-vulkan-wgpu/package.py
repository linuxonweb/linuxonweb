#!/usr/bin/env python3
"""Isolated simple Vulkan benchmark package, never launches Firefox."""
import argparse,hashlib,json,os,sys,subprocess
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'guest-vulkan-graphics'))
from package import records,record
TASK=Path('/mnt/p6/project/build/guest-vulkan-wgpu-20261003')
ROOT=Path(__file__).resolve().parents[4]
def sha(data):return hashlib.sha256(data).hexdigest()
def disk(p):
    p=p.resolve();s=os.statvfs(p)
    if not(p==TASK or TASK in p.parents) or s.f_bavail*s.f_frsize<20*1024**3:raise ValueError('task disk path/20GiB reserve required')
    if int(subprocess.check_output(['stat','-f','-c','%t',str(p)],text=True).strip(),16) in (0x01021994,0x858458f6):raise ValueError('disk-backed output required')
    return p
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--build',type=Path,required=True);ap.add_argument('--wgpu-dir',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
    for k in ('TMPDIR','TMP','TEMP'):disk(Path(os.environ[k]))
    output=a.output.absolute();disk(output.parent)
    if output.exists():raise ValueError('fresh package directory required')
    buildraw=a.build.read_bytes();b=json.loads(buildraw);binary=Path(b['artifact']).read_bytes()
    if not b.get('pass') or not b.get('testOnly') or len(binary)!=b['bytes'] or sha(binary)!=b['sha256'] or binary[:4]!=b'\0asm':raise ValueError('verified native Wasm app required')
    for item in b.get('inputs',[]):
        data=Path(item['path']).read_bytes()
        if len(data)!=item['bytes'] or sha(data)!=item['sha256']:raise ValueError('app compiler input changed: '+item['path'])
    if not b.get('inputs') or not b.get('commands') or any(c.get('exit')!=0 for c in b['commands']):raise ValueError('real successful compiler/shader/validator provenance required')
    manifest=json.loads((ROOT/'web/linux/boot-manifest.json').read_text())['assets']['plain'];raw=(ROOT/'web/linux/initramfs.cpio').read_bytes()
    if len(raw)!=manifest['bytes'] or sha(raw)!=manifest['sha256']:raise ValueError('plain archive differs from manifest')
    rows=list(records(raw));keys=[r[0] for r in rows]
    if len(set(keys))!=len(keys) or keys.count('init')!=1 or 'bin/guest-vulkan-wgpu-benchmark' in keys:raise ValueError('unexpected original archive layout')
    init=b'#!/bin/sh\nexport PATH=/bin:/sbin:/usr/bin:/usr/sbin\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\nmount -t devtmpfs devtmpfs /dev\nexport GUEST_GPU_TRANSPORT=hostcall\n/bin/guest-vulkan-wgpu-benchmark\nstatus=$?\necho GUEST_WGPU_INIT_EXIT status=$status\nwhile :; do sleep 60; done\n'
    chunks=[]
    for key,h,name,body,encoded in rows:
        if key=='init':chunks.append(record(h,name,init))
        elif key=='TRAILER!!!':
            n=b'bin/guest-vulkan-wgpu-benchmark\0';fields=[0x7ffffffe,0o100755,0,0,1,0,len(binary),0,0,0,0,len(n),0];header=b'070701'+b''.join(f'{v:08x}'.encode() for v in fields);chunks.extend([record(header,n,binary),encoded])
        else:chunks.append(encoded)
    tail=raw[sum(len(r[4]) for r in rows):];archive=b''.join(chunks)+tail;after=list(records(archive));beforemap={r[0]:r[4] for r in rows};aftermap={r[0]:r[4] for r in after}
    if set(aftermap)-set(beforemap)!={'bin/guest-vulkan-wgpu-benchmark'} or set(beforemap)-set(aftermap) or [k for k in beforemap if beforemap[k]!=aftermap[k]]!=['init']:raise ValueError('unexpected archive mutation')
    output.mkdir();(output/'initramfs.cpio').write_bytes(archive);(output/'app-build.json').write_bytes(buildraw)
    artifacts={}
    for name in ('guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'):
        data=(a.wgpu_dir/name).read_bytes()
        if name.endswith('.wasm') and data[:4]!=b'\0asm':raise ValueError('genuine Wasm renderer artifact missing')
        (output/name).write_bytes(data);artifacts[name]={'sha256':sha(data),'bytes':len(data),'source':str((a.wgpu_dir/name).resolve())}
    report={'schema':1,'passPackage':True,'testOnly':True,'mode':'guest-vulkan-wgpu-benchmark','bytes':len(archive),'archiveSha256':sha(archive),'sourceArchiveSha256':sha(raw),'guestBinary':b,'appBuildSha256':sha(buildraw),'wgpuArtifacts':artifacts,'modified':['init'],'added':['bin/guest-vulkan-wgpu-benchmark'],'unchangedOriginalRecords':len(rows)-1,'tailPreserved':archive.endswith(tail) if tail else True,'firefoxLaunch':False,'packageSourceSha256':sha(Path(__file__).read_bytes())}
    (output/'package.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passPackage':True,'output':str(output),'archiveBytes':len(archive)}))
if __name__=='__main__':main()
