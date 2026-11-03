#!/usr/bin/env python3
"""Compile the original native JIT fixture into a minimal isolated guest image."""
import argparse,pathlib,json,hashlib,subprocess,sys,importlib.util,time
sys.dont_write_bytecode=True
p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--current-abi',action='store_true');a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);start=time.time();root=pathlib.Path(__file__).resolve().parents[2]
source=root/'web/linux/tests/guest-jit/jit-test.c';frozen=out/'jit-test.c';code=source.read_text()
# The historical fixture predates PRIVATE=1. Keep its source and results intact;
# an explicit additional fixture checks the existing ABI instead of hiding it.
if a.current_abi:
 assert 'export const JIT_INSTALL_PRIVATE = 1;' in (root/'web/linux/dist/guest-jit.js').read_text()
 old='        CHECK("reject flags", syscall(SYS_jit_install, m0.p, m0.n, 1, &out) == -1 && errno == EINVAL);'
 new='''        uint32_t before_private[12], after_private[12];
        CHECK("private before stats", syscall(SYS_jit_stats, before_private) == 0);
        CHECK("accept private flag", syscall(SYS_jit_install, m0.p, m0.n, 1, &out) == 0);
        CHECK("private function callable", ((fn1)(uintptr_t)out)(23) == 24);
        CHECK("private after stats", syscall(SYS_jit_stats, after_private) == 0);
        CHECK("private not published", before_private[0] == after_private[0]);
        errno = 0;
        CHECK("private free is unsupported", syscall(SYS_jit_free, out, 1) == -1 && errno == EINVAL);
        CHECK("private remains callable after refused free", ((fn1)(uintptr_t)out)(31) == 32);
        errno = 0;
        CHECK("reject unknown flags", syscall(SYS_jit_install, m0.p, m0.n, 2, &out) == -1 && errno == EINVAL);'''
 assert code.count(old)==1;code=code.replace(old,new)
frozen.write_text(code);binary=out/'guest-jit-test.wasm' 
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
cmd=[cc,'-std=c11','-O2','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-static',str(frozen),'-Wl,--import-memory,--export-table,--growable-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(binary)]
with (out/'compile.log').open('w') as log:subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=60)
subprocess.run(['wasm-validate','--enable-all',str(binary)],check=True,timeout=10)
abi=subprocess.check_output(['wasm-objdump','-x',str(binary)],text=True);(out/'abi.log').write_text(abi)
assert '-> "__indirect_function_table"' in abi and '<- env.memory' in abi and '<- linux.syscall' in abi
init=out/'init';init.write_text('''#!/bin/busybox sh
export PATH=/bin
busybox mount -t devtmpfs devtmpfs /dev
busybox mount -t proc proc /proc
busybox mount -t sysfs sysfs /sys
/bin/guest-jit-test
result=$?
echo "GUEST_JIT_EXIT status=$result"
while :; do busybox sleep 5; done
''')
spec=importlib.util.spec_from_file_location('smoke',root/'tools/guest-packages/make-smoke.py');smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
base=root/'web/linux/initramfs.cpio';meta=json.loads((root/'web/linux/boot-manifest.json').read_text())['assets']['plain'];archive=out/'initramfs.cpio';report=smoke.build(base,meta['sha256'],init,{'bin/guest-jit-test':binary},archive)
report.update(pass_=True,testOnly=True,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),command=cmd,currentAbiFixture=a.current_abi,frozenSourceSha256=hashlib.sha256(frozen.read_bytes()).hexdigest(),seconds=time.time()-start);report['pass']=report.pop('pass_');(out/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ('pass','archiveSha256','archiveBytes','sourceSha256','binarySha256','seconds')}))
