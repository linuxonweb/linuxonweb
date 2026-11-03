#!/usr/bin/env python3
"""Produce reproducible signed APK v2 packages for the wasm32 Linux repository.
The private signing key is an explicit external path; it is never packaged.
"""
import argparse,gzip,hashlib,io,json,pathlib,re,subprocess,tarfile

def valid_member(name):
 if not isinstance(name,str) or not name or name.startswith('/') or '\\' in name or '\0' in name or any(part in ('','..','.') for part in name.rstrip('/').split('/')):raise ValueError('unsafe archive path')
 return name

def metadata_value(value,field):
 if not isinstance(value,str) or any(c in value for c in ('\r','\n','\0')):raise ValueError('invalid metadata field: '+field)
 return value

def validate_spec(spec,key_name):
 if not isinstance(key_name,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._@+-]*',key_name):raise ValueError('public key name must be a safe basename')
 for field in ('name','version','description','url','license'):
  metadata_value(spec[field],field)
 if 'origin' in spec:metadata_value(spec['origin'],'origin')
 for d in spec.get('depends',[]):metadata_value(d,'dependency')
 for member in spec.get('files',{}):
  valid_member(member)
  if member.endswith('/'):raise ValueError('file member must not end in slash')

def tar_segment(entries,end=False):
 out=bytearray()
 for name,data,mode,kind,link in entries:
  valid_member(name)
  info=tarfile.TarInfo(name);info.uid=info.gid=0;info.uname=info.gname='root';info.mode=mode;info.mtime=0;info.type=kind;info.linkname=link;info.size=len(data) if kind==tarfile.REGTYPE else 0
  if end and kind in (tarfile.REGTYPE,tarfile.SYMTYPE):info.pax_headers={'APK-TOOLS.checksum.SHA1':hashlib.sha1(data if kind==tarfile.REGTYPE else link.encode()).hexdigest()}
  out.extend(info.tobuf(format=tarfile.PAX_FORMAT));out.extend(data if kind==tarfile.REGTYPE else b'');out.extend(b'\0'*((-info.size)%512))
 if end:out.extend(b'\0'*1024)
 return bytes(out)
def gz(b):return gzip.compress(b,compresslevel=9,mtime=0)
def signature(blob,key,key_name):
 r=subprocess.run(['openssl','dgst','-sha1','-sign',str(key)],input=blob,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 return gz(tar_segment([(f'.SIGN.RSA.{key_name}',r.stdout,0o644,tarfile.REGTYPE,'')]))
def package(spec,output,key,key_name):
 validate_spec(spec,key_name)
 name=spec['name'];version=spec['version']
 if not re.fullmatch(r'[a-z0-9][a-z0-9+_.-]*',name) or not re.fullmatch(r'[a-zA-Z0-9+_.-]+',version):raise ValueError('invalid name/version')
 entries=[];size=0;directories=set()
 for member in spec.get('files',{}):
  parent=pathlib.PurePosixPath(member).parent
  while str(parent)!='.':directories.add(str(parent));parent=parent.parent
 for directory in sorted(directories,key=lambda d:(d.count('/'),d)):
  if directory in spec.get('files',{}):raise ValueError('file/directory collision')
  entries.append((directory+'/',b'',0o755,tarfile.DIRTYPE,''))
 for member,item in sorted(spec.get('files',{}).items()):
  if isinstance(item,str):item={'path':item}
  if 'symlink' in item:entries.append((member,b'',0o777,tarfile.SYMTYPE,item['symlink']));continue
  data=pathlib.Path(item['path']).read_bytes();size+=(len(data)+4095)//4096*4096
  entries.append((member,data,int(str(item.get('mode','644')),8),tarfile.REGTYPE,''))
 data=gz(tar_segment(entries,True))
 meta={'pkgname':name,'pkgver':version,'pkgdesc':spec['description'],'url':spec['url'],'builddate':'0','packager':'Linux on Web project','size':str(size),'arch':'wasm32','origin':spec.get('origin',name),'license':spec['license'],'datahash':hashlib.sha256(data).hexdigest()}
 info=''.join(f'{k} = {v}\n' for k,v in meta.items())+''.join(f'depend = {d}\n' for d in spec.get('depends',[]))
 control=[('.PKGINFO',info.encode(),0o644,tarfile.REGTYPE,'')]
 for script,filename in spec.get('scripts',{}).items():
  if script not in ['pre-install','post-install','pre-upgrade','post-upgrade','pre-deinstall','post-deinstall','trigger']:raise ValueError('unknown script')
  control.append(('.'+script,pathlib.Path(filename).read_bytes(),0o755,tarfile.REGTYPE,''))
 control=gz(tar_segment(control));signed=signature(control,key,key_name)+control+data
 output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(signed)
 receipt={'name':name,'version':version,'arch':'wasm32','bytes':len(signed),'sha256':hashlib.sha256(signed).hexdigest(),'publicKeyName':key_name,'signaturesRequired':True,'runtimeValidated':False,'provenance':spec.get('provenance',{})};output.with_suffix('.json').write_text(json.dumps(receipt,indent=2)+'\n');return receipt
if __name__=='__main__':
 q=argparse.ArgumentParser();q.add_argument('--spec',type=pathlib.Path,required=True);q.add_argument('--output',type=pathlib.Path,required=True);q.add_argument('--key',type=pathlib.Path,required=True);q.add_argument('--public-key-name',required=True);a=q.parse_args();print(json.dumps(package(json.loads(a.spec.read_text()),a.output,a.key,a.public_key_name)))
