#include "no-fork.h"
#include <sys/types.h>
#include <errno.h>
_Static_assert(__builtin_types_compatible_p(pid_t, int), "guest pid_t ABI changed");
int fork(void) { errno = ENOSYS; return -1; }
int vfork(void) { errno = ENOSYS; return -1; }
