/* Independent constraints against installed genuine GNU public declarations. */
#include <unistd.h>
#include <linux/capability.h>
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
extern int capget(cap_user_header_t,cap_user_data_t);
extern int capset(cap_user_header_t,const struct __user_cap_data_struct *);
extern int pivot_root(const char *,const char *);
VERIFY(capget,int,cap_user_header_t,cap_user_data_t);
VERIFY(capset,int,cap_user_header_t,const struct __user_cap_data_struct *);
VERIFY(mount_setattr,int,int,const char *,unsigned int,struct mount_attr *,size_t);
VERIFY(pidfd_send_signal,int,int,int,siginfo_t *,unsigned int);
VERIFY(pivot_root,int,const char *,const char *);
_Static_assert(sizeof(size_t)==4 && sizeof(pid_t)==4,"audited scalar32 ABI");
