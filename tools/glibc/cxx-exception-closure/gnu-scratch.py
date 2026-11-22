#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
S=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')
j=json.loads(pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/logs/c-attempts/attempt-29ohfnjg/attempt.json').read_text())
old=j['originalArgs'];args=[];i=0
while i<len(old):
 a=old[i];i+=1
 if a in ['-o','-MF','-MT']:i+=1;continue
 if a==pathlib.Path(j['source']).name:continue
 if a.startswith('-I'):
  p=pathlib.Path(a[2:]);args+=['-I'+str(p if p.is_absolute() else pathlib.Path(j['cwd'])/p)];continue
 if a=='-include':
  p=pathlib.Path(old[i]);i+=1;args+=['-include',str(p if p.is_absolute() else pathlib.Path(j['cwd'])/p)];continue
 args.append(a)
for n in ['scratch_buffer_grow_preserve','scratch_buffer_set_array_size']:
 src=S/'malloc'/f'{n}.c';q=T/'source/imported-gnu/malloc'/src.name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(src.read_bytes())
 run('gnu-'+n,[CLANG,'--target=wasm32-unknown-linux-gnu',*args,src,'-MF',T/'objects'/f'{n}.d','-o',T/'objects'/f'{n}.o'])
