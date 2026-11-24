/* Actual owner/frame gate candidate. No fabricated descriptor or frame head.
   This checks canonical lifetime and ordinary genuine cancellable transport;
   it does not claim blocked cancellation or forced-unwind acceptance. */
#include <pthreadP.h>
#include <errno.h>
#include <stdint.h>
#include "frame-abi.h"
extern void *boundary_owner_sidecar(void);
extern int bridge_lifetime_tests(void *, void *, uint32_t, uint32_t);
extern int owner_raw(int, int, int, int, int, int, int);
extern struct nf_thread *__wasm_gnu_frame_thread_v1(void);

/* Worker epoch is provided by the actually admitted sidecar, not guessed from
   immutable compiler module generation. Import-free bridge getter returns the
   canonical thread fields already authenticated at owner admission. */
static void print(const char *s)
{
  unsigned length = 0;
  while (s[length]) ++length;
  owner_raw(64, 1, (int)(uintptr_t)s, length, 0, 0, 0);
}

/* Host instance generation is admitted separately; this is supplied by a
   specific verified bridge accessor, never inferred from the compiler root. */
extern uint32_t __wasm_boundary_native_instance_generation_v3(void);

__attribute__((noreturn, noinline)) void owner_recorded_gate(void)
{
  struct nf_thread *thread = __wasm_gnu_frame_thread_v1();
  struct pthread *self = THREAD_SELF;
  void *sidecar = boundary_owner_sidecar();
  int good = thread && thread->head && thread->owner_tp == self && sidecar &&
    thread->head->owner_tp == self && thread->head->task_epoch == thread->task_epoch;
  int lifetime = good ? bridge_lifetime_tests(sidecar, self, thread->task_epoch,
      __wasm_boundary_native_instance_generation_v3()) : -1;
  good = good && lifetime > 0;
  errno = 137;
  /* Actual GNU cancellation.c -> reference cancel_arch -> real kernelgetpid.
     Enabled but not pending, so positive result/errno must remain unchanged. */
  long pid = __internal_syscall_cancel(0, 0, 0, 0, 0, 0, 172);
  good = good && pid > 0 && pid == owner_raw(172, 0, 0, 0, 0, 0, 0) && errno == 137;
  long bad = __internal_syscall_cancel(-1, 0, 0, 0, 0, 0, 63);
  good = good && bad == -EBADF && errno == 137;
  print(good ? "GNU_BOUNDARY_OWNER genuineTP=1 canonical=1 lifetime=sequential,nested,stale ordinaryGNUcanceltransport=1 result=PASS\n"
             : "GNU_BOUNDARY_OWNER FAIL\n");
  owner_raw(94, good ? 0 : 99, 0, 0, 0, 0, 0);
  __builtin_unreachable();
}
