/* Owned native Wasm architecture adapter; true GNU variadic public ABI.
   Reject unavailable operations before reading any optional destination. */
#include <sys/mman.h>
#include <errno.h>
extern void *__wasm_memory_mremap(void *,size_t,size_t,int,...);
void *__mremap(void *address,size_t old_size,size_t new_size,int flags,...){
 unsigned known=MREMAP_MAYMOVE|MREMAP_FIXED|MREMAP_DONTUNMAP;
 if(((unsigned)flags&~known) ||
    ((flags&(MREMAP_FIXED|MREMAP_DONTUNMAP))&&!(flags&MREMAP_MAYMOVE))){
  __set_errno(EINVAL);return MAP_FAILED;
 }
 if(flags&(MREMAP_FIXED|MREMAP_DONTUNMAP)){
  __set_errno(ENOTSUP);return MAP_FAILED;
 }
 return __wasm_memory_mremap(address,old_size,new_size,flags);
}
libc_hidden_def(__mremap)
weak_alias(__mremap,mremap)
