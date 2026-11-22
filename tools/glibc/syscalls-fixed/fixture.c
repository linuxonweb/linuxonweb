/* Real public GNU calls; raw read/write helpers are fixture transport only. */
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <sys/file.h>
#include <sys/eventfd.h>
#include <sys/epoll.h>
#include <sys/inotify.h>
#include <sys/timerfd.h>
#include <sys/mman.h>
#include <sched.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#define REF(name) extern __typeof__(&name) volatile public_reference_##name
#define API(name) public_reference_##name
REF(setxattr);REF(lsetxattr);REF(fsetxattr);REF(getxattr);REF(lgetxattr);REF(fgetxattr);
REF(listxattr);REF(llistxattr);REF(flistxattr);REF(removexattr);REF(lremovexattr);REF(fremovexattr);
REF(linkat);REF(symlinkat);REF(fchownat);REF(umask);REF(pipe2);REF(flock);REF(syncfs);REF(close_range);
REF(eventfd);REF(epoll_create1);REF(inotify_init1);REF(inotify_add_watch);REF(inotify_rm_watch);
REF(timerfd_create);REF(memfd_create);REF(getpgid);REF(getsid);REF(sched_yield);
REF(sched_get_priority_max);REF(sched_get_priority_min);REF(getgroups);REF(getresuid);REF(getresgid);REF(setpgid);
extern int __open64_nocancel(const char *,int,...),__close_nocancel(int);
extern int fixed_raw(int,int,int,int,int,int,int);
extern void fixed_record(const char *,int);
static int rd(int fd,void *p,unsigned n){return fixed_raw(63,fd,(int)(uintptr_t)p,n,0,0,0);}
static int wr(int fd,const void *p,unsigned n){return fixed_raw(64,fd,(int)(uintptr_t)p,n,0,0,0);}
#define CHECK(name,expression) fixed_record(name,!!(expression))
#define ERROR(name,expression,error) do {errno=231;CHECK(name,(expression)==-1&&errno==(error));}while(0)
static void unavailable(void){
 ERROR("fixed-inotify-init-real-ENOSYS",API(inotify_init1)(IN_NONBLOCK),ENOSYS);
 ERROR("fixed-inotify-add-real-ENOSYS",API(inotify_add_watch)(-1,"/tmp",IN_CREATE),ENOSYS);
 ERROR("fixed-inotify-rm-real-ENOSYS",API(inotify_rm_watch)(-1,1),ENOSYS);
 ERROR("fixed-timerfd-real-ENOSYS",API(timerfd_create)(CLOCK_MONOTONIC,TFD_NONBLOCK),ENOSYS);
 ERROR("fixed-memfd-real-ENOSYS",API(memfd_create)("gnu-fixed",MFD_CLOEXEC),ENOSYS);
}
static void xattrs(int fd,const char *path,const char *sym){
 const char value[4]={'a',0,'b',0};struct {uint32_t before;char value[8];uint32_t after;} b={0x12345678,{0},0x87654321};
 memset(b.value,0xa5,sizeof(b.value));
 ERROR("fixed-setxattr-ramfs",API(setxattr)(path,"user.gnu",value,sizeof(value),0),EOPNOTSUPP);
 ERROR("fixed-lsetxattr-regular-ramfs",API(lsetxattr)(path,"user.gnu",value,sizeof(value),0),EOPNOTSUPP);
 ERROR("fixed-fsetxattr-ramfs",API(fsetxattr)(fd,"user.gnu",value,sizeof(value),0),EOPNOTSUPP);
 ERROR("fixed-getxattr-ramfs",API(getxattr)(path,"user.gnu",b.value,sizeof(b.value)),EOPNOTSUPP);
 ERROR("fixed-lgetxattr-regular-ramfs",API(lgetxattr)(path,"user.gnu",b.value,1),EOPNOTSUPP);
 ERROR("fixed-fgetxattr-ramfs",API(fgetxattr)(fd,"user.gnu",b.value,sizeof(b.value)),EOPNOTSUPP);
 errno=232;CHECK("fixed-listxattr-empty",API(listxattr)(path,b.value,1)==0&&errno==232);
 CHECK("fixed-llistxattr-empty",API(llistxattr)(path,b.value,1)==0&&errno==232);
 CHECK("fixed-flistxattr-empty",API(flistxattr)(fd,b.value,1)==0&&errno==232);
 ERROR("fixed-removexattr-ramfs",API(removexattr)(path,"user.gnu"),EOPNOTSUPP);
 ERROR("fixed-lremovexattr-regular-ramfs",API(lremovexattr)(path,"user.gnu"),EOPNOTSUPP);
 ERROR("fixed-fremovexattr-ramfs",API(fremovexattr)(fd,"user.gnu"),EOPNOTSUPP);
 ERROR("fixed-lsetxattr-symlink-policy",API(lsetxattr)(sym,"user.gnu",value,sizeof(value),0),EPERM);
 ERROR("fixed-lgetxattr-symlink-policy",API(lgetxattr)(sym,"user.gnu",b.value,sizeof(b.value)),ENODATA);
 ERROR("fixed-lremovexattr-symlink-policy",API(lremovexattr)(sym,"user.gnu"),EPERM);
 CHECK("fixed-xattr-output-canaries",b.before==0x12345678&&b.after==0x87654321);
 for(unsigned i=0;i<sizeof(b.value);i++)CHECK("fixed-xattr-output-unchanged",(unsigned char)b.value[i]==0xa5);
}
static void files(void){
 const char *path="/tmp/gnu-fixed-file",*hard="/tmp/gnu-fixed-hard",*sym="/tmp/gnu-fixed-symlink";
 unlinkat(AT_FDCWD,path,0);unlinkat(AT_FDCWD,hard,0);unlinkat(AT_FDCWD,sym,0);
 int fd=__open64_nocancel(path,O_CREAT|O_EXCL|O_RDWR,0600);CHECK("fixed-fixture-open",fd>=0);
 const char value[4]={'A',0,'B','C'};CHECK("fixed-fixture-write",wr(fd,value,sizeof(value))==sizeof(value));
 errno=233;CHECK("fixed-linkat-success",API(linkat)(AT_FDCWD,path,AT_FDCWD,hard,0)==0&&errno==233);
 CHECK("fixed-symlinkat-success",API(symlinkat)(path,AT_FDCWD,sym)==0&&errno==233);
 char readlink[64]={0};CHECK("fixed-symlink-target",readlinkat(AT_FDCWD,sym,readlink,sizeof(readlink))==(ssize_t)strlen(path)&&!memcmp(readlink,path,strlen(path)));
 int linked=__open64_nocancel(hard,O_RDONLY,0);char bytes[4]={0};CHECK("fixed-hardlink-bytes",linked>=0&&rd(linked,bytes,4)==4&&!memcmp(bytes,value,4));if(linked>=0)__close_nocancel(linked);
 linked=__open64_nocancel(sym,O_RDONLY,0);memset(bytes,0,4);CHECK("fixed-follow-symlink-bytes",linked>=0&&rd(linked,bytes,4)==4&&!memcmp(bytes,value,4));if(linked>=0)__close_nocancel(linked);
 errno=233;CHECK("fixed-fchownat-current-identities",API(fchownat)(AT_FDCWD,path,getuid(),getgid(),0)==0&&errno==233);
 CHECK("fixed-fchownat-unchanged",API(fchownat)(AT_FDCWD,path,(uid_t)-1,(gid_t)-1,0)==0&&errno==233);
 ERROR("fixed-fchownat-invalidfd",API(fchownat)(-1,"relative",(uid_t)-1,(gid_t)-1,0),EBADF);
 errno=234;mode_t old=API(umask)(0027);CHECK("fixed-umask-NOERRNO",errno==234);CHECK("fixed-umask-mask-bits",API(umask)(07777)==0027&&errno==234);CHECK("fixed-umask-restore",API(umask)(old)==0777&&errno==234);
 xattrs(fd,path,sym);
 errno=235;CHECK("fixed-flock-success",API(flock)(fd,LOCK_EX|LOCK_NB)==0&&errno==235);
 int second=__open64_nocancel(path,O_RDWR,0);CHECK("fixed-flock-second-open",second>=0);
 ERROR("fixed-flock-conflict",API(flock)(second,LOCK_EX|LOCK_NB),EAGAIN);
 errno=236;CHECK("fixed-flock-unlock",API(flock)(fd,LOCK_UN)==0&&errno==236);
 CHECK("fixed-flock-retry",API(flock)(second,LOCK_EX|LOCK_NB)==0&&errno==236);if(second>=0)__close_nocancel(second);
 CHECK("fixed-syncfs-ramfs",API(syncfs)(fd)==0&&errno==236);ERROR("fixed-syncfs-invalid",API(syncfs)(-1),EBADF);
 if(fd>=0)__close_nocancel(fd);unlinkat(AT_FDCWD,sym,0);unlinkat(AT_FDCWD,hard,0);unlinkat(AT_FDCWD,path,0);
}
static void descriptors(void){
 struct {uint32_t before;int fd[2];uint32_t after;} pair={0x11223344,{-7,-7},0x44332211};
 errno=237;CHECK("fixed-pipe2-success",API(pipe2)(pair.fd,O_CLOEXEC|O_NONBLOCK)==0&&errno==237);
 CHECK("fixed-pipe2-canaries",pair.before==0x11223344&&pair.after==0x44332211&&pair.fd[0]>=0&&pair.fd[1]>=0);
 CHECK("fixed-pipe2-cloexec",fixed_raw(25,pair.fd[0],F_GETFD,0,0,0,0)==FD_CLOEXEC&&fixed_raw(25,pair.fd[1],F_GETFD,0,0,0,0)==FD_CLOEXEC);
 char b[4]={0};CHECK("fixed-pipe2-empty",rd(pair.fd[0],b,4)==-EAGAIN);
 CHECK("fixed-pipe2-bytes",wr(pair.fd[1],"a\0b",3)==3&&rd(pair.fd[0],b,3)==3&&!memcmp(b,"a\0b",3));
 __close_nocancel(pair.fd[0]);__close_nocancel(pair.fd[1]);pair.fd[0]=pair.fd[1]=-7;
 ERROR("fixed-pipe2-invalid-flags",API(pipe2)(pair.fd,0x40000000),EINVAL);
 CHECK("fixed-pipe2-failure-no-output",pair.fd[0]==-7&&pair.fd[1]==-7&&pair.before==0x11223344&&pair.after==0x44332211);
 errno=238;int event=API(eventfd)(2,EFD_NONBLOCK|EFD_CLOEXEC);CHECK("fixed-eventfd-success",event>=0&&errno==238);
 CHECK("fixed-eventfd-cloexec",event>=0&&fixed_raw(25,event,F_GETFD,0,0,0,0)==FD_CLOEXEC);
 uint64_t counter=0;CHECK("fixed-eventfd-initial-counter",rd(event,&counter,8)==8&&counter==2);
 CHECK("fixed-eventfd-empty",rd(event,&counter,8)==-EAGAIN);counter=5;CHECK("fixed-eventfd-write",wr(event,&counter,8)==8);counter=0;CHECK("fixed-eventfd-read-counter",rd(event,&counter,8)==8&&counter==5);if(event>=0)__close_nocancel(event);
 ERROR("fixed-eventfd-invalid-flags",API(eventfd)(0,0x40000000),EINVAL);
 errno=239;int epoll=API(epoll_create1)(EPOLL_CLOEXEC);CHECK("fixed-epoll-descriptor",epoll>=0&&errno==239&&fixed_raw(25,epoll,F_GETFD,0,0,0,0)==FD_CLOEXEC);if(epoll>=0)__close_nocancel(epoll);
 ERROR("fixed-epoll-invalid-flags",API(epoll_create1)(0x40000000),EINVAL);
 int a=__open64_nocancel("/init",O_RDONLY,0),bfd=__open64_nocancel("/init",O_RDONLY,0),c=__open64_nocancel("/init",O_RDONLY,0);
 int range_ok=a>=0&&bfd==a+1&&c==bfd+1;CHECK("fixed-close-range-fresh-fds",range_ok);
 if(range_ok){
 errno=240;CHECK("fixed-close-range-selected",API(close_range)((unsigned)a,(unsigned)bfd,0)==0&&errno==240);
 CHECK("fixed-close-range-closed",rd(a,b,1)==-EBADF&&rd(bfd,b,1)==-EBADF);
 CHECK("fixed-close-range-adjacent-survives",rd(c,b,1)==1&&b[0]=='#');__close_nocancel(c);
 }else{if(a>=0)__close_nocancel(a);if(bfd>=0)__close_nocancel(bfd);if(c>=0)__close_nocancel(c);}
 ERROR("fixed-close-range-reverse",API(close_range)(2,1,0),EINVAL);
 ERROR("fixed-close-range-flags",API(close_range)(1234,1234,0x40000000),EINVAL);
}
static void identities(void){
 errno=241;CHECK("fixed-getpgid-self",API(getpgid)(0)==API(getpgid)(getpid())&&errno==241);
 CHECK("fixed-getsid-self",API(getsid)(0)==API(getsid)(getpid())&&errno==241);
 ERROR("fixed-getpgid-unknown",API(getpgid)(2147483647),ESRCH);ERROR("fixed-getsid-unknown",API(getsid)(2147483647),ESRCH);
 errno=242;CHECK("fixed-sched-yield",API(sched_yield)()==0&&errno==242);
 CHECK("fixed-sched-normal-priorities",API(sched_get_priority_max)(SCHED_OTHER)==0&&API(sched_get_priority_min)(SCHED_OTHER)==0&&errno==242);
 CHECK("fixed-sched-RT-query",API(sched_get_priority_max)(SCHED_FIFO)==99&&API(sched_get_priority_min)(SCHED_FIFO)==1&&API(sched_get_priority_max)(SCHED_RR)==99&&API(sched_get_priority_min)(SCHED_RR)==1&&errno==242);
 ERROR("fixed-sched-max-invalid",API(sched_get_priority_max)(-1),EINVAL);ERROR("fixed-sched-min-invalid",API(sched_get_priority_min)(-1),EINVAL);
 struct {uint32_t before;gid_t values[16];uint32_t after;} groups={0x12481248,{0},0x84218421};
 errno=243;int count=API(getgroups)(0,0);CHECK("fixed-getgroups-count",count>=0&&count<=16&&errno==243);
 CHECK("fixed-getgroups-values",API(getgroups)(16,groups.values)==count&&errno==243&&groups.before==0x12481248&&groups.after==0x84218421);
 ERROR("fixed-getgroups-negative",API(getgroups)(-1,groups.values),EINVAL);if(count>0)ERROR("fixed-getgroups-small",API(getgroups)(count-1,groups.values),EINVAL);
 struct {uint32_t before;uid_t r,e,s;uint32_t after;} u={0x13571357,~0u,~0u,~0u,0x75317531};
 struct {uint32_t before;gid_t r,e,s;uint32_t after;} g={0x24682468,~0u,~0u,~0u,0x86428642};
 errno=244;CHECK("fixed-getresuid",API(getresuid)(&u.r,&u.e,&u.s)==0&&errno==244&&u.r==getuid()&&u.e==geteuid()&&u.s==geteuid()&&u.before==0x13571357&&u.after==0x75317531);
 CHECK("fixed-getresgid",API(getresgid)(&g.r,&g.e,&g.s)==0&&errno==244&&g.r==getgid()&&g.e==getegid()&&g.s==getegid()&&g.before==0x24682468&&g.after==0x86428642);
 ERROR("fixed-setpgid-negative",API(setpgid)(0,-1),EINVAL);
}
void fixed_tests(void){int old=errno;unavailable();files();descriptors();identities();errno=old;}
int fixed_thread_test(unsigned id){
 int canary=100+(int)id,ok=errno==canary;
 ok&=API(syncfs)(-1)==-1&&errno==EBADF;
 ok&=API(inotify_init1)(0)==-1&&errno==ENOSYS;
 ok&=API(sched_yield)()==0&&errno==ENOSYS;errno=canary;return ok;
}
static void pgdiag(const char *name,int value){
 char line[96];unsigned n=0;while(*name)line[n++]=*name++;line[n++]='=';
 unsigned v=value<0?0u-(unsigned)value:(unsigned)value;if(value<0)line[n++]='-';
 char digits[12];unsigned count=0;do{digits[count++]=(char)('0'+v%10);v/=10;}while(v);
 while(count)line[n++]=digits[--count];line[n++]='\n';wr(1,line,n);
}
int fixed_setpgid_process(void){
 pid_t pid=getpid(),old=API(getpgid)(0),sid=API(getsid)(0);
 pgdiag("FIXED_PG pid",pid);pgdiag("FIXED_PG old",old);pgdiag("FIXED_PG sid",sid);
 int ok=sid>0&&pid!=sid&&old>0;errno=245;
 int created=API(setpgid)(0,0),create_errno=errno;pid_t now=API(getpgid)(0);
 pgdiag("FIXED_PG create",created);pgdiag("FIXED_PG create_errno",create_errno);pgdiag("FIXED_PG after_create",now);
 ok&=created==0&&now==pid&&create_errno==245;errno=245;
 int restored=API(setpgid)(0,old),restore_errno=errno;now=API(getpgid)(0);
 pgdiag("FIXED_PG restore",restored);pgdiag("FIXED_PG restore_errno",restore_errno);pgdiag("FIXED_PG after_restore",now);
 ok&=restored==0&&now==old&&restore_errno==245;return ok;
}
