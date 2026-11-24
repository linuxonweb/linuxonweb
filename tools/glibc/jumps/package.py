import json,hashlib,sys,os
from pathlib import Path
T=Path(os.environ['GLIBC_TASK']).resolve();R=Path(os.environ.get('GLIBC_REPO',Path(__file__).resolve().parents[3])).resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
def records(data):
 o=0
 while True:
  start=o;h=data[o:o+110];assert h[:6]==b'070701';size=int(h[54:62],16);n=int(h[94:102],16);o+=110;name=data[o:o+n];o+=n;o+=(-o)%4;body=data[o:o+size];o+=size;o+=(-o)%4;key=name[:-1].decode().removeprefix('./').lstrip('/');yield key,h,name,body,data[start:o]
  if key=='TRAILER!!!':return
def record(h,n,b):
 h=h[:54]+f'{len(b):08x}'.encode()+h[62:94]+f'{len(n):08x}'.encode()+h[102:];return h+n+b'\0'* (-(110+len(n))%4)+b+b'\0'*(-len(b)%4)
module,outname=sys.argv[1:];binary=Path(module).read_bytes();raw=(R/'web/linux/initramfs.cpio').read_bytes();manifest=json.loads((R/'web/linux/boot-manifest.json').read_text())['assets']['plain'];assert sha(raw)==manifest['sha256'] and len(raw)==manifest['bytes'];original=list(records(raw));chunks=[];anchor=b'# Keep the picker available without requiring Firefox to fork a helper on NOMMU.'
for key,h,n,b,e in original:
 if key=='init':
  assert b.count(anchor)==1;chunks.append(record(h,n,b.replace(anchor,b'for mode in jump-owner jump-bounds jump-past default ignored returning blocked fatal; do\nGLIBC_TUNABLES=glibc.malloc.tcache_count=0:glibc.malloc.perturb=93:glibc.malloc.arena_max=1 /bin/gnu-allocator-probe "$mode"\necho "GNU_ABORT_EXIT mode=$mode status=$?"\ndone\nGLIBC_TUNABLES=glibc.malloc.tcache_count=0:glibc.malloc.perturb=93:glibc.malloc.arena_max=1 /bin/gnu-allocator-probe normal\necho "GUEST_JIT_EXIT status=$?"\n\n'+anchor)))
 elif key=='TRAILER!!!':
  n=b'bin/gnu-allocator-probe\0';fields=[0x7ffffffe,0o100755,0,0,1,0,len(binary),0,0,0,0,len(n),0];h=b'070701'+b''.join(f'{v:08x}'.encode() for v in fields);chunks+=[record(h,n,binary),e]
 else:chunks.append(e)
archive=b''.join(chunks)+raw[sum(len(x[4]) for x in original):];old={x[0]:x[4] for x in original};new={x[0]:x[4] for x in records(archive)};assert [k for k in old if old[k]!=new[k]]==['init'];assert set(new)-set(old)=={'bin/gnu-allocator-probe'}
out=(T/outname).resolve();assert out.is_relative_to(T) and out!=T;out.mkdir();out.joinpath('initramfs.cpio').write_bytes(archive);out.joinpath('build.json').write_text(json.dumps({'pass':True,'testOnly':True,'artifact':module,'sha256':sha(binary),'archiveSha256':sha(archive),'archiveBytes':len(archive),'plainSourceSha256':sha(raw),'workerSha256':sha((R/'web/linux/dist/worker.js').read_bytes()),'guestJitSha256':sha((R/'web/linux/dist/guest-jit.js').read_bytes()),'taskLocalWorkerSha256':sha((T/'source/worker.js').read_bytes()),'modified':['init'],'added':['bin/gnu-allocator-probe']},indent=2)+'\n')
