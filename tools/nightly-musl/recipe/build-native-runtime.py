"""Replay the guest-tested static native runtime adapter; no upstream edits."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys
T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R = Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
P = T/'native-runtime-accepted-run1'
assert not P.exists()
groups = set(subprocess.check_output(['ps','-eo','pgid='],text=True).split())
for p in (T/'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):
        assert d['state']=='completed' and str(d['pgid']) not in groups,p
guest = T/'native-runtime-link/guest-run1/result.json'
acceptance = json.loads(guest.read_text())
assert acceptance['pass'] and acceptance['ownedGroupEmpty'] and acceptance['serverClosed']
assert acceptance['unwind']['passes']==100 and acceptance['unwind']['runtimePasses']==20
build = json.loads((T/'native-runtime-link/guest-build-run2/build.json').read_text())
source = R/'adapters/native-runtime/runtime.c'
assert hashlib.sha256(source.read_bytes()).hexdigest()==build['adapterSha256']
P.mkdir(); copy=P/'runtime.c';shutil.copyfile(source,copy)
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','runtime',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
obj=P/'runtime.o';archive=P/'libnightly-native-runtime.a'
commands=[('compile',[env['CC'],'-std=c11','-O2','-pthread','-Wall','-Wextra','-Werror','-I'+str(T/'native-unwind/include'),'-c',str(copy),'-o',str(obj)]),
          ('validate',['wasm-validate','--enable-all',str(obj)]),('archive',[env['AR'],'crs',str(archive),str(obj)])]
for name,argv in commands:
    run=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=60)
    (P/(name+'.log')).write_text(run.stdout+run.stderr);assert run.returncode==0,run.stderr
def pin(p):return dict(path=str(p),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
(P/'build.json').write_text(json.dumps(dict(pass_=True,source=pin(copy),archive=pin(archive),object=pin(obj),
 guestEvidence=pin(guest),commands=commands,browserLinkAcceptance=False),indent=2)+'\n')
print(str(archive))
