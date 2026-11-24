#!/usr/bin/env python3
"""Verify actual guest CPIO payload bytes against fresh linked Wasm modules."""
import os,pathlib,json,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);repo=pathlib.Path(__file__).resolve().parents[3]
def sha(b):return hashlib.sha256(b).hexdigest()
def records(data):
 o=0;result={}
 while True:
  start=o;h=data[o:o+110];assert h[:6]==b'070701';size=int(h[54:62],16);n=int(h[94:102],16);o+=110;name=data[o:o+n];o+=n;o+=(-o)%4;body=data[o:o+size];o+=size;o+=(-o)%4
  key=name[:-1].decode().removeprefix('./').lstrip('/');assert key not in result;result[key]=(body,data[start:o])
  if key=='TRAILER!!!':return result
raw=(repo/'web/linux/initramfs.cpio').read_bytes();plain=json.loads((repo/'web/linux/boot-manifest.json').read_text())['assets']['plain'];assert sha(raw)==plain['sha256'] and len(raw)==plain['bytes'];old=records(raw);rows={}
for mode,name in [('native','fenv.wasm'),('fpcast','fenv-fpcast.wasm')]:
 D=T/(mode+'-package');archive=(D/'initramfs.cpio').read_bytes();new=records(archive);module=(T/'objects'/name).read_bytes();build=json.loads((D/'build.json').read_text())
 assert sha(archive)==build['archiveSha256'] and len(archive)==build['archiveBytes'];assert new['bin/gnu-allocator-probe'][0]==module and sha(module)==build['sha256']
 assert set(new)-set(old)=={'bin/gnu-allocator-probe'} and [k for k in old if old[k][1]!=new[k][1]]==['init']
 assert b'cleanup-abort cleanup-exec jump-owner jump-bounds jump-past default ignored returning blocked fatal' in new['init'][0]
 rows[mode]={'archive':str(D/'initramfs.cpio'),'archiveSha256':sha(archive),'module':str(T/'objects'/name),'moduleSha256':sha(module),'actualCPIOPayloadMatches':True,'onlyOriginalRecordChanged':'init','onlyAddedRecord':'bin/gnu-allocator-probe'}
(T/'logs/package-payload-proof.json').write_text(json.dumps({'pass':True,'plainRootfsSha256':sha(raw),'oldLauncherOutsideGNUPayload':True,'packages':rows},indent=2)+'\n');print(json.dumps({'pass':True,'packages':rows}))
