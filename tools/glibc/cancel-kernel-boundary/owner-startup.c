/* Finite genuine GNU owner bootstrap candidate. The pre-admission functions
   require an exact source/IR/machine startup seal; they are not generally
   exempt from frame publication. The recorded gate is entered only after
   kernel-verified raw TP and actual compiler-root admission. */
#include <pthreadP.h>
#include <tls.h>
#include <errno.h>
#include <stdint.h>
#include "frame-abi.h"

__attribute__((import_module("linux"), import_name("syscall")))
extern int owner_raw(int, int, int, int, int, int, int);
__attribute__((import_module("linux"), import_name("boundary_admit_v3")))
extern int owner_host_admit(void);
extern unsigned tls_size(void), tls_align(void), tls_base(void);
extern unsigned char __stack_low, __stack_high;
extern void owner_recorded_gate(void);

static struct pthread owner_descriptor __attribute__((aligned(32)));
static dtv_t owner_dtv[3];
static unsigned char owner_tls[32768] __attribute__((aligned(65536)));
static _Thread_local uint32_t initialized_canary = 0x31415926;
static _Thread_local uint32_t zero_canary;
_Static_assert(sizeof(struct pthread) == 1184 && _Alignof(struct pthread) == 32,
               "actual GNU descriptor ABI");
_Static_assert(sizeof(dtv_t) == 8 && sizeof(struct nf_thread) == 60,
               "genuine DTV and canonical sidecar ABI");

__attribute__((export_name("__gnu_wasm_raw_tp"))) void raw_marker(void) {}

/* Before __wasm_init_tls: no C TLS/library calls or allocation. */
void *startup_prepare(void)
{
  unsigned size = tls_size(), alignment = tls_align();
  if (!size || size > sizeof(owner_tls) || !alignment ||
      (alignment & (alignment - 1)) || alignment > 65536) {
    owner_raw(94, 90, 0, 0, 0, 0, 0);
    __builtin_unreachable();
  }
  return owner_tls;
}

/* These explicit imports establish genuine TP before any admitted record.
   They are bootstrap operations, not fake implementation of GNU pthread APIs. */
bool __wasm_gnu_init_tp(void *pd)
{
  return owner_raw(244, (int)(uintptr_t)pd, 0, 0, 0, 0, 0) == 0;
}

void owner_bootstrap(void)
{
  struct pthread *pd = &owner_descriptor;
  pd->header.tcb = pd;
  pd->header.self = pd;
  owner_dtv[0].counter = 1;
  owner_dtv[1].counter = 0;
  owner_dtv[2].pointer.val = (void *)(uintptr_t)tls_base();
  owner_dtv[2].pointer.to_free = 0;
  INSTALL_DTV(pd, owner_dtv);
  pd->specific[0] = &pd->specific_1stblock[0];
  pd->joinstate = THREAD_STATE_JOINABLE;
  pd->stack_mode = ALLOCATE_GUARD_USER;
  pd->stackblock = &__stack_low;
  pd->stackblock_size = (uintptr_t)&__stack_high - (uintptr_t)&__stack_low;
  pd->header.multiple_threads = 1; /* Deliberately exercise real cancellable route. */
  if (!TLS_INIT_TP(pd)) {
    owner_raw(94, 91, 0, 0, 0, 0, 0);
    __builtin_unreachable();
  }
  pd->tid = owner_raw(96, (int)(uintptr_t)&pd->joinstate, 0, 0, 0, 0, 0);
  if (pd->tid <= 0 || pd->tid != owner_raw(178, 0, 0, 0, 0, 0, 0) ||
      THREAD_SELF != pd || initialized_canary != 0x31415926 || zero_canary || errno ||
      owner_host_admit() != 0) {
    owner_raw(94, 92, 0, 0, 0, 0, 0);
    __builtin_unreachable();
  }
}
