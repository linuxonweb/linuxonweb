/* Native Wasm architecture template, compiled as C by compile-syscall.py.
   GNU make-syscalls.sh supplies all entry names and alias declarations.
   Only explicitly audited i32/pointer signatures are accepted here. */
#include <sysdep.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>
#include <bits/types/struct_sched_param.h>
#include <sched.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/file.h>
#include <sys/inotify.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/timerfd.h>
#include <sys/xattr.h>
#include <unistd.h>

#include <sys/swap.h>
#include <sys/fsuid.h>
#include <sys/mount.h>
#include <sys/pidfd.h>
#include <sys/klog.h>
#include <sys/resource.h>
#include <sys/fanotify.h>
#include <sys/utsname.h>
#include <sys/sysinfo.h>
#include <sys/quota.h>
#include <fcntl.h>
#include <sys/uio.h>

#define WASM_ACCEPT_sched_setparam 1
#define WASM_ACCEPT_sched_getparam 1
#define WASM_ACCEPT_sched_setscheduler 1
#define WASM_ACCEPT_mlock 1
#define WASM_ACCEPT_quotactl 1
#define WASM_ACCEPT_name_to_handle_at 1
#define WASM_ACCEPT_process_madvise 1
#define WASM_ACCEPT_mseal 1
#define WASM_ACCEPT_sysinfo 1
#define WASM_ACCEPT_pkey_alloc 1
#define WASM_ACCEPT_munlock 1
#define WASM_ACCEPT_uname 1
#define WASM_ACCEPT_remap_file_pages 1
#define WASM_ACCEPT_process_mrelease 1
#define WASM_ACCEPT_munlockall 1
#define WASM_ACCEPT_mlockall 1
#define WASM_ACCEPT_epoll_ctl 1
#define WASM_ACCEPT_pkey_free 1
#define WASM_ACCEPT_mincore 1
#define WASM_ACCEPT_setxattr 1
#define WASM_ACCEPT_lsetxattr 1
#define WASM_ACCEPT_fsetxattr 1
#define WASM_ACCEPT_getxattr 1
#define WASM_ACCEPT_lgetxattr 1
#define WASM_ACCEPT_fgetxattr 1
#define WASM_ACCEPT_listxattr 1
#define WASM_ACCEPT_llistxattr 1
#define WASM_ACCEPT_flistxattr 1
#define WASM_ACCEPT_removexattr 1
#define WASM_ACCEPT_lremovexattr 1
#define WASM_ACCEPT_fremovexattr 1
#define WASM_ACCEPT_linkat 1
#define WASM_ACCEPT_symlinkat 1
#define WASM_ACCEPT_fchownat 1
#define WASM_ACCEPT_umask 1
#define WASM_ACCEPT_pipe2 1
#define WASM_ACCEPT_flock 1
#define WASM_ACCEPT_syncfs 1
#define WASM_ACCEPT_close_range 1
#define WASM_ACCEPT_eventfd2 1
#define WASM_ACCEPT_epoll_create1 1
#define WASM_ACCEPT_inotify_init1 1
#define WASM_ACCEPT_inotify_add_watch 1
#define WASM_ACCEPT_inotify_rm_watch 1
#define WASM_ACCEPT_timerfd_create 1
#define WASM_ACCEPT_memfd_create 1
#define WASM_ACCEPT_getpgid 1
#define WASM_ACCEPT_getsid 1
#define WASM_ACCEPT_sched_yield 1
#define WASM_ACCEPT_sched_get_priority_max 1
#define WASM_ACCEPT_sched_get_priority_min 1
#define WASM_ACCEPT_getgroups 1
#define WASM_ACCEPT_getresuid 1
#define WASM_ACCEPT_getresgid 1
#define WASM_ACCEPT_setpgid 1
#define WASM_ACCEPT_sigaltstack 1
#define WASM_ACCEPT_getpid 1
#define WASM_ACCEPT_getppid 1
#define WASM_ACCEPT_getuid 1
#define WASM_ACCEPT_geteuid 1
#define WASM_ACCEPT_getgid 1
#define WASM_ACCEPT_getegid 1
#define WASM_ACCEPT_gettid 1
#define WASM_ACCEPT_kill 1
#define WASM_ACCEPT_close 1
#define WASM_ACCEPT_dup 1
#define WASM_ACCEPT_dup3 1
#define WASM_ACCEPT_chdir 1
#define WASM_ACCEPT_fchdir 1
#define WASM_ACCEPT_unlinkat 1
#define WASM_ACCEPT_mkdirat 1
#define WASM_ACCEPT_renameat 1
#define WASM_ACCEPT_readlinkat 1
#define WASM_ACCEPT_fchmod 1
#define WASM_ACCEPT_fchown 1
#define WASM_ACCEPT_swapoff 1
#define WASM_ACCEPT_setfsgid 1
#define WASM_ACCEPT_chroot 1
#define WASM_ACCEPT_acct 1
#define WASM_ACCEPT_fsmount 1
#define WASM_ACCEPT_setsid 1
#define WASM_ACCEPT_unshare 1
#define WASM_ACCEPT_mount 1
#define WASM_ACCEPT_swapon 1
#define WASM_ACCEPT_pidfd_open 1
#define WASM_ACCEPT_setdomainname 1
#define WASM_ACCEPT_fsopen 1
#define WASM_ACCEPT_syslog 1
#define WASM_ACCEPT_setpriority 1
#define WASM_ACCEPT_fsconfig 1
#define WASM_ACCEPT_setns 1
#define WASM_ACCEPT_open_tree 1
#define WASM_ACCEPT_sched_getscheduler 1
#define WASM_ACCEPT_setfsuid 1
#define WASM_ACCEPT_sethostname 1
#define WASM_ACCEPT_pidfd_getfd 1
#define WASM_ACCEPT_fanotify_init 1
#define WASM_ACCEPT_fspick 1
#define WASM_ACCEPT_move_mount 1
#define WASM_ACCEPT_tgkill 1
#define WASM_ACCEPT_execve 1
#define WASM_CAT_I(a,b) a##b
#define WASM_CAT(a,b) WASM_CAT_I(a,b)
#if !WASM_CAT(WASM_ACCEPT_,SYSCALL_NAME)
# error "GNU generated syscall has no audited native Wasm public signature"
#else
#define WASM_RETURN_sigaltstack int
#define WASM_ARGS_sigaltstack const stack_t *a0,stack_t *a1
#define WASM_NARGS_sigaltstack 2
#define WASM_RETURN_getpid pid_t
#define WASM_ARGS_getpid void
#define WASM_NARGS_getpid 0
#define WASM_RETURN_getppid pid_t
#define WASM_ARGS_getppid void
#define WASM_NARGS_getppid 0
#define WASM_RETURN_getuid uid_t
#define WASM_ARGS_getuid void
#define WASM_NARGS_getuid 0
#define WASM_RETURN_geteuid uid_t
#define WASM_ARGS_geteuid void
#define WASM_NARGS_geteuid 0
#define WASM_RETURN_getgid gid_t
#define WASM_ARGS_getgid void
#define WASM_NARGS_getgid 0
#define WASM_RETURN_getegid gid_t
#define WASM_ARGS_getegid void
#define WASM_NARGS_getegid 0
#define WASM_RETURN_gettid pid_t
#define WASM_ARGS_gettid void
#define WASM_NARGS_gettid 0
#define WASM_RETURN_kill int
#define WASM_ARGS_kill pid_t a0,int a1
#define WASM_NARGS_kill 2
#define WASM_RETURN_close int
#define WASM_ARGS_close int a0
#define WASM_NARGS_close 1
#define WASM_RETURN_dup int
#define WASM_ARGS_dup int a0
#define WASM_NARGS_dup 1
#define WASM_RETURN_dup3 int
#define WASM_ARGS_dup3 int a0,int a1,int a2
#define WASM_NARGS_dup3 3
#define WASM_RETURN_chdir int
#define WASM_ARGS_chdir const char *a0
#define WASM_NARGS_chdir 1
#define WASM_RETURN_fchdir int
#define WASM_ARGS_fchdir int a0
#define WASM_NARGS_fchdir 1
#define WASM_RETURN_unlinkat int
#define WASM_ARGS_unlinkat int a0,const char *a1,int a2
#define WASM_NARGS_unlinkat 3
#define WASM_RETURN_mkdirat int
#define WASM_ARGS_mkdirat int a0,const char *a1,mode_t a2
#define WASM_NARGS_mkdirat 3
#define WASM_RETURN_renameat int
#define WASM_ARGS_renameat int a0,const char *a1,int a2,const char *a3
#define WASM_NARGS_renameat 4
#define WASM_RETURN_readlinkat ssize_t
#define WASM_ARGS_readlinkat int a0,const char *a1,char *a2,size_t a3
#define WASM_NARGS_readlinkat 4
#define WASM_RETURN_fchmod int
#define WASM_ARGS_fchmod int a0,mode_t a1
#define WASM_NARGS_fchmod 2
#define WASM_RETURN_fchown int
#define WASM_ARGS_fchown int a0,uid_t a1,gid_t a2
#define WASM_NARGS_fchown 3
#define WASM_RETURN_setxattr int
#define WASM_ARGS_setxattr const char * a0, const char * a1, const void * a2, size_t a3, int a4
#define WASM_NARGS_setxattr 5
#define WASM_PUBLIC_setxattr setxattr
#define WASM_NEW_setxattr 1
#define WASM_NOERRNO_setxattr 0
#define WASM_RETURN_lsetxattr int
#define WASM_ARGS_lsetxattr const char * a0, const char * a1, const void * a2, size_t a3, int a4
#define WASM_NARGS_lsetxattr 5
#define WASM_PUBLIC_lsetxattr lsetxattr
#define WASM_NEW_lsetxattr 1
#define WASM_NOERRNO_lsetxattr 0
#define WASM_RETURN_fsetxattr int
#define WASM_ARGS_fsetxattr int a0, const char * a1, const void * a2, size_t a3, int a4
#define WASM_NARGS_fsetxattr 5
#define WASM_PUBLIC_fsetxattr fsetxattr
#define WASM_NEW_fsetxattr 1
#define WASM_NOERRNO_fsetxattr 0
#define WASM_RETURN_getxattr ssize_t
#define WASM_ARGS_getxattr const char * a0, const char * a1, void * a2, size_t a3
#define WASM_NARGS_getxattr 4
#define WASM_PUBLIC_getxattr getxattr
#define WASM_NEW_getxattr 1
#define WASM_NOERRNO_getxattr 0
#define WASM_RETURN_lgetxattr ssize_t
#define WASM_ARGS_lgetxattr const char * a0, const char * a1, void * a2, size_t a3
#define WASM_NARGS_lgetxattr 4
#define WASM_PUBLIC_lgetxattr lgetxattr
#define WASM_NEW_lgetxattr 1
#define WASM_NOERRNO_lgetxattr 0
#define WASM_RETURN_fgetxattr ssize_t
#define WASM_ARGS_fgetxattr int a0, const char * a1, void * a2, size_t a3
#define WASM_NARGS_fgetxattr 4
#define WASM_PUBLIC_fgetxattr fgetxattr
#define WASM_NEW_fgetxattr 1
#define WASM_NOERRNO_fgetxattr 0
#define WASM_RETURN_listxattr ssize_t
#define WASM_ARGS_listxattr const char * a0, char * a1, size_t a2
#define WASM_NARGS_listxattr 3
#define WASM_PUBLIC_listxattr listxattr
#define WASM_NEW_listxattr 1
#define WASM_NOERRNO_listxattr 0
#define WASM_RETURN_llistxattr ssize_t
#define WASM_ARGS_llistxattr const char * a0, char * a1, size_t a2
#define WASM_NARGS_llistxattr 3
#define WASM_PUBLIC_llistxattr llistxattr
#define WASM_NEW_llistxattr 1
#define WASM_NOERRNO_llistxattr 0
#define WASM_RETURN_flistxattr ssize_t
#define WASM_ARGS_flistxattr int a0, char * a1, size_t a2
#define WASM_NARGS_flistxattr 3
#define WASM_PUBLIC_flistxattr flistxattr
#define WASM_NEW_flistxattr 1
#define WASM_NOERRNO_flistxattr 0
#define WASM_RETURN_removexattr int
#define WASM_ARGS_removexattr const char * a0, const char * a1
#define WASM_NARGS_removexattr 2
#define WASM_PUBLIC_removexattr removexattr
#define WASM_NEW_removexattr 1
#define WASM_NOERRNO_removexattr 0
#define WASM_RETURN_lremovexattr int
#define WASM_ARGS_lremovexattr const char * a0, const char * a1
#define WASM_NARGS_lremovexattr 2
#define WASM_PUBLIC_lremovexattr lremovexattr
#define WASM_NEW_lremovexattr 1
#define WASM_NOERRNO_lremovexattr 0
#define WASM_RETURN_fremovexattr int
#define WASM_ARGS_fremovexattr int a0, const char * a1
#define WASM_NARGS_fremovexattr 2
#define WASM_PUBLIC_fremovexattr fremovexattr
#define WASM_NEW_fremovexattr 1
#define WASM_NOERRNO_fremovexattr 0
#define WASM_RETURN_linkat int
#define WASM_ARGS_linkat int a0, const char * a1, int a2, const char * a3, int a4
#define WASM_NARGS_linkat 5
#define WASM_PUBLIC_linkat linkat
#define WASM_NEW_linkat 1
#define WASM_NOERRNO_linkat 0
#define WASM_RETURN_symlinkat int
#define WASM_ARGS_symlinkat const char * a0, int a1, const char * a2
#define WASM_NARGS_symlinkat 3
#define WASM_PUBLIC_symlinkat symlinkat
#define WASM_NEW_symlinkat 1
#define WASM_NOERRNO_symlinkat 0
#define WASM_RETURN_fchownat int
#define WASM_ARGS_fchownat int a0, const char * a1, uid_t a2, gid_t a3, int a4
#define WASM_NARGS_fchownat 5
#define WASM_PUBLIC_fchownat fchownat
#define WASM_NEW_fchownat 1
#define WASM_NOERRNO_fchownat 0
#define WASM_RETURN_umask mode_t
#define WASM_ARGS_umask mode_t a0
#define WASM_NARGS_umask 1
#define WASM_PUBLIC_umask umask
#define WASM_NEW_umask 1
#define WASM_NOERRNO_umask 1
#define WASM_RETURN_pipe2 int
#define WASM_ARGS_pipe2 int * a0, int a1
#define WASM_NARGS_pipe2 2
#define WASM_PUBLIC_pipe2 pipe2
#define WASM_NEW_pipe2 1
#define WASM_NOERRNO_pipe2 0
#define WASM_RETURN_flock int
#define WASM_ARGS_flock int a0, int a1
#define WASM_NARGS_flock 2
#define WASM_PUBLIC_flock flock
#define WASM_NEW_flock 1
#define WASM_NOERRNO_flock 0
#define WASM_RETURN_syncfs int
#define WASM_ARGS_syncfs int a0
#define WASM_NARGS_syncfs 1
#define WASM_PUBLIC_syncfs syncfs
#define WASM_NEW_syncfs 1
#define WASM_NOERRNO_syncfs 0
#define WASM_RETURN_close_range int
#define WASM_ARGS_close_range unsigned int a0, unsigned int a1, int a2
#define WASM_NARGS_close_range 3
#define WASM_PUBLIC_close_range close_range
#define WASM_NEW_close_range 1
#define WASM_NOERRNO_close_range 0
#define WASM_RETURN_eventfd2 int
#define WASM_ARGS_eventfd2 unsigned int a0, int a1
#define WASM_NARGS_eventfd2 2
#define WASM_PUBLIC_eventfd2 eventfd
#define WASM_NEW_eventfd2 1
#define WASM_NOERRNO_eventfd2 0
#define WASM_RETURN_epoll_create1 int
#define WASM_ARGS_epoll_create1 int a0
#define WASM_NARGS_epoll_create1 1
#define WASM_PUBLIC_epoll_create1 epoll_create1
#define WASM_NEW_epoll_create1 1
#define WASM_NOERRNO_epoll_create1 0
#define WASM_RETURN_inotify_init1 int
#define WASM_ARGS_inotify_init1 int a0
#define WASM_NARGS_inotify_init1 1
#define WASM_PUBLIC_inotify_init1 inotify_init1
#define WASM_NEW_inotify_init1 1
#define WASM_NOERRNO_inotify_init1 0
#define WASM_RETURN_inotify_add_watch int
#define WASM_ARGS_inotify_add_watch int a0, const char * a1, uint32_t a2
#define WASM_NARGS_inotify_add_watch 3
#define WASM_PUBLIC_inotify_add_watch inotify_add_watch
#define WASM_NEW_inotify_add_watch 1
#define WASM_NOERRNO_inotify_add_watch 0
#define WASM_RETURN_inotify_rm_watch int
#define WASM_ARGS_inotify_rm_watch int a0, int a1
#define WASM_NARGS_inotify_rm_watch 2
#define WASM_PUBLIC_inotify_rm_watch inotify_rm_watch
#define WASM_NEW_inotify_rm_watch 1
#define WASM_NOERRNO_inotify_rm_watch 0
#define WASM_RETURN_timerfd_create int
#define WASM_ARGS_timerfd_create clockid_t a0, int a1
#define WASM_NARGS_timerfd_create 2
#define WASM_PUBLIC_timerfd_create timerfd_create
#define WASM_NEW_timerfd_create 1
#define WASM_NOERRNO_timerfd_create 0
#define WASM_RETURN_memfd_create int
#define WASM_ARGS_memfd_create const char * a0, unsigned int a1
#define WASM_NARGS_memfd_create 2
#define WASM_PUBLIC_memfd_create memfd_create
#define WASM_NEW_memfd_create 1
#define WASM_NOERRNO_memfd_create 0
#define WASM_RETURN_getpgid pid_t
#define WASM_ARGS_getpgid pid_t a0
#define WASM_NARGS_getpgid 1
#define WASM_PUBLIC_getpgid getpgid
#define WASM_NEW_getpgid 1
#define WASM_NOERRNO_getpgid 0
#define WASM_RETURN_getsid pid_t
#define WASM_ARGS_getsid pid_t a0
#define WASM_NARGS_getsid 1
#define WASM_PUBLIC_getsid getsid
#define WASM_NEW_getsid 1
#define WASM_NOERRNO_getsid 0
#define WASM_RETURN_sched_yield int
#define WASM_ARGS_sched_yield void
#define WASM_NARGS_sched_yield 0
#define WASM_PUBLIC_sched_yield sched_yield
#define WASM_NEW_sched_yield 1
#define WASM_NOERRNO_sched_yield 0
#define WASM_RETURN_sched_get_priority_max int
#define WASM_ARGS_sched_get_priority_max int a0
#define WASM_NARGS_sched_get_priority_max 1
#define WASM_PUBLIC_sched_get_priority_max sched_get_priority_max
#define WASM_NEW_sched_get_priority_max 1
#define WASM_NOERRNO_sched_get_priority_max 0
#define WASM_RETURN_sched_get_priority_min int
#define WASM_ARGS_sched_get_priority_min int a0
#define WASM_NARGS_sched_get_priority_min 1
#define WASM_PUBLIC_sched_get_priority_min sched_get_priority_min
#define WASM_NEW_sched_get_priority_min 1
#define WASM_NOERRNO_sched_get_priority_min 0
#define WASM_RETURN_getgroups int
#define WASM_ARGS_getgroups int a0, gid_t * a1
#define WASM_NARGS_getgroups 2
#define WASM_PUBLIC_getgroups getgroups
#define WASM_NEW_getgroups 1
#define WASM_NOERRNO_getgroups 0
#define WASM_RETURN_getresuid int
#define WASM_ARGS_getresuid uid_t * a0, uid_t * a1, uid_t * a2
#define WASM_NARGS_getresuid 3
#define WASM_PUBLIC_getresuid getresuid
#define WASM_NEW_getresuid 1
#define WASM_NOERRNO_getresuid 0
#define WASM_RETURN_getresgid int
#define WASM_ARGS_getresgid gid_t * a0, gid_t * a1, gid_t * a2
#define WASM_NARGS_getresgid 3
#define WASM_PUBLIC_getresgid getresgid
#define WASM_NEW_getresgid 1
#define WASM_NOERRNO_getresgid 0
#define WASM_RETURN_setpgid int
#define WASM_ARGS_setpgid pid_t a0, pid_t a1
#define WASM_NARGS_setpgid 2
#define WASM_PUBLIC_setpgid setpgid
#define WASM_NEW_setpgid 1
#define WASM_NOERRNO_setpgid 0
#define WASM_RETURN_swapoff int
#define WASM_ARGS_swapoff const char * a0
#define WASM_NARGS_swapoff 1
#define WASM_PUBLIC_swapoff swapoff
#define WASM_NEW_swapoff 1
#define WASM_NOERRNO_swapoff 0
#define WASM_RETURN_setfsgid int
#define WASM_ARGS_setfsgid gid_t a0
#define WASM_NARGS_setfsgid 1
#define WASM_PUBLIC_setfsgid setfsgid
#define WASM_NEW_setfsgid 1
#define WASM_NOERRNO_setfsgid 0
#define WASM_RETURN_chroot int
#define WASM_ARGS_chroot const char * a0
#define WASM_NARGS_chroot 1
#define WASM_PUBLIC_chroot chroot
#define WASM_NEW_chroot 1
#define WASM_NOERRNO_chroot 0
#define WASM_RETURN_acct int
#define WASM_ARGS_acct const char * a0
#define WASM_NARGS_acct 1
#define WASM_PUBLIC_acct acct
#define WASM_NEW_acct 1
#define WASM_NOERRNO_acct 0
#define WASM_RETURN_fsmount int
#define WASM_ARGS_fsmount int a0, unsigned int a1, unsigned int a2
#define WASM_NARGS_fsmount 3
#define WASM_PUBLIC_fsmount fsmount
#define WASM_NEW_fsmount 1
#define WASM_NOERRNO_fsmount 0
#define WASM_RETURN_setsid pid_t
#define WASM_ARGS_setsid void
#define WASM_NARGS_setsid 0
#define WASM_PUBLIC_setsid setsid
#define WASM_NEW_setsid 1
#define WASM_NOERRNO_setsid 0
#define WASM_RETURN_unshare int
#define WASM_ARGS_unshare int a0
#define WASM_NARGS_unshare 1
#define WASM_PUBLIC_unshare unshare
#define WASM_NEW_unshare 1
#define WASM_NOERRNO_unshare 0
#define WASM_RETURN_mount int
#define WASM_ARGS_mount const char * a0, const char * a1, const char * a2, unsigned long int a3, const void * a4
#define WASM_NARGS_mount 5
#define WASM_PUBLIC_mount mount
#define WASM_NEW_mount 1
#define WASM_NOERRNO_mount 0
#define WASM_RETURN_swapon int
#define WASM_ARGS_swapon const char * a0, int a1
#define WASM_NARGS_swapon 2
#define WASM_PUBLIC_swapon swapon
#define WASM_NEW_swapon 1
#define WASM_NOERRNO_swapon 0
#define WASM_RETURN_pidfd_open int
#define WASM_ARGS_pidfd_open pid_t a0, unsigned int a1
#define WASM_NARGS_pidfd_open 2
#define WASM_PUBLIC_pidfd_open pidfd_open
#define WASM_NEW_pidfd_open 1
#define WASM_NOERRNO_pidfd_open 0
#define WASM_RETURN_setdomainname int
#define WASM_ARGS_setdomainname const char * a0, size_t a1
#define WASM_NARGS_setdomainname 2
#define WASM_PUBLIC_setdomainname setdomainname
#define WASM_NEW_setdomainname 1
#define WASM_NOERRNO_setdomainname 0
#define WASM_RETURN_fsopen int
#define WASM_ARGS_fsopen const char * a0, unsigned int a1
#define WASM_NARGS_fsopen 2
#define WASM_PUBLIC_fsopen fsopen
#define WASM_NEW_fsopen 1
#define WASM_NOERRNO_fsopen 0
#define WASM_RETURN_syslog int
#define WASM_ARGS_syslog int a0, char * a1, int a2
#define WASM_NARGS_syslog 3
#define WASM_PUBLIC_syslog klogctl
#define WASM_NEW_syslog 1
#define WASM_NOERRNO_syslog 0
#define WASM_RETURN_setpriority int
#define WASM_ARGS_setpriority __priority_which_t a0, id_t a1, int a2
#define WASM_NARGS_setpriority 3
#define WASM_PUBLIC_setpriority setpriority
#define WASM_NEW_setpriority 1
#define WASM_NOERRNO_setpriority 0
#define WASM_RETURN_fsconfig int
#define WASM_ARGS_fsconfig int a0, unsigned int a1, const char * a2, const void * a3, int a4
#define WASM_NARGS_fsconfig 5
#define WASM_PUBLIC_fsconfig fsconfig
#define WASM_NEW_fsconfig 1
#define WASM_NOERRNO_fsconfig 0
#define WASM_RETURN_setns int
#define WASM_ARGS_setns int a0, int a1
#define WASM_NARGS_setns 2
#define WASM_PUBLIC_setns setns
#define WASM_NEW_setns 1
#define WASM_NOERRNO_setns 0
#define WASM_RETURN_open_tree int
#define WASM_ARGS_open_tree int a0, const char * a1, unsigned int a2
#define WASM_NARGS_open_tree 3
#define WASM_PUBLIC_open_tree open_tree
#define WASM_NEW_open_tree 1
#define WASM_NOERRNO_open_tree 0
#define WASM_RETURN_sched_getscheduler int
#define WASM_ARGS_sched_getscheduler pid_t a0
#define WASM_NARGS_sched_getscheduler 1
#define WASM_PUBLIC_sched_getscheduler sched_getscheduler
#define WASM_NEW_sched_getscheduler 1
#define WASM_NOERRNO_sched_getscheduler 0
#define WASM_RETURN_setfsuid int
#define WASM_ARGS_setfsuid uid_t a0
#define WASM_NARGS_setfsuid 1
#define WASM_PUBLIC_setfsuid setfsuid
#define WASM_NEW_setfsuid 1
#define WASM_NOERRNO_setfsuid 0
#define WASM_RETURN_sethostname int
#define WASM_ARGS_sethostname const char * a0, size_t a1
#define WASM_NARGS_sethostname 2
#define WASM_PUBLIC_sethostname sethostname
#define WASM_NEW_sethostname 1
#define WASM_NOERRNO_sethostname 0
#define WASM_RETURN_pidfd_getfd int
#define WASM_ARGS_pidfd_getfd int a0, int a1, unsigned int a2
#define WASM_NARGS_pidfd_getfd 3
#define WASM_PUBLIC_pidfd_getfd pidfd_getfd
#define WASM_NEW_pidfd_getfd 1
#define WASM_NOERRNO_pidfd_getfd 0
#define WASM_RETURN_fanotify_init int
#define WASM_ARGS_fanotify_init unsigned int a0, unsigned int a1
#define WASM_NARGS_fanotify_init 2
#define WASM_PUBLIC_fanotify_init fanotify_init
#define WASM_NEW_fanotify_init 1
#define WASM_NOERRNO_fanotify_init 0
#define WASM_RETURN_fspick int
#define WASM_ARGS_fspick int a0, const char * a1, unsigned int a2
#define WASM_NARGS_fspick 3
#define WASM_PUBLIC_fspick fspick
#define WASM_NEW_fspick 1
#define WASM_NOERRNO_fspick 0
#define WASM_RETURN_move_mount int
#define WASM_ARGS_move_mount int a0, const char * a1, int a2, const char * a3, unsigned int a4
#define WASM_NARGS_move_mount 5
#define WASM_PUBLIC_move_mount move_mount
#define WASM_NEW_move_mount 1
#define WASM_NOERRNO_move_mount 0
#define WASM_RETURN_tgkill int
#define WASM_ARGS_tgkill pid_t a0, pid_t a1, int a2
#define WASM_NARGS_tgkill 3
#define WASM_PUBLIC_tgkill tgkill
#define WASM_NEW_tgkill 1
#define WASM_NOERRNO_tgkill 0
#define WASM_RETURN_execve int
#define WASM_ARGS_execve const char * a0, char *const * a1, char *const * a2
#define WASM_NARGS_execve 3
#define WASM_PUBLIC_execve execve
#define WASM_NEW_execve 1
#define WASM_NOERRNO_execve 0
#define WASM_RETURN_sched_setparam int
#define WASM_ARGS_sched_setparam pid_t a0, const struct sched_param * a1
#define WASM_NARGS_sched_setparam 2
#define WASM_PUBLIC_sched_setparam sched_setparam
#define WASM_NEW_sched_setparam 1
#define WASM_NOERRNO_sched_setparam 0
#define WASM_RETURN_sched_getparam int
#define WASM_ARGS_sched_getparam pid_t a0, struct sched_param * a1
#define WASM_NARGS_sched_getparam 2
#define WASM_PUBLIC_sched_getparam sched_getparam
#define WASM_NEW_sched_getparam 1
#define WASM_NOERRNO_sched_getparam 0
#define WASM_RETURN_sched_setscheduler int
#define WASM_ARGS_sched_setscheduler pid_t a0, int a1, const struct sched_param * a2
#define WASM_NARGS_sched_setscheduler 3
#define WASM_PUBLIC_sched_setscheduler sched_setscheduler
#define WASM_NEW_sched_setscheduler 1
#define WASM_NOERRNO_sched_setscheduler 0
#define WASM_RETURN_mlock int
#define WASM_ARGS_mlock const void * a0, size_t a1
#define WASM_NARGS_mlock 2
#define WASM_PUBLIC_mlock mlock
#define WASM_NEW_mlock 1
#define WASM_NOERRNO_mlock 0
#define WASM_ULONG1_mlock 2
#define WASM_ULONG2_mlock 0
#define WASM_RETURN_quotactl int
#define WASM_ARGS_quotactl int a0, const char * a1, int a2, caddr_t a3
#define WASM_NARGS_quotactl 4
#define WASM_PUBLIC_quotactl quotactl
#define WASM_NEW_quotactl 1
#define WASM_NOERRNO_quotactl 0
#define WASM_ULONG1_quotactl 0
#define WASM_ULONG2_quotactl 0
#define WASM_RETURN_name_to_handle_at int
#define WASM_ARGS_name_to_handle_at int a0, const char * a1, struct file_handle * a2, int * a3, int a4
#define WASM_NARGS_name_to_handle_at 5
#define WASM_PUBLIC_name_to_handle_at name_to_handle_at
#define WASM_NEW_name_to_handle_at 1
#define WASM_NOERRNO_name_to_handle_at 0
#define WASM_ULONG1_name_to_handle_at 0
#define WASM_ULONG2_name_to_handle_at 0
#define WASM_RETURN_process_madvise ssize_t
#define WASM_ARGS_process_madvise int a0, const struct iovec * a1, size_t a2, int a3, unsigned int a4
#define WASM_NARGS_process_madvise 5
#define WASM_PUBLIC_process_madvise process_madvise
#define WASM_NEW_process_madvise 1
#define WASM_NOERRNO_process_madvise 0
#define WASM_ULONG1_process_madvise 5
#define WASM_ULONG2_process_madvise 0
#define WASM_RETURN_mseal int
#define WASM_ARGS_mseal void * a0, size_t a1, unsigned long a2
#define WASM_NARGS_mseal 3
#define WASM_PUBLIC_mseal mseal
#define WASM_NEW_mseal 1
#define WASM_NOERRNO_mseal 0
#define WASM_ULONG1_mseal 2
#define WASM_ULONG2_mseal 3
#define WASM_RETURN_sysinfo int
#define WASM_ARGS_sysinfo struct sysinfo * a0
#define WASM_NARGS_sysinfo 1
#define WASM_PUBLIC_sysinfo sysinfo
#define WASM_NEW_sysinfo 1
#define WASM_NOERRNO_sysinfo 0
#define WASM_ULONG1_sysinfo 0
#define WASM_ULONG2_sysinfo 0
#define WASM_RETURN_pkey_alloc int
#define WASM_ARGS_pkey_alloc unsigned int a0, unsigned int a1
#define WASM_NARGS_pkey_alloc 2
#define WASM_PUBLIC_pkey_alloc pkey_alloc
#define WASM_NEW_pkey_alloc 1
#define WASM_NOERRNO_pkey_alloc 0
#define WASM_ULONG1_pkey_alloc 0
#define WASM_ULONG2_pkey_alloc 0
#define WASM_RETURN_munlock int
#define WASM_ARGS_munlock const void * a0, size_t a1
#define WASM_NARGS_munlock 2
#define WASM_PUBLIC_munlock munlock
#define WASM_NEW_munlock 1
#define WASM_NOERRNO_munlock 0
#define WASM_ULONG1_munlock 2
#define WASM_ULONG2_munlock 0
#define WASM_RETURN_uname int
#define WASM_ARGS_uname struct utsname * a0
#define WASM_NARGS_uname 1
#define WASM_PUBLIC_uname uname
#define WASM_NEW_uname 1
#define WASM_NOERRNO_uname 0
#define WASM_ULONG1_uname 0
#define WASM_ULONG2_uname 0
#define WASM_RETURN_remap_file_pages int
#define WASM_ARGS_remap_file_pages void * a0, size_t a1, int a2, size_t a3, int a4
#define WASM_NARGS_remap_file_pages 5
#define WASM_PUBLIC_remap_file_pages remap_file_pages
#define WASM_NEW_remap_file_pages 1
#define WASM_NOERRNO_remap_file_pages 0
#define WASM_ULONG1_remap_file_pages 2
#define WASM_ULONG2_remap_file_pages 4
#define WASM_RETURN_process_mrelease int
#define WASM_ARGS_process_mrelease int a0, unsigned int a1
#define WASM_NARGS_process_mrelease 2
#define WASM_PUBLIC_process_mrelease process_mrelease
#define WASM_NEW_process_mrelease 1
#define WASM_NOERRNO_process_mrelease 0
#define WASM_ULONG1_process_mrelease 2
#define WASM_ULONG2_process_mrelease 0
#define WASM_RETURN_munlockall int
#define WASM_ARGS_munlockall void
#define WASM_NARGS_munlockall 0
#define WASM_PUBLIC_munlockall munlockall
#define WASM_NEW_munlockall 1
#define WASM_NOERRNO_munlockall 0
#define WASM_ULONG1_munlockall 0
#define WASM_ULONG2_munlockall 0
#define WASM_RETURN_mlockall int
#define WASM_ARGS_mlockall int a0
#define WASM_NARGS_mlockall 1
#define WASM_PUBLIC_mlockall mlockall
#define WASM_NEW_mlockall 1
#define WASM_NOERRNO_mlockall 0
#define WASM_ULONG1_mlockall 0
#define WASM_ULONG2_mlockall 0
#define WASM_RETURN_epoll_ctl int
#define WASM_ARGS_epoll_ctl int a0, int a1, int a2, struct epoll_event * a3
#define WASM_NARGS_epoll_ctl 4
#define WASM_PUBLIC_epoll_ctl epoll_ctl
#define WASM_NEW_epoll_ctl 1
#define WASM_NOERRNO_epoll_ctl 0
#define WASM_ULONG1_epoll_ctl 0
#define WASM_ULONG2_epoll_ctl 0
#define WASM_RETURN_pkey_free int
#define WASM_ARGS_pkey_free int a0
#define WASM_NARGS_pkey_free 1
#define WASM_PUBLIC_pkey_free pkey_free
#define WASM_NEW_pkey_free 1
#define WASM_NOERRNO_pkey_free 0
#define WASM_ULONG1_pkey_free 0
#define WASM_ULONG2_pkey_free 0
#define WASM_RETURN_mincore int
#define WASM_ARGS_mincore void * a0, size_t a1, unsigned char * a2
#define WASM_NARGS_mincore 3
#define WASM_PUBLIC_mincore mincore
#define WASM_NEW_mincore 1
#define WASM_NOERRNO_mincore 0
#define WASM_ULONG1_mincore 2
#define WASM_ULONG2_mincore 0
#if SYSCALL_NARGS != WASM_CAT(WASM_NARGS_,SYSCALL_NAME)
# error "GNU generated syscall argument count differs from audited signature"
#endif
#if WASM_CAT(WASM_NEW_,SYSCALL_NAME)
extern __typeof__(WASM_CAT(WASM_PUBLIC_,SYSCALL_NAME)) SYSCALL_SYMBOL;
#if SYSCALL_NOERRNO != WASM_CAT(WASM_NOERRNO_,SYSCALL_NAME) || SYSCALL_ERRVAL
#error "GNU selected convention differs from audited public syscall"
#endif
#endif
#define WASM_FINAL16_mlock 1
#define WASM_FINAL16_quotactl 1
#define WASM_FINAL16_name_to_handle_at 1
#define WASM_FINAL16_process_madvise 1
#define WASM_FINAL16_mseal 1
#define WASM_FINAL16_sysinfo 1
#define WASM_FINAL16_pkey_alloc 1
#define WASM_FINAL16_munlock 1
#define WASM_FINAL16_uname 1
#define WASM_FINAL16_remap_file_pages 1
#define WASM_FINAL16_process_mrelease 1
#define WASM_FINAL16_munlockall 1
#define WASM_FINAL16_mlockall 1
#define WASM_FINAL16_epoll_ctl 1
#define WASM_FINAL16_pkey_free 1
#define WASM_FINAL16_mincore 1
#if WASM_CAT(WASM_FINAL16_,SYSCALL_NAME)
#if SYSCALL_ULONG_ARG_1 != WASM_CAT(WASM_ULONG1_,SYSCALL_NAME) || SYSCALL_ULONG_ARG_2 != WASM_CAT(WASM_ULONG2_,SYSCALL_NAME)
#error "GNU ULONG transport annotation differs from pinned16 stream"
#endif
#endif
#define WASM_NR_I(name) SYS_ify(name)
#define WASM_NR(name) WASM_NR_I(name)
#define WASM_INVOKE_0 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),0)
#define WASM_INVOKE_1 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),1,a0)
#define WASM_INVOKE_2 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),2,a0,a1)
#define WASM_INVOKE_3 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),3,a0,a1,a2)
#define WASM_INVOKE_4 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),4,a0,a1,a2,a3)
#define WASM_INVOKE_5 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),5,a0,a1,a2,a3,a4)
#define WASM_INVOKE_6 INTERNAL_SYSCALL_NCS(WASM_NR(SYSCALL_NAME),6,a0,a1,a2,a3,a4,a5)
WASM_CAT(WASM_RETURN_,SYSCALL_NAME) SYSCALL_SYMBOL(WASM_CAT(WASM_ARGS_,SYSCALL_NAME)){
 long result=WASM_CAT(WASM_INVOKE_,SYSCALL_NARGS);
#if SYSCALL_NOERRNO
 return result;
#elif SYSCALL_ERRVAL
 return INTERNAL_SYSCALL_ERROR_P(result)?INTERNAL_SYSCALL_ERRNO(result):result;
#else
 if(INTERNAL_SYSCALL_ERROR_P(result))return INLINE_SYSCALL_ERROR_RETURN_VALUE(INTERNAL_SYSCALL_ERRNO(result));
 return result;
#endif
}
libc_hidden_def(SYSCALL_SYMBOL)

#endif /* audited signature */
