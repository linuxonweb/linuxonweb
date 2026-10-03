#!/usr/bin/env python3
"""Run real emitter against regenerated Nightly opcode mocks; host-only evidence."""
import argparse, hashlib, json, os, shutil, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--packet',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--cxx',default='c++');a=p.parse_args()
packet=a.packet.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
script=Path(__file__).resolve().parent
manifest=json.loads((packet/'manifest.json').read_text())
assert manifest['pass']
for rec in manifest['files']:
    assert hashlib.sha256((packet/rec['path']).read_bytes()).hexdigest()==rec['sha256'], rec['path']
for rec in manifest['inputs']:
    assert hashlib.sha256(Path(rec['path']).read_bytes()).hexdigest()==rec['sha256'], rec['path']
shutil.copytree(packet/'overlay',out/'adapter')
coverage=manifest.get('coverage', 'integer')
assert coverage in ('integer', 'broad')
fixtures=script if coverage=='integer' else script.parent/'pbl-jit/host-test'
shutil.copyfile(fixtures/'emit.cpp',out/'adapter/host-test/emit.cpp')
(out/'fixtures').mkdir();(out/'tmp').mkdir()
env=os.environ.copy(); env.update({k:str(out/'tmp') for k in ('TMPDIR','TMP','TEMP')})
cmds=[[a.cxx,'-std=c++17','-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer',str(out/'adapter/host-test/emit.cpp'),'-o',str(out/'emit')],[str(out/'emit'),str(out/'fixtures')],['node',str(fixtures/'run.mjs'),str(out/'fixtures')]]
results=[]
for n,cmd in enumerate(cmds):
    r=subprocess.run(cmd,env=env,text=True,capture_output=True)
    (out/f'command{n}.stdout').write_text(r.stdout);(out/f'command{n}.stderr').write_text(r.stderr)
    results.append({'argv':cmd,'exit_code':r.returncode,'stdout':f'command{n}.stdout','stderr':f'command{n}.stderr'})
    if r.returncode: break
report={'pass':len(results)==3 and all(r['exit_code']==0 for r in results),'coverage':coverage,'scope':'host emitter correctness/fallback checks; no Nightly compiler ABI or guest acceptance','packet_manifest_sha256':hashlib.sha256((packet/'manifest.json').read_bytes()).hexdigest(),'task_tmp':str(out/'tmp'),'commands':results,'helper_inputs':[{'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in [fixtures/'emit.cpp',fixtures/'run.mjs',Path(__file__).resolve()]]}
if report['pass']: report['test_result']=json.loads((out/'command2.stdout').read_text().splitlines()[-1])
(out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
raise SystemExit(0 if report['pass'] else 1)
