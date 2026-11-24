/* Architecture wrapper selects GNU's genuine statx conversion for the
   distinct Linux/Wasm legacy stat ABI. The implementation remains unchanged. */
#include <kernel_stat.h>
#include <sysdeps/unix/sysv/linux/statx_cp.c>
