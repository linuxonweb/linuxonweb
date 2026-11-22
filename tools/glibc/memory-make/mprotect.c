/* Linear Wasm memory cannot enforce page protections. */
#include <sys/mman.h>
extern int __wasm_memory_mprotect(void *,size_t,int);
int __mprotect(void *a,size_t n,int p){return __wasm_memory_mprotect(a,n,p);}
libc_hidden_def(__mprotect)
weak_alias(__mprotect,mprotect)
