#include <sys/mman.h>
#include <unistd.h>
#include <malloc.h>
#include <stdlib.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#define P 65536U
extern void memory_record(const char *,int);
extern uintptr_t __wasm_memory_cursor(void);
static int (*volatile api_brk)(void *)=brk;
static void *(*volatile api_sbrk)(intptr_t)=sbrk;
static void *(*volatile api_mmap)(void *,size_t,int,int,int,off_t)=mmap;
static void *(*volatile api_mmap64)(void *,size_t,int,int,int,off64_t)=mmap64;
static int (*volatile api_munmap)(void *,size_t)=munmap;
static void *(*volatile api_mremap)(void *,size_t,size_t,int,...)=mremap;
static int (*volatile api_mprotect)(void *,size_t,int)=mprotect;
static int (*volatile api_madvise)(void *,size_t,int)=madvise;
static int (*volatile api_trim)(size_t)=malloc_trim;
static void *(*volatile api_malloc)(size_t)=malloc;
static void (*volatile api_free)(void *)=free;
static unsigned char reserved[P] __attribute__((aligned(P)));
static int bytes(const void *p,size_t n,unsigned char b){
 const volatile unsigned char *s=p;for(size_t i=0;i<n;i++)if(s[i]!=b)return 0;return 1;
}
static void *mapping(size_t n){return api_mmap(0,n,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);}
#define C(n,x) memory_record("memory-" n,(x))
void memory_isolated(void){
 errno=731;uintptr_t base=(uintptr_t)api_sbrk(0);C("GNU-sbrk-query",base!=(uintptr_t)-1&&errno==731);
 size_t size=3*P+123;C("GNU-sbrk-growth",(uintptr_t)api_sbrk(size)==base&&errno==731);
 unsigned char *first=(void*)base;memset(first,0x37,size);
 uintptr_t lo=(base+P-1)&~(uintptr_t)(P-1),hi=(base+size)&~(uintptr_t)(P-1);
 C("brk-owned-DONTNEED",api_madvise((void*)lo,P+1,MADV_DONTNEED)==0&&errno==731);
 C("brk-rounding-zero",bytes((void*)lo,2*P,0));
 C("brk-boundary-canaries",bytes(first,lo-base,0x37)&&bytes((void*)hi,base+size-hi,0x37));
 memset(reserved,0x58,sizeof reserved);errno=0;
 C("reserved-excluded",api_madvise(reserved,P,MADV_DONTNEED)==-1&&errno==ENOMEM&&bytes(reserved,P,0x58));
 errno=0;C("brk-below-floor",api_brk((void*)(base-1))==-1&&errno==ENOMEM&&(uintptr_t)api_sbrk(0)==base+size);
 uintptr_t cursor=__wasm_memory_cursor();unsigned pages=__builtin_wasm_memory_size(0);errno=0;
 C("brk-overflow-OOM",api_sbrk(INTPTR_MAX)==(void*)-1&&errno==ENOMEM&&__wasm_memory_cursor()==cursor&&pages==__builtin_wasm_memory_size(0));
 C("GNU-sbrk-shrink",(uintptr_t)api_sbrk(-(intptr_t)size)==base+size&&(uintptr_t)api_sbrk(0)==base);
 unsigned char *a=mapping(P),*b=mapping(P),*c=mapping(P);
 C("adjacent-map-allocation",a!=MAP_FAILED&&b==a+P&&c==b+P);
 if(a==MAP_FAILED||b==MAP_FAILED||c==MAP_FAILED)return;
 memset(a,0x41,P);memset(b,0x42,P);memset(c,0x43,P);errno=812;
 C("adjacent-live-union",api_madvise(a,2*P,MADV_DONTNEED)==0&&errno==812&&bytes(a,P,0)&&bytes(b,P,0)&&bytes(c,P,0x43));
 memset(a,0x41,P);memset(b,0x42,P);C("unmap-middle",api_munmap(b,P)==0);errno=0;
 C("partial-hole-result",api_madvise(a,3*P,MADV_DONTNEED)==-1&&errno==ENOMEM);
 C("partial-hole-bytes",bytes(a,P,0)&&bytes(b,P,0x42)&&bytes(c,P,0));
 errno=0;C("released-hole-only",api_madvise(b,P,MADV_DONTNEED)==-1&&errno==ENOMEM&&bytes(b,P,0x42));
 memset(a,0x49,P);cursor=__wasm_memory_cursor();pages=__builtin_wasm_memory_size(0);
 errno=0;C("madvise-misaligned",api_madvise(a+1,P,MADV_DONTNEED)==-1&&errno==EINVAL&&bytes(a,P,0x49));
 errno=0;C("madvise-round-overflow",api_madvise(a,SIZE_MAX,MADV_DONTNEED)==-1&&errno==EINVAL&&bytes(a,P,0x49));
 errno=0;C("madvise-end-overflow",api_madvise((void*)(uintptr_t)0xffff0000U,2*P,MADV_DONTNEED)==-1&&errno==EINVAL&&bytes(a,P,0x49));
 errno=0;C("madvise-unknown",api_madvise(a,P,0x123456)==-1&&errno==EINVAL&&bytes(a,P,0x49));
 errno=0;C("madvise-recognized-unavailable",api_madvise(a,P,MADV_FREE)==-1&&errno==ENOTSUP&&bytes(a,P,0x49));
 errno=713;C("madvise-zero",api_madvise(0,0,MADV_DONTNEED)==0&&errno==713);
 int bad[]={8,0x40000000,-1,MREMAP_FIXED,MREMAP_DONTUNMAP};
 for(unsigned i=0;i<sizeof bad/sizeof bad[0];i++){
  errno=0;C("mremap-invalid-flags",api_mremap(a,P,2*P,bad[i])==MAP_FAILED&&errno==EINVAL&&bytes(a,P,0x49)&&__wasm_memory_cursor()==cursor&&pages==__builtin_wasm_memory_size(0));
 }
 errno=0;C("mremap-valid-FIXED-unavailable",api_mremap(a,P,2*P,MREMAP_FIXED|MREMAP_MAYMOVE,c)==MAP_FAILED&&errno==ENOTSUP&&bytes(a,P,0x49));
 errno=0;C("mremap-valid-DONTUNMAP-unavailable",api_mremap(a,P,2*P,MREMAP_DONTUNMAP|MREMAP_MAYMOVE)==MAP_FAILED&&errno==ENOTSUP&&bytes(a,P,0x49));
 errno=0;C("mprotect-unavailable",api_mprotect(a,P,PROT_NONE)==-1&&errno==ENOTSUP&&bytes(a,P,0x49));
 errno=0;C("mapped-brk-growth-rejected",api_brk((void*)(base+1))==-1&&errno==ENOMEM&&(uintptr_t)api_sbrk(0)==base&&bytes(a,P,0x49));
 C("unmap-adjacent",api_munmap(a,P)==0&&api_munmap(c,P)==0);
 a=mapping(2*P);C("reuse-zero",a!=MAP_FAILED&&bytes(a,2*P,0));if(a==MAP_FAILED)return;
 memset(a,0x55,2*P);errno=511;
 C("page-rounded-one-byte",api_madvise(a,1,MADV_DONTNEED)==0&&errno==511&&bytes(a,P,0)&&bytes(a+P,P,0x55));
 memset(a,0x67,2*P);C("mremap-shrink",api_mremap(a,2*P,P,0)==a&&bytes(a,P,0x67));
 errno=0;C("mremap-no-move-growth",api_mremap(a,P,3*P,0)==MAP_FAILED&&errno==ENOMEM&&bytes(a,P,0x67));
 a[P-1]=0x79;b=api_mremap(a,1,3*P,MREMAP_MAYMOVE);C("mremap-rounded-old-page",b!=MAP_FAILED&&bytes(b,P-1,0x67)&&b[P-1]==0x79&&bytes(b+P,2*P,0));
 if(b!=MAP_FAILED)C("unmap-remapped",api_munmap(b,3*P)==0);
 errno=0;C("mmap64-real-off64",api_mmap64(0,P,3,MAP_PRIVATE|MAP_ANONYMOUS,-1,(off64_t)1<<33)==MAP_FAILED&&errno==ENOTSUP);
 errno=0;C("mmap-real-off64",api_mmap(0,P,3,MAP_PRIVATE|MAP_ANONYMOUS,-1,(off_t)1<<33)==MAP_FAILED&&errno==ENOTSUP);
 cursor=__wasm_memory_cursor();pages=__builtin_wasm_memory_size(0);errno=0;
 C("mapping-OOM-preservation",mapping(0x7fffffffU)==MAP_FAILED&&errno==ENOMEM&&cursor==__wasm_memory_cursor()&&pages==__builtin_wasm_memory_size(0));
 errno=0;C("unmap-invalid",api_munmap(reserved,P)==-1&&errno==EINVAL&&bytes(reserved,P,0x58));
}
void memory_trim_test(unsigned free_pattern){
 int saved=errno,ok=1;const size_t n=112*1024;
 unsigned char *guard[4],*mid[3];uintptr_t interior[3];size_t discard[3];unsigned eligible=0;
 for(unsigned i=0;i<3;i++){guard[i]=api_malloc(4096);mid[i]=api_malloc(n);ok&=guard[i]&&mid[i];}
 guard[3]=api_malloc(4096);ok&=guard[3]!=0;C("trim-allocations",ok);
 if(!ok){for(unsigned i=0;i<3;i++){api_free(guard[i]);api_free(mid[i]);}api_free(guard[3]);errno=saved;return;}
 for(unsigned i=0;i<4;i++)memset(guard[i],0x31+i,4096);
 for(unsigned i=0;i<3;i++){
  memset(mid[i],0x73,n);
  C("trim-arena-contiguous",(uintptr_t)guard[i]<(uintptr_t)mid[i]&&(uintptr_t)mid[i]<(uintptr_t)guard[i+1]);
  interior[i]=((uintptr_t)mid[i]+32+P-1)&~(uintptr_t)(P-1);
  uintptr_t end=((uintptr_t)mid[i]+n)&~(uintptr_t)(P-1);
  discard[i]=end>interior[i]?end-interior[i]:0;eligible+=discard[i]/P;
 }
 C("trim-has-interior-page",eligible>0);
 for(unsigned i=0;i<3;i++){api_free(mid[i]);C("trim-before-discard-dirty",bytes((void*)interior[i],discard[i],free_pattern));}
 errno=719;int result=api_trim(0);C("GNU-malloc-trim-result",result==1&&errno==719);
 for(unsigned i=0;i<3;i++)C("GNU-malloc-trim-discard",bytes((void*)interior[i],discard[i],0));
 for(unsigned i=0;i<4;i++)C("GNU-malloc-trim-live-neighbors",bytes(guard[i],4096,0x31+i));
 for(unsigned i=0;i<3;i++){mid[i]=api_malloc(n);C("GNU-malloc-trim-reuse-metadata",mid[i]!=0);}
 for(unsigned i=0;i<4;i++)C("GNU-malloc-trim-reuse-neighbors",bytes(guard[i],4096,0x31+i));
 for(unsigned i=0;i<3;i++){api_free(mid[i]);api_free(guard[i]);}api_free(guard[3]);errno=saved;
}
static unsigned char *maps[3][2];
int memory_thread_begin(unsigned id){
 int saved=errno,ok=1;for(unsigned j=0;j<2;j++){
  unsigned char *p=mapping(P);maps[id][j]=p;if(p==MAP_FAILED){ok=0;continue;}
  ok&=bytes(p,P,0);memset(p,0x90+id*2+j,P);
 }ok&=errno==saved;errno=saved;return ok;
}
int memory_thread_end(unsigned id){
 int saved=errno,ok=1;for(unsigned j=0;j<2;j++){
  unsigned char *p=maps[id][j];if(p==MAP_FAILED){ok=0;continue;}
  ok&=bytes(p,P,0x90+id*2+j);errno=0;
  ok&=api_mremap(p,P,2*P,8)==MAP_FAILED&&errno==EINVAL;
  ok&=bytes(p,P,0x90+id*2+j);ok&=api_munmap(p,P)==0;
 }errno=saved;return ok;
}
void memory_round_check(void){
 for(unsigned a=0;a<6;a++)for(unsigned b=a+1;b<6;b++){
  uintptr_t x=(uintptr_t)maps[a/2][a%2],y=(uintptr_t)maps[b/2][b%2];
  C("concurrent-public-map-nonoverlap",x+P<=y||y+P<=x);
 }
}
int memory_nonoverlap(const void *p,size_t n){
 uintptr_t x=(uintptr_t)p;for(unsigned a=0;a<6;a++){
  uintptr_t y=(uintptr_t)maps[a/2][a%2];if(!(x+n<=y||y+P<=x))return 0;
 }return 1;
}
