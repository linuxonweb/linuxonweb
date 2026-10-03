#!/usr/bin/env python3
"""Compile isolated overlay against current generated headers; not a PBL full build.
Invoke with frozen musl environment sourced. Dry-run argv is diagnostic provenance.
"""
import argparse, hashlib, json, os, shlex, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--packet',type=Path,required=True);p.add_argument('--dry-run',type=Path,required=True);p.add_argument('--objdir',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--unit',action='append');a=p.parse_args()
packet=a.packet.resolve();obj=a.objdir.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);(out/'tmp').mkdir();(out/'deps').mkdir()
manifest=json.loads((packet/'manifest.json').read_text())
for rec in manifest['files']:
    assert hashlib.sha256((packet/rec['path']).read_bytes()).hexdigest()==rec['sha256'], rec['path']
lines=a.dry_run.read_text().splitlines();commands=[shlex.split(l) for l in lines if 'clang++ -std=' in l]
assert len(commands)==1; original=commands[0]
assert 'wasm32-unknown-linux-musl' in original[0]
assert not any('__wasi__' in x for x in original)
config=(obj/'mozilla-config.h').read_text();assert '#define JS_CODEGEN_NONE 1' in config and '#define JS_NUNBOX32 1' in config
localconfig=out/'mozilla-config.h';localconfig.write_text(config+'\n// Diagnostic overlay only; fresh PBL configure remains mandatory.\n#define ENABLE_PORTABLE_BASELINE_INTERP 1\n')
base=[];i=0
while i<len(original):
    v=original[i]
    if v in ['-o','-MF']:i+=2;continue
    if v in ['-MD','-MP']:i+=1;continue
    if v.endswith('.cpp'):i+=1;continue
    if v==str(obj/'mozilla-config.h'):v=str(localconfig)
    base.append(v);i+=1
# Keep baseline flags; no native x86, WASI, exception/TLS/ABI flag substitution.
env=os.environ.copy();env.update({k:str(out/'tmp') for k in ['TMPDIR','TMP','TEMP']})
results=[]
for rel in (a.unit or ['PblJit.cpp','js/src/vm/PortableBaselineInterpret.cpp','js/src/jit/Jit.cpp']):
    src=packet/'overlay'/rel;name=src.stem;dest=out/(name+'.o')
    cmd=base+['-MD','-MP','-MF',str(out/'deps'/(name+'.pp')),'-o',str(dest),str(src)]
    r=subprocess.run(cmd,cwd=out,env=env,text=True,capture_output=True)
    (out/(name+'.stdout')).write_text(r.stdout);(out/(name+'.stderr')).write_text(r.stderr)
    result={'source':str(src),'argv':cmd,'cwd':str(out),'exit_code':r.returncode,'stderr':name+'.stderr','source_sha256':hashlib.sha256(src.read_bytes()).hexdigest()}
    if dest.exists():result.update({'object_bytes':dest.stat().st_size,'object_sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
    results.append(result)
    print(json.dumps({'source':rel,'exit_code':r.returncode}),flush=True)
report={'pass':all(r['exit_code']==0 for r in results),'scope':'actual musl wasm C++ diagnostic against baseline generated headers plus isolated ENABLE_PORTABLE_BASELINE_INTERP header; no full PBL configuration/link/runtime','command_provenance':'read-only make -n source-context compile command, native Wasm musl wrapper with frozen environment','packet_manifest_sha256':hashlib.sha256((packet/'manifest.json').read_bytes()).hexdigest(),'baseline_config_sha256':hashlib.sha256((obj/'mozilla-config.h').read_bytes()).hexdigest(),'diagnostic_config_sha256':hashlib.sha256(localconfig.read_bytes()).hexdigest(),'results':results}
(out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'pass':report['pass'],'output':str(out)}))
raise SystemExit(0 if report['pass'] else 1)
