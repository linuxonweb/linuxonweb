#!/usr/bin/env python3
"""Reject known private grant/key values and device IDs in a public export.
Only paths and aggregate counts are printed; no credential value is logged.
"""
import argparse,base64,hashlib,json,pathlib,re,tarfile,urllib.parse
q=argparse.ArgumentParser();q.add_argument('--public',type=pathlib.Path,required=True);q.add_argument('--private-preview',type=pathlib.Path,required=True);q.add_argument('--private-backup-root',type=pathlib.Path,required=True);q.add_argument('--device-ids-file',type=pathlib.Path);a=q.parse_args();needles=set()
def add(v):
 if isinstance(v,str)and len(v)>=20:
  needles.add(v.encode())
  if v.startswith('https://'):
   u=urllib.parse.urlsplit(v)
   for x in u.path.split('/'):
    if len(x)>=24:needles.add(x.encode())
   for k,x in urllib.parse.parse_qsl(u.query):
    if len(x)>=20:needles.add(x.encode())
def walk(v,key=''):
 if isinstance(v,dict):
  for k,x in v.items():walk(x,k)
 elif isinstance(v,list):
  for x in v:walk(x,key)
 elif isinstance(v,str)and any(x in key.lower()for x in ['token','secret','cookie','grant','authorization','url']):add(v)
for name in ['owner-key','cookie-key']:
 p=a.private_preview/name
 if p.is_file():needles.add(p.read_bytes().strip())
for p in a.private_preview.glob('*grant*.json'):
 try:walk(json.loads(p.read_text()))
 except (ValueError,OSError):pass
for d in a.private_backup_root.glob('private-*'):
 p=d/'resume.json'
 if p.is_file():walk(json.loads(p.read_text()))
if a.device_ids_file:
 for x in a.device_ids_file.read_text().splitlines():
  if x.strip():needles.add(x.strip().encode())
private_pem=re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}')
failed=[];checked=0
def scan(name,data):
 global checked
 checked+=1
 if private_pem.search(data)or any(n and n in data for n in needles):failed.append(name)
def file(p):
 if p.name.endswith(('.tar.gz','.tgz')):
  with tarfile.open(p,'r:gz')as t:
   for m in t:
    if m.isfile():scan(str(p)+'!'+m.name,t.extractfile(m).read())
 elif p.suffix in ['.json','.md','.txt','.html','.mjs','.js','.py','.pem','.crt']:scan(str(p),p.read_bytes())
if a.public.is_dir():
 for p in a.public.rglob('*'):
  if p.is_file():file(p)
else:file(a.public)
result={'pass':not failed,'checkedFilesAndArchiveMembers':checked,'privateValueCount':len(needles),'failedPaths':failed,'scope':'Known preview/backup secret values, explicit device identifiers and literal private PEM bodies; not a general guarantee against every possible secret.'};print(json.dumps(result));raise SystemExit(0 if not failed else 1)
