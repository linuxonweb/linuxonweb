#!/usr/bin/env python3
from run import *
run('shape-execute',['/home/a/.config/nvm/versions/node/v22.22.2/bin/node',R/'shape.mjs',T])
run('native-disassembly',[L/'bin/llvm-objdump','-d',T/'objects/shape.wasm'])
