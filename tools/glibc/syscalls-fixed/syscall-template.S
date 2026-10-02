/* Native Wasm architecture template, compiled as C by compile-syscall.py.
   GNU make-syscalls.sh supplies all entry names and alias declarations.
   Only explicitly audited i32/pointer signatures are accepted here. */
#include <sysdep.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>
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
#if SYSCALL_NARGS != WASM_CAT(WASM_NARGS_,SYSCALL_NAME)
# error "GNU generated syscall argument count differs from audited signature"
#endif
#if WASM_CAT(WASM_NEW_,SYSCALL_NAME)
extern __typeof__(WASM_CAT(WASM_PUBLIC_,SYSCALL_NAME)) SYSCALL_SYMBOL;
#if SYSCALL_NOERRNO != WASM_CAT(WASM_NOERRNO_,SYSCALL_NAME) || SYSCALL_ERRVAL
#error "GNU selected convention differs from audited public syscall"
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
