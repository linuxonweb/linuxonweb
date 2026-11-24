#!/usr/bin/env python3
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_CHECKED_JUMP_PACKET']);B=pathlib.Path(os.environ['GLIBC_FINAL16_PACKET']);R=pathlib.Path(__file__).resolve().parents[3]
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(P/'manifest.json')['sha256']=='51c9ccab91c1fa6747c70228ad60e48e9344329571674a49dee61c074c9588e3'
assert digest(P/'repository-freeze.json')['sha256']=='f6283ffc63448bd144dbb5dc72bacb0579bb69525310aee3b6d48ced9820d1b8'
m=json.loads((P/'manifest.json').read_text());files=m['files'];assert len(files)==22551
for name,row in files.items():assert digest(pathlib.Path(name))==row,name
base=json.loads((T/'logs/base-inputs.json').read_text());assert base['pass']and len(base['objects'])==231
O=T/'objects/guest';O.mkdir(exist_ok=True);rows=[]
for row in base['objects']:
 p=pathlib.Path(row['copy']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']}
 if p.name=='jump-helpers.o':continue
 q=O/p.name;shutil.copy2(p,q);assert digest(q)==digest(p);rows.append({'original':str(p),'path':str(q),**digest(q),'format':row['format']})
assert len(rows)==230
selected=[]
for rel,name,h in [('objects/fullmake/setjmp/__longjmp.o','GNU-make-__longjmp.o','146712f4d220d9d71b0533ef208287e1de4a072ed36dfdcf620e56235343d65f'),('objects/fullmake/debug/____longjmp_chk.o','GNU-make-____longjmp_chk.o','6436232aaff4c648499bafe40d5d3ed494a98974108857d2ba5f13213d6099d4')]:
 p=P/rel;assert digest(p)['sha256']==h and digest(p)==files[str(p.resolve())]and p.read_bytes()[:8]==b'\0asm\1\0\0\0';q=O/name;shutil.copy2(p,q);assert digest(q)==digest(p);r={'original':str(p),'path':str(q),**digest(q),'format':'Wasm-v1'};rows.append(r);selected.append(r)
helper=R/'tools/glibc/jumps/helpers.c';b=helper.read_bytes();marker=b'/* Checked backend is restricted to known GNU descriptor/linear-stack bounds. */\n';ordinary,checked=b.split(marker)
ordinarysource=P/'source/glibc-2.44/sysdeps/wasm32/__longjmp.c';checkedsource=P/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32/____longjmp_chk.c'
assert ordinarysource.read_bytes()==ordinary
assert checkedsource.read_bytes()==b'#include <setjmp.h>\n#include <tls.h>\n'+marker+checked
attempts=[]
for p in (P/'logs/c-attempts').glob('*/attempt.json'):
 j=json.loads(p.read_text())
 if j['output']in [x['original']for x in selected]and j['pass']:
  assert digest(pathlib.Path(j['sourceSnapshot']))['sha256']==j['sourceSha256']==digest(pathlib.Path(j['source']))['sha256'];assert digest(pathlib.Path(j['driverSnapshot']))['sha256']==j['driverSha256'];assert all(x['exit']==0 for x in j['stages']);attempts.append({'attempt':str(p),**j})
attempts=[max([x for x in attempts if x['output']==r['original']],key=lambda x:pathlib.Path(x['attempt']).stat().st_mtime_ns)for r in selected]
assert len(attempts)==2
(T/'logs/selected-inputs.json').write_text(json.dumps({'pass':True,'objects':rows,'selected':selected,'providerSourceScope':'genuine GNUmake selection of owned Wasm architecture provider units; accepted native bodies byte-preserved, not newly upstream GNU algorithms','ordinarySource':str(ordinarysource),'checkedSource':str(checkedsource),'ordinaryBodyPreserved':True,'checkedBodyPreserved':True,'makeAttempts':attempts,'sourceManifest':str(P/'manifest.json'),'sourceManifestSha256':digest(P/'manifest.json')['sha256']},indent=2)+'\n');print('Exact GNUmake providers, preserved native bodies and232 runtime objects PASS')
