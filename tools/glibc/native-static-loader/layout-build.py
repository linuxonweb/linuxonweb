#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
args=json.loads((T/'logs/gnu-compile-flags.json').read_text())['args']
run('gnu-layout-front',[CLANG,'--target=wasm32-unknown-linux-gnu',*args,'-c',R/'layout.c','-MF',T/'objects/layout.d','-o',T/'objects/layout.o'])
run('gnu-layout-link',[L/'bin/wasm-ld','--no-entry','--export=native_layout',T/'objects/layout.o','-o',T/'objects/layout.wasm'])
run('gnu-layout-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'layout.mjs',T])
