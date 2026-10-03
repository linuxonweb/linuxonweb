#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
import re,hashlib
S=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')
O=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/objects/configure-port')
CXX=LLVM_SRC/'libcxx';ABI=LLVM_SRC/'libcxxabi';UW=LLVM_SRC/'libunwind'
INC=T/'source/coherent-include';INC.mkdir(parents=True,exist_ok=True)
(INC/'gnu-unwind.h').write_bytes((G/'sysdeps/generic/unwind.h').read_bytes())
(INC/'unwind.h').write_text('#include "gnu-unwind.h"\ntypedef struct _Unwind_Exception _Unwind_Exception;\ntypedef struct _Unwind_Context _Unwind_Context;\n')
vals={'_LIBCPP_ABI_VERSION':'1','_LIBCPP_ABI_NAMESPACE':'__1','_LIBCPP_HAS_THREADS':'1','_LIBCPP_HAS_THREAD_API_PTHREAD':'1','_LIBCPP_HAS_MONOTONIC_CLOCK':'1','_LIBCPP_HAS_TERMINAL':'1','_LIBCPP_HAS_FILESYSTEM':'1','_LIBCPP_HAS_RANDOM_DEVICE':'1','_LIBCPP_HAS_LOCALIZATION':'1','_LIBCPP_HAS_UNICODE':'1','_LIBCPP_HAS_WIDE_CHARACTERS':'1','_LIBCPP_HAS_TIME_ZONE_DATABASE':'1','_LIBCPP_PSTL_BACKEND_SERIAL':'1','_LIBCPP_HARDENING_MODE_DEFAULT':'2','_LIBCPP_ASSERTION_SEMANTIC_DEFAULT':'32'}
template=(CXX/'include/__config_site.in').read_text()
lines=[]
for line in template.splitlines():
 m=re.match(r'#cmakedefine(01)? (\w+)(.*)',line)
 if m:
  isbool,key,tail=m.groups();value=vals.get(key,'0')
  if isbool:line='#define '+key+' '+value
  elif key in vals:line='#define '+key+' '+(tail.strip().replace('@'+key+'@',value) or value)
  else:line='/* '+key+' not selected */'
 line=re.sub(r'@[^@]+@','',line);lines.append(line)
(INC/'__config_site').write_text('\n'.join(lines)+'\n')
(INC/'__assertion_handler').write_bytes((CXX/'vendor/llvm/default_assertion_handler.in').read_bytes())
(T/'logs/cxx-config.json').write_text(json.dumps(vals,indent=2)+'\n')
paths=['include','sysdeps/unix/sysv/linux/wasm32','sysdeps/unix/sysv/linux/include','sysdeps/unix/sysv/linux','sysdeps/nptl','sysdeps/pthread','sysdeps/gnu','sysdeps/unix/inet','sysdeps/unix/sysv','sysdeps/unix','sysdeps/posix','sysdeps/wasm32','sysdeps/wordsize-32','sysdeps/ieee754/ldbl-128','sysdeps/ieee754/dbl-64','sysdeps/ieee754/flt-32','sysdeps/ieee754','sysdeps/generic','.','libio','stdlib','string','signal','setjmp','time','wcsmbs','nptl','io','dirent','posix','elf']
# GNU/Linux selects generic Itanium by default. A fresh coherent Wasm C++
# closure needs catchret and Wasm member-pointer dispatch for every C++ unit.
# Historical generic-Itanium objects must not be reused in this closure.
flags=[*base,'-fc++-abi=webassembly','-std=c++23','-nostdinc++','-D_ISOMAC','-D_LIBCPP_BUILDING_LIBRARY','-D_LIBCXXABI_BUILDING_LIBRARY','-matomics','-mbulk-memory','-fwasm-exceptions','-fexceptions','-I',INC,'-I',CXX/'include','-I',ABI/'include','-I',ABI/'src','-I',CXX/'src','-I',O,'-isystem','/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/ckv9mf7zan7434qdbfj6cv8dhqn228ab-linux-0.0.0-headers/include']
for path in paths:flags+=['-I',S/path]
units=['layout','cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers','private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo','cxa_demangle','stdlib_new_delete']
result=[]
OBJ=T/'objects/release' if '--release' in sys.argv else T/'objects'
OBJ.mkdir(exist_ok=True)
if '--release' in sys.argv:flags+=['-DNDEBUG','-DLIBCXXABI_SILENT_TERMINATE']
for unit in (['probe'] if '--probe-only' in sys.argv else units if '--unwind-only' not in sys.argv else []):
 src=R/'typed-probe.cpp' if unit=='probe' else R/'cxxabi-layout.cpp' if unit=='layout' else ABI/'src'/f'{unit}.cpp'
 if unit not in ['layout','probe']:
  imported=T/'source/imported-llvm'/src.relative_to(LLVM_SRC);imported.parent.mkdir(parents=True,exist_ok=True);imported.write_bytes(src.read_bytes())
 try:
  if '--deps-only' in sys.argv:run('cxxabi-deps-'+unit,[CLANG,*flags,'-M','-MF',T/'objects'/f'{unit}-full.d',src])
  else:run(('release-' if '--release' in sys.argv else '')+'cxxabi-'+unit,[CLANG,*flags,'-MMD','-MF',OBJ/f'{unit}.d','-c',src,'-o',OBJ/f'{unit}.o'])
  result.append({'unit':unit,'pass':True})
 except RuntimeError as error:result.append({'unit':unit,'pass':False,'error':str(error)})
if result:(T/'logs'/(('release-' if '--release' in sys.argv else '')+('cxxabi-dependency-results.json' if '--deps-only' in sys.argv else 'probe-compile-results.json' if '--probe-only' in sys.argv else 'cxxabi-compile-results.json'))).write_text(json.dumps(result,indent=2)+'\n')

if '--probe-only' in sys.argv:exit()
# The GNU declaration returns void*, not libunwind's uintptr_t spelling.
(R/'libunwind-config.h').write_bytes((UW/'src/config.h').read_bytes())
uw=(UW/'src/Unwind-wasm.c').read_text().replace('#include "config.h"','#include "libunwind-config.h"')
uw=uw.replace('_LIBUNWIND_EXPORT uintptr_t\n_Unwind_GetLanguageSpecificData','_LIBUNWIND_EXPORT void *\n_Unwind_GetLanguageSpecificData')
uw=uw.replace('  return result;\n}\n\n/// Not used in Wasm.\n_LIBUNWIND_EXPORT uintptr_t _Unwind_GetRegionStart','  return (void *)result;\n}\n\n/// Not used in Wasm.\n_LIBUNWIND_EXPORT uintptr_t _Unwind_GetRegionStart')
(R/'Unwind-wasm-gnu.c').write_text(uw)
cflags=[x for x in flags if x not in ['-fc++-abi=webassembly','-std=c++23','-nostdinc++','-D_LIBCPP_BUILDING_LIBRARY','-D_LIBCXXABI_BUILDING_LIBRARY']]
cflags+=['-DNDEBUG','-D_LIBUNWIND_HIDE_SYMBOLS','-fvisibility=hidden','-std=gnu11','-I',UW/'src','-I',UW/'include']
if '--deps-only' in sys.argv:
 run('unwind-wasm-deps',[CLANG,*cflags,'-M','-MF',T/'objects/unwind-wasm-full.d',R/'Unwind-wasm-gnu.c'])
 exit()
run(('release-' if '--release' in sys.argv else '')+'unwind-wasm-gnu',[CLANG,*cflags,'-MMD','-MF',OBJ/'unwind-wasm-gnu.d','-c',R/'Unwind-wasm-gnu.c','-o',OBJ/'unwind-wasm-gnu.o'])
