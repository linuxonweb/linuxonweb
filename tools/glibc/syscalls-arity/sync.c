/* Owned Wasm public void wrapper; raw result deliberately discarded. */
#include <sysdep.h>
#include <unistd.h>
void sync(void){ (void)INTERNAL_SYSCALL_CALL(sync); }
libc_hidden_def(sync)
