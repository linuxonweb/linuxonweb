#!/usr/bin/env python3
"""Audit the genuine GNU make result and metadata-only alias correction."""
import hashlib,json,os,pathlib,re,shlex,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
out=T/'objects/fullmake/libio/vtables.o';dest=T/'logs/vtables-audit.json';assert not dest.exists()
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
def u(data,p):
 value=shift=0
 while True:
  b=data[p];p+=1;value|=(b&127)<<shift
  if b<128:return value,p
  shift+=7;assert shift<35
def sections(data):
 assert data[:8]==b'\0asm\1\0\0\0';p=8;rows=[]
 while p<len(data):
  kind=data[p];size,start=u(data,p+1);end=start+size;assert end<=len(data);raw=data[start:end];name=None
  if kind==0:
   count,q=u(raw,0);name=raw[q:q+count].decode()
  rows.append((kind,name,raw));p=end
 assert p==len(data);return rows
j=json.loads((T/'logs/vtables-make.json').read_text());assert j['exit']==0 and digest(out)=={k:j['output'][k] for k in ['bytes','sha256']}
attempts=[]
for p in (T/'logs/c-attempts').glob('*/attempt.json'):
 a=json.loads(p.read_text())
 if a['source']==str(S/'libio/vtables.c'):attempts.append((p,a))
assert len(attempts)==1;p,a=attempts[0];work=p.parent
assert a['pass'] and all(row['exit']==0 for row in a['stages'])
assert digest(pathlib.Path(a['driverSnapshot']))['sha256']==a['driverSha256']
source=S/'libio/vtables.c';pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44/libio/vtables.c'
assert source.read_bytes()==pristine.read_bytes()==pathlib.Path(a['sourceSnapshot']).read_bytes()
before=sections((work/'backend.o').read_bytes());after=sections(out.read_bytes());assert len(before)==len(after)
unchanged=[];changed=[]
for n,(x,y) in enumerate(zip(before,after)):
 assert x[:2]==y[:2]
 row={'index':n,'kind':x[0],'name':x[1],'bytes':len(y[2]),'sha256':hashlib.sha256(y[2]).hexdigest()}
 if x[2]!=y[2]:assert x[:2]==(0,'linking');changed.append(row)
 else:unchanged.append(row)
assert len(changed)==1 and any(r['kind']==10 for r in unchanged) and any(r['kind']==11 for r in unchanged)
assert any((r['name'] or '').startswith('reloc.') for r in unchanged)
cmd=[str(L/'llvm-readobj'),'--symbols',str(out)];text=subprocess.check_output(cmd,text=True)
(T/'logs/vtables-symbols.txt').write_text(text)
aliases={}
for name,offset in [('_IO_file_jumps',168),('_IO_wfile_jumps',420),('__io_vtables',0)]:
 blocks=[b for b in text.split('Symbol {')[1:] if re.search(r'\bName: '+re.escape(name)+r'\n',b)]
 assert len(blocks)==1;b=blocks[0].split('\n  }',1)[0]
 assert 'Type: DATA (0x1)' in b and 'BINDING_WEAK' not in b and 'UNDEFINED' not in b
 actual=int(re.search(r'Offset: (0x[0-9A-Fa-f]+|\d+)',b)[1],0);size=int(re.search(r'Size: (0x[0-9A-Fa-f]+|\d+)',b)[1],0)
 assert actual==offset and size==(1176 if name=='__io_vtables' else 84)
 assert ('VISIBILITY_HIDDEN' in b)==(name=='__io_vtables')
 aliases[name]={'offset':actual,'size':size,'segment':int(re.search(r'Segment: (\d+)',b)[1]),'hidden':name=='__io_vtables'}
assert len({r['segment'] for r in aliases.values()})==1
ir=(work/'aliases.ll').read_text();raw=(work/'front.ll').read_text()
assert len(re.findall(r'^module asm ',raw,re.M))==8 and not re.search(r'^module asm ',ir,re.M)
for name,offset in [('_IO_file_jumps',168),('_IO_wfile_jumps',420)]:
 assert re.search(r'^@'+name+r' = alias .*@__io_vtables.*i32 '+str(offset)+r'\)',ir,re.M),name
validate=['wasm-validate','--enable-all',str(out)];v=subprocess.run(validate,capture_output=True,text=True)
(T/'logs/vtables-validate.txt').write_text(v.stdout+v.stderr);assert v.returncode==0
headers={};dep=T/'objects/fullmake/libio/vtables.o.dt'
for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
 q=pathlib.Path(word.removesuffix(':'))
 if not q.is_absolute():q=pathlib.Path(a['cwd'])/q
 if q.is_file():headers[str(q.resolve())]=digest(q)
assert str(source) in headers
report={'pass':True,'scope':'one actual GNU make unit and native alias metadata; not stdio runtime or full libc acceptance',
 'make':j,'attempt':str(p),'source':digest(source),'object':digest(out),'aliases':aliases,
 'unchangedSections':unchanged,'changedLinkingSection':changed,'headers':headers,
 'readobjCommand':cmd,'validationCommand':validate,'validationExit':v.returncode,
 'undefinedGNUProvidersRetained':True,'unresolvedSuppression':False}
dest.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'pass':True,'object':report['object'],'aliases':aliases,'headers':len(headers),'unchangedSections':len(unchanged)}))
