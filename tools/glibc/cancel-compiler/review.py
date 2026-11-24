#!/usr/bin/env python3
"""Independently reread source/archive/runtime/native artifacts for this bounded subset."""
from common import *
import importlib.util,re,shlex
R=pathlib.Path(__file__).resolve().parent;O=T/'objects/controls'
spec=importlib.util.spec_from_file_location('independent_ar',R.parent/'c-cleanup/archive-audit.py');ar=importlib.util.module_from_spec(spec);spec.loader.exec_module(ar)
changes=json.loads((T/'source-changes.json').read_text())
assert sha(T/'compiler.patch')=='67473abb362e308fef395f80baffdabb8e5baa8572222b457fefb879911cec40'
for rel,row in changes.items():assert sha(S/rel)==row['original'] and sha(row['path'])==row['owned']
archives=json.loads((T/'logs/archive-proof.json').read_text())
for proof in archives:
 assert ar.members(proof['base'])==proof['before'] and ar.members(proof['owned'])==proof['after']
 assert sha(proof['base'])==proof['baseSha256'] and sha(proof['owned'])==proof['ownedSha256']
inputs=json.loads((T/'logs/link-inputs.json').read_text());assert all(sha(p)==h for p,h in inputs.items())
results=json.loads((T/'test-result.json').read_text());assert results['pass']
for level in ['O0','O2','O3']:
 result=json.loads((T/'logs'/(level+'-runtime.json')).read_text());assert result==results['results'][level] and result['failed']==0
 assert result['passed']==(624 if level=='O0' else 640)
 assert len(result['escapingStackLeaks'])==80
 for source in ['controls.c','controls.cpp']:
  p=O/(level+'-'+source+'.ll');text=p.read_text();attrs={n:a for n,a in re.findall(r'^attributes #(\d+) = (.+)$',text,re.M)}
  defs=re.findall(r'^define .*? #([0-9]+).*?\{$',text,re.M);assert defs
  assert all('"wasm-gnu-cancel-prerequisite"="1"' in attrs[n] for n in defs)
  assembly=(O/(level+'-'+source+'.s')).read_text();assert 'call\t__wasm_gnu_caller_sp_v1' not in assembly
  run('review-nm-'+level+'-'+source,[L/'bin/llvm-nm','--format=posix',O/(level+'-'+source+'.o')])
  log=sorted((T/'logs').glob('review-nm-'+level+'-'+source+'*.log'),key=lambda p:p.stat().st_mtime)[-1].read_text();assert '__wasm_gnu_caller_sp_v1' not in log
 run('disassemble-'+level,[L/'bin/llvm-objdump','--disassemble',O/(level+'.wasm')])
# All actual dependencies of retained current frontend/backend/control compiles.
paths=set(pathlib.Path(p) for p in inputs)
for p in list((T/'logs').glob('*.d'))+list(O.glob('*.d')):
 text=p.read_text().replace('\\\n',' ')
 for token in shlex.split(text.partition(':')[2]):
  q=pathlib.Path(token)
  if q.is_file():paths.add(q.resolve())
for rel,row in changes.items():paths.update([S/rel,pathlib.Path(row['path'])])
paths.update([P/'clang',T/'objects/compiler/clang',T/'compiler.patch',T/'source-changes.json'])
borrowedFailure=pathlib.Path('/mnt/p6/build/glibc-native-static-loader-20261002/logs/routes-results.json')
paths.add(borrowedFailure)
snapshot=T/'source-snapshots'/('borrowed-tag1-'+sha(borrowedFailure)+'.json')
if not snapshot.exists():shutil.copyfile(borrowedFailure,snapshot)
assert sha(snapshot)==sha(borrowedFailure);paths.add(snapshot)
manifest={str(p):sha(p) for p in sorted(paths)};assert all(sha(p)==h for p,h in manifest.items())
(T/'actual-inputs.json').write_text(json.dumps(manifest,indent=2)+'\n')
commands=[]
for p in sorted((T/'logs').glob('*.command.json')):
 row=json.loads(p.read_text());assert row['status']=='terminal' and not row['groupMembers'] and not group(row['pgid']);commands.append({'path':str(p),'sha256':sha(p),'pid':row['pid'],'pgid':row['pgid'],'exit':row['exit']})
assert not group(23133)
repo={str(p):sha(p) for p in sorted(R.iterdir()) if p.is_file()}
doc=R.parents[2]/'docs/glibc-cancel-compiler-20261002.md';repo[str(doc)]=sha(doc)
review={'subsetPass':True,'fullCompilerPacketAccepted':False,'patch':sha(T/'compiler.patch'),'compiler':sha(T/'objects/compiler/clang'),'runtime':{level:{'passed':results['results'][level]['passed'],'failed':0,'module':sha(O/(level+'.wasm')),'result':sha(T/'logs'/(level+'-runtime.json'))} for level in ['O0','O2','O3']},'archiveProof':sha(T/'logs/archive-proof.json'),'inputCount':len(manifest),'actualInputs':sha(T/'actual-inputs.json'),'repository':repo,'commands':commands,'storage':budget(),'limits':['no general descriptors or CFA/context API','no escaping-exception global SP restoration:80 observed leaks each mode','no tag1/SjLj correction; prior loader failure retained','no final optimization-introduced-loop coverage verifier','no inline/tailcall handoff; mode forces noinline and disables tail calls','original LTO backend fails on reserved marker; no private LTO linker','diagnostic mode-off poll/fatal boundary only; no GNU cancellation/libunwind runtime','no kernel/browser/public pthread lifecycle or Nightly/JIT/GPU acceptance']}
(T/'review.json').write_text(json.dumps(review,indent=2)+'\n');print(json.dumps({'subsetPass':True,'fullCompilerPacketAccepted':False,'inputs':len(manifest),'commandGroups':len(commands),'storage':budget()}))
