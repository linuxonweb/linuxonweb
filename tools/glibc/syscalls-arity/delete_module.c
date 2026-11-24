/* Historical GNU export without current GNU public header declaration.
   Kernel Linux ABI has two operands, unlike obsolete generated three. */
#include <sysdep.h>
int delete_module(const char *name,unsigned int flags){return INLINE_SYSCALL_CALL(delete_module,name,flags);}
libc_hidden_def(delete_module)
