#!/usr/bin/env python3
"""Order frozen architecture overlays without modifying genuine GNU bodies."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';R=pathlib.Path(__file__).resolve().parent;A=S/'sysdeps/unix/sysv/linux/wasm32'
(A/'syscall-template.S').write_bytes((R/'syscall-template.S').read_bytes())
(A/'Makefile').write_text('override compile-syscall = $(PYTHON) '+str(R/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n')
s=(S/'bits/fenv.h').read_text();old='   We define no macro which signals no rounding mode is selectable.  */';assert s.count(old)==1
(S/'sysdeps/wasm32/bits/fenv.h').write_text(s.replace(old,'   Native Wasm has fixed round-to-nearest, ties-to-even arithmetic.  */\n\n#define FE_TONEAREST 0'))
k=A/'kernel-features.h';assert '# define __ASSUME_STATX 1' not in k.read_text();k.write_bytes(k.read_bytes()+b'\n/* The pinned Linux/Wasm kernel implements real statx syscall291. */\n#ifndef __ASSUME_STATX\n# define __ASSUME_STATX 1\n#endif\n')
for name in ['kernel_stat.h','statx_cp.c']:
 p=A/name;assert not p.exists();p.write_bytes((R.parent/'stat-runtime'/name).read_bytes())
(T/'logs/cumulative-overlay.json').write_text(json.dumps({'order':['signed-foundation','jump-layout-and-caller-lowering','warning-metadata','typed-next26-template','nearest-only-fenv','libnames-and-pthreadP','statx-selection'],'architectureFiles':{str(p):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [A/'Makefile',A/'syscall-template.S',S/'sysdeps/wasm32/bits/fenv.h',k,A/'kernel_stat.h',A/'statx_cp.c']},'acceptedObjectsCopied':0},indent=2)+'\n')
