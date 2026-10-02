#!/usr/bin/env python3
"""Select the owned typed extension only in the fresh architecture tree."""
import os,pathlib
R=pathlib.Path(__file__).resolve().parent
S=pathlib.Path(os.environ['GLIBC_TASK'])/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
(S/'syscall-template.S').write_bytes((R/'syscall-template.S').read_bytes())
(S/'Makefile').write_text('override compile-syscall = $(PYTHON) '+str(R/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n')
