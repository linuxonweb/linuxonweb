/* Fixed-address and additional remap flags are explicitly unsupported. */
#include <sys/mman.h>
extern void *__wasm_memory_mremap(void *,size_t,size_t,int,...);
void *__mremap(void *a,size_t old,size_t size,int flags,...) {
 return __wasm_memory_mremap(a,old,size,flags);
}
libc_hidden_def(__mremap)
weak_alias(__mremap,mremap)
