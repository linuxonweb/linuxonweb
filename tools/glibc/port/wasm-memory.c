/* Owned nonrecursive linear-memory authority. Anonymous RW mappings only.
   Logical unmapping/reuse does not enforce hardware access protections. */
#include <sys/mman.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#define WASM_PAGE 65536ULL
#define SLOT_COUNT 512
struct range { uintptr_t begin; size_t size; unsigned used; };
static struct range ranges[SLOT_COUNT];
static unsigned lock_word, initialized;
static uintptr_t heap_begin, cursor;
static size_t logical_page;
static void lock(void) {
 while(__atomic_exchange_n(&lock_word,1,__ATOMIC_ACQUIRE))
  __builtin_wasm_memory_atomic_wait32((int*)&lock_word,1,-1);
}
static void unlock(void) {
 __atomic_store_n(&lock_word,0,__ATOMIC_RELEASE);
 __builtin_wasm_memory_atomic_notify((int*)&lock_word,1);
}
static void *fail(int error) {__set_errno(error);return (void*)-1;}
/* No state update unless memory.grow succeeds. Called with authority locked. */
static int ensure(uint64_t end) {
 if(end>UINT32_MAX)return 0;
 uint64_t pages=__builtin_wasm_memory_size(0);
 uint64_t wanted=(end+WASM_PAGE-1)/WASM_PAGE;
 if(wanted>pages && __builtin_wasm_memory_grow(0,wanted-pages)==(size_t)-1)return 0;
 return 1;
}
int __wasm_memory_init(uintptr_t begin,size_t page) {
 lock();
 if(initialized || !begin || !page || (page&(page-1)) || page>WASM_PAGE){unlock();__set_errno(EINVAL);return -1;}
 uint64_t aligned=((uint64_t)begin+31)&~31ULL;
 if(!ensure(aligned)){unlock();__set_errno(ENOMEM);return -1;}
 heap_begin=cursor=aligned;logical_page=page;initialized=1;unlock();return 0;
}
void *__sbrk(intptr_t increment) {
 lock();
 if(!initialized){unlock();return fail(EINVAL);}
 if(increment<0){unlock();return fail(ENOTSUP);}
 uintptr_t result=cursor;
 uint64_t end=(uint64_t)cursor+(uintptr_t)increment;
 if(!ensure(end)){unlock();return fail(ENOMEM);}
 cursor=end;unlock();return (void*)result;
}
static size_t round_page(size_t n) {
 uint64_t result=((uint64_t)n+logical_page-1)&~((uint64_t)logical_page-1);
 return result<=UINT32_MAX?result:0;
}
static int vacant(void) {
 for(int i=0;i<SLOT_COUNT;i++)if(!ranges[i].size)return i;
 return -1;
}
static void coalesce(void) {
 for(int i=0;i<SLOT_COUNT;i++)if(ranges[i].size&&!ranges[i].used)
  for(int j=0;j<SLOT_COUNT;j++)if(i!=j&&ranges[j].size&&!ranges[j].used) {
   if(ranges[i].begin+ranges[i].size==ranges[j].begin) {
    ranges[i].size+=ranges[j].size;ranges[j].size=0;j=-1;
   } else if(ranges[j].begin+ranges[j].size==ranges[i].begin) {
    ranges[i].begin=ranges[j].begin;ranges[i].size+=ranges[j].size;
    ranges[j].size=0;j=-1;
   }
  }
}
void *__mmap(void *addr,size_t length,int prot,int flags,int fd,off_t offset) {
 if(prot!=(PROT_READ|PROT_WRITE) || flags!=(MAP_PRIVATE|MAP_ANONYMOUS) || fd!=-1 || offset!=0)
  return fail(ENOTSUP);
 (void)addr; /* A non-fixed hint may be ignored. */
 lock();
 if(!initialized || !length){unlock();return fail(EINVAL);}
 size_t n=round_page(length);
 if(!n){unlock();return fail(ENOMEM);}
 for(int i=0;i<SLOT_COUNT;i++)if(ranges[i].size>=n&&!ranges[i].used) {
  int split=-1;
  if(ranges[i].size>n && (split=vacant())<0)continue;
  if(split>=0)ranges[split]=(struct range){ranges[i].begin+n,ranges[i].size-n,0};
  ranges[i].size=n;ranges[i].used=1;
  void *result=(void*)ranges[i].begin;
  memset(result,0,n);unlock();return result;
 }
 int slot=vacant();
 if(slot<0){unlock();return fail(ENOMEM);}
 uint64_t begin=((uint64_t)cursor+logical_page-1)&~((uint64_t)logical_page-1);
 if(!ensure(begin+n)){unlock();return fail(ENOMEM);}
 ranges[slot]=(struct range){begin,n,1};cursor=begin+n;
 void *result=(void*)(uintptr_t)begin;memset(result,0,n);unlock();return result;
}
int __munmap(void *addr,size_t length) {
 lock();
 if(!initialized || !length || ((uintptr_t)addr&(logical_page-1))){unlock();__set_errno(EINVAL);return -1;}
 size_t n=round_page(length);
 for(int i=0;i<SLOT_COUNT;i++)if(ranges[i].used&&ranges[i].begin==(uintptr_t)addr&&ranges[i].size==n) {
  ranges[i].used=0;coalesce();unlock();return 0;
 }
 unlock();__set_errno(EINVAL);return -1;
}
void *__mremap(void *addr,size_t old_size,size_t new_size,int flags,...) {
 if(flags!=0&&flags!=MREMAP_MAYMOVE)return fail(ENOTSUP);
 lock();
 if(!initialized || !old_size || !new_size){unlock();return fail(EINVAL);}
 size_t oldn=round_page(old_size),newn=round_page(new_size);int slot=-1;
 for(int i=0;i<SLOT_COUNT;i++)if(ranges[i].used&&ranges[i].begin==(uintptr_t)addr&&ranges[i].size==oldn){slot=i;break;}
 if(slot<0||!newn){unlock();return fail(EINVAL);}
 if(newn==oldn){unlock();return addr;}
 /* Shrink release requires a range metadata slot. */
 if(newn<oldn){
  int tail=vacant();if(tail<0){unlock();return fail(ENOMEM);}
  ranges[tail]=(struct range){(uintptr_t)addr+newn,oldn-newn,0};ranges[slot].size=newn;
  coalesce();unlock();return addr;
 }
 unlock();
 if(!(flags&MREMAP_MAYMOVE))return fail(ENOMEM);
 void *replacement=__mmap(0,newn,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 if(replacement==(void*)-1)return replacement;
 memcpy(replacement,addr,old_size);
 if(__munmap(addr,old_size)){__munmap(replacement,newn);return fail(EINVAL);}
 return replacement;
}
int __mprotect(void *addr,size_t n,int prot) {
 (void)addr;(void)n;(void)prot;__set_errno(ENOTSUP);return -1;
}
int __madvise(void *addr,size_t n,int advice) {
 lock();
 uint64_t end=(uint64_t)(uintptr_t)addr+n;
 if(!initialized || advice!=MADV_DONTNEED || ((uintptr_t)addr&(logical_page-1)) ||
    (n&(logical_page-1)) || (uintptr_t)addr<heap_begin || end>cursor){unlock();__set_errno(ENOTSUP);return -1;}
 memset(addr,0,n);unlock();return 0;
}
uintptr_t __wasm_memory_cursor(void){lock();uintptr_t r=cursor;unlock();return r;}
