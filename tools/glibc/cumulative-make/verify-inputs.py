#!/usr/bin/env python3
"""Pin borrowed cumulative adapters and binaries to the accepted runtime freeze."""
import hashlib,json,os,pathlib,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']);R=pathlib.Path(__file__).resolve().parents[3]
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4194304),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':p.stat().st_size}
assert digest(P/'manifest.json')['sha256']=='4cdac038bc83c699a429e3f649f175d9c7511c62520b5bd6dd2936bda6f76042'
m=json.loads((P/'manifest.json').read_text())['files'];rows=[];D=T/'source-snapshots/borrowed-tools';D.mkdir(parents=True,exist_ok=True)
paths=subprocess.check_output(['git','ls-files','tools/glibc'],cwd=R,text=True).splitlines()
paths=sorted(set(paths)|{n for n in json.loads((P/'repository-freeze.json').read_text()) if n.startswith('tools/glibc/stat-runtime/')})
# Read only committed predecessor tools; no mutable sched-sem or unrelated trees.
for name in paths:
 rel=pathlib.Path(name).relative_to('tools/glibc');first=rel.parts[0]
 if len(rel.parts)>1 and first not in ['port','probes','source','jumps','fullmake','fenv','libnames','stat-runtime','syscalls-next26']:continue
 p=R/name;key=str(p.resolve())
 if key not in m:continue
 d=digest(p);assert d==m[key],name
 q=D/rel;q.parent.mkdir(parents=True,exist_ok=True);assert not q.exists() or q.read_bytes()==p.read_bytes();q.write_bytes(p.read_bytes())
 rows.append({'source':str(p),'snapshot':str(q),'verified':d})
required=['replay-source.sh','env.sh','jumps/prepare.py','fullmake/prepare.py','libnames/overlay.py','libnames/pthreadP.h','stat-runtime/kernel_stat.h','stat-runtime/statx_cp.c']
assert all(str(R/'tools/glibc'/n) in [r['source'] for r in rows] for n in required)
for n in ['compiler/clang','lower','warnings']:
 p=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET'])/'objects'/n;assert digest(p)==m[str(p.resolve())]
 q=T/'objects'/n;q.parent.mkdir(exist_ok=True);q.symlink_to(p)
 rows.append({'source':str(p),'ownedSymlink':str(q),'verified':digest(p)})
# The unchanged compiler archive closure remains an explicit verified prerequisite.
C=pathlib.Path(os.environ['GLIBC_C_CLEANUP_PACKET']);proof=C/'logs/compiler/result.json';assert digest(proof)==m[str(proof)]
for n in json.loads(proof.read_text())['linkArchives']:
 p=pathlib.Path(n);assert digest(p)==m[str(p.resolve())];rows.append({'source':str(p),'verified':digest(p)})
(T/'logs/borrowed-inputs.json').write_text(json.dumps({'pass':True,'anchor':str(P/'manifest.json'),'rows':rows},indent=2)+'\n')
