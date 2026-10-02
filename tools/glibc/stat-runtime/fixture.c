/* GNU public calls are under test; raw statx/time64 and I/O are independent
   fixture transport, never replacements for the public stat implementations. */
#define _GNU_SOURCE 1
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdint.h>
#include <stddef.h>
#include <errno.h>
#include <string.h>
#define REF(n) __typeof__(&n) volatile stat_reference_##n = &n
REF(stat);REF(stat64);REF(lstat);REF(lstat64);REF(fstat);REF(fstat64);REF(fstatat);REF(fstatat64);
extern int stat_raw(int,int,int,int,int,int,int);
extern void stat_record(const char *,int);
extern int __open64_nocancel(const char *,int,...),__close_nocancel(int);
#define CHECK(n,x) stat_record(n,!!(x))
#define PTR(p) ((int)(uintptr_t)(p))
_Static_assert(sizeof(struct stat)==128&&sizeof(struct stat64)==128,"GNU public time64 stat");
_Static_assert(sizeof(struct statx)==256,"kernel statx output ABI");
struct guarded {unsigned char before[16]; union {struct stat s;struct stat64 l;unsigned char bytes[128];} value;unsigned char after[16];};
_Static_assert(offsetof(struct guarded,value)==16&&offsetof(struct guarded,after)==144&&sizeof(struct guarded)==160,"contiguous public output guards");
static int allbytes(const unsigned char *p,unsigned n,unsigned char value){for(unsigned i=0;i<n;i++)if(p[i]!=value)return 0;return 1;}
static void reset(struct guarded *g){memset(g->before,0x6b,16);memset(g->after,0xb6,16);memset(g->value.bytes,0xa5,128);}
static int guards(const struct guarded *g){return allbytes(g->before,16,0x6b)&&allbytes(g->after,16,0xb6);}
static int unchanged(const struct guarded *g){for(unsigned i=0;i<128;i++)if(g->value.bytes[i]!=0xa5)return 0;return guards(g);}
static int call(unsigned which,const char *path,int fd,int dir,int flags,struct guarded *g){
 switch(which){
 case 0:return stat_reference_stat(path,&g->value.s);
 case 1:return stat_reference_stat64(path,&g->value.l);
 case 2:return stat_reference_lstat(path,&g->value.s);
 case 3:return stat_reference_lstat64(path,&g->value.l);
 case 4:return stat_reference_fstat(fd,&g->value.s);
 case 5:return stat_reference_fstat64(fd,&g->value.l);
 case 6:return stat_reference_fstatat(dir,path,&g->value.s,flags);
 default:return stat_reference_fstatat64(dir,path,&g->value.l,flags);
 }
}
static int agrees(const struct stat *s,const struct statx *x){
 return s->st_dev==makedev(x->stx_dev_major,x->stx_dev_minor)&&s->st_ino==x->stx_ino&&s->st_mode==x->stx_mode&&s->st_nlink==x->stx_nlink&&s->st_uid==x->stx_uid&&s->st_gid==x->stx_gid&&s->st_rdev==makedev(x->stx_rdev_major,x->stx_rdev_minor)&&s->st_size==(off_t)x->stx_size&&s->st_blksize==x->stx_blksize&&s->st_blocks==(blkcnt_t)x->stx_blocks&&s->st_atim.tv_sec==x->stx_atime.tv_sec&&s->st_atim.tv_nsec==x->stx_atime.tv_nsec&&s->st_mtim.tv_sec==x->stx_mtime.tv_sec&&s->st_mtim.tv_nsec==x->stx_mtime.tv_nsec&&s->st_ctim.tv_sec==x->stx_ctime.tv_sec&&s->st_ctim.tv_nsec==x->stx_ctime.tv_nsec;
}
static int rawx(const char *path,int dir,int flags,struct statx *x){return stat_raw(291,dir,PTR(path),flags,STATX_BASIC_STATS,PTR(x),0);}
static int rawwrite(int fd,const char *s,unsigned n){return stat_raw(64,fd,PTR(s),n,0,0,0);}
/* Linux __kernel_timespec is two signed 64-bit fields even on wasm32. */
struct kernel_timespec64 {int64_t sec,nsec;};
_Static_assert(sizeof(struct kernel_timespec64)==16&&offsetof(struct kernel_timespec64,nsec)==8,"kernel time64 input");
void stat_tests(void){
 const char *path="/tmp/gnu-stat-file",*hard="/tmp/gnu-stat-hard",*sym="/tmp/gnu-stat-sym";
 unlinkat(AT_FDCWD,path,0);unlinkat(AT_FDCWD,hard,0);unlinkat(AT_FDCWD,sym,0);
 int fd=__open64_nocancel(path,O_CREAT|O_EXCL|O_RDWR,0640);CHECK("stat-fixture-open",fd>=0);if(fd<0)return;
 CHECK("stat-fixture-bytes",rawwrite(fd,"GNUstat!",8)==8);
 struct kernel_timespec64 times[2]={{2208988801LL,123456789},{2208988802LL,987654321}};
 CHECK("stat-raw-utimensat-time64-beyond2038",stat_raw(412,AT_FDCWD,PTR(path),PTR(times),0,0,0)==0);
 CHECK("stat-fixture-hardlink",linkat(AT_FDCWD,path,AT_FDCWD,hard,0)==0);
 CHECK("stat-fixture-symlink",symlinkat(path,AT_FDCWD,sym)==0);
 struct raw_guarded {unsigned char before[16];struct statx value;unsigned char after[16];} x;
 _Static_assert(offsetof(struct raw_guarded,value)==16&&offsetof(struct raw_guarded,after)==272&&sizeof(struct raw_guarded)==288,"contiguous raw statx output guards");
 memset(x.before,0x6b,16);memset(x.after,0xb6,16);
 CHECK("stat-independent-raw-statx",rawx(path,AT_FDCWD,0,&x.value)==0);
 CHECK("stat-raw-statx-canaries",allbytes(x.before,16,0x6b)&&allbytes(x.after,16,0xb6));
 CHECK("stat-raw-file-identity",S_ISREG(x.value.stx_mode)&&x.value.stx_size==8&&x.value.stx_uid==geteuid()&&x.value.stx_gid==getegid()&&x.value.stx_nlink==2);
 CHECK("stat-time64-input-not-truncated",x.value.stx_atime.tv_sec==times[0].sec&&x.value.stx_atime.tv_nsec==times[0].nsec&&x.value.stx_mtime.tv_sec==times[1].sec&&x.value.stx_mtime.tv_nsec==times[1].nsec);
 for(unsigned i=0;i<8;i++){
  struct guarded g;reset(&g);errno=241;int r=call(i,path,fd,AT_FDCWD,0,&g);
  CHECK("stat-public-eight-success-errno",r==0&&errno==241);CHECK("stat-public-eight-output-canaries",guards(&g));CHECK("stat-public-eight-converter-agreement",r==0&&agrees(&g.value.s,&x.value));
  reset(&g);errno=242;r=call(i,"/tmp/gnu-stat-no-such-file",-1,AT_FDCWD,0,&g);
  CHECK("stat-public-eight-error-errno",r==-1&&errno==(i==4||i==5?EBADF:ENOENT));CHECK("stat-public-eight-error-output-unchanged",unchanged(&g));
 }
 struct guarded g;struct statx hx;reset(&g);errno=243;
 CHECK("stat-hardlink-public-identity",stat_reference_stat(hard,&g.value.s)==0&&errno==243&&guards(&g)&&g.value.s.st_ino==x.value.stx_ino&&g.value.s.st_nlink==2);
 CHECK("stat-hardlink-independent-statx",rawx(hard,AT_FDCWD,0,&hx)==0&&hx.stx_ino==x.value.stx_ino);
 for(unsigned i=0;i<8;i++)if(i!=4&&i!=5){
  reset(&g);errno=244;int flags=(i==6||i==7)?AT_SYMLINK_NOFOLLOW:0;
  CHECK("stat-symlink-public-call",call(i,sym,fd,AT_FDCWD,flags,&g)==0&&errno==244&&guards(&g));
  CHECK("stat-symlink-follow-policy",(i==0||i==1)?g.value.s.st_ino==x.value.stx_ino:S_ISLNK(g.value.s.st_mode)&&g.value.s.st_size==(off_t)strlen(path));
 }
 int dir=__open64_nocancel("/tmp",O_RDONLY|O_DIRECTORY,0);CHECK("stat-fixture-dirfd",dir>=0);
 if(dir>=0)for(unsigned i=6;i<8;i++){
  reset(&g);errno=245;CHECK("stat-dirfd-relative",call(i,"gnu-stat-file",fd,dir,0,&g)==0&&errno==245&&guards(&g)&&agrees(&g.value.s,&x.value));
  reset(&g);errno=245;CHECK("stat-empty-path-fd",call(i,"",fd,fd,AT_EMPTY_PATH,&g)==0&&errno==245&&guards(&g)&&agrees(&g.value.s,&x.value));
  reset(&g);errno=245;CHECK("stat-dirfd-EBADF",call(i,"gnu-stat-file",fd,-1,0,&g)==-1&&errno==EBADF&&unchanged(&g));
  reset(&g);errno=245;CHECK("stat-invalid-flags",call(i,path,fd,AT_FDCWD,0x40000000,&g)==-1&&errno==EINVAL&&unchanged(&g));
 }
 char data[8];int readfd=__open64_nocancel(path,O_RDONLY,0);CHECK("stat-open-for-byte-verification",readfd>=0);
 if(readfd>=0){CHECK("stat-file-payload-survives-metadata",stat_raw(63,readfd,PTR(data),8,0,0,0)==8&&!memcmp(data,"GNUstat!",8));__close_nocancel(readfd);}
 if(dir>=0)__close_nocancel(dir);__close_nocancel(fd);unlinkat(AT_FDCWD,sym,0);unlinkat(AT_FDCWD,hard,0);unlinkat(AT_FDCWD,path,0);
}
int stat_thread_test(unsigned index){
 int saved=errno,canary=246+(int)index;struct guarded g;int ok=1;
 for(unsigned i=0;i<8;i++){reset(&g);errno=canary;int r=call(i,"/tmp/gnu-stat-thread-absent",-1,AT_FDCWD,0,&g);ok&=r==-1&&errno==(i==4||i==5?EBADF:ENOENT)&&unchanged(&g);errno=canary;}
 ok&=errno==canary;errno=saved;return ok&&errno==saved;
}
