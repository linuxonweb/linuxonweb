#!/usr/bin/env python3
"""Select only the owned last-five driver/template in the new source tree."""
import os,pathlib
R=pathlib.Path(__file__).resolve().parent;T=pathlib.Path(os.environ['GLIBC_TASK'])
A=T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
for n in ['syscall-template.S','last5-signal.h']:(A/n).write_bytes((R/n).read_bytes())
(A/'Makefile').write_text('override compile-syscall = $(PYTHON) '+str(R/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n')
p=T/'objects/fullmake/configparms';s=p.read_text() if p.exists() else ''
s+='\nCC = python3 '+str(R/'compiler.py')+' -nostdlib -nostdinc -isystem '+os.environ['GLIBC_TOOLCHAIN']+'/lib/clang/22/include\n'
p.write_text(s)
