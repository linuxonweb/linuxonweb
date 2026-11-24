#!/usr/bin/env python3
# GNU definitions of returning setjmp wrappers are not valid native Wasm jump frames.
import os,pathlib
root=pathlib.Path(__file__).resolve().parent
src=pathlib.Path(os.environ['GLIBC_TASK'])/'source/glibc-2.44/sysdeps/wasm32'
marker='/* Native Wasm setjmp is lowered in its caller by tools/glibc/jumps/compiler.py.\n   No out-of-line returning wrapper is emitted. Indirect setjmp is rejected. */\n'
for name in ['setjmp.c','bsd-setjmp.c','bsd-_setjmp.c']:(src/name).write_text(marker)
(src/'__longjmp.c').write_bytes((root/'helpers.c').read_bytes())
(src/'wasm-jump-tag.S').write_bytes((root/'eh-tag.S').read_bytes())
(src/'Makefile').write_text('ifeq ($(subdir),setjmp)\nsysdep_routines += wasm-jump-tag\nendif\n')
