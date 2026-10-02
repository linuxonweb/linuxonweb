#!/usr/bin/env python3
"""Extract exact echo streams from GNU's genuine generated sysd-syscalls rules."""
import os,pathlib,re,json,hashlib
t=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
rules=t/'objects/fullmake/sysd-syscalls'
text=rules.read_text()
selected=['getpid','getppid','getuid','geteuid','getgid','getegid','gettid','kill','dup','dup3','chdir','fchdir','mkdirat','unlinkat','readlinkat','fchmod','fchown']
out=t/'source/selected-syscalls';out.mkdir(exist_ok=True)
report=[]
for name in selected:
 blocks=re.findall(r'^#### CALL='+name+r' NUMBER=.*?(?=^#### CALL=|\Z)',text,re.M|re.S)
 blocks=[b for b in blocks if 'SOURCE=-' in b.splitlines()[0] and "echo '#include <syscall-template.S>'" in b]
 assert blocks,name
 streams=['\n'.join(re.findall(r"echo '([^']*)'",b))+'\n' for b in blocks]
 assert len(set(streams))==1,(name,'inconsistent GNU generation')
 p=out/(name+'.c');data=streams[0].encode()
 if p.exists():assert p.read_bytes()==data
 else:p.write_bytes(data)
 report.append({'name':name,'selectedGNU':True,'rule':blocks[0].splitlines()[0],'sha256':hashlib.sha256(data).hexdigest()})
# There is no selected generated close here: GNU Linux close.c is cancellable.
# Private instantiations exercise each convention using the actual close syscall.
for mode,noerrno,errval in [('regular',0,0),('raw',1,0),('errval',0,1)]:
 data=f'#define SYSCALL_NAME close\n#define SYSCALL_NARGS 1\n#define SYSCALL_SYMBOL __wasm_probe_close_{mode}\n#define SYSCALL_NOERRNO {noerrno}\n#define SYSCALL_ERRVAL {errval}\n#include <syscall-template.S>\n'.encode()
 p=out/('private-close-'+mode+'.c')
 if p.exists():assert p.read_bytes()==data
 else:p.write_bytes(data)
 report.append({'name':'private-close-'+mode,'selectedGNU':False,'sha256':hashlib.sha256(data).hexdigest()})
(t/'logs/selected-syscalls.json').write_text(json.dumps({'generator':'GNU sysdeps/unix/make-syscalls.sh','rulesSha256':hashlib.sha256(rules.read_bytes()).hexdigest(),'wrappers':report},indent=2)+'\n')
