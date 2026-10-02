/* Independent GNU public C type constraints, separate from the backend table. */
#include <unistd.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <sys/file.h>
#include <sys/eventfd.h>
#include <sys/epoll.h>
#include <sys/inotify.h>
#include <sys/timerfd.h>
#include <sys/mman.h>
#include <sched.h>
#define VERIFY(name,result,...) \
 _Static_assert(__builtin_types_compatible_p(__typeof__(&name),result (*)(__VA_ARGS__)),#name " genuine GNU prototype"); \
 __typeof__(&name) volatile public_reference_##name=&name
VERIFY(setxattr,int,const char *,const char *,const void *,size_t,int);
VERIFY(lsetxattr,int,const char *,const char *,const void *,size_t,int);
VERIFY(fsetxattr,int,int,const char *,const void *,size_t,int);
VERIFY(getxattr,ssize_t,const char *,const char *,void *,size_t);
VERIFY(lgetxattr,ssize_t,const char *,const char *,void *,size_t);
VERIFY(fgetxattr,ssize_t,int,const char *,void *,size_t);
VERIFY(listxattr,ssize_t,const char *,char *,size_t);
VERIFY(llistxattr,ssize_t,const char *,char *,size_t);
VERIFY(flistxattr,ssize_t,int,char *,size_t);
VERIFY(removexattr,int,const char *,const char *);
VERIFY(lremovexattr,int,const char *,const char *);
VERIFY(fremovexattr,int,int,const char *);
VERIFY(linkat,int,int,const char *,int,const char *,int);
VERIFY(symlinkat,int,const char *,int,const char *);
VERIFY(fchownat,int,int,const char *,uid_t,gid_t,int);
VERIFY(umask,mode_t,mode_t);
VERIFY(pipe2,int,int *,int);
VERIFY(flock,int,int,int);
VERIFY(syncfs,int,int);
VERIFY(close_range,int,unsigned int,unsigned int,int);
VERIFY(eventfd,int,unsigned int,int);
VERIFY(epoll_create1,int,int);
VERIFY(inotify_init1,int,int);
VERIFY(inotify_add_watch,int,int,const char *,uint32_t);
VERIFY(inotify_rm_watch,int,int,int);
VERIFY(timerfd_create,int,clockid_t,int);
VERIFY(memfd_create,int,const char *,unsigned int);
VERIFY(getpgid,pid_t,pid_t);
VERIFY(getsid,pid_t,pid_t);
VERIFY(sched_yield,int,void);
VERIFY(sched_get_priority_max,int,int);
VERIFY(sched_get_priority_min,int,int);
VERIFY(getgroups,int,int,gid_t *);
VERIFY(getresuid,int,uid_t *,uid_t *,uid_t *);
VERIFY(getresgid,int,gid_t *,gid_t *,gid_t *);
VERIFY(setpgid,int,pid_t,pid_t);
_Static_assert(sizeof(uid_t)==4 && _Alignof(uid_t)==4,"kernel uid32");
_Static_assert(sizeof(gid_t)==4 && _Alignof(gid_t)==4,"kernel gid32");
_Static_assert(sizeof(mode_t)==4 && sizeof(pid_t)==4 && sizeof(ssize_t)==4,"audited scalar32 ABI");
