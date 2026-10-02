import os,pathlib,hashlib,json
T=pathlib.Path(os.environ['GLIBC_TASK']);F=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET']);A=T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
m=json.loads((F/'manifest.json').read_text())['files']
for name in ['kernel-features.h','kernel_stat.h','statx_cp.c']:
 p=F/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'/name;d={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size};assert d==m[str(p)];(A/name).write_bytes(p.read_bytes())
