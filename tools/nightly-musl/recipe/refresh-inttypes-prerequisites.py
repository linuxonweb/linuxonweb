from pathlib import Path
import subprocess,json,hashlib,time,shutil
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');O=T/'obj-nightly';P=T/'inttypes-prerequisite-backup';inventory=T/'status/inttypes-consumer-inventory-run1.json';shim=T/'recipe/shim/inttypes.h'
def sha(b):return hashlib.sha256(b).hexdigest()
def empty():
 active={int(x) for x in subprocess.check_output(['ps','-eo','pgid='],text=True).split()}
 for p in (T/'status').glob('*.json'):
  r=json.loads(p.read_text())
  if isinstance(r,dict) and 'phase' in r and 'state' in r and 'pgid' in r:assert r['state']=='completed' and r['pgid'] not in active
empty();assert not P.exists();r=json.loads(inventory.read_text());todo=[]
for row in r['consumers']:
 if row['adapter_in_dependency']:continue
 obj=Path(row['object']);dep=Path(row['dependency']);rel=obj.relative_to(O)
 assert obj.resolve().is_relative_to(O.resolve()) and dep.resolve().is_relative_to(O.resolve())
 b=dep.read_bytes();assert sha(b)==row['dependency_sha256'];assert b.split(b':',1)[0].decode().strip()==obj.name
 st=obj.stat();assert st.st_size==row['object_bytes'] and st.st_mtime_ns==row['object_mtime_ns']
 assert obj.read_bytes()[:8]==b'\0asm\x01\0\0\0';assert str(shim).encode() not in b
 addition=('\n'+obj.name+': '+str(shim)+'\n').encode();backup=P/'deps'/dep.relative_to(O)
 todo.append((dep,b,b+addition,backup,dict(row,object_sha256=sha(obj.read_bytes()),object_inode=st.st_ino,backup=str(backup),before_sha256=sha(b),after_sha256=sha(b+addition))))
assert len(todo)==552;empty();P.mkdir()
for dep,b,new,backup,row in todo:backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes(b)
empty()
for dep,b,new,backup,row in todo:assert dep.read_bytes()==b;dep.write_bytes(new)
proof={'claim':'Exact additional native object prerequisites only; all original dependency bytes preserved. Regenerated dependencies/output freshness still required','checked':time.time(),'inventory_sha256':sha(inventory.read_bytes()),'adapter_sha256':sha(shim.read_bytes()),'groups_empty_before_mutation':True,'count':len(todo),'rows':[row for dep,b,new,backup,row in todo]}
(T/'status/inttypes-prerequisite-refresh-run1.json').write_text(json.dumps(proof,indent=2));print(json.dumps({'count':len(todo),'backup_bytes':sum(len(b) for dep,b,new,backup,row in todo),'path':str(T/'status/inttypes-prerequisite-refresh-run1.json')}))
