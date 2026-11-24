/* Owned Linux/Wasm GNU-public to retained kernel signal boundary.
   The kernel callback supplies siginfo only, no PC/ucontext or signal frame.
   Passing NULL context states that limitation; no synthetic registers. */
#include <signal.h>
#include <string.h>
#include <sysdep.h>
#define WASM_SA_RESTORER 0x04000000U
struct wasm_kernel_sigaction { __sighandler_t handler; unsigned long flags;
 void (*restorer)(void); unsigned long mask[2]; };
_Static_assert(sizeof(struct wasm_kernel_sigaction)==20,"kernel action");
_Static_assert(__builtin_offsetof(struct wasm_kernel_sigaction,mask)==12,"kernel mask");
_Static_assert(sizeof(struct sigaction)==140,"GNU action");
_Static_assert(sizeof(siginfo_t)==128,"GNU siginfo");
_Static_assert(__builtin_offsetof(siginfo_t,si_pid)==12,"kernel/GNU pid offset");
_Static_assert(__builtin_offsetof(siginfo_t,si_uid)==16,"kernel/GNU uid offset");
__attribute__((import_module("linux"),import_name("copy_siginfo"))) extern int copy_siginfo(siginfo_t *);
static void siginfo_trampoline(void (*handler)(int,siginfo_t*,void*),int sig){
 siginfo_t info;memset(&info,0,sizeof(info));
 if(copy_siginfo(&info)==0)handler(sig,&info,NULL);
}
int __libc_sigaction(int sig,const struct sigaction *act,struct sigaction *old){
 struct wasm_kernel_sigaction input={0},output={0};
 if(act){input.handler=act->sa_handler;input.flags=(unsigned)act->sa_flags;
  /* There is no native rt_sigreturn/restorer ABI. A user-supplied restorer
     cannot be honored; reject instead of silently installing it. */
  if(input.flags&(WASM_SA_RESTORER|SA_ONSTACK)){__set_errno(EOPNOTSUPP);return -1;}
  if(input.flags&SA_SIGINFO){input.flags|=WASM_SA_RESTORER;input.restorer=(void(*)(void))siginfo_trampoline;}
  memcpy(input.mask,&act->sa_mask,8);}
 int r=INLINE_SYSCALL_CALL(rt_sigaction,sig,act?&input:0,old?&output:0,8);
 if(old&&r>=0){memset(old,0,sizeof(*old));old->sa_handler=output.handler;
  old->sa_flags=output.flags;old->sa_restorer=output.restorer;
  if(output.restorer==(void(*)(void))siginfo_trampoline){old->sa_flags&=~WASM_SA_RESTORER;old->sa_restorer=0;}
  memcpy(&old->sa_mask,output.mask,8);}
 return r;
}
libc_hidden_def(__libc_sigaction)
