#!/usr/bin/env python3
"""Pin selected frozen prerequisites; copy build tools, never GNU target objects."""
import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();R=pathlib.Path(__file__).resolve().parents[3]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
anchors={
 'GLIBC_STAT_RUNTIME_PACKET':'4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042',
 'GLIBC_CUMULATIVE_PACKET':'dcef13c05cbcab8f8ea0dddae7013bbd198d4e2878f0485df597e5286bb9ee09',
 'GLIBC_FINAL16_PACKET':'888d4947e801e9c3ecc5c58c194751964be069c8ed993284c846da4c4c105266',
 'GLIBC_SCHED_SEM_PACKET':'7add20192700d9c544a3fadd192255f3491277d64896ddb1e1b6a3e29432af9a',
 'GLIBC_CHECKED_MAKE_PACKET':'51c9ccab91c1fa6747c70228ad60e48e9344329571674a49dee61c074c9588e3',
 'GLIBC_ARITY_PACKET':'e9002b3d9ef9d00a8df62566e2eabe05cb8f4c391b90343c90f3d75081167095',
 'GLIBC_LAST5_PACKET':'19c1ae05f93df716db260dbf6d16dd1092e3e6d0c9ff757594d1d44117550671',
 'GLIBC_LEGACY_STAT_PACKET':'f4fb6bb8806e20285b25ba3dfae6d29252e939b64ee43c4255de5dd239dd5807',
 'GLIBC_VTABLES_PACKET':'4560bc3586da072fa8e64d8966c8918831142677636b16d8883ae4633d767589',
 'GLIBC_ALIAS_PACKET':'484c458177125e84683da87938340f0c779e9b0106b1e7338e17008ac05b7e4a'}
rows=[];maps={};D=T/'source-snapshots/prerequisites';D.mkdir(parents=True,exist_ok=True)
def retain(p,expected,anchor):
 p=p.resolve();assert digest(p)==expected,(str(p),'frozen prerequisite drift')
 q=D/(expected['sha256']+'-'+p.name)
 if q.exists():assert digest(q)==expected
 else:shutil.copy2(p,q)
 rows.append({'source':str(p),'snapshot':str(q),'verified':expected,'anchor':str(anchor)})
for variable,sha in anchors.items():
 packet=pathlib.Path(os.environ[variable]).resolve();p=packet/'manifest.json'
 assert digest(p)['sha256']==sha;maps[variable]=json.loads(p.read_text())['files']
 rows.append({'source':str(p),'verified':digest(p),'manifestAnchor':True})
 frozen=json.loads((packet/'repository-freeze.json').read_text())
 for name,h in frozen.items():retain(R/name,h,p)
base=maps['GLIBC_STAT_RUNTIME_PACKET'];packet=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']).resolve()
directories={'port','probes','jumps','fullmake','source','fenv','libnames','stat-runtime'}
for name,h in base.items():
 p=pathlib.Path(name)
 if p.is_relative_to(R/'tools/glibc'):
  rel=p.relative_to(R/'tools/glibc')
  if len(rel.parts)==1 or rel.parts[0] in directories:retain(p,h,packet/'manifest.json')
E=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']).resolve()
for directory in [E/'logs/compiler',E/'source-snapshots/compiler',E/'objects/compiler']:
 for p in directory.rglob('*'):
  if p.is_file():retain(p,base[str(p.resolve())],packet/'manifest.json')
proof=E/'logs/compiler/result.json'
for name in json.loads(proof.read_text())['linkArchives']:
 p=pathlib.Path(name).resolve();retain(p,base[str(p)],packet/'manifest.json')
for name in ['compiler/clang','lower','warnings']:
 p=E/'objects'/name;retain(p,base[str(p.resolve())],packet/'manifest.json')
 q=T/'objects'/name;q.parent.mkdir(parents=True,exist_ok=True)
 if q.exists():assert q.is_symlink() and q.resolve()==p.resolve()
 else:q.symlink_to(p)
for name in ['normalize.py','fix-symbol-sizes.py']:
 p=R/'tools/glibc/data-alias'/name;d=digest(p)
 frozen=pathlib.Path(os.environ['GLIBC_ALIAS_PACKET']).resolve()/'repository-source/tools/glibc/data-alias'/name
 assert d==digest(frozen)==maps['GLIBC_ALIAS_PACKET'][str(frozen)]
 q=T/'source-snapshots/alias-tools'/name;q.parent.mkdir(exist_ok=True);q.write_bytes(p.read_bytes())
archive=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).resolve()
assert digest(archive)['sha256']=='37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667'
rows.append({'source':str(archive),'verified':digest(archive),'signedReleaseArchive':True})
(T/'logs/coherent-input-pins.json').write_text(json.dumps({'pass':True,'rows':rows,
 'targetObjectsCopied':0,'memoryRuntime':'pending immutable identity; not consumed'},indent=2)+'\n')
print('Pinned coherent prerequisites',len(rows),'zero GNU target objects copied')
