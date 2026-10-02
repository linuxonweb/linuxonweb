#!/usr/bin/env python3
"""Select genuine GNU statx paths without changing upstream stat sources."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';R=pathlib.Path(__file__).resolve().parent
D=T/'source-snapshots/stat-overlay';D.mkdir()
arch=S/'sysdeps/unix/sysv/linux/wasm32';kf=arch/'kernel-features.h'
assert kf.is_file();(D/'kernel-features-before.h').write_bytes(kf.read_bytes())
kf.write_bytes(kf.read_bytes()+b'\n/* The pinned Linux/Wasm kernel implements real statx syscall291. */\n#ifndef __ASSUME_STATX\n# define __ASSUME_STATX 1\n#endif\n')
for name in ['kernel_stat.h','statx_cp.c']:
 p=arch/name;assert not p.exists();p.write_bytes((R/name).read_bytes())
rows={str(p):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [kf,arch/'kernel_stat.h',arch/'statx_cp.c']}
(T/'logs/stat-overlay.json').write_text(json.dumps({'upstreamSourceModified':False,'architectureFiles':rows,'scope':'statx GNU conversion selection; runtime acceptance pending'},indent=2)+'\n')
