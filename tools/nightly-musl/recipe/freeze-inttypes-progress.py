"""Read-only retained graph/coherence evidence after an owned phase terminates."""
from pathlib import Path
import json,hashlib,subprocess,sys,time
T=Path(__file__).resolve().parents[1];run=sys.argv[1];previous=sys.argv[2];status_path=T/f'status/build-{run}.json';status=json.loads(status_path.read_text())
assert status['state']=='completed' and str(status['pgid']) not in subprocess.check_output(['ps','-eo','pgid='],text=True).split()
assert status['phase']=='build' and status['run']==run and status['argv'][-2:]==['build','-j4']
output=T/f'status/inttypes-coherence-{run}.json';assert not output.exists()
manifest=T/'status/inttypes-prerequisite-refresh-run1.json';original=json.loads(manifest.read_text());shim=T/'recipe/shim/inttypes.h';assert hashlib.sha256(shim.read_bytes()).hexdigest()==original['adapter_sha256']
assert hashlib.sha256(manifest.read_bytes()).hexdigest()=='307ca97d721c1c5964db27c220346cb0c1661f77d290ada9a14645c588bed3ae'
assert original['count']==len(original['rows'])==len({r['object'] for r in original['rows']})==552
shim_ns=shim.stat().st_mtime_ns; assert all(r['object_mtime_ns']<shim_ns for r in original['rows'])
rows=[]
for r in original['rows']:
 obj=Path(r['object']);dep=Path(r['dependency']);b=dep.read_bytes();st=obj.stat();marker=('\n'+obj.name+': '+str(shim)+'\n').encode()
 fresh=st.st_mtime_ns>max(r['object_mtime_ns'],shim_ns,int(original['checked']*1e9));natural=str(shim).encode() in b and not b.endswith(marker) and b'/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/inttypes.h' in b
 rows.append({'object':str(obj),'mtime_ns':st.st_mtime_ns,'bytes':st.st_size,'fresh_since_refresh':fresh,'native_magic':obj.read_bytes()[:8].hex(),'regenerated_dependency_includes_adapter':natural,'dependency_sha256':hashlib.sha256(b).hexdigest()})
assert all(r['native_magic']=='0061736d01000000' for r in rows)
now_path=T/f'status/full-graph-estimate-{run}.json';before_path=T/f'status/full-graph-estimate-{previous}.json';now=json.loads(now_path.read_text());before=json.loads(before_path.read_text())
new=[{'path':p,**r} for p,r in now['objects'].items() if r['exists'] and not before['objects'][p]['exists']]
rebuilt=[{'path':p,**r} for p,r in now['objects'].items() if r['exists'] and before['objects'][p]['exists'] and r['mtime_ns']>before['objects'][p]['mtime_ns']]
phase_ns=int(status['started']*1e9)
def pin(p):return {'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
report={'claim':'Retained native object progress and exact inttypes consumer rebuild; no linked browser or guest acceptance','checked':time.time(),'run':run,'previous_full_boundary':previous,'terminal_group_empty':True,'required_count':len(rows),'naturally_regenerated_fresh_count':sum(r['fresh_since_refresh'] and r['regenerated_dependency_includes_adapter'] for r in rows),'all_required_consumers_complete':all(r['fresh_since_refresh'] and r['regenerated_dependency_includes_adapter'] for r in rows),'consumers':rows,'new_graph_paths_since_previous_boundary':new,'rebuilt_existing_graph_paths_since_previous_boundary':rebuilt,'new_paths_written_during_phase_count':sum(r['mtime_ns']>=phase_ns for r in new),'new_paths_written_before_phase_count':sum(r['mtime_ns']<phase_ns for r in new),'rebuilt_existing_written_during_phase_count':sum(r['mtime_ns']>=phase_ns for r in rebuilt),'pins':[pin(p) for p in [status_path,manifest,shim,now_path,before_path,T/f'status/build-{run}-boundary.json',T/f'status/build-{run}-group-cleanup.json']]}
report['pins'].append(pin(Path(__file__).resolve()))
output.write_text(json.dumps(report,indent=2));print(json.dumps({k:report[k] for k in ['run','required_count','naturally_regenerated_fresh_count','all_required_consumers_complete','new_paths_written_during_phase_count','new_paths_written_before_phase_count','rebuilt_existing_written_during_phase_count']}))
