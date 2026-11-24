/* Native Wasm architecture template, compiled as C by compile-syscall.py.
   GNU make-syscalls.sh supplies all entry names and alias declarations.
   Only explicitly audited i32/pointer signatures are accepted here. */
#include <sysdep.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>
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
#if SYSCALL_NARGS != WASM_CAT(WASM_NARGS_,SYSCALL_NAME)
# error "GNU generated syscall argument count differs from audited signature"
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
