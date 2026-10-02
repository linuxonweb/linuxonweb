/* Synthetic conversion inputs; this is not a kernel syscall/runtime probe. */
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <kernel_stat.h>
#include <xstatconv.h>
#pragma push_macro("stat")
#pragma push_macro("stat64")
#pragma push_macro("st_atime")
#pragma push_macro("st_mtime")
#pragma push_macro("st_ctime")
#undef st_atime
#undef st_mtime
#undef st_ctime
#define stat __kernel_uapi_stat
#define stat64 __kernel_uapi_stat64
#include <asm-generic/stat.h>
#undef stat
#undef stat64
#pragma pop_macro("st_ctime")
#pragma pop_macro("st_mtime")
#pragma pop_macro("st_atime")
#pragma pop_macro("stat64")
#pragma pop_macro("stat")
#undef st_atime
#undef st_mtime
#undef st_ctime
#define FIELD(a,b) _Static_assert (offsetof (struct kernel_stat,a) == offsetof (struct __kernel_uapi_stat64,b), "kernel field " #a)
FIELD(st_dev,st_dev); FIELD(st_ino,st_ino); FIELD(st_mode,st_mode);
FIELD(st_nlink,st_nlink); FIELD(st_uid,st_uid); FIELD(st_gid,st_gid);
FIELD(st_rdev,st_rdev); FIELD(__pad1,__pad1); FIELD(st_size,st_size);
FIELD(st_blksize,st_blksize); FIELD(__pad2,__pad2); FIELD(st_blocks,st_blocks);
FIELD(st_atim.tv_sec,st_atime); FIELD(st_atim.tv_nsec,st_atime_nsec);
FIELD(st_mtim.tv_sec,st_mtime); FIELD(st_mtim.tv_nsec,st_mtime_nsec);
FIELD(st_ctim.tv_sec,st_ctime); FIELD(st_ctim.tv_nsec,st_ctime_nsec);
FIELD(__unused4,__unused4); FIELD(__unused5,__unused5);
_Static_assert (sizeof (struct kernel_stat)==sizeof (struct __kernel_uapi_stat64), "kernel size");
_Static_assert (_Alignof (struct kernel_stat)==_Alignof (struct __kernel_uapi_stat64), "kernel alignment");
_Static_assert (sizeof (struct stat)==128 && sizeof (struct stat64)==128, "public time64 ABI");
_Static_assert (_STAT_VER_KERNEL==0 && _STAT_VER_LINUX==0, "public version ABI");
struct guarded_public { unsigned char before[16]; struct stat value; unsigned char after[16]; };
struct guarded_kernel { unsigned char before[16]; struct kernel_stat value; unsigned char after[16]; };
_Static_assert (offsetof (struct guarded_public,value)==16 && offsetof (struct guarded_public,after)==144 && sizeof (struct guarded_public)==160, "contiguous public guards");
_Static_assert (offsetof (struct guarded_kernel,value)==16 && offsetof (struct guarded_kernel,after)==120 && sizeof (struct guarded_kernel)==136, "contiguous kernel guards");
static unsigned passed,failed;
static void check(int value) { if(value)++passed;else ++failed; }
static int equal(const void *a,const void *b,unsigned size) {
 const unsigned char *x=a,*y=b;for(unsigned i=0;i<size;++i)if(x[i]!=y[i])return 0;return 1;
}
static int guard(const unsigned char *p) { for(unsigned i=0;i<16;++i)if(p[i]!=0xA5)return 0;return 1; }
static void expected(struct stat *p,const struct kernel_stat *k) {
 memset(p,0xA5,sizeof *p);p->st_dev=k->st_dev;p->st_ino=k->st_ino;p->st_mode=k->st_mode;
 p->st_nlink=k->st_nlink;p->st_uid=k->st_uid;p->st_gid=k->st_gid;p->st_rdev=k->st_rdev;
 p->__pad1=0;p->__pad2=0;p->st_size=k->st_size;p->st_blksize=k->st_blksize;p->st_blocks=k->st_blocks;
 p->st_atim.tv_sec=k->st_atim.tv_sec;p->st_atim.tv_nsec=k->st_atim.tv_nsec;
 p->st_mtim.tv_sec=k->st_mtim.tv_sec;p->st_mtim.tv_nsec=k->st_mtim.tv_nsec;
 p->st_ctim.tv_sec=k->st_ctim.tv_sec;p->st_ctim.tv_nsec=k->st_ctim.tv_nsec;
}
__attribute__((visibility("default"))) unsigned run_tests(void) {
 passed=failed=0;
 for(unsigned seed=0;seed<1024;++seed) {
  struct guarded_kernel input;memset(&input,0xA5,sizeof input);
  struct kernel_stat *k=&input.value;
  k->st_dev=0xFFFfffffU;k->st_rdev=0xABcdef12U;k->st_ino=0x8000000000000000ULL+seed;
  k->st_mode=0100644;k->st_nlink=2+seed;k->st_uid=seed*17;k->st_gid=seed*19;
  k->st_size=(seed&1)?-(1LL<<42)-seed:(1LL<<42)+seed;k->st_blksize=4096;k->st_blocks=(1LL<<40)+seed;
  static const int seconds[4]={(-2147483647-1),-1,0,2147483647};
  k->st_atim.tv_sec=seconds[seed%4];k->st_mtim.tv_sec=seconds[(seed+1)%4];k->st_ctim.tv_sec=seconds[(seed+2)%4];
  k->st_atim.tv_nsec=999999999-seed;k->st_mtim.tv_nsec=seed;k->st_ctim.tv_nsec=123456789;
  struct kernel_stat original=*k;struct stat want;expected(&want,k);
  for(unsigned route=0;route<3;++route) {
   struct guarded_public output;memset(&output,0xA5,sizeof output);errno=201;
   int result;
   if(route==0)result=__xstat_conv(0,k,&output.value);
   else if(route==1)result=__xstat64_conv(0,k,&output.value);
   else {
    struct stat64 from;memset(&from,0,sizeof from);
    from.st_dev=k->st_dev;from.st_rdev=k->st_rdev;from.st_ino=k->st_ino;from.st_mode=k->st_mode;
    from.st_nlink=k->st_nlink;from.st_uid=k->st_uid;from.st_gid=k->st_gid;from.st_size=k->st_size;
    from.st_blksize=k->st_blksize;from.st_blocks=k->st_blocks;
    from.st_atim.tv_sec=k->st_atim.tv_sec;from.st_atim.tv_nsec=k->st_atim.tv_nsec;
    from.st_mtim.tv_sec=k->st_mtim.tv_sec;from.st_mtim.tv_nsec=k->st_mtim.tv_nsec;
    from.st_ctim.tv_sec=k->st_ctim.tv_sec;from.st_ctim.tv_nsec=k->st_ctim.tv_nsec;
    result=__xstat32_conv(0,&from,&output.value);
   }
   check(result==0);check(errno==201);check(equal(&output.value,&want,sizeof want));
   check(guard(output.before));check(guard(output.after));check(equal(k,&original,sizeof original));
   check(guard(input.before));check(guard(input.after));
  }
 }
 const int invalid[4]={1,-1,2147483647,(-2147483647-1)};
 for(unsigned i=0;i<4;++i)for(unsigned route=0;route<3;++route) {
  struct guarded_public out,original;memset(&out,0xA5,sizeof out);original=out;
  struct kernel_stat k;struct stat64 k64;memset(&k,0,sizeof k);memset(&k64,0,sizeof k64);errno=202;
  int result=route==0?__xstat_conv(invalid[i],&k,&out.value):route==1?__xstat64_conv(invalid[i],&k,&out.value):__xstat32_conv(invalid[i],&k64,&out.value);
  check(result==-1);check(errno==EINVAL);check(equal(&out,&original,sizeof out));
 }
 return failed;
}
__attribute__((visibility("default"))) unsigned pass_count(void) {return passed;}
__attribute__((visibility("default"))) unsigned fail_count(void) {return failed;}
__attribute__((visibility("default"))) unsigned layout(unsigned index) {
 static const unsigned values[]={sizeof(struct kernel_stat),_Alignof(struct kernel_stat),sizeof(struct __kernel_uapi_stat64),sizeof(struct stat),sizeof(struct stat64),offsetof(struct kernel_stat,st_atim.tv_sec),offsetof(struct kernel_stat,st_atim.tv_nsec),offsetof(struct kernel_stat,st_mtim.tv_sec),offsetof(struct kernel_stat,st_ctim.tv_sec),offsetof(struct stat,st_atim.tv_sec),offsetof(struct stat,st_atim.tv_nsec),offsetof(struct stat,__glibc_reserved)};
 return index<sizeof values/sizeof *values?values[index]:0;
}
