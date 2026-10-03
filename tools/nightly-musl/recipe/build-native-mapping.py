"""Replay the accepted native mapping archive compilation in a fresh owned output."""
from pathlib import Path
import hashlib,json,subprocess,shutil
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
 d=json.loads(p.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):assert d['state']=='completed' and d['pgid'] not in groups,p
source=Path('/mnt/p6/project/linux/linuxonweb/web/linux/firefox-shims/mmap-shim.c')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='cf9f7592186c95dbe9589d8e86bd86fd724b8f06f9c539826ca3a3707c621e97'
P=T/'native-mapping-link';assert not P.exists();P.mkdir()
copy=P/'mmap-shim.c';shutil.copyfile(source,copy)
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','mapping',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
obj=P/'mmap-shim.o';archive=P/'libnightly-native-mapping.a'
argv=[env['CC'],'-std=c11','-D_GNU_SOURCE','-pthread','-O2','-I'+str(T/'recipe/shim'),'-c',str(copy),'-o',str(obj)]
for name,args in [('expanded-compiler.log',[*argv,'-###']),('compile.log',argv),('archive.log',[env['AR'],'crs',str(archive),str(obj)])]:
 run=subprocess.run(args,env=env,capture_output=True,text=True,timeout=60);(P/name).write_text(run.stdout+run.stderr);assert run.returncode==0,run.stderr
assert obj.read_bytes()[:8]==b'\0asm\x01\0\0\0'
(P/'replay-command.json').write_text(json.dumps(dict(compile_argv=argv,archive_argv=[env['AR'],'crs',str(archive),str(obj)],source_sha256=hashlib.sha256(copy.read_bytes()).hexdigest(),guestAcceptance=False),indent=2)+'\n')
print(str(archive))
