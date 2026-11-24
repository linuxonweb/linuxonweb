#!/usr/bin/env python3
"""Audit every static ar member occurrence, including duplicate basenames."""
import pathlib,hashlib,json,os
def members(p):
 data=pathlib.Path(p).read_bytes();assert data[:8]==b'!<arch>\n';offset=8;table=b'';out=[]
 while offset<len(data):
  h=data[offset:offset+60];assert h[58:60]==b'`\n';size=int(h[48:58]);name=h[:16].decode().strip();body=data[offset+60:offset+60+size];assert len(body)==size;offset+=60+size+(size&1)
  if name=='//':table=body;continue
  if name in ['/','/SYM64/']:continue
  if name.startswith('/'):
   start=int(name[1:]);end=table.find(b'/\n',start);assert end>=start;name=table[start:end].decode()
  else:name=name.rstrip('/')
  out.append({'name':name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
 assert offset==len(data);return out
if __name__=='__main__':
 T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);a=members(L/'lib/libclangCodeGen.a');b=members(T/'objects/compiler/libclangCodeGen.a');assert len(a)==len(b)
 changed=[i for i,(x,y) in enumerate(zip(a,b)) if x!=y];assert len(changed)==1 and a[changed[0]]['name']=='CGException.cpp.o'
 j={'pass':True,'actualMemberCount':len(a),'unchangedOccurrences':len(a)-1,'changedIndices':changed,'original':a,'owned':b,'initialProvenanceCaveat':'initial llvm-ar p by basename omitted duplicate occurrences; this ordered byte audit supplements original proof'}
 (T/'logs/compiler/archive-ordered-proof.json').write_text(json.dumps(j,indent=2)+'\n');print('ordered ar proof PASS',len(a),'members',changed)
