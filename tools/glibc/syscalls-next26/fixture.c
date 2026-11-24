/* Genuine public GNU indirect calls. Raw I/O/uname/unmount are fixture transport. */
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/swap.h>
#include <sys/fsuid.h>
#include <sys/mount.h>
#include <sys/pidfd.h>
#include <sys/klog.h>
#include <sys/resource.h>
#include <sys/fanotify.h>
#include <sched.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <limits.h>
#include <string.h>
#define REF(name) extern __typeof__(&name) volatile public_reference_##name
#define API(name) public_reference_##name
REF(swapoff);REF(swapon);REF(setfsuid);REF(setfsgid);REF(chroot);REF(acct);REF(setsid);
REF(sethostname);REF(setdomainname);REF(execve);REF(mount);REF(fsopen);REF(fsmount);
REF(fsconfig);REF(fspick);REF(open_tree);REF(move_mount);REF(unshare);REF(setns);
REF(sched_getscheduler);REF(pidfd_open);REF(pidfd_getfd);REF(klogctl);REF(setpriority);
REF(fanotify_init);REF(tgkill);
extern int __open64_nocancel(const char *,int,...),__close_nocancel(int);
extern int next26_raw(int,int,int,int,int,int,int);
extern void next26_record(const char *,int);
#define CHECK(n,x) next26_record(n,!!(x))
#define ERROR(n,x,e) do {errno=251;CHECK(n,(x)==-1&&errno==(e));}while(0)
static int rd(int f,void *p,unsigned n){return next26_raw(63,f,(int)(uintptr_t)p,n,0,0,0);}
static int wr(int f,const void *p,unsigned n){return next26_raw(64,f,(int)(uintptr_t)p,n,0,0,0);}
static int fcntl_raw(int f,int cmd){return next26_raw(25,f,cmd,0,0,0,0);}
static void emit(const char *s){wr(1,s,strlen(s));}
static void unavailable(void){
 char *args[]={"/tmp/gnu-next26-absent",0};char *env[]={0};ERROR("next26-exec-missing-file",API(execve)(args[0],args,env),ENOENT);
 ERROR("next26-swapoff-bound-ENOSYS",API(swapoff)("/tmp/gnu-no-swap"),ENOSYS);
 ERROR("next26-swapon-bound-ENOSYS",API(swapon)("/tmp/gnu-no-swap",0),ENOSYS);
 ERROR("next26-acct-bound-ENOSYS",API(acct)(0),ENOSYS);
 ERROR("next26-fanotify-bound-ENOSYS",API(fanotify_init)(0,0),ENOSYS);
}
static void identities(void){
 uid_t u=geteuid();gid_t g=getegid();errno=252;
 int old=API(setfsuid)((uid_t)-1);CHECK("next26-fsuid-query-real-return",old==(int)u&&errno==252);
 CHECK("next26-fsuid-preserve",API(setfsuid)(u)==old&&errno==252);
 CHECK("next26-fsuid-restore",API(setfsuid)((uid_t)old)==old&&errno==252);
 old=API(setfsgid)((gid_t)-1);CHECK("next26-fsgid-query-real-return",old==(int)g&&errno==252);
 CHECK("next26-fsgid-preserve",API(setfsgid)(g)==old&&errno==252);
 CHECK("next26-fsgid-restore",API(setfsgid)((gid_t)old)==old&&errno==252);
 int priority=next26_raw(141,PRIO_PROCESS,0,0,0,0,0);CHECK("next26-priority-query-raw-fixture",priority>=1&&priority<=40);
 if(priority>=1&&priority<=40){errno=252;CHECK("next26-setpriority-preserve",API(setpriority)(PRIO_PROCESS,0,20-priority)==0&&errno==252);CHECK("next26-setpriority-query-unchanged",next26_raw(141,PRIO_PROCESS,0,0,0,0,0)==priority);CHECK("next26-setpriority-restore",API(setpriority)(PRIO_PROCESS,0,20-priority)==0&&errno==252);}
 ERROR("next26-setpriority-invalid-class",API(setpriority)((__priority_which_t)99,0,0),EINVAL);
 errno=252;CHECK("next26-scheduler-query",API(sched_getscheduler)(0)==SCHED_OTHER&&errno==252);
 ERROR("next26-scheduler-unknown-pid",API(sched_getscheduler)(INT_MAX),ESRCH);
 errno=252;CHECK("next26-unshare-nochange",API(unshare)(0)==0&&errno==252);
 ERROR("next26-unshare-invalid",API(unshare)(0x80000000),EINVAL);
 ERROR("next26-setns-invalid-fd",API(setns)(-1,0),EBADF);
}
static void names(void){
 struct {uint32_t before;char sysname[65],nodename[65],release[65],version[65],machine[65],domainname[65];uint32_t after;} u={0x12345678,{0},{0},{0},{0},{0},{0},0x87654321};
 CHECK("next26-uname-raw-fixture",next26_raw(160,(int)(uintptr_t)u.sysname,0,0,0,0,0)==0);
 CHECK("next26-uname-canaries",u.before==0x12345678&&u.after==0x87654321);
 char oldhost[65],olddomain[65];memcpy(oldhost,u.nodename,65);memcpy(olddomain,u.domainname,65);
 errno=253;CHECK("next26-sethostname-success",API(sethostname)("gnu-next26",10)==0&&errno==253);
 CHECK("next26-setdomainname-success",API(setdomainname)("gnu-next26-domain",17)==0&&errno==253);
 CHECK("next26-uname-updated",next26_raw(160,(int)(uintptr_t)u.sysname,0,0,0,0,0)==0&&!strcmp(u.nodename,"gnu-next26")&&!strcmp(u.domainname,"gnu-next26-domain"));
 CHECK("next26-hostname-restore",API(sethostname)(oldhost,strlen(oldhost))==0&&errno==253);
 CHECK("next26-domainname-restore",API(setdomainname)(olddomain,strlen(olddomain))==0&&errno==253);
 CHECK("next26-names-restored",next26_raw(160,(int)(uintptr_t)u.sysname,0,0,0,0,0)==0&&!memcmp(oldhost,u.nodename,65)&&!memcmp(olddomain,u.domainname,65));
 ERROR("next26-hostname-too-long",API(sethostname)(oldhost,65),EINVAL);
 ERROR("next26-domainname-too-long",API(setdomainname)(olddomain,65),EINVAL);
 errno=253;CHECK("next26-klog-size-readonly",API(klogctl)(10,0,0)>0&&errno==253);
 ERROR("next26-klog-invalid-type",API(klogctl)(99,0,0),EINVAL);
}
static volatile sig_atomic_t delivered,signal_number;
static void handler(int n){signal_number=n;delivered++;}
static void signals(void){
 sigset_t one,mask;sigemptyset(&one);sigaddset(&one,SIGUSR2);CHECK("next26-unblock-callback-signal",sigprocmask(SIG_UNBLOCK,&one,&mask)==0);
 struct sigaction a,old;memset(&a,0,sizeof(a));a.sa_handler=handler;sigemptyset(&a.sa_mask);
 CHECK("next26-install-real-GNU-signal",sigaction(SIGUSR2,&a,&old)==0);delivered=0;signal_number=0;
 errno=254;CHECK("next26-tgkill-zero",API(tgkill)(getpid(),gettid(),0)==0&&errno==254);
 CHECK("next26-tgkill-callback",API(tgkill)(getpid(),gettid(),SIGUSR2)==0&&delivered==1&&signal_number==SIGUSR2&&errno==254);
 ERROR("next26-tgkill-wrong-process",API(tgkill)(INT_MAX,gettid(),0),ESRCH);
 ERROR("next26-tgkill-invalid-signal",API(tgkill)(getpid(),gettid(),-1),EINVAL);
 CHECK("next26-restore-signal",sigaction(SIGUSR2,&old,0)==0);CHECK("next26-restore-signal-mask",sigprocmask(SIG_SETMASK,&mask,0)==0);
}
static void pidfds(void){
 const char *path="/tmp/gnu-next26-pidfd";unlinkat(AT_FDCWD,path,0);
 int file=__open64_nocancel(path,O_CREAT|O_EXCL|O_WRONLY,0600);CHECK("next26-pidfd-fixture-open",file>=0);
 if(file>=0){CHECK("next26-pidfd-fixture-write",wr(file,"ABC",3)==3);__close_nocancel(file);}
 file=__open64_nocancel(path,O_RDONLY,0);CHECK("next26-pidfd-fixture-reopen",file>=0);
 errno=255;int pidfd=API(pidfd_open)(getpid(),0);CHECK("next26-pidfd-open-self",pidfd>=0&&errno==255);
 if(pidfd>=0){CHECK("next26-pidfd-CLOEXEC",fcntl_raw(pidfd,F_GETFD)==FD_CLOEXEC);
  int copy=API(pidfd_getfd)(pidfd,file,0);CHECK("next26-pidfd-getfd-self",copy>=0&&errno==255);
  if(copy>=0&&file>=0){char x=0,y=0,z=0;CHECK("next26-pidfd-shared-file-description",rd(file,&x,1)==1&&rd(copy,&y,1)==1&&rd(file,&z,1)==1&&x=='A'&&y=='B'&&z=='C');CHECK("next26-pidfd-copy-CLOEXEC",fcntl_raw(copy,F_GETFD)==FD_CLOEXEC);__close_nocancel(copy);}
  ERROR("next26-pidfd-getfd-invalid-target",API(pidfd_getfd)(pidfd,-1,0),EBADF);__close_nocancel(pidfd);
 }
 if(file>=0)__close_nocancel(file);unlinkat(AT_FDCWD,path,0);
 ERROR("next26-pidfd-open-invalid-flags",API(pidfd_open)(getpid(),0x80000000U),EINVAL);
 ERROR("next26-pidfd-getfd-invalid-flags",API(pidfd_getfd)(-1,-1,1),EINVAL);
 ERROR("next26-pidfd-getfd-invalid-fd",API(pidfd_getfd)(-1,0,0),EBADF);
}
static void mount_bytes(const char *path){
 const char bytes[4]={'M',0,'N','T'};int f=__open64_nocancel(path,O_CREAT|O_EXCL|O_WRONLY,0600);CHECK("next26-mount-file-create",f>=0);
 if(f>=0){CHECK("next26-mount-file-write",wr(f,bytes,4)==4);__close_nocancel(f);}
 f=__open64_nocancel(path,O_RDONLY,0);char out[4]={0};CHECK("next26-mount-file-bytes",f>=0&&rd(f,out,4)==4&&!memcmp(out,bytes,4));if(f>=0)__close_nocancel(f);
 CHECK("next26-mount-file-remove",unlinkat(AT_FDCWD,path,0)==0);
}
static void mounts(void){
 const char *legacy="/tmp/gnu-next26-legacy",*modern="/tmp/gnu-next26-modern";
 CHECK("next26-mount-dir-legacy",mkdirat(AT_FDCWD,legacy,0700)==0);CHECK("next26-mount-dir-modern",mkdirat(AT_FDCWD,modern,0700)==0);
 errno=256;int mounted=API(mount)("none",legacy,"ramfs",0,0)==0;CHECK("next26-public-mount-ramfs",mounted&&errno==256);
 if(mounted){mount_bytes("/tmp/gnu-next26-legacy/file");errno=256;int picked=API(fspick)(AT_FDCWD,legacy,FSPICK_CLOEXEC);CHECK("next26-fspick-mounted-root",picked>=0&&errno==256);if(picked>=0){CHECK("next26-fspick-CLOEXEC",fcntl_raw(picked,F_GETFD)==FD_CLOEXEC);__close_nocancel(picked);}
  errno=256;int tree=API(open_tree)(AT_FDCWD,legacy,OPEN_TREE_CLOEXEC);CHECK("next26-open-tree-mounted-root",tree>=0&&errno==256);if(tree>=0)__close_nocancel(tree);
  CHECK("next26-legacy-unmount-raw-fixture",next26_raw(39,(int)(uintptr_t)legacy,0,0,0,0,0)==0);
 }
 errno=256;int context=API(fsopen)("ramfs",FSOPEN_CLOEXEC);CHECK("next26-fsopen-ramfs",context>=0&&errno==256);
 if(context>=0){CHECK("next26-fsopen-CLOEXEC",fcntl_raw(context,F_GETFD)==FD_CLOEXEC);errno=256;
  CHECK("next26-fsconfig-explicit-source",API(fsconfig)(context,FSCONFIG_SET_STRING,"source","gnu-next26",0)==0&&errno==256);
  int configured=API(fsconfig)(context,FSCONFIG_CMD_CREATE,0,0,0)==0;CHECK("next26-fsconfig-create",configured&&errno==256);
  if(configured){int detached=API(fsmount)(context,FSMOUNT_CLOEXEC,0);CHECK("next26-fsmount-detached",detached>=0&&errno==256);
   if(detached>=0){CHECK("next26-fsmount-CLOEXEC",fcntl_raw(detached,F_GETFD)==FD_CLOEXEC);errno=256;
    int moved=API(move_mount)(detached,"",AT_FDCWD,modern,MOVE_MOUNT_F_EMPTY_PATH)==0;CHECK("next26-move-mount-attach",moved&&errno==256);
    if(moved){__close_nocancel(detached);mount_bytes("/tmp/gnu-next26-modern/file");CHECK("next26-modern-unmount-raw-fixture",next26_raw(39,(int)(uintptr_t)modern,0,0,0,0,0)==0);}else __close_nocancel(detached);
   }
  }__close_nocancel(context);
 }
 CHECK("next26-mount-dir-remove-legacy",unlinkat(AT_FDCWD,legacy,AT_REMOVEDIR)==0);CHECK("next26-mount-dir-remove-modern",unlinkat(AT_FDCWD,modern,AT_REMOVEDIR)==0);
 ERROR("next26-fsopen-invalid-flags",API(fsopen)("ramfs",0x80000000U),EINVAL);
 ERROR("next26-fsmount-invalid-fd",API(fsmount)(-1,0,0),EBADF);
 ERROR("next26-fsconfig-invalid-fd",API(fsconfig)(-1,FSCONFIG_CMD_CREATE,0,0,0),EINVAL);
 ERROR("next26-fspick-invalid-flags",API(fspick)(AT_FDCWD,"/tmp",0x80000000U),EINVAL);
 ERROR("next26-open-tree-invalid-flags",API(open_tree)(AT_FDCWD,"/tmp",0x80000000U),EINVAL);
 ERROR("next26-move-mount-invalid-flags",API(move_mount)(-1,"",AT_FDCWD,"/tmp",0x80000000U),EINVAL);
}
void next26_tests(void){unavailable();identities();names();signals();pidfds();mounts();}
int next26_thread_test(unsigned index){int saved=errno;errno=300+(int)index;int policy=API(sched_getscheduler)(0);int ok=policy==SCHED_OTHER&&errno==300+(int)index;ok=ok&&API(pidfd_open)(0,0)==-1&&errno==EINVAL;errno=saved;return ok&&errno==saved;}
int next26_setsid_process(void){pid_t p=getpid(),old=getpgid(0),sid=getsid(0);int ok=p>0&&old>0&&sid>0&&p!=old&&p!=sid;errno=257;pid_t created=API(setsid)();ok=ok&&created==p&&errno==257&&getpgid(0)==p&&getsid(0)==p;errno=0;ok=ok&&API(setsid)()==-1&&errno==EPERM;return ok;}
int next26_chroot_process(void){const char *root="/tmp/gnu-next26-root";int ok=mkdirat(AT_FDCWD,root,0700)==0;
 int f=__open64_nocancel("/tmp/gnu-next26-root/sentinel",O_CREAT|O_EXCL|O_WRONLY,0600);ok=ok&&f>=0;if(f>=0){ok=ok&&wr(f,"ROOT",4)==4;__close_nocancel(f);}
 errno=258;ok=ok&&API(chroot)(root)==0&&errno==258&&chdir("/")==0;
 f=__open64_nocancel("/sentinel",O_RDONLY,0);char b[4]={0};ok=ok&&f>=0&&rd(f,b,4)==4&&!memcmp(b,"ROOT",4);if(f>=0)__close_nocancel(f);
 errno=0;f=__open64_nocancel("/bin/gnu-allocator-probe",O_RDONLY,0);ok=ok&&f==-1&&errno==ENOENT;if(f>=0)__close_nocancel(f);return ok;
}
static __thread unsigned exec_dirty;
static void exec_cleanup(unsigned *p){(void)p;emit("GNU_NEXT26_EXEC_OLD_CLEANUP FAIL\n");}
void next26_exec_process(void){exec_dirty=157;unsigned value __attribute__((cleanup(exec_cleanup)))=157;
 char *args[]={"/bin/gnu-allocator-probe","next26-exec-target","gnu-public-exec",0};char *env[]={"GLIBC_TUNABLES=glibc.malloc.arena_max=1","GNU_NEXT26_EXEC=environment-sentinel",0};
 emit("GNU_NEXT26_EXEC active-cleanup public=execve\n");int r=API(execve)(args[0],args,env);(void)r;(void)value;CHECK("next26-public-exec-unexpected-return",0);_exit(99);
}
int next26_exec_target_fresh(void){return exec_dirty==0;}
