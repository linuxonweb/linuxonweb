#!/usr/bin/env python3
import os,pathlib
root=pathlib.Path(__file__).resolve().parent
task=pathlib.Path(os.environ['GLIBC_TASK']);src=task/'source/glibc-2.44'
p=src/'sysdeps/wasm32/bits/setjmp.h'
s=p.read_text().replace('  void *__sp;\n  void *__owner;\n','');s=s.replace('  int __value;','  int __value;\n  void *__sp;\n  void *__owner;');p.write_text(s)
(src/'sysdeps/wasm32/jmpbuf-unwind.h').write_bytes((root/'jmpbuf-unwind.h').read_bytes())
# Copy the bounded startup fixture into owned task storage; source is preserved.
p=task/'source/startup.c'
s=(root.parent/'source/startup.c').read_text()
s=s.replace('init_descriptor(0,0,65536);','extern unsigned char __stack_low, __stack_high;\n init_descriptor(0,&__stack_low,(unsigned)(&__stack_high-&__stack_low));')
s=s.replace('__attribute__((noreturn)) void startup_main(void){',(root/'fixture.c').read_text()+'\n__attribute__((noreturn)) void startup_main(void){')
s=s.replace('check("ctors-after-TLS-TP",ctor_count==1&&ctor_saw_ready);','check("ctors-after-TLS-TP",ctor_count==1&&ctor_saw_ready);\n jump_tests();')
p.write_text(s)
