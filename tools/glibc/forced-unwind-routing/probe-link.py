#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from run import *
units=['probe','cxa_exception','cxa_personality','cxa_exception_storage','cxa_aux_runtime','cxa_handlers','cxa_default_handlers','private_typeinfo','abort_message','fallback_malloc','stdlib_exception','stdlib_typeinfo','unwind-wasm-gnu','tags']
try:run('typed-foreign-closure-link',[L/'bin/wasm-ld','--no-entry','--error-limit=0','--export=typed_probe','--export=foreign_probe',*[T/'objects'/f'{unit}.o' for unit in units],'-o',T/'objects/typed-foreign.wasm'])
except RuntimeError:
 if rows[-1]['exit']!=1:raise
 print('Genuine typed/foreign runtime closure FAIL retained; no execution or symbol suppression.',flush=True)
