#include <errno.h>
#include <stdint.h>
#include <stddef.h>
extern unsigned char __heap_base;
extern int __wasm_memory_init(uintptr_t,size_t);
int fixture_init(uintptr_t floor){return __wasm_memory_init(floor,65536);}
int fixture_errno(void){return errno;}
void fixture_set_errno(int n){errno=n;}
uintptr_t fixture_heap(void){return (uintptr_t)&__heap_base;}

/* Volatile public-header function pointers exercise the actual Wasm indirect
   calling ABI, including off64_t and mremap's real variadic declaration. */
#include <sys/mman.h>
#include <unistd.h>
static int (*volatile typed_brk)(void *) = brk;
static void *(*volatile typed_sbrk)(intptr_t) = sbrk;
static void *(*volatile typed_mmap)(void *,size_t,int,int,int,off_t) = mmap;
static void *(*volatile typed_mmap64)(void *,size_t,int,int,int,off64_t) = mmap64;
static int (*volatile typed_munmap)(void *,size_t) = munmap;
static void *(*volatile typed_mremap)(void *,size_t,size_t,int,...) = mremap;
static int (*volatile typed_mprotect)(void *,size_t,int) = mprotect;
static int (*volatile typed_madvise)(void *,size_t,int) = madvise;
intptr_t fixture_typed(int op,void *p,size_t n,size_t newn,int arg,off64_t off) {
 switch(op) {
 case 0:return typed_brk(p);
 case 1:return (intptr_t)typed_sbrk((intptr_t)n);
 case 2:return (intptr_t)typed_mmap(p,n,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,off);
 case 3:return (intptr_t)typed_mmap64(p,n,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,off);
 case 4:return typed_munmap(p,n);
 case 5:return (intptr_t)typed_mremap(p,n,newn,arg);
 case 6:return typed_mprotect(p,n,arg);
 case 7:return typed_madvise(p,n,arg);
 default:return -2;
 }
}
