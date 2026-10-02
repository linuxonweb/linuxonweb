#!/usr/bin/env python3
"""Finite native compiler prerequisite controls; no forced-unwind acceptance."""
from common import *
import re
R=pathlib.Path(__file__).resolve().parent;C=T/'objects/compiler/clang';O=T/'objects/controls';O.mkdir(parents=True,exist_ok=True)
GNU=pathlib.Path('/mnt/p6/build/glibc-syscalls-next26-20261002/source/glibc-2.44')
base=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-isystem',str(L/'lib/clang/22/include'),'-I'+str(GNU/'sysdeps/wasm32'),'-I'+str(GNU/'sysdeps/generic'),'-I'+str(GNU/'sysdeps/wordsize-32'),'-matomics','-mbulk-memory','-fno-builtin','-fno-stack-protector','-fexceptions','-fwasm-exceptions']
mode=['-mllvm','-wasm-gnu-cancel-prerequisite']
exports=['__cpp_exception','raise_tag0','actual_trap','read_sp','restore_sp','zero_frame','static_frame','dynamic_frame','nested_indirect','recursive','c_while','c_do','c_for','cpp_while','cpp_range_lambda','cpp_normal']
# Negative target/native-EH/source-marker controls are explicit build failures.
negative=O/'marker-definition.c';negative.write_text('unsigned __wasm_gnu_caller_sp_v1(void){return 0;}\n')
for name,args,source in [('wrong-target',['--target=wasm32-unknown-unknown','-fexceptions','-fwasm-exceptions'],negative),('no-native-EH',['--target=wasm32-unknown-linux-gnu'],negative),('disabled-frontend-EH',[*base,'-fno-exceptions'],negative),('marker-definition',base,negative)]:
 row=run('negative-'+name,[C,*args,'-I'+str(GNU/'sysdeps/wasm32'),*mode,'-S','-emit-llvm',source,'-o',O/(name+'.ll')],expected=None);assert row['exit']!=0
# No mode keeps accepted frontend/native behavior exactly auditable.
plain=O/'plain.c';plain.write_text('int ordinary(int a){return a*7+3;}\n')
for suffix,extra in [('c',[]),('noeh',['-fno-exceptions'])]:
 run('off-new-'+suffix,[C,*base,*extra,'-O2','-S','-emit-llvm',plain,'-o',O/('off-new-'+suffix+'.ll')])
 run('off-old-'+suffix,[P/'clang',*base,*extra,'-O2','-S','-emit-llvm',plain,'-o',O/('off-old-'+suffix+'.ll')])
 assert (O/('off-new-'+suffix+'.ll')).read_bytes()==(O/('off-old-'+suffix+'.ll')).read_bytes()
for label,compiler in [('new',C),('old',P/'clang')]:
 run('off-native-'+label,[compiler,*base,'-O2','-S',plain,'-o',O/('ordinary-'+label+'.s')])
assert (O/'ordinary-new.s').read_bytes()==(O/'ordinary-old.s').read_bytes()
host=O/'host-eh.c';host.write_text('extern void q(void);extern void cleanup(int*);void host_eh(void){int x __attribute__((cleanup(cleanup)))=2;q();}\n')
for label,compiler in [('new',C),('old',P/'clang')]:
 run('off-host-'+label,[compiler,'--target=x86_64-unknown-linux-gnu','-ffreestanding','-fexceptions','-O2','-S','-emit-llvm',host,'-o',O/('host-'+label+'.ll')])
assert (O/'host-new.ll').read_bytes()==(O/'host-old.ll').read_bytes()
run('boundary-runtime',[C,*base,'-O2','-c',R/'runtime.c','-o',O/'runtime.o'])
run('boundary-stack',[L/'bin/clang',*base,'-c',R/'stack.S','-o',O/'stack.o'])
for level in ['O0','O2','O3']:
 objs=[]
 for source in ['controls.c','controls.cpp']:
  lang=['-std=gnu++17','-nostdinc++'] if source.endswith('cpp') else ['-std=gnu11']
  out=O/(level+'-'+source)
  run('front-'+level+'-'+source,[C,*base,*lang,*mode,'-'+level,'-MD','-MF',str(out)+'.d','-S','-emit-llvm',R/source,'-o',str(out)+'.ll'])
  data=pathlib.Path(str(out)+'.ll').read_text();assert 'wasm-gnu-cancel-prerequisite' in data and '__wasm_gnu_cancel_poll_v1' in data
  run('native-'+level+'-'+source,[C,*base,*lang,*mode,'-'+level,'-c',R/source,'-o',str(out)+'.o'])
  run('assembly-'+level+'-'+source,[C,*base,*lang,*mode,'-'+level,'-S',R/source,'-o',str(out)+'.s'])
  assembly=pathlib.Path(str(out)+'.s').read_text();assert 'call\t__wasm_gnu_caller_sp_v1' not in assembly
  objs.append(str(out)+'.o')
 run('marker-admission-'+level,['python3','-B',R/'marker-audit.py',*objs,O/'runtime.o',O/'stack.o'])
 module=O/(level+'.wasm')
 run('link-'+level,[L/'bin/wasm-ld','--no-entry','--shared-memory','--initial-memory=2097152','--max-memory=16777216',*[f'--export={x}' for x in exports],*objs,O/'runtime.o',O/'stack.o','-o',module])
 run('symbols-'+level,[L/'bin/llvm-nm','--format=posix',module])
 text=(T/'logs'/('symbols-'+level+'.log')).read_text();assert '__wasm_gnu_caller_sp_v1' not in text
 run('execute-'+level,['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'test.mjs',T,level])
# Actual LTO backend remains outside the private clang relink. Preserve its failure.
run('lto-front',[C,*base,*mode,'-O2','-flto','-c',R/'controls.c','-o',O/'lto.bc'])
run('marker-lto-admission',['python3','-B',R/'marker-audit.py',O/'lto.bc'],expected=3)
run('external-marker-build',[C,*base,'-O2','-c',negative,'-o',O/'external-marker.o'])
run('marker-external-admission',['python3','-B',R/'marker-audit.py',O/'external-marker.o'],expected=3)
row=run('lto-original-link',[L/'bin/wasm-ld','--no-entry','--export=c_while',O/'lto.bc',O/'runtime.o','-o',O/'lto-original.wasm'],expected=None)
assert row['exit']!=0,'unaudited original LTO backend unexpectedly accepted marker'
log=sorted((T/'logs').glob('lto-original-link*.log'),key=lambda p:p.stat().st_mtime)[-1].read_text();assert '__wasm_gnu_caller_sp_v1' in log
results={x:json.loads((T/'logs'/(x+'-runtime.json')).read_text()) for x in ['O0','O2','O3']}
(T/'test-result.json').write_text(json.dumps({'pass':all(x['failed']==0 for x in results.values()),'results':results,'ordinaryAndNoEHIdentical':True,'ltoOriginalBackend':'retained expected FAIL; private LTO final pass absent','forcedUnwind':False,'frameDescriptors':False,'tag1Fix':False},indent=2)+'\n')
