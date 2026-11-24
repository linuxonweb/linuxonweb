#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
run('cxxabi-layout-link',[L/'bin/wasm-ld','--no-entry','--export=cxxabi_layout',T/'objects/layout.o','-o',T/'objects/cxxabi-layout.wasm'])
run('cxxabi-layout-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'layout.mjs',T])
