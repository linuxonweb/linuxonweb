"""Run current-header XPTCall code through raw and 23-slot native Wasm modules."""
from pathlib import Path
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R=Path(__file__).resolve().parent
P=Path(sys.argv[1]).resolve()
assert str(P).startswith('/mnt/p6/build/') and not P.exists()
P.mkdir(parents=True);(P/'tmp').mkdir()
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','xpt-probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
for k in ('TMPDIR','TMP','TEMP'):env[k]=str(P/'tmp')
assert 'ext4' in subprocess.check_output(['findmnt','-T',str(P),'-n','-o','FSTYPE'],text=True)
commands=[]
def execute(name,argv,timeout=90):
    r=subprocess.run(argv,capture_output=True,text=True,env=env,timeout=timeout)
    log=P/(name+'.log');log.write_text(r.stdout+r.stderr)
    commands.append(dict(name=name,argv=argv,exitCode=r.returncode,log=str(log)))
    if r.returncode:print((r.stdout+r.stderr)[-5000:]);raise SystemExit(r.returncode)
    return r
log=(T/'logs/xptcall-run1.log').read_text()
rows=[line[line.index('/nix/store/'): ] for line in log.splitlines()
      if ' -c ' in line and line.endswith('/xptcall_wasm32.cpp')]
assert len(rows)==1
argv=shlex.split(rows[0]);flags=[];i=1
while i<len(argv)-1:
    if argv[i] in ('-o','-MF'):i+=2;continue
    if argv[i] in ('-c','-MD','-MP'):i+=1;continue
    flags.append(argv[i]);i+=1
source=P/'probe.cpp';source.write_bytes((R/'probe.cpp').read_bytes())
execute('compile',[argv[0],*flags,'-fno-builtin','-c',str(source),'-o',str(P/'probe.o')])
inputs=[T/'obj-nightly/xpcom/reflect/xptcall/xptcall.o',T/'obj-nightly/xpcom/reflect/xptcall/md/unix/xptcall_wasm32.o',P/'probe.o']
def pin(p):return dict(path=str(p),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
pins=[pin(p) for p in inputs]
for i,p in enumerate(inputs):execute('validate-object-'+str(i),['wasm-validate','--enable-all',str(p)])
execute('link',['wasm-ld','--no-entry','--export=run_case','--export-memory','--export-table','--initial-memory=1048576','-z','stack-size=131072',*[str(p) for p in inputs],'-o',str(P/'probe-raw.wasm')])
execute('fpcast',['wasm-opt','--all-features','--pass-arg=max-func-params@23','--fpcast-emu',str(P/'probe-raw.wasm'),'-o',str(P/'probe-fpcast.wasm')])
for kind in ('raw','fpcast'):execute('validate-'+kind,['wasm-validate','--enable-all',str(P/('probe-'+kind+'.wasm'))])
node=execute('execute',['node',str(R/'probe.cjs'),str(P)])
result=json.loads(node.stdout)
assert result['pass'] and [pin(p) for p in inputs]==pins
report=dict(claim='Actual native Nightly XPTCall objects execute both directions with current headers and an isolated metadata catalog; browser/guest pending',pass_=True,commands=commands,inputs=pins,result=result,source=pin(source),modules=[pin(P/'probe-raw.wasm'),pin(P/'probe-fpcast.wasm')],guestAcceptance=False,browserAcceptance=False,jitAcceptance=False)
report['pass']=report.pop('pass_')
(P/'review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(cases=len(result['cases']),rawWrongSignatureTraps=result['rawWrongSignatureTraps'],review=str(P/'review.json'))))
