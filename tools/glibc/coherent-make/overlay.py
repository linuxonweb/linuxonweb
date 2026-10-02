#!/usr/bin/env python3
"""Final coherent source selection, gated on reviewed frozen memory input."""
import os,pathlib,json,hashlib,subprocess,sys
assert os.environ.get('GLIBC_COHERENT_OVERLAY_APPROVED')=='1'
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve();S=T/'source/glibc-2.44'
R=pathlib.Path(__file__).resolve().parent;A=S/'sysdeps/unix/sysv/linux/wasm32'
M=pathlib.Path(os.environ['GLIBC_MEMORY_RUNTIME_PACKET']).resolve()
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
assert digest(M/'manifest.json')['sha256']==os.environ['GLIBC_MEMORY_RUNTIME_MANIFEST_SHA256']
frozen=json.loads((M/'manifest.json').read_text())['files']
assert digest(M/'acceptance.json')==frozen[str(M/'acceptance.json')]
assert json.loads((M/'acceptance.json').read_text())['pass']
assert not (T/'logs/coherent-final-overlay.json').exists()
commands=[]
def run(relative,*args):
 argv=[sys.executable,str(R.parent/relative),*args]
 command={'argv':argv,'cwd':str(pathlib.Path.cwd())}
 with (T/'logs'/('overlay-'+str(len(commands))+'.log')).open('wb') as log:
  p=subprocess.run(argv,stdout=log,stderr=subprocess.STDOUT)
 command['exit']=p.returncode;commands.append(command)
 (T/'logs/coherent-overlay-commands.json').write_text(json.dumps(commands,indent=2)+'\n')
 assert p.returncode==0
run('jumps/prepare.py');run('jumps/fullmake-overlay.py');run('checked-jump-make/overlay.py')
run('libnames/overlay.py','coherent-libnames');run('syscalls-final16/header-adapter.py')
s=(S/'bits/fenv.h').read_text();old='   We define no macro which signals no rounding mode is selectable.  */'
assert s.count(old)==1
(S/'sysdeps/wasm32/bits/fenv.h').write_text(s.replace(old,'   Native Wasm has fixed round-to-nearest, ties-to-even arithmetic.  */\n\n#define FE_TONEAREST 0'))
run('syscalls-arity/stat-overlay.py');run('legacy-stat/overlay.py');run('syscalls-arity/overlay.py')
for selected,original in [('final16-template.S','syscalls-final16/syscall-template.S'),('last5-template.S','syscalls-last5/syscall-template.S'),('last5-signal.h','syscalls-last5/last5-signal.h')]:
 (A/selected).write_bytes((R.parent/original).read_bytes())
(A/'syscall-template.S').write_bytes((R/'syscall-template.S').read_bytes())
# Preserve the jump/libnames architecture Makefile and all later misc additions.
(A/'Makefile').write_text('override compile-syscall = $(PYTHON) '+str(R/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n\nifeq ($(subdir),misc)\n# GNU suppresses generated extras when these architecture C sources exist.\nsysdep_routines += wasm-memory-authority init_module delete_module\nendif\n')
memory=[]
for name in ['brk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']:
 p=M/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'/(name+'.c');h=digest(p)
 assert h==frozen[str(p)]
 q=A/p.name;q.write_bytes(p.read_bytes());memory.append({'source':str(p),'selected':str(q),'verified':h})
assert not (T/'objects/fullmake').exists(), 'final configure and metadata must follow all overlays'
(T/'logs/coherent-final-overlay.json').write_text(json.dumps({'pass':True,'commands':commands,
 'memoryManifest':str(M/'manifest.json'),'memoryManifestHash':digest(M/'manifest.json'),
 'memorySources':memory,'architectureFiles':{str(p):digest(p) for p in A.rglob('*') if p.is_file()},
 'acceptedTargetObjectsCopied':0,'scope':'source selection only; actual fresh GNU make still required'},indent=2)+'\n')
