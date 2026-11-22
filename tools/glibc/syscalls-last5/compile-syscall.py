#!/usr/bin/env python3
"""Capture the unchanged GNU generator stream, compile owned architecture C template."""
import os,sys,pathlib,subprocess,hashlib,json
root=pathlib.Path(__file__).resolve().parent;task=pathlib.Path(os.environ['GLIBC_TASK'])
a=sys.argv[1:];out=pathlib.Path(a[a.index('-o')+1]);assert out.resolve().is_relative_to(task.resolve())
stream=sys.stdin.buffer.read();destination=task/'source/generated';destination.mkdir(exist_ok=True)
# Retain the exact template and driver associated with every diagnostic stream.
# Hash-addressed snapshots preserve evolving backends without overwriting failures.
arch=task/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
assert (arch/'syscall-template.S').read_bytes()==(root/'syscall-template.S').read_bytes(), 'replayed architecture template drift'
inputs={p.name:p.read_bytes() for p in [arch/'syscall-template.S',pathlib.Path(__file__),root/'compiler.py']}
inputs['last5-signal.h']=(arch/'last5-signal.h').read_bytes()
inputs['linux-wasm32-sysdep.h']=(arch/'sysdep.h').read_bytes()
inputs['generic-linux-sysdep.h']=(task/'source/glibc-2.44/sysdeps/unix/sysv/linux/sysdep.h').read_bytes()
inputs['unix-sysdep.h']=(task/'source/glibc-2.44/sysdeps/unix/sysdep.h').read_bytes()
inputs['generic-sysdep.h']=(task/'source/glibc-2.44/sysdeps/generic/sysdep.h').read_bytes()
key=hashlib.sha256(b''.join(k.encode()+b'\0'+v for k,v in sorted(inputs.items()))).hexdigest()
snapshot=task/'source-snapshots'/key;snapshot.mkdir(parents=True,exist_ok=True)
for name,data in inputs.items():
 p=snapshot/name
 if p.exists():assert p.read_bytes()==data
 else:p.write_bytes(data)
source=destination/(hashlib.sha256(str(out).encode()).hexdigest()[:16]+'.c')
if source.exists():assert source.read_bytes()==stream
else:source.write_bytes(stream)
a += [str(source)]
(task/'logs'/('generated-'+source.stem+'-'+key[:16]+'-command.json')).write_text(json.dumps({'command':a,'sourceSnapshot':str(snapshot),'streamSha256':hashlib.sha256(stream).hexdigest()},indent=2)+'\n')
raise SystemExit(subprocess.call(a))
