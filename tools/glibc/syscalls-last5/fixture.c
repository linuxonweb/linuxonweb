/* Genuine GNU public/historical volatile calls; raw read/write/umount are
   explicitly fixture transport, outside acceptance of those GNU APIs. */
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/pidfd.h>
#include <linux/capability.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <limits.h>
#include <string.h>
extern int capget(cap_user_header_t,cap_user_data_t);
extern int capset(cap_user_header_t,const struct __user_cap_data_struct *);
extern int pivot_root(const char *,const char *);
#define REF(n) extern __typeof__(&n) volatile public_reference_##n
REF(capget);REF(capset);REF(mount_setattr);REF(pidfd_send_signal);REF(pivot_root);
#define API(n) public_reference_##n
extern void last5_record(const char *,int);
extern int last5_raw(int,int,int,int,int,int,int);
extern int __open64_nocancel(const char *,int,...),__close_nocancel(int);
#define CHECK(n,x) last5_record(n,!!(x))
#define ERROR(n,x,e) do {errno=321;CHECK(n,(x)==-1&&errno==(e));}while(0)
struct guarded_header {unsigned char before[16];struct __user_cap_header_struct value;unsigned char after[16];};
struct guarded_caps {unsigned char before[16];struct __user_cap_data_struct value[2];unsigned char after[16];};
struct guarded_info {unsigned char before[16];siginfo_t value;unsigned char after[16];};
struct guarded_attr {unsigned char before[16];struct mount_attr value;unsigned char after[16];};
_Static_assert(__builtin_offsetof(struct guarded_info,value)==16&&__builtin_offsetof(struct guarded_info,after)==144&&sizeof(struct guarded_info)==160,"contiguous info guards");
_Static_assert(__builtin_offsetof(struct guarded_attr,value)==16&&__builtin_offsetof(struct guarded_attr,after)==48&&sizeof(struct guarded_attr)==64,"contiguous attr guards");
_Static_assert(__builtin_offsetof(struct guarded_caps,value)==16&&__builtin_offsetof(struct guarded_caps,after)==40&&sizeof(struct guarded_caps)==56,"contiguous cap guards");
static int guards(const unsigned char *a,const unsigned char *b){for(int i=0;i<16;i++)if(a[i]!=0xa5||b[i]!=0xa5)return 0;return 1;}
static void capabilities(void){
 struct guarded_header h;struct guarded_caps c;memset(&h,0xa5,sizeof(h));memset(&c,0xa5,sizeof(c));
 h.value.version=_LINUX_CAPABILITY_VERSION_3;h.value.pid=0;errno=322;
 int ok=API(capget)(&h.value,c.value)==0;CHECK("last5-capget-current",ok&&errno==322);
 CHECK("last5-capget-guards",guards(h.before,h.after)&&guards(c.before,c.after)&&h.value.version==_LINUX_CAPABILITY_VERSION_3&&h.value.pid==0);
 if(ok){struct guarded_caps saved=c;errno=322;CHECK("last5-capset-no-op",API(capset)(&h.value,c.value)==0&&errno==322);CHECK("last5-capset-input-unchanged",!memcmp(&saved,&c,sizeof(c)));
  struct guarded_caps again;memset(&again,0xa5,sizeof(again));CHECK("last5-capset-exact-capabilities-preserved",API(capget)(&h.value,again.value)==0&&!memcmp(c.value,again.value,sizeof(c.value))&&guards(again.before,again.after));}
 h.value.pid=-1;ERROR("last5-capget-negative-pid",API(capget)(&h.value,c.value),EINVAL);h.value.pid=INT_MAX;ERROR("last5-capget-missing-pid",API(capget)(&h.value,c.value),ESRCH);
 h.value.pid=0;h.value.version=0;ERROR("last5-capget-version-negotiation",API(capget)(&h.value,c.value),EINVAL);CHECK("last5-capget-latest-version-written",h.value.version==_LINUX_CAPABILITY_VERSION_3&&guards(h.before,h.after));
 h.value.version=0;errno=323;CHECK("last5-capget-null-data-negotiation",API(capget)(&h.value,0)==0&&h.value.version==_LINUX_CAPABILITY_VERSION_3&&errno==323);
 h.value.version=_LINUX_CAPABILITY_VERSION_3;ERROR("last5-capget-data-EFAULT",API(capget)(&h.value,(cap_user_data_t)(uintptr_t)UINT32_MAX),EFAULT);
 ERROR("last5-capset-data-EFAULT",API(capset)(&h.value,(void*)(uintptr_t)UINT32_MAX),EFAULT);
 h.value.pid=INT_MAX;ERROR("last5-capset-other-pid",API(capset)(&h.value,c.value),EPERM);
 h.value.pid=0;h.value.version=0;ERROR("last5-capset-invalid-version",API(capset)(&h.value,c.value),EINVAL);CHECK("last5-capset-version-written",h.value.version==_LINUX_CAPABILITY_VERSION_3);
}
static volatile int deliveries,delivered_code,delivered_pid,delivered_uid,delivered_value,delivered_errno;
static void receiver(int n,siginfo_t *s,void *u){(void)u;if(n==SIGUSR2){deliveries++;delivered_code=s->si_code;delivered_pid=s->si_pid;delivered_uid=s->si_uid;delivered_value=s->si_value.sival_int;delivered_errno=s->si_errno;}}
static void signals(void){
 struct sigaction a,old;memset(&a,0,sizeof(a));a.sa_sigaction=receiver;a.sa_flags=SA_SIGINFO;
 int installed=sigaction(SIGUSR2,&a,&old)==0;CHECK("last5-pidfd-handler-install",installed);int fd=pidfd_open(getpid(),0);CHECK("last5-pidfd-open-self",fd>=0);
 if(installed&&fd>=0){errno=324;CHECK("last5-pidfd-null-signal-zero",API(pidfd_send_signal)(fd,0,0,0)==0&&errno==324);
  struct guarded_info g;memset(&g,0xa5,sizeof(g));memset(&g.value,0,sizeof(g.value));g.value.si_signo=SIGUSR2;g.value.si_pid=getpid();g.value.si_uid=getuid();g.value.si_errno=17;
  int codes[3]={SI_QUEUE,SI_USER,SI_TKILL};
  for(int i=0;i<3;i++){g.value.si_code=codes[i];g.value.si_value.sival_int=0x5123a7c9;struct guarded_info copy=g;deliveries=0;errno=324;
   CHECK("last5-pidfd-real-callback",API(pidfd_send_signal)(fd,SIGUSR2,&g.value,0)==0&&deliveries==1&&errno==324);
   CHECK("last5-pidfd-callback-fields",delivered_code==codes[i]&&delivered_pid==getpid()&&delivered_uid==(int)getuid()&&delivered_errno==17&&(i!=0||delivered_value==0x5123a7c9));
   CHECK("last5-pidfd-input-preserved",!memcmp(&copy,&g,sizeof(g))&&guards(g.before,g.after));}
  g.value.si_code=SI_QUEUE;g.value.si_signo=SIGUSR1;ERROR("last5-pidfd-signo-mismatch",API(pidfd_send_signal)(fd,SIGUSR2,&g.value,0),EINVAL);
  g.value.si_signo=SIGUSR2;ERROR("last5-pidfd-flags",API(pidfd_send_signal)(fd,SIGUSR2,&g.value,0x80000000U),EINVAL);
  ERROR("last5-pidfd-info-EFAULT",API(pidfd_send_signal)(fd,SIGUSR2,(void*)(uintptr_t)UINT32_MAX,0),EFAULT);
  g.value.si_code=SI_TIMER;ERROR("last5-pidfd-unmeasured-class-rejected",API(pidfd_send_signal)(fd,SIGUSR2,&g.value,0),EOPNOTSUPP);
 }
 ERROR("last5-pidfd-invalid-fd",API(pidfd_send_signal)(-1,0,0,0),EBADF);
 if(fd>=0)__close_nocancel(fd);if(installed)CHECK("last5-pidfd-handler-restored",sigaction(SIGUSR2,&old,0)==0);
}
static int unmount(const char*p,int flags){return last5_raw(39,(int)(uintptr_t)p,flags,0,0,0,0);}
static int attach(const char *where){
 int c=fsopen("ramfs",FSOPEN_CLOEXEC);if(c<0)return 0;
 int ok=fsconfig(c,FSCONFIG_SET_STRING,"source","gnu-last5-owned",0)==0&&fsconfig(c,FSCONFIG_CMD_CREATE,0,0,0)==0;
 int m=ok?fsmount(c,FSMOUNT_CLOEXEC,0):-1;__close_nocancel(c);if(m<0)return 0;
 ok=move_mount(m,"",AT_FDCWD,where,MOVE_MOUNT_F_EMPTY_PATH)==0;__close_nocancel(m);return ok;
}
static int create_file(const char *p){int f=__open64_nocancel(p,O_CREAT|O_EXCL|O_WRONLY,0600);if(f<0)return 0;int ok=last5_raw(64,f,(int)(uintptr_t)"L5",2,0,0,0)==2;__close_nocancel(f);return ok;}
static void mounts(void){
 const char *p="/tmp/gnu-last5-mount";CHECK("last5-mountpoint-created",mkdirat(AT_FDCWD,p,0700)==0);int mounted=attach(p);CHECK("last5-configured-source-mount",mounted);
 if(mounted){struct guarded_attr g;memset(&g,0xa5,sizeof(g));memset(&g.value,0,sizeof(g.value));g.value.attr_set=MOUNT_ATTR_RDONLY;struct guarded_attr copy=g;
  errno=325;int ro=API(mount_setattr)(AT_FDCWD,p,0,&g.value,sizeof(g.value))==0;CHECK("last5-mount-set-readonly",ro&&errno==325);CHECK("last5-mount-attr-input-preserved",!memcmp(&g,&copy,sizeof(g))&&guards(g.before,g.after));
  if(ro)ERROR("last5-mount-readonly-enforced",__open64_nocancel("/tmp/gnu-last5-mount/file",O_CREAT|O_WRONLY,0600),EROFS);
  g.value.attr_set=0;g.value.attr_clr=MOUNT_ATTR_RDONLY;errno=325;CHECK("last5-mount-clear-readonly",API(mount_setattr)(AT_FDCWD,p,0,&g.value,sizeof(g.value))==0&&errno==325);
  CHECK("last5-mount-restored-write",create_file("/tmp/gnu-last5-mount/file"));CHECK("last5-mount-file-cleaned",unlinkat(AT_FDCWD,"/tmp/gnu-last5-mount/file",0)==0);
  ERROR("last5-mount-attr-too-short",API(mount_setattr)(AT_FDCWD,p,0,&g.value,31),EINVAL);
  ERROR("last5-mount-attr-too-large",API(mount_setattr)(AT_FDCWD,p,0,&g.value,65537),E2BIG);
  ERROR("last5-mount-invalid-flags",API(mount_setattr)(AT_FDCWD,p,0x80000000U,&g.value,32),EINVAL);
  ERROR("last5-mount-attr-EFAULT",API(mount_setattr)(AT_FDCWD,p,0,(void*)(uintptr_t)UINT32_MAX,32),EFAULT);
  CHECK("last5-owned-mount-unmounted",unmount(p,0)==0);
 }
 CHECK("last5-mountpoint-removed",unlinkat(AT_FDCWD,p,AT_REMOVEDIR)==0);
}
void last5_tests(void){capabilities();signals();mounts();}
int last5_thread_test(unsigned id){int saved=errno;errno=500+(int)id;int ok=API(pidfd_send_signal)(-1,0,0,0)==-1&&errno==EBADF;struct __user_cap_header_struct h={_LINUX_CAPABILITY_VERSION_3,-1};struct __user_cap_data_struct c[2];ok=ok&&API(capget)(&h,c)==-1&&errno==EINVAL;errno=saved;return ok;}
int last5_pivot_process(void){
 int ok=1,inside=0,pivoted=0,root_mounted=0,new_mounted=0;int outside=__open64_nocancel("/",O_RDONLY|O_DIRECTORY,0);if(outside<0)return 0;
 const char *a="/tmp/gnu-last5-pivot";ok=mkdirat(AT_FDCWD,a,0700)==0&&attach(a);root_mounted=ok;
 if(ok)ok=mkdirat(AT_FDCWD,"/tmp/gnu-last5-pivot/new",0700)==0&&mkdirat(AT_FDCWD,"/tmp/gnu-last5-pivot/returned",0700)==0&&create_file("/tmp/gnu-last5-pivot/old-sentinel")&&attach("/tmp/gnu-last5-pivot/new");new_mounted=ok;
 if(ok)ok=mkdirat(AT_FDCWD,"/tmp/gnu-last5-pivot/new/old",0700)==0&&create_file("/tmp/gnu-last5-pivot/new/new-sentinel");
 if(ok){inside=chroot(a)==0;ok=inside&&chdir("/")==0;}
 if(ok){errno=326;pivoted=API(pivot_root)("/new","/new/old")==0;ok=pivoted&&errno==326;}
 if(ok){struct stat st;ok=stat("/new-sentinel",&st)==0&&st.st_size==2&&stat("/old/old-sentinel",&st)==0&&st.st_size==2;}
 if(pivoted){errno=326;int reversed=API(pivot_root)("/old","/old/returned")==0;ok=ok&&reversed&&errno==326;if(reversed)pivoted=0;}
 if(inside){int restored=fchdir(outside)==0&&chroot(".")==0&&chdir("/")==0;ok=ok&&restored;if(!restored){__close_nocancel(outside);return 0;}}
 __close_nocancel(outside);
 if(new_mounted){const char *b=pivoted?"/tmp/gnu-last5-pivot/new":"/tmp/gnu-last5-pivot/returned";int r=unmount(b,0);if(r){unmount("/tmp/gnu-last5-pivot/new",2);ok=0;}}
 if(root_mounted){int r=unmount(a,0);if(r){unmount(a,2);ok=0;}}
 if(unlinkat(AT_FDCWD,a,AT_REMOVEDIR))ok=0;
 errno=327;ok=ok&&API(pivot_root)("/gnu-last5-missing","/gnu-last5-missing/old")==-1&&errno==ENOENT;
 return ok;
}
