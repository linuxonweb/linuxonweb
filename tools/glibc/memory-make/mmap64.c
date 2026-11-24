/* Native anonymous mapping authority, with genuine GNU public aliases. */
#include <sys/mman.h>
#include <unistd.h>
extern void *__wasm_memory_mmap(void *,size_t,int,int,int,off_t);
_Static_assert(sizeof(off_t)==sizeof(off64_t),"native GNU time64 offset ABI");
void *__mmap64(void *a,size_t n,int p,int f,int fd,off64_t off) {
 return __wasm_memory_mmap(a,n,p,f,fd,off);
}
weak_alias(__mmap64,mmap64)
libc_hidden_def(__mmap64)
#ifdef __OFF_T_MATCHES_OFF64_T
static_weak_alias(__mmap64,mmap)
strong_alias(__mmap64,__mmap)
libc_hidden_def(__mmap)
#else
#error "native GNU mmap aliases require identical off_t/off64_t"
#endif
