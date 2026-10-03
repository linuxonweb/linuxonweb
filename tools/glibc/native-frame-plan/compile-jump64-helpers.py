#!/usr/bin/env python3
"""Bounded genuine-header helper compile; no runtime or frame admission claim."""
import json, os, resource, subprocess, signal, time, shutil
from pathlib import Path
from evidence import T,H,P,L,R,sha,budget,group

def main():
    budget(True); out=T/'jump64-helpers-1';out.mkdir()
    source=out/'jump-helpers-v2.c';shutil.copyfile(R/source.name,source)
    obj=H.parents[1]/'objects/configure-port'
    include=T/'jump64-layout-1/include'
    kernel=Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/ckv9mf7zan7434qdbfj6cv8dhqn228ab-linux-0.0.0-headers/include')
    flags=['--target=wasm32-unknown-linux-gnu','-nostdinc','-isystem',str(L/'lib/clang/22/include'),'-std=gnu11','-fgnu89-inline','-O2','-matomics','-mbulk-memory','-ffreestanding','-fno-builtin','-fno-stack-protector','-fexceptions','-fwasm-exceptions','-I'+str(include),'-I'+str(R)]
    dirs=['include','sysdeps/unix/sysv/linux/wasm32','sysdeps/unix/sysv/linux/include','sysdeps/unix/sysv/linux','sysdeps/nptl','sysdeps/pthread','sysdeps/gnu','sysdeps/unix/inet','sysdeps/unix/sysv','sysdeps/unix','sysdeps/posix','sysdeps/wasm32','sysdeps/wordsize-32','sysdeps/ieee754/ldbl-128','sysdeps/ieee754/dbl-64','sysdeps/ieee754/flt-32','sysdeps/ieee754','sysdeps/generic','','libio','setjmp','signal','elf','nptl']
    flags += ['-I'+str(obj),*['-I'+str(H/d) for d in dirs],'-isystem',str(kernel),'-D_LIBC_REENTRANT','-include',str(obj/'libc-modules.h'),'-DMODULE_NAME=libc','-include',str(H/'include/libc-symbols.h')]
    os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1');resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    argv=[P/'objects/compiler/clang',*flags,'-MD','-MF',out/'helpers.d','-c',source,'-o',out/'helpers.o']
    with (out/'compile.log').open('wb') as log:
        proc=subprocess.Popen([str(x) for x in argv],cwd=out,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        row={'argv':[str(x) for x in argv],'cwd':str(out),'pid':proc.pid,'pgid':proc.pid}
        try:
            (out/'command.json').write_text(json.dumps(row,indent=2)+'\n')
            try: code=proc.wait(timeout=60)
            except subprocess.TimeoutExpired: code=-1
        finally:
            if proc.poll() is None or group(proc.pid):
                try: os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            proc.wait(timeout=10)
            deadline=time.monotonic()+10
            while group(proc.pid) and time.monotonic()<deadline:time.sleep(.05)
            row.update(exit=proc.returncode,members=group(proc.pid));(out/'command.json').write_text(json.dumps(row,indent=2)+'\n')
    assert row['exit']==0 and not row['members'], row
    deps=(out/'helpers.d').read_text().replace('\\\n',' ').split(':',1)[1].split()
    inputs={str(Path(p).resolve()):sha(p) for p in deps}
    proof={'compileOnly':True,'nativeRecordsAdmitted':False,'runtimeAccepted':False,'command':row,'inputs':inputs,'objectSha256':sha(out/'helpers.o'),'sourceSha256':sha(source),'storage':budget()}
    (out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'proof':str(out/'proof.json'),'sha256':sha(out/'proof.json')}))
if __name__=='__main__':main()
