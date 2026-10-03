from pathlib import Path
import subprocess,hashlib,json
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');P=T/'inttypes-preflight';P.mkdir(exist_ok=False)
env=dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1";env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
H=Path('/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/inttypes.h')
body='''#include <stdio.h>
#ifdef __cplusplus
static_assert(__is_same(intptr_t,long),"signed pointer type");
static_assert(__is_same(uintptr_t,unsigned long),"unsigned pointer type");
#else
_Static_assert(__builtin_types_compatible_p(intptr_t,long),"signed pointer type");
_Static_assert(__builtin_types_compatible_p(uintptr_t,unsigned long),"unsigned pointer type");
#endif
int formats(intptr_t s,uintptr_t u,const char* text) {
 printf("%" PRIdPTR " %" PRIiPTR " %" PRIoPTR " %" PRIuPTR " %" PRIxPTR " %" PRIXPTR,s,s,u,u,u,u);
 return sscanf(text,"%" SCNdPTR " %" SCNiPTR " %" SCNoPTR " %" SCNuPTR " %" SCNxPTR,&s,&s,&u,&u,&u);
}
'''
results={};commands={}
for lang in ('c','c++'):
 for fixed in (False,True):
  name=lang.replace('+','x')+('-fixed' if fixed else '-original');src=P/(name+('.cpp' if lang=='c++' else '.c'));src.write_text(('#include <inttypes.h>\n' if fixed else '#include "'+str(H)+'"\n')+body)
  cc=env['CXX' if lang=='c++' else 'CC'];argv=[cc,'-I'+str(T/'recipe/shim'),'-Werror=format','-c',str(src),'-o',str(P/(name+'.o'))]
  if lang=='c++':argv+=['-std=c++20','-Xclang','-fc++-abi=webassembly']
  else:argv+=['-std=c11']
  r=subprocess.run(argv,env=env,capture_output=True,text=True);(P/(name+'.log')).write_text(r.stdout+r.stderr)
  results[name]={'exit':r.returncode,'expected_success':fixed};commands[name]=argv
assert all((r['exit']==0)==r['expected_success'] for r in results.values()),results
macros=subprocess.check_output([env['CC'],'-dM','-E','-x','c','/dev/null'],env=env,text=True);selected=[x for x in macros.splitlines() if any(k in x for k in ['__INTPTR_FMT','__UINTPTR_FMT','__INTPTR_TYPE__','__UINTPTR_TYPE__'])]
pins=[]
for p in [H,T/'recipe/shim/inttypes.h',T/'recipe/environment.sh',*P.iterdir()]:
 if p.is_file():b=p.read_bytes();pins.append({'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
proof={'claim':'Actual native C/C++ pointer typedef and all six PRI/five SCN formats; original failures retained. No varargs ABI change','results':results,'commands':commands,'compiler_pointer_macros':selected,'pins':pins}
(P/'result.json').write_text(json.dumps(proof,indent=2));print(json.dumps(results))
