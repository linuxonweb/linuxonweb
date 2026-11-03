#ifndef LINUXONWEB_NO_FORK_H
#define LINUXONWEB_NO_FORK_H
#ifndef __wasm32__
#error This compatibility header is only for the project's wasm32 Linux target
#endif
/* No system headers here: gnulib requires config.h before those headers.
 * pid_t is int on this target; no-fork.c statically verifies that ABI fact. */
extern int fork(void);
extern int vfork(void);
#endif
