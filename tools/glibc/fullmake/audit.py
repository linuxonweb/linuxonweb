#!/usr/bin/env python3
import pathlib,os,json,hashlib,re,subprocess
t=pathlib.Path(os.environ['GLIBC_TASK']);tool=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def leb(b,i):
 value=shift=0
 while True:
  c=b[i];i+=1;value|=(c&127)<<shift
  if not c&128:return value,i
  shift+=7
def customs(p):
 b=p.read_bytes();assert b[:8]==b'\0asm\1\0\0\0';i=8;result={}
 while i<len(b):
  kind=b[i];i+=1;size,i=leb(b,i);end=i+size
  if kind==0:
   n,j=leb(b,i);name=b[j:j+n].decode();assert name not in result;result[name]=b[j+n:end]
  i=end
 return result
checks=[]
proofs=list((t/'logs/warning-units').rglob('front.ll'))
for name,stub in [('revoke',True),('sigreturn',True),('sigstack',False),('dlmopen',False)]:
 if name=='dlmopen':
  p=t/'objects/metadata-tests/dlmopen-metadata-only.o';front=next(x for x in (t/'tmp').glob('fullmake-cc-*/front.ll') if 'warning.dlmopen' in x.read_text())
 else:
  p=t/('objects/guest/warning-'+name+'.o');front=next(x for x in proofs if '@__evoke_link_warning_'+name+' =' in x.read_text())
 text=re.search(r'@__evoke_link_warning_'+name+r' = .*? c"(.*?)", section',front.read_text()).group(1)
 expected=re.sub(r'\\([0-9A-Fa-f]{2})',lambda m:chr(int(m[1],16)),text).encode('latin1')
 sections=customs(p);assert sections['.gnu.warning.'+name]==expected
 assert ('.gnu.glibc-stub.'+name in sections)==stub
 if stub:assert sections['.gnu.glibc-stub.'+name]==b''
 checks.append({'name':name,'warningBytes':len(expected),'exactBytes':True,'stub':stub,'object':str(p),'sha256':sha(p),'runtimeCompiled':name!='dlmopen'})
objects=sorted((t/'objects/guest').glob('*.o'));assert not (t/'objects/guest/wasm-basic-syscalls.o').exists()
symbols={p.name:subprocess.check_output([str(tool/'llvm-nm'),'--defined-only',str(p)],text=True) for p in objects if p.name.startswith('warning-')}
assert '__sigaltstack' in symbols['warning-sigaltstack.o'] and 'sigaltstack' in symbols['warning-sigaltstack.o']
modules={str(t/'objects'/n):sha(t/'objects'/n) for n in ['fullmake-warnings.wasm','fullmake-warnings-fpcast.wasm']}
(t/'logs/warning-object-audit.json').write_text(json.dumps({'pass':True,'customSections':checks,'objects':{str(p):sha(p) for p in objects},'symbols':symbols,'modules':modules,'noOwnedPidThunks':True},indent=2)+'\n')
