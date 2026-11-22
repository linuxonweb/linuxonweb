#!/usr/bin/env python3
"""Relink immutable consumer13 objects with a separately reviewed producer packet."""
import sys
sys.dont_write_bytecode=True
import argparse,importlib.util,json,shutil
from pathlib import Path
from common_consumer13 import T,R,L,pin,run

parser=argparse.ArgumentParser()
parser.add_argument('--peer',required=True)
parser.add_argument('--version',required=True,type=int)
parser.add_argument('--execute-reviewed-plan')
args=parser.parse_args()
peer=Path(args.peer).resolve()
assert peer.is_relative_to(T.parent) and peer.name.startswith('module4-proposal-')
stem=f'consumer13-reuse-{args.version}'
planfile=T/'logs'/(stem+'-plan.json')
owned=T/'objects'/stem
previous=json.loads((T/'logs/consumer13-continuation-build-plan.json').read_text())
existing=T/'objects/compiler-consumer13-continuation'
if not args.execute_reviewed_plan:
 assert not planfile.exists() and not owned.exists()
 result=json.loads((peer/'build-result.json').read_text())
 assert result['compiled'] and not result['runtimeAcceptance']
 assert pin(result['compiler'])['sha256']==result['sha256']
 link=list(next(s['argv'] for s in result['stages'] if s['name']=='link-owned-driver'))
 link[link.index('-o')+1]=str(owned/'clang')
 positions={name:[i for i,p in enumerate(link) if Path(p).name==name]
            for name in ['libLLVMCodeGen.a','libLLVMWebAssemblyCodeGen.a']}
 assert all(len(v)==1 for v in positions.values())
 codegenbase=link[positions['libLLVMCodeGen.a'][0]]
 assert pin(codegenbase)==pin(previous['archiveBases']['libLLVMCodeGen.a'])
 targetbase=link[positions['libLLVMWebAssemblyCodeGen.a'][0]]
 link[positions['libLLVMCodeGen.a'][0]]=str(existing/'libLLVMCodeGen.a')
 link[positions['libLLVMWebAssemblyCodeGen.a'][0]]=str(owned/'libLLVMWebAssemblyCodeGen.a')
 # Consumer compilation inputs must remain unchanged. Reference retained
 # snapshots, rather than duplicating the immutable predecessor corpus.
 rows=list(previous['pins'])
 known={row['path'] for row in rows}
 additional={Path(p) for p in link if Path(p).is_file()}
 additional.update([Path(targetbase),Path(codegenbase),Path(result['compiler']),
  existing/'libLLVMCodeGen.a',existing/'WasmEHPrepare.cpp.o',
  Path(previous['precompiledCFGObject']),peer/'prepared.json',peer/'build-result.json',
  peer/'compiler.patch',R/'compose-consumer13-reuse.py',R/'common_consumer13.py',
  L/'bin/llvm-ar',R.parent/'c-cleanup/archive-audit.py'])
 for pair in json.loads((peer/'prepared.json').read_text())['sourcePairs'].values():
  additional.update(Path(pair[key]) for key in ['path','basis','basisSnapshot'] if key in pair)
 snapshots=T/'source'/(stem+'-plan');snapshots.mkdir()
 for index,path in enumerate(sorted(additional)):
  if str(path) in known:continue
  row={'path':str(path),**pin(path)}
  if path.stat().st_size<8388608 and path.suffix in {'.cpp','.py','.h','.json','.patch'}:
   snapshot=snapshots/f'{index}-{path.name}';snapshot.write_bytes(path.read_bytes())
   row['snapshot']=str(snapshot)
  rows.append(row)
 for row in rows:
  assert pin(row['path'])['sha256']==row['sha256'],row['path']
  if 'snapshot' in row:assert pin(row['snapshot'])['sha256']==row['sha256']
 plan={'runtimeAcceptance':False,'timeoutSecondsPerStage':300,'capBytes':2147483648,
       'peer':str(peer),'peerCompiler':result['compiler'],'peerCompilerSha256':result['sha256'],
       'targetBase':targetbase,'cfgObject':previous['precompiledCFGObject'],
       'unchangedConsumerCodeGen':str(existing/'libLLVMCodeGen.a'),
       'replacements':['WebAssemblyCFGStackify.cpp.o'],'linkCommand':link,'pins':rows,
       'compileCommands':[],'afterAdapterLTO':False}
 planfile.write_text(json.dumps(plan,indent=2)+'\n')
 print(json.dumps({'plan':str(planfile),**pin(planfile),'pins':len(rows)},indent=2))
else:
 assert pin(planfile)['sha256']==args.execute_reviewed_plan
 plan=json.loads(planfile.read_text())
 for row in plan['pins']:
  assert pin(row['path'])['sha256']==row['sha256'],row['path']
  if 'snapshot' in row:assert pin(row['snapshot'])['sha256']==row['sha256']
 owned.mkdir(exist_ok=False)
 spec=importlib.util.spec_from_file_location('ar',R.parent/'c-cleanup/archive-audit.py')
 ar=importlib.util.module_from_spec(spec);spec.loader.exec_module(ar)
 base=Path(plan['targetBase']);before=ar.members(base)
 target=owned/'libLLVMWebAssemblyCodeGen.a';shutil.copyfile(base,target)
 run(stem+'-replace',[L/'bin/llvm-ar','r',target,plan['cfgObject']])
 after=ar.members(target)
 assert [row['name'] for row in before]==[row['name'] for row in after]
 changed=[i for i,(a,b) in enumerate(zip(before,after)) if a!=b]
 assert [before[i]['name'] for i in changed]==plan['replacements']
 (T/'logs'/(stem+'-archive-proof.json')).write_text(json.dumps(
  {'base':str(base),'owned':str(target),'before':before,'after':after,
   'changedIndices':changed,**pin(target)},indent=2)+'\n')
 run(stem+'-link',plan['linkCommand'])
 run(stem+'-version',[owned/'clang','--version'])
 for row in plan['pins']:assert pin(row['path'])['sha256']==row['sha256']
 (T/'logs'/(stem+'-result.json')).write_text(json.dumps(
  {'compiled':True,'runtimeAcceptance':False,'compiler':str(owned/'clang'),
   'planSha256':args.execute_reviewed_plan,**pin(owned/'clang')},indent=2)+'\n')
