#!/usr/bin/env python3
"""Create a small isolated Linux guest image from verified BusyBox and overlays.
Only the existing guest BusyBox binary is reused. A new /init is always explicit.
No user home, Firefox profile, files, accounts or live rootfs are copied.
"""
import argparse,gzip,hashlib,json,os,pathlib,stat

def digest(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def read_exact(f,n):
 b=f.read(n)
 if len(b)!=n:raise ValueError('truncated newc archive')
 return b
def member(source,name):
 opener=gzip.open if source.open('rb').read(2)==b'\x1f\x8b' else open
 with opener(source,'rb') as f:
  while True:
   h=read_exact(f,110)
   if h[:6]!=b'070701':raise ValueError('unsupported archive')
   size=int(h[54:62],16);ns=int(h[94:102],16);n=read_exact(f,ns).rstrip(b'\0').decode().removeprefix('./');read_exact(f,(-(110+ns))%4)
   if n=='TRAILER!!!':raise ValueError('missing member: '+name)
   if n==name:return read_exact(f,size)
   left=size+(-size)%4
   while left:left-=len(read_exact(f,min(left,1024*1024)))
def entry(name,data=b'',mode=0o100644,ino=1,rdev=(0,0)):
 if name.startswith('/') or any(p in ('','..','.') for p in name.split('/')):raise ValueError('unsafe path '+name)
 n=name.encode()+b'\0';fields=[ino,mode,0,0,1,0,len(data),0,0,rdev[0],rdev[1],len(n),0];h=b'070701'+b''.join(f'{v:08x}'.encode() for v in fields);out=h+n+b'\0'*((-(110+len(n)))%4)+data+b'\0'*((-len(data))%4);return out

def build(source,expected,init,overlays,out):
 if digest(source)!=expected:raise ValueError('base archive hash mismatch')
 busybox=member(source,'bin/busybox')
 if not busybox.startswith(b'\0asm\x01\0\0\0'):raise ValueError('BusyBox must be genuine Wasm binary')
 files={'bin/busybox':(busybox,0o100755),'bin/sh':(b'busybox',0o120777),'init':(init.read_bytes(),0o100755),'etc/passwd':(b'root:x:0:0:root:/:/bin/sh\n',0o100644),'etc/group':(b'root:x:0:\n',0o100644)}
 for name,p in overlays.items():
  name=name.lstrip('/');data=p.read_bytes();files[name]=(data,0o100755 if data.startswith(b'\0asm') or data.startswith(b'#!') else 0o100644)
 dirs={'bin','dev','proc','sys','tmp','etc','usr','usr/bin','usr/libexec','var','var/cache','lib','run','testroot'}
 for name in files:
  par=pathlib.PurePosixPath(name).parent
  while str(par)!='.':dirs.add(str(par));par=par.parent
 records=[entry(n,b'',0o040755,i+1) for i,n in enumerate(sorted(dirs,key=lambda s:(s.count('/'),s)))]
 records.extend(entry(n,b'',0o020666,500+i,rdev=d) for i,(n,d) in enumerate([('dev/console',(5,1)),('dev/null',(1,3)),('dev/zero',(1,5)),('dev/urandom',(1,9)),('dev/tty',(5,0))]))
 records.extend(entry(n,data,mode,i+len(dirs)+1) for i,(n,(data,mode)) in enumerate(sorted(files.items())));records.append(entry('TRAILER!!!',mode=0));image=b''.join(records);image+=b'\0'*((-len(image))%512);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(image)
 report={'testOnly':True,'pass':True,'sourceArchiveSha256':expected,'busyboxSha256':hashlib.sha256(busybox).hexdigest(),'archiveSha256':digest(out),'archiveBytes':len(image),'files':{n:{'bytes':len(d),'sha256':hashlib.sha256(d).hexdigest(),'mode':oct(m)} for n,(d,m) in files.items()}}
 out.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['archiveSha256','archiveBytes','busyboxSha256']}));return report
if __name__=='__main__':
 q=argparse.ArgumentParser();q.add_argument('--base',type=pathlib.Path,required=True);q.add_argument('--base-sha256',required=True);q.add_argument('--init',type=pathlib.Path,required=True);q.add_argument('--output',type=pathlib.Path,required=True);q.add_argument('--file',action='append',default=[]);a=q.parse_args();files={}
 for item in a.file:
  name,p=item.split('=',1)
  if name in files:raise ValueError('duplicate overlay '+name)
  files[name]=pathlib.Path(p)
 build(a.base,a.base_sha256,a.init,files,a.output)
