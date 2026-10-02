/* Historical GNU export without current GNU public header declaration.
   Kernel Linux ABI has three operands, unlike obsolete generated five. */
#include <sysdep.h>
int init_module(void *image,unsigned long size,const char *parameters){return INLINE_SYSCALL_CALL(init_module,image,size,parameters);}
libc_hidden_def(init_module)
