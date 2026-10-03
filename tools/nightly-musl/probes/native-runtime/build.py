#!/usr/bin/env python3
"""Build a fresh real guest runtime regression, retaining the accepted EH cases."""
import hashlib, importlib.util, json, os, shutil, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
HERE = Path(__file__).resolve().parent
assert sys.argv[2:] in ([], ['--without-tls-wrap'])
negative = bool(sys.argv[2:])
OUT = T / 'native-runtime-link' / sys.argv[1]
assert sys.argv[1].startswith('guest-build-run') and not OUT.exists()
OUT.mkdir()
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
env = dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','runtime',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
assert shutil.disk_usage(T).free > 20*1024**3
old = T/'native-unwind/guest-build-run5'
prior = json.loads((old/'build.json').read_text())
assert sha(old/'unwind-test.cpp') == prior['sourceSha256']
assert sha(old/'initramfs.cpio') == prior['archiveSha256']
libraries = T/'native-unwind/runtimes-build/lib'
for name, identity in prior['runtimeArchives'].items(): assert sha(libraries/name) == identity
fixture = OUT/'runtime-test.cpp'; shutil.copyfile(HERE/fixture.name,fixture)
runtime = OUT/'runtime.c'; shutil.copyfile(ROOT/'tools/nightly-musl/adapters/native-runtime/runtime.c',runtime)
exception = OUT/'unwind-test.cpp'
original = (old/'unwind-test.cpp').read_text()
assert original.count('int main() {\n  int pass = 0, fail = 0;') == 1
exception.write_text(original.replace('int main() {\n  int pass = 0, fail = 0;', 'int run_exception_fixture(int& pass, int& fail) {\n  pass = fail = 0;'))
commands = []
def run(label,args):
    commands.append(dict(label=label,argv=args))
    result=subprocess.run(args,env=env,capture_output=True,text=True,timeout=90)
    (OUT/(label+'.log')).write_text(result.stdout+result.stderr)
    assert result.returncode==0,result.stderr
run('adapter-compile',[env['CC'],'-std=c11','-O2','-pthread','-Wall','-Wextra','-Werror','-I'+str(T/'native-unwind/include'),'-c',str(runtime),'-o',str(OUT/'runtime.o')])
artifact=OUT/'guest-unwind-test.wasm'
argv=[env['CXX'],'-std=c++17','-O2','-Wall','-Wextra','-Werror','-fwasm-exceptions','-Xclang','-fc++-abi=webassembly','-pthread','-matomics','-mbulk-memory','-static',str(fixture),str(exception),str(OUT/'runtime.o'),'-Wl,--wrap=exit'+('' if negative else ',--wrap=__pthread_tsd_run_dtors'),'-Wl,--import-memory,--export-table,--growable-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(artifact)]
run('guest-driver',[argv[0],'-###',*argv[1:]])
run('guest-compile',argv)
run('validate',['wasm-validate','--enable-all',str(artifact)])
run('abi',['wasm-objdump','-x',str(artifact)])
spec=importlib.util.spec_from_file_location('package',ROOT/'tools/guest-rootfs/package-firefox-nightly.py')
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)
archive=OUT/'initramfs.cpio'; unchanged=0; changed=[]
with (old/'initramfs.cpio').open('rb') as source, archive.open('wb') as target:
    for key,fields,body,encoded in package.cpio(source):
        if key=='bin/guest-unwind-test':
            target.write(package.encode(key,fields[1],artifact.read_bytes(),fields[0]));changed.append(key)
        else: target.write(encoded);unchanged+=1
assert changed==['bin/guest-unwind-test'] and unchanged==3847
metadata=dict(pass_=True,testOnly=True,artifact=str(artifact),bytes=artifact.stat().st_size,sha256=sha(artifact),
              sourceSha256=sha(fixture),adapterSha256=sha(runtime),exceptionSourceSha256=sha(exception),
              originalExceptionSourceSha256=prior['sourceSha256'],runtimeArchives=prior['runtimeArchives'],
              archive=str(archive),archiveBytes=archive.stat().st_size,archiveSha256=sha(archive),
              originalArchiveSha256=prior['archiveSha256'],changedRecords=changed,unchangedRecords=unchanged,
              workerSha256=sha(ROOT/'web/linux/dist/worker.js'),guestJitSha256=sha(ROOT/'web/linux/dist/guest-jit.js'),
              expectedRuntimePasses=20,expectedExceptionPasses=100,negativeWithoutTlsWrap=negative,guestAcceptance=False,browserLinkAcceptance=False,commands=commands)
metadata['pass']=metadata.pop('pass_')
(OUT/'build.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(dict(output=str(OUT),bytes=metadata['bytes'],archiveBytes=metadata['archiveBytes'])))
