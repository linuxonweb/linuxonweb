#!/usr/bin/env python3
"""Finite coherent GNU layout compile; does not claim runtime/header acceptance."""
import json, os, resource, shutil, subprocess, time, signal
from pathlib import Path
from evidence import T, H, G, P, L, R, sha, budget, group

def main():
    budget(True)
    out = T/'jump64-layout-1'; out.mkdir()
    inc = out/'include'; (inc/'bits/types').mkdir(parents=True)
    old = H/'sysdeps/wasm32/bits/setjmp.h'
    text = old.read_text()
    assert text.count('  void *__sp;') == text.count('  void *__owner;') == 1
    text = text.replace('  void *__sp;', '  unsigned __throw_version;\n  void *__sp;').replace(
        '  void *__owner;', '  void *__owner;\n  unsigned __registration[9];')
    text = text.replace('   value are the native EH tag payload written by __wasm_longjmp.',
        '   value are retained ABI members. Coherent tag1 v2 carries a generation\n   handle to separate immutable delivery storage; it never points here.')
    (inc/'bits/setjmp.h').write_text(text)
    genuine = [G/'setjmp/bits/types/struct___jmp_buf_tag.h', G/'sysdeps/unix/sysv/linux/bits/types/__sigset_t.h']
    for path in genuine: shutil.copyfile(path, inc/'bits/types'/path.name)
    source = out/'layout.c'
    source.write_text('''#define _SETJMP_H 1
#include <bits/types/struct___jmp_buf_tag.h>
#include "jump-abi-v2.h"
_Static_assert(sizeof(__jmp_buf)==64,"actual architecture backend");
_Static_assert(sizeof(__sigset_t)==128,"genuine GNU Linux signal mask");
_Static_assert(sizeof(struct __jmp_buf_tag)==196,"genuine GNU public jump storage");
_Static_assert(__builtin_offsetof(struct __jmp_buf_tag,__mask_was_saved)==64,"GNU mask flag");
_Static_assert(__builtin_offsetof(struct __jmp_buf_tag,__saved_mask)==68,"GNU saved mask");
_Static_assert(__builtin_offsetof(__typeof__(((__jmp_buf*)0)[0][0]),__registration)==28,"actual embedded jump");
const unsigned jump64_layout[] = {sizeof(__jmp_buf),sizeof(struct __jmp_buf_tag),sizeof(__sigset_t),64,68,28,32};
''')
    os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    flags=['--target=wasm32-unknown-linux-gnu','-nostdinc','-ffreestanding','-O2','-I'+str(inc),'-I'+str(R)]
    commands=[]
    for name, args in [('llvm', ['-S','-emit-llvm','-o',out/'layout.ll']), ('object',['-c','-o',out/'layout.o'])]:
        argv=[P/'objects/compiler/clang',*flags,source,*args]
        with (out/(name+'.log')).open('wb') as log:
            p=subprocess.Popen([str(x) for x in argv],cwd=out,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            row={'argv':[str(x) for x in argv],'pid':p.pid,'pgid':p.pid,'cwd':str(out)}; commands.append(row)
            (out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
            try: code=p.wait(timeout=60)
            except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);code=p.wait()
            row.update(exit=code,members=group(p.pid)); (out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
            assert code==0 and not row['members']
    assert '[i32 64, i32 196, i32 128, i32 64, i32 68, i32 28, i32 32]' in (out/'layout.ll').read_text()
    proof={'compileOnly':True,'runtimeAccepted':False,'commands':commands,'inputs':{str(p):sha(p) for p in [old,*genuine,R/'jump-abi-v2.h',P/'objects/compiler/clang']},'outputs':{str(p):sha(p) for p in [*inc.rglob('*.h'),source,out/'layout.ll',out/'layout.o']},'storage':budget()}
    (out/'proof.json').write_text(json.dumps(proof,indent=2)+'\n'); print(json.dumps({'proof':str(out/'proof.json'),'sha256':sha(out/'proof.json')}))
if __name__=='__main__':main()
