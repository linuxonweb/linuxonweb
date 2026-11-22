#!/usr/bin/env python3
from run import *
flags=base+['-I','/mnt/p6/build/glibc-native-jumps-20261002/source/glibc-2.44/sysdeps/wasm32','-fwasm-exceptions','-fexceptions','-fno-optimize-sibling-calls','-Xclang','-disable-llvm-passes','-S','-emit-llvm']
for lang in ['c','cpp']:
 run('fixture-front-'+lang,[CLANG,*flags,R/f'fixture.{lang}','-o',T/'objects'/f'fixture-{lang}.front.ll'])
 run('fixture-opt-'+lang,[L/'bin/opt','-passes=default<O2>',T/'objects'/f'fixture-{lang}.front.ll','-o',T/'objects'/f'fixture-{lang}.opt.bc'])
 run('fixture-dis-'+lang,[L/'bin/llvm-dis',T/'objects'/f'fixture-{lang}.opt.bc','-o',T/'objects'/f'fixture-{lang}.opt.ll'])
