/* Actual GNU state inspection proposal. Compile-only until native frame
 * primitives and the whole kernel/worker/guest route are provided and tested. */
#include <pthreadP.h>
#include <internal-signals.h>
#include <errno.h>
#include <string.h>
#include "gnu-helper.h"
#include "native-bridge.h"

#define EXPORT(name) __attribute__((export_name("__wasm_boundary_v3_" #name), noinline))
#define LIMIT 8
struct boundary_slot {
  struct gnu_boundary_record record; /* Host writes only this first80 bytes. */
  struct gnu_boundary_record original;
  siginfo_t info;
  void *checkpoint;
  void *import_bridge;
  unsigned used, registered, authenticated, policy, dispatched;
};
struct boundary_sidecar {
  struct pthread *owner;
  uint32_t epoch, module_generation, task, generation_lo, generation_hi;
  unsigned admitted;
  struct boundary_slot slots[LIMIT];
};
/* Compiler TLS holds storage; the explicit owner is actual raw GNU TP. */
static _Thread_local struct boundary_sidecar sidecar;
static const void *const native_bridge_requirements[] __attribute__((used)) = {
  (const void *)&__wasm_boundary_v3_import_enter,
  (const void *)&__wasm_boundary_v3_import_leave
};
extern int boundary_copy_siginfo(siginfo_t *)
  __attribute__((import_module("linux"), import_name("copy_siginfo")));

static int valid_sidecar(const struct boundary_sidecar *s)
{
  return s == &sidecar && s->admitted && s->owner && s->epoch && s->module_generation;
}
static int valid_slot(const struct boundary_sidecar *s, const struct boundary_slot *slot)
{
  uintptr_t address = (uintptr_t)slot, base = (uintptr_t)&s->slots[0];
  return valid_sidecar(s) && address >= base && address < (uintptr_t)&s->slots[LIMIT]
    && (address - base) % sizeof(*slot) == 0 && slot->used;
}
static int enabled_pending(const struct boundary_sidecar *s)
{
  int state = atomic_load_relaxed(&s->owner->cancelhandling);
  return cancel_enabled_and_canceled(state) && !cancel_exiting(state)
    && !(state & TERMINATED_BITMASK);
}
static int asynchronous(const struct boundary_sidecar *s)
{
  return cancel_enabled_and_canceled_and_async(atomic_load_relaxed(&s->owner->cancelhandling));
}
static int same_record(const struct gnu_boundary_record *a, const struct gnu_boundary_record *b)
{
  const uint32_t *left = (const uint32_t *)a, *right = (const uint32_t *)b;
  for (unsigned index = 0; index != 20; ++index)
    if (index != 3 && index != 12 && index != 13 && index != 15 && left[index] != right[index])
      return 0;
  return 1;
}

EXPORT(abi) int boundary_abi(void) { return 3; }

/* Called only after real GNU TLS setup. The owned worker must compare owner
 * against the kernel's actual TP before this import-free admission call. */
EXPORT(admit) void *boundary_admit(struct pthread *owner, uint32_t epoch, uint32_t generation)
{
  if (sidecar.admitted || !owner || !epoch || !generation) return NULL;
  /* Exact compiler manifest comes from final-module admission. It is not a
     mutable synthetic descriptor table. This occurs before recorded startup. */
  if (__wasm_boundary_native_admit_v3(owner, epoch, generation,
                                     __wasm_boundary_native_root_v3()) != 0) return NULL;
  sidecar.owner = owner;
  sidecar.epoch = epoch;
  sidecar.module_generation = generation;
  sidecar.admitted = 1;
  if (__wasm_boundary_native_bind_v3(&sidecar, owner, epoch, generation) != 0) {
    __wasm_boundary_native_invalidate_v3(owner, epoch);
    sidecar.admitted = 0;
    return NULL;
  }
  return &sidecar;
}
/* Exact admitted compiler-TLS sidecar, never a second frame chain. */
EXPORT(owner_sidecar) void *boundary_owner_sidecar(void)
{
  return valid_sidecar(&sidecar) ? &sidecar : NULL;
}
EXPORT(slot) void *boundary_slot(struct boundary_sidecar *s, unsigned index)
{
  if (!valid_sidecar(s) || index >= LIMIT || s->slots[index].used) return NULL;
  s->slots[index].used = 1;
  return &s->slots[index];
}
EXPORT(prepare) int boundary_prepare(struct boundary_sidecar *s, struct boundary_slot *slot,
                                    void *import_bridge)
{
  if (!valid_slot(s, slot) || !import_bridge) return -EINVAL;
  slot->import_bridge = import_bridge;
  struct gnu_boundary_record *r = &slot->record;
  if (r->magic != 0x53424733U || r->version != 3 || r->bytes != 80 || r->phase != 1
      || r->tp != (uintptr_t)s->owner || !(r->lo || r->hi)
      || (s->task && s->task != r->task) || (r->kind != 1 && r->kind != 2)
      || r->hi < s->generation_hi || (r->hi == s->generation_hi && r->lo <= s->generation_lo))
    return -EINVAL;
  s->task = r->task;
  s->generation_lo = r->lo;
  s->generation_hi = r->hi;
  slot->original = *r;
  slot->registered = r->handler == __wasm_boundary_gnu_sigcancel_handler_v3();
  if (!slot->registered) return 0;
  if (r->kind != 1) return -EINVAL;
  memset(&slot->info, 0, sizeof(slot->info));
  int status = boundary_copy_siginfo(&slot->info);
  if (status != 0) return status;
  slot->authenticated = r->signal == SIGCANCEL && slot->info.si_signo == SIGCANCEL
    && slot->info.si_code == SI_TKILL && slot->info.si_pid == (pid_t)r->tgid;
  slot->checkpoint = __wasm_boundary_native_checkpoint_v3(import_bridge, s->owner, s->epoch, s->module_generation);
  return slot->checkpoint ? 0 : -ENOTSUP;
}
EXPORT(inspect) int boundary_inspect(struct boundary_sidecar *s, struct boundary_slot *slot)
{
  if (!valid_slot(s, slot)) return -EINVAL;
  return slot->registered | ((slot->authenticated && enabled_pending(s)) ? 2 : 0)
    | ((slot->authenticated && enabled_pending(s) && asynchronous(s)) ? 4 : 0);
}
EXPORT(callback_enter) void *boundary_callback_enter(struct boundary_sidecar *s, struct boundary_slot *slot,
                                                     void *import_bridge)
{
  if (!valid_slot(s, slot) || slot->registered || import_bridge != slot->import_bridge) return NULL;
  slot->checkpoint = __wasm_boundary_native_checkpoint_v3(import_bridge, s->owner, s->epoch, s->module_generation);
  if (slot->checkpoint && __wasm_boundary_native_callback_enter_v3(slot->checkpoint) != 0)
    return NULL;
  return slot->checkpoint;
}
EXPORT(callback_leave) int boundary_callback_leave(struct boundary_sidecar *s, void *checkpoint, int escaped)
{
  if (!valid_sidecar(s) || !checkpoint || (escaped != 0 && escaped != 1)) return -EINVAL;
  return __wasm_boundary_native_leave_v3(checkpoint, escaped);
}
EXPORT(policy) int boundary_policy(struct boundary_sidecar *s, struct boundary_slot *slot, int eligible)
{
  if (!valid_slot(s, slot) || !same_record(&slot->original, &slot->record)
      || slot->record.phase != 2 || slot->record.copy_status != 0) return 3;
  slot->policy = eligible == 1 && slot->registered && slot->authenticated
    && slot->record.raw == -512 && enabled_pending(s)
    && __wasm_boundary_native_current_v3(slot->checkpoint)
    && (asynchronous(s) || __wasm_boundary_native_cancellable_v3(slot->checkpoint)) ? 1 : 0;
  return slot->policy;
}
int __wasm_boundary_cancellation_pc_check_v3(const void *context)
{
  const struct boundary_slot *slot = context;
  return valid_slot(&sidecar, slot) && slot->registered && slot->authenticated
    && slot->policy == 1 && slot->record.raw == -512 && slot->record.phase == 2
    && same_record(&slot->record, &slot->original) && !slot->dispatched
    && enabled_pending(&sidecar) && __wasm_boundary_native_current_v3(slot->checkpoint)
    && __wasm_boundary_native_cancellable_v3(slot->checkpoint);
}
EXPORT(dispatch) void boundary_dispatch(struct boundary_sidecar *s, struct boundary_slot *slot)
{
  if (!valid_slot(s, slot) || !slot->registered || !slot->authenticated || slot->dispatched
      || slot->record.phase != 2 || !same_record(&slot->original, &slot->record)
      || !enabled_pending(s) || !__wasm_boundary_native_current_v3(slot->checkpoint)) return;
  if (!asynchronous(s) && !__wasm_boundary_cancellation_pc_check_v3(slot)) return;
  /* Genuine handler performs its own SIGCANCEL/PID/SI_TKILL and state checks.
   * No stub or synthetic unwind provider is linked by this packet. */
  void (*handler)(int, siginfo_t *, void *) = (void *)__wasm_boundary_gnu_sigcancel_handler_v3();
  handler(SIGCANCEL, &slot->info, slot);
  slot->dispatched = 1;
}
EXPORT(complete) int boundary_complete(struct boundary_sidecar *s)
{
  if (!valid_sidecar(s)) return -EINVAL;
  if (__wasm_boundary_native_complete_v3() != 0) return -EINVAL;
  memset(s->slots, 0, sizeof(s->slots));
  return 0;
}
EXPORT(invalidate) void boundary_invalidate(struct boundary_sidecar *s, int reason)
{
  (void)reason;
  if (valid_sidecar(s)) {
    __wasm_boundary_native_invalidate_v3(s->owner, s->epoch);
    s->admitted = 0;
  }
}
