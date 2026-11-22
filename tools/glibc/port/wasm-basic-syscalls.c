/* Architecture-owned syscall thunks; genuine kernel results, no fallback. */
#include <sysdep.h>
pid_t __getpid(void){return INLINE_SYSCALL_CALL(getpid);}
pid_t __gettid(void){return INLINE_SYSCALL_CALL(gettid);}
