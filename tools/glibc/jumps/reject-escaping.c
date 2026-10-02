#include <setjmp/setjmp.h>
int probe(jmp_buf b){int (*volatile pointer)(jmp_buf)=_setjmp;return pointer(b);}
