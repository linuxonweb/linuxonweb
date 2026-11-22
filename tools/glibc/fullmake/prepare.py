#!/usr/bin/env python3
import os,pathlib
root=pathlib.Path(__file__).resolve().parent;src=pathlib.Path(os.environ['GLIBC_TASK'])/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
(src/'syscall-template.S').write_bytes((root/'syscall-template.S').read_bytes())
(src/'Makefile').write_text('override compile-syscall = $(PYTHON) '+str(root/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n')
