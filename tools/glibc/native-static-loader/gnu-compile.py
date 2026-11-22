#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
S=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')
C=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002')
j=json.loads((C/'logs/c-attempts/attempt-eil7p8a3/attempt.json').read_text())
args=[];old=j['originalArgs'];i=0
while i<len(old):
 a=old[i];i+=1
 if a in ['-o','-MF','-MT']:i+=1;continue
 if a=='-c' or a==pathlib.Path(j['source']).name:continue
 if a.startswith('-I'):
  p=pathlib.Path(a[2:]);args+=['-I'+str(p if p.is_absolute() else pathlib.Path(j['cwd'])/p)];continue
 if a=='-include':
  p=pathlib.Path(old[i]);i+=1;args+=['-include',str(p if p.is_absolute() else pathlib.Path(j['cwd'])/p)];continue
 args.append(a)
args+=['-I'+str(S/'elf'),'-I'+str(S/'dlfcn'),'-I'+str(R),'-fno-optimize-sibling-calls','-include',str(R/'native-gscope.h')]
(T/'logs/gnu-compile-flags.json').write_text(json.dumps({'original':str(C/'logs/c-attempts/attempt-eil7p8a3/attempt.json'),'args':args},indent=2)+'\n')
units=['dlfcn/dlopen','dlfcn/dlsym','dlfcn/dlvsym','dlfcn/dlmopen','dlfcn/dlclose',
 'dlfcn/dlerror','dlfcn/libc_dlerror_result','elf/dl-libc','elf/dl-sym','elf/dl-catch','elf/dl-exception','elf/dl-printf']
if '--provider-only' in sys.argv:units=['native-loader']
elif '--sym-only' in sys.argv:units=['elf/dl-sym']
else:units+=['native-loader']
results=[]
for unit in units:
 src=R/'native-loader.c' if unit=='native-loader' else S/(unit+'.c')
 name=unit.replace('/','-');out=T/'objects'/f'{name}.front.ll'
 try:
  run('gnu-front-'+name,[CLANG,'--target=wasm32-unknown-linux-gnu',*args,'-fwasm-exceptions','-Xclang','-disable-llvm-passes','-S','-emit-llvm',src,'-MF',T/'objects'/f'{name}.d','-o',out])
  run('gnu-warnings-'+name,[C/'objects/warnings',out,T/'objects'/f'{name}.warnings.bc'])
  run('gnu-jumps-'+name,[C/'objects/lower',T/'objects'/f'{name}.warnings.bc',T/'objects'/f'{name}.lower.bc'])
  run('gnu-opt-'+name,[L/'bin/opt','-passes=default<O2>',T/'objects'/f'{name}.lower.bc','-o',T/'objects'/f'{name}.opt.bc'])
  results.append({'unit':unit,'pass':True,'scope':'LLVM frontend+GNU warning/jump lowering+O2; native RETURN_ADDRESS still requires coherent caller adapter'})
 except RuntimeError as error:results.append({'unit':unit,'pass':False,'error':str(error)})
out=T/'logs'/('gnu-provider-results.json' if '--provider-only' in sys.argv else 'gnu-sym-results.json' if '--sym-only' in sys.argv else 'gnu-compile-results.json')
if out.exists():
 n=1
 while out.with_name(out.stem+f'-before{n}.json').exists():n+=1
 out.with_name(out.stem+f'-before{n}.json').write_bytes(out.read_bytes())
out.write_text(json.dumps(results,indent=2)+'\n')
