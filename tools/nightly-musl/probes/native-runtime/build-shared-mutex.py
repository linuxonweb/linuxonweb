#!/usr/bin/env python3
"""Build native/legacy ABI controls without touching historical browser outputs."""
import hashlib, importlib.util, json, os, resource, shutil, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[4]
BUILD = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
TASK = Path('/mnt/p6/project/build/nightly-baseline-guest-20261003')
HERE = Path(__file__).resolve().parent
arm = sys.argv[1]
assert arm in ('native', 'legacy')
OUT = TASK / ('shared-mutex-build-' + arm)
assert not OUT.exists()
OUT.mkdir()
def sha(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
env = dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','fixture',str(BUILD/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
for key in ('TMPDIR','TMP','TEMP'): env[key] = str(TASK/'tmp')
assert shutil.disk_usage(TASK).free > 20*1024**3
def guards():
    resource.setrlimit(resource.RLIMIT_AS, (16*1024**3,16*1024**3))
    resource.setrlimit(resource.RLIMIT_CORE, (0,0))
commands = []
def run(label,args,localenv=env):
    commands.append(dict(label=label,argv=args))
    result = subprocess.run(args,env=localenv,capture_output=True,text=True,timeout=90,preexec_fn=guards)
    (OUT/(label+'.log')).write_text(result.stdout+result.stderr)
    assert result.returncode == 0, result.stderr[-4096:]
    return result.stdout+result.stderr
source = OUT/'shared-mutex-test.cpp'; shutil.copyfile(HERE/source.name, source)
artifact = OUT/'guest-unwind-test.wasm'
runtime = BUILD/'native-unwind/runtimes-build/lib'
archives = {n:sha(runtime/n) for n in ('libc++.a','libc++abi.a','libunwind.a')}
if arm == 'legacy':
    legacy = Path(env['WASM_MUSL_SYSROOT'])/'lib'
    env['NIX_CXXSTDLIB_LINK_wasm32_unknown_linux_musl'] = '-nostdlib++ ' + ' '.join(str(legacy/n) for n in ('libc++.a','libc++abi.a')) + ' ' + str(runtime/'libunwind.a')
argv=[env['CXX'],'-std=c++17','-O2','-Wall','-Wextra','-Werror','-fwasm-exceptions','-Xclang','-fc++-abi=webassembly','-pthread','-matomics','-mbulk-memory','-static',str(source),'-Wl,--import-memory,--export-table,--growable-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(artifact)]
run('driver',[argv[0],'-###',*argv[1:]])
log = run('compile', argv)
if arm == 'native': assert 'function signature mismatch' not in log
else: assert 'function signature mismatch: _ZNSt3__118shared_timed_mutexC1Ev' in log
run('validate',['wasm-validate','--enable-all',str(artifact)])
run('abi',['wasm-objdump','-x',str(artifact)])
spec=importlib.util.spec_from_file_location('package',REPO/'tools/guest-rootfs/package-firefox-nightly.py')
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)
old=BUILD/'native-unwind/guest-build-run5/initramfs.cpio'
archive=OUT/'initramfs.cpio'; unchanged=0; changed=[]
with old.open('rb') as source_file, archive.open('wb') as target:
    for key,fields,body,encoded in package.cpio(source_file):
        if key=='bin/guest-unwind-test':
            target.write(package.encode(key,fields[1],artifact.read_bytes(),fields[0]));changed.append(key)
        else: target.write(encoded);unchanged+=1
assert changed==['bin/guest-unwind-test'] and unchanged==3847
metadata=dict(pass_=True,testOnly=True,arm=arm,artifact=str(artifact),bytes=artifact.stat().st_size,sha256=sha(artifact),
 sourceSha256=sha(source),runtimeArchives=archives,archive=str(archive),archiveBytes=archive.stat().st_size,archiveSha256=sha(archive),
 originalArchiveSha256=sha(old),changedRecords=changed,unchangedRecords=unchanged,
 workerSha256=sha(REPO/'web/linux/dist/worker.js'),guestJitSha256=sha(REPO/'web/linux/dist/guest-jit.js'),
 expectedMutexPasses=20,guestAcceptance=False,browserAcceptance=False,commands=commands)
metadata['pass']=metadata.pop('pass_')
(OUT/'build.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(dict(arm=arm,output=str(OUT),bytes=metadata['bytes'],archiveBytes=metadata['archiveBytes'])))
