#include <sys/mman.h>
extern int __wasm_memory_munmap(void *,size_t);
int __munmap(void *a,size_t n){return __wasm_memory_munmap(a,n);}
libc_hidden_def(__munmap)
weak_alias(__munmap,munmap)
