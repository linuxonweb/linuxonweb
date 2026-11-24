/* Native Wasm equivalents of GNU's architecture-neutral GSCOPE protocol.
   Bodies are copied from GNU2.44 sysdeps/riscv/nptl/tls.h:111-130. No RISC-V
   register/layout code is imported. Actual Wasm GNU descriptor fields and
   existing GNU atomic/futex operations supply the architecture semantics. */
#include <tls.h>
#include <atomic.h>
#include <lowlevellock.h>
#define THREAD_GSCOPE_FLAG_UNUSED 0
#define THREAD_GSCOPE_FLAG_USED 1
#define THREAD_GSCOPE_FLAG_WAIT 2
#define THREAD_GSCOPE_RESET_FLAG() \
 do {int result=atomic_exchange_release(&THREAD_SELF->header.gscope_flag, \
                                       THREAD_GSCOPE_FLAG_UNUSED); \
     if(result==THREAD_GSCOPE_FLAG_WAIT) \
       lll_futex_wake(&THREAD_SELF->header.gscope_flag,1,LLL_PRIVATE); \
 } while(0)
#define THREAD_GSCOPE_SET_FLAG() \
 do {THREAD_SELF->header.gscope_flag=THREAD_GSCOPE_FLAG_USED; \
     atomic_write_barrier(); \
 } while(0)
