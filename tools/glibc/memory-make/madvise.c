#include <sys/mman.h>
extern int __wasm_memory_madvise(void *,size_t,int);
int __madvise(void *a,size_t n,int advice){return __wasm_memory_madvise(a,n,advice);}
libc_hidden_def(__madvise)
weak_alias(__madvise,madvise)
