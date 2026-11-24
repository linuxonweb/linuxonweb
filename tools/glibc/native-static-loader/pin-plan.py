#!/usr/bin/env python3
"""Read-only provenance capture for the native GNU static-loader design."""
import hashlib, json, os, pathlib, shutil
T = pathlib.Path('/mnt/p6/build/glibc-native-static-loader-20261002')
S = pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')
G = pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
F = pathlib.Path('/mnt/p6/build/firefox-nightly-plan-20261002/source/firefox-159.0a1')
L = pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
LS = pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
os.environ.update(TMPDIR=str(T/'tmp'), TMP=str(T/'tmp'), TEMP=str(T/'tmp'), XDG_CACHE_HOME=str(T/'cache'))
rows = []
def pin(p, rel=None):
    p = pathlib.Path(p); b = p.read_bytes()
    row = dict(path=str(p), bytes=len(b), sha256=hashlib.sha256(b).hexdigest())
    if rel is not None:
        q = T/'source/imported'/rel; q.parent.mkdir(parents=True, exist_ok=True); q.write_bytes(b)
        row['snapshot'] = str(q)
    rows.append(row)
gnu = ['elf/dl-libc.c','elf/dl-sym.c','elf/dl-open.c','elf/dl-close.c',
       'elf/dl-readonly-area.c','elf/dl-support.c','elf/dl-catch.c','elf/dl-exception.c',
       'elf/dl-printf.c','elf/dl-sym-post.h','dlfcn/dlopen.c','dlfcn/dlsym.c',
       'dlfcn/dlvsym.c','dlfcn/dlmopen.c','dlfcn/dlclose.c','dlfcn/dlerror.c',
       'dlfcn/dlerror.h','dlfcn/libc_dlerror_result.c','include/dlfcn.h','include/link.h',
       'include/libc-symbols.h','sysdeps/generic/ldsodefs.h','debug/readonly-area.c']
for rel in gnu:
    assert (S/rel).read_bytes() == (G/rel).read_bytes(), rel
    pin(S/rel, 'gnu/'+rel)
for rel in ['nsprpub/pr/src/linking/prlink.c','nsprpub/pr/include/prlink.h','nsprpub/pr/tests/dlltest.c']:
    pin(F/rel, 'nightly/'+rel)
for rel in ['llvm/lib/Target/WebAssembly/WebAssemblyISelLowering.cpp',
            'llvm/include/llvm/IR/IntrinsicsWebAssembly.td',
            'clang/lib/CodeGen/CGBuiltin.cpp']:
    pin(LS/rel,'llvm/'+rel)
for p in [L/'bin/wasm-ld',L/'bin/llc',L/'bin/llvm-nm',L/'bin/llvm-ar',
          L/'bin/clang',pathlib.Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang')]:
    pin(p)
for p in ['/mnt/p6/build/glibc-fullmake-inventory-20261002/logs/primary-failures.json',
          '/mnt/p6/build/glibc-cxx-exception-closure-20261002/acceptance.json',
          '/mnt/p6/build/glibc-cxx-exception-closure-20261002/logs/typed-foreign-link-attempt3.log',
          '/mnt/p6/build/glibc-cxx-exception-closure-20261002/logs/why-extract.txt',
          '/mnt/p6/build/glibc-cxx-exception-closure-20261002/logs/release-typed-foreign-link-attempt2.log']:
    pin(p)
out=T/'logs/design-source-pins.json';out.write_text(json.dumps(rows,indent=2)+'\n')
print('pins',len(rows),'sha256',hashlib.sha256(out.read_bytes()).hexdigest())
