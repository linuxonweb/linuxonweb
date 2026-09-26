#!/usr/bin/env python3
"""Hash-guarded isolated CPIO: preserve every original record except /init."""
import argparse, hashlib, json
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__); p.add_argument('--build',type=Path,required=True); p.add_argument('--output',type=Path,required=True)
a=p.parse_args(); here=Path(__file__).resolve().parent; root=here.parents[3]
out=a.output.resolve()
if not out.is_relative_to(here/'generated') or out.exists(): p.error('use fresh output under guest-gpu/generated')
source=root/'web/linux/initramfs.cpio'; manifest=json.loads((root/'web/linux/boot-manifest.json').read_text())['assets']['plain']
raw=source.read_bytes()
if len(raw)!=manifest['bytes'] or hashlib.sha256(raw).hexdigest()!=manifest['sha256']: p.error('accepted plain archive hash mismatch')
build=json.loads(a.build.read_text()); binary=Path(build['artifact']).read_bytes()
if not build['pass'] or len(binary)!=build['bytes'] or hashlib.sha256(binary).hexdigest()!=build['sha256']: p.error('build report hash mismatch')
def records(data):
 offset=0
 while True:
  start=offset; h=data[offset:offset+110]
  if len(h)!=110 or h[:6]!=b'070701': raise ValueError('invalid newc')
  size=int(h[54:62],16); namesize=int(h[94:102],16); offset+=110
  name=data[offset:offset+namesize]; offset+=namesize; offset+=(-offset)%4
  body=data[offset:offset+size]; offset+=size; offset+=(-size)%4
  if len(body)!=size or not name.endswith(b'\0'): raise ValueError('truncated record')
  key=name[:-1].decode().removeprefix('./').lstrip('/')
  yield key,h,name,body,data[start:offset]
  if key=='TRAILER!!!': return
def record(h,name,body):
 h=h[:54]+f'{len(body):08x}'.encode()+h[62:94]+f'{len(name):08x}'.encode()+h[102:]
 return h+name+b'\0'*(-(110+len(name))%4)+body+b'\0'*(-len(body)%4)
original=list(records(raw)); chunks=[]; changes=0
anchor=b'# Keep the picker available without requiring Firefox to fork a helper on NOMMU.'
for key,h,name,body,encoded in original:
 if key=='init':
  if body.count(anchor)!=1: raise ValueError('init anchor is not unique')
  overlay=b'# Isolated guest GPU test; original desktop startup follows.\n/bin/guest-gpu-triangle &\n\n'
  chunks.append(record(h,name,body.replace(anchor,overlay+anchor))); changes+=1
 elif key=='TRAILER!!!':
  fields=[0x7ffffffe,0o100755,0,0,1,0,len(binary),0,0,0,0,len(b'bin/guest-gpu-triangle\0'),0]
  header=b'070701'+b''.join(f'{n:08x}'.encode() for n in fields)
  chunks.append(record(header,b'bin/guest-gpu-triangle\0',binary)); chunks.append(encoded)
 else: chunks.append(encoded)
if changes!=1: raise ValueError('init must occur once')
tail=raw[sum(len(r[4]) for r in original):]; result=b''.join(chunks)+tail
after=list(records(result)); old={r[0]:r[4] for r in original}; new={r[0]:r[4] for r in after}
if len(old)!=len(original) or len(new)!=len(after): raise ValueError('duplicate cpio path')
if set(new)-set(old)!={'bin/guest-gpu-triangle'} or set(old)-set(new): raise ValueError('unexpected path changes')
if [k for k in old if old[k]!=new[k]]!=['init']: raise ValueError('unexpected modified record')
out.mkdir(parents=True); (out/'initramfs.cpio').write_bytes(result)
report={'pass':True,'sourceSha256':manifest['sha256'],'archiveSha256':hashlib.sha256(result).hexdigest(),'bytes':len(result),'unchangedOriginalRecords':len(original)-1,'modified':['init'],'added':['bin/guest-gpu-triangle'],'tailPreserved':result.endswith(tail) if tail else True,'guestBinary':build}
(out/'package.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report))
