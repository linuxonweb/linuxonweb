/* Owned native Linux/Wasm architecture implementation selected by GNU make.
   Clang wasm32 represents va_list as a pointer to four-byte argument words.
   Copy object representation: pointers and promoted ints need no type-punning
   through an incompatible va_arg type. Read only the explicit option matrix.
   Options checking reserved argument slots require those explicit operands. */
#include <sysdep.h>
#include <stdarg.h>
#include <sys/prctl.h>
#include <string.h>
_Static_assert(sizeof(va_list)==4 && _Alignof(va_list)==4,"Wasm vararg cursor");
_Static_assert(sizeof(unsigned long)==4 && sizeof(void*)==4,"Wasm word ABI");
static unsigned argument_words(int option){
 switch(option){
#ifdef PR_GET_DUMPABLE
 case PR_GET_DUMPABLE:
#endif
#ifdef PR_GET_TIMING
 case PR_GET_TIMING:
#endif
#ifdef PR_GET_SECCOMP
 case PR_GET_SECCOMP:
#endif
#ifdef PR_TASK_PERF_EVENTS_DISABLE
 case PR_TASK_PERF_EVENTS_DISABLE:
#endif
#ifdef PR_TASK_PERF_EVENTS_ENABLE
 case PR_TASK_PERF_EVENTS_ENABLE:
#endif
#ifdef PR_GET_TIMERSLACK
 case PR_GET_TIMERSLACK:
#endif
#ifdef PR_MPX_ENABLE_MANAGEMENT
 case PR_MPX_ENABLE_MANAGEMENT:
#endif
#ifdef PR_MPX_DISABLE_MANAGEMENT
 case PR_MPX_DISABLE_MANAGEMENT:
#endif
#ifdef PR_GET_FP_MODE
 case PR_GET_FP_MODE:
#endif
#ifdef PR_SVE_GET_VL
 case PR_SVE_GET_VL:
#endif
#ifdef PR_SME_GET_VL
 case PR_SME_GET_VL:
#endif
#ifdef PR_RISCV_V_GET_CONTROL
 case PR_RISCV_V_GET_CONTROL:
#endif
#ifdef PR_GET_SECUREBITS
 case PR_GET_SECUREBITS:
#endif
#ifdef PR_GET_KEEPCAPS
 case PR_GET_KEEPCAPS:
#endif
 return 0;
#ifdef PR_SET_PDEATHSIG
 case PR_SET_PDEATHSIG:
#endif
#ifdef PR_GET_PDEATHSIG
 case PR_GET_PDEATHSIG:
#endif
#ifdef PR_SET_DUMPABLE
 case PR_SET_DUMPABLE:
#endif
#ifdef PR_SET_UNALIGN
 case PR_SET_UNALIGN:
#endif
#ifdef PR_GET_UNALIGN
 case PR_GET_UNALIGN:
#endif
#ifdef PR_SET_FPEMU
 case PR_SET_FPEMU:
#endif
#ifdef PR_GET_FPEMU
 case PR_GET_FPEMU:
#endif
#ifdef PR_SET_FPEXC
 case PR_SET_FPEXC:
#endif
#ifdef PR_GET_FPEXC
 case PR_GET_FPEXC:
#endif
#ifdef PR_SET_TIMING
 case PR_SET_TIMING:
#endif
#ifdef PR_SET_NAME
 case PR_SET_NAME:
#endif
#ifdef PR_GET_NAME
 case PR_GET_NAME:
#endif
#ifdef PR_GET_ENDIAN
 case PR_GET_ENDIAN:
#endif
#ifdef PR_SET_ENDIAN
 case PR_SET_ENDIAN:
#endif
#ifdef PR_GET_TSC
 case PR_GET_TSC:
#endif
#ifdef PR_SET_TSC
 case PR_SET_TSC:
#endif
#ifdef PR_SET_TIMERSLACK
 case PR_SET_TIMERSLACK:
#endif
#ifdef PR_GET_TID_ADDRESS
 case PR_GET_TID_ADDRESS:
#endif
#ifdef PR_SET_CHILD_SUBREAPER
 case PR_SET_CHILD_SUBREAPER:
#endif
#ifdef PR_GET_CHILD_SUBREAPER
 case PR_GET_CHILD_SUBREAPER:
#endif
#ifdef PR_SET_FP_MODE
 case PR_SET_FP_MODE:
#endif
#ifdef PR_SVE_SET_VL
 case PR_SVE_SET_VL:
#endif
#ifdef PR_SME_SET_VL
 case PR_SME_SET_VL:
#endif
#ifdef PR_RISCV_V_SET_CONTROL
 case PR_RISCV_V_SET_CONTROL:
#endif
#ifdef PR_CAPBSET_READ
 case PR_CAPBSET_READ:
#endif
#ifdef PR_CAPBSET_DROP
 case PR_CAPBSET_DROP:
#endif
#ifdef PR_SET_SECUREBITS
 case PR_SET_SECUREBITS:
#endif
#ifdef PR_SET_KEEPCAPS
 case PR_SET_KEEPCAPS:
#endif
 return 1;
#ifdef PR_SET_SECCOMP
 case PR_SET_SECCOMP:
#endif
#ifdef PR_RISCV_SET_ICACHE_FLUSH_CTX
 case PR_RISCV_SET_ICACHE_FLUSH_CTX:
#endif
 return 2;
#ifdef PR_FUTEX_HASH
 case PR_FUTEX_HASH:
#endif
 return 3;
#ifdef PR_MCE_KILL
 case PR_MCE_KILL:
#endif
#ifdef PR_MCE_KILL_GET
 case PR_MCE_KILL_GET:
#endif
#ifdef PR_SET_MM
 case PR_SET_MM:
#endif
#ifdef PR_SET_NO_NEW_PRIVS
 case PR_SET_NO_NEW_PRIVS:
#endif
#ifdef PR_GET_NO_NEW_PRIVS
 case PR_GET_NO_NEW_PRIVS:
#endif
#ifdef PR_GET_THP_DISABLE
 case PR_GET_THP_DISABLE:
#endif
#ifdef PR_SET_THP_DISABLE
 case PR_SET_THP_DISABLE:
#endif
#ifdef PR_GET_SPECULATION_CTRL
 case PR_GET_SPECULATION_CTRL:
#endif
#ifdef PR_SET_SPECULATION_CTRL
 case PR_SET_SPECULATION_CTRL:
#endif
#ifdef PR_PAC_RESET_KEYS
 case PR_PAC_RESET_KEYS:
#endif
#ifdef PR_PAC_SET_ENABLED_KEYS
 case PR_PAC_SET_ENABLED_KEYS:
#endif
#ifdef PR_PAC_GET_ENABLED_KEYS
 case PR_PAC_GET_ENABLED_KEYS:
#endif
#ifdef PR_SET_TAGGED_ADDR_CTRL
 case PR_SET_TAGGED_ADDR_CTRL:
#endif
#ifdef PR_GET_TAGGED_ADDR_CTRL
 case PR_GET_TAGGED_ADDR_CTRL:
#endif
#ifdef PR_SET_IO_FLUSHER
 case PR_SET_IO_FLUSHER:
#endif
#ifdef PR_GET_IO_FLUSHER
 case PR_GET_IO_FLUSHER:
#endif
#ifdef PR_SET_SYSCALL_USER_DISPATCH
 case PR_SET_SYSCALL_USER_DISPATCH:
#endif
#ifdef PR_SCHED_CORE
 case PR_SCHED_CORE:
#endif
#ifdef PR_SET_MDWE
 case PR_SET_MDWE:
#endif
#ifdef PR_GET_MDWE
 case PR_GET_MDWE:
#endif
#ifdef PR_PPC_GET_DEXCR
 case PR_PPC_GET_DEXCR:
#endif
#ifdef PR_PPC_SET_DEXCR
 case PR_PPC_SET_DEXCR:
#endif
#ifdef PR_SET_VMA
 case PR_SET_VMA:
#endif
#ifdef PR_GET_AUXV
 case PR_GET_AUXV:
#endif
#ifdef PR_SET_MEMORY_MERGE
 case PR_SET_MEMORY_MERGE:
#endif
#ifdef PR_GET_MEMORY_MERGE
 case PR_GET_MEMORY_MERGE:
#endif
#ifdef PR_GET_SHADOW_STACK_STATUS
 case PR_GET_SHADOW_STACK_STATUS:
#endif
#ifdef PR_SET_SHADOW_STACK_STATUS
 case PR_SET_SHADOW_STACK_STATUS:
#endif
#ifdef PR_LOCK_SHADOW_STACK_STATUS
 case PR_LOCK_SHADOW_STACK_STATUS:
#endif
#ifdef PR_TIMER_CREATE_RESTORE_IDS
 case PR_TIMER_CREATE_RESTORE_IDS:
#endif
#ifdef PR_RSEQ_SLICE_EXTENSION
 case PR_RSEQ_SLICE_EXTENSION:
#endif
#ifdef PR_GET_CFI
 case PR_GET_CFI:
#endif
#ifdef PR_SET_CFI
 case PR_SET_CFI:
#endif
#ifdef PR_CAP_AMBIENT
 case PR_CAP_AMBIENT:
#endif
 return 4;
 default:return 0;
 }
}
int __prctl(int option,...){
 unsigned long args[4]={0,0,0,0};unsigned n=argument_words(option);
 va_list ap;va_start(ap,option);unsigned char *cursor=(unsigned char*)ap;
 for(unsigned i=0;i<n;i++){__builtin_memcpy(&args[i],cursor,4);cursor+=4;}
 va_end(ap);
 return INLINE_SYSCALL_CALL(prctl,option,args[0],args[1],args[2],args[3]);
}
libc_hidden_def(__prctl)
weak_alias(__prctl,prctl)
hidden_weak(prctl)
weak_alias(__prctl,__prctl_time64)
hidden_weak(__prctl_time64)
