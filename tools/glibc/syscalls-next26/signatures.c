/* Independent constraints against installed genuine GNU public declarations. */
#include <unistd.h>
#include <sys/swap.h>
#include <sys/fsuid.h>
#include <sys/mount.h>
#include <sched.h>
#include <sys/pidfd.h>
#include <sys/klog.h>
#include <sys/resource.h>
#include <sys/fanotify.h>
#include <signal.h>
#define VERIFY(name,result,...) \
 _Static_assert(__builtin_types_compatible_p(__typeof__(&name),result (*)(__VA_ARGS__)),#name " genuine GNU prototype"); \
 __typeof__(&name) volatile public_reference_##name=&name
VERIFY(swapoff,int,const char *);
VERIFY(swapon,int,const char *,int);
VERIFY(setfsuid,int,uid_t);
VERIFY(setfsgid,int,gid_t);
VERIFY(chroot,int,const char *);
VERIFY(acct,int,const char *);
VERIFY(setsid,pid_t,void);
VERIFY(sethostname,int,const char *,size_t);
VERIFY(setdomainname,int,const char *,size_t);
VERIFY(execve,int,const char *,char *const *,char *const *);
VERIFY(mount,int,const char *,const char *,const char *,unsigned long int,const void *);
VERIFY(fsopen,int,const char *,unsigned int);
VERIFY(fsmount,int,int,unsigned int,unsigned int);
VERIFY(fsconfig,int,int,unsigned int,const char *,const void *,int);
VERIFY(fspick,int,int,const char *,unsigned int);
VERIFY(open_tree,int,int,const char *,unsigned int);
VERIFY(move_mount,int,int,const char *,int,const char *,unsigned int);
VERIFY(unshare,int,int);
VERIFY(setns,int,int,int);
VERIFY(sched_getscheduler,int,pid_t);
VERIFY(pidfd_open,int,pid_t,unsigned int);
VERIFY(pidfd_getfd,int,int,int,unsigned int);
VERIFY(klogctl,int,int,char *,int);
VERIFY(setpriority,int,__priority_which_t,id_t,int);
VERIFY(fanotify_init,int,unsigned int,unsigned int);
VERIFY(tgkill,int,pid_t,pid_t,int);
_Static_assert(sizeof(unsigned long)==4 && sizeof(size_t)==4 && sizeof(pid_t)==4 && sizeof(id_t)==4,"audited kernel scalar32 ABI");
_Static_assert(sizeof(uid_t)==4 && sizeof(gid_t)==4,"kernel UID/GID32 ABI");
