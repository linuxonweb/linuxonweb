/* Owned Wasm adapter to actual zero-argument GNU public interface. */
#include <sysdep.h>
#include <unistd.h>
int vhangup(void){return INLINE_SYSCALL_CALL(vhangup);}
libc_hidden_def(vhangup)
