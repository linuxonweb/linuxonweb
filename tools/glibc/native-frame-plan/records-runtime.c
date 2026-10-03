/* Exact proposed RECORDS_ONLY providers. No forced-unwind/dispatch implementation.
   Real rawTP/thread binding and immutable admitted module tables are required.
   Failure is a real native trap for this prerequisite; never GNU abort proof. */
#include "frame-abi.h"
#define LIMIT_MODULES 64u
#define LIMIT_DESCRIPTORS 4096u
static __attribute__((noreturn)) void invalid(void) { __builtin_trap(); }
static nf_u32 address(const void *p) { return (nf_u32)p; }
static struct nf_thread *thread(void) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!t || t->version != NF_ABI_VERSION || !t->owner_tp ||
      t->owner_tp != __wasm_gnu_frame_owner_tp_v1() || !t->task_epoch ||
      !t->root_module || address(t->stack_low) >= address(t->stack_high) ||
      t->forced || t->critical_depth)
    invalid();
  return t;
}
static int geometry(struct nf_thread *t, const struct nf_frame *f) {
  nf_u32 p = address(f), low = address(t->stack_low), high = address(t->stack_high);
  return f && !(p & 15u) && high >= 64 && p >= low && p <= high - 64;
}
static int active(struct nf_thread *t, const struct nf_frame *f) {
  return geometry(t, f) && f->version == NF_ABI_VERSION &&
      f->owner_tp == t->owner_tp && f->task_epoch == t->task_epoch &&
      f->activation_id && f->phase == NF_PHASE_ACTIVE &&
      address(f->active_sp) >= address(t->stack_low) &&
      address(f->active_sp) <= address(f->fixed_sp) &&
      address(f->fixed_sp) <= address(f) &&
      address(f->caller_entry_sp) <= address(t->stack_high) &&
      address(f) + 64 <= address(f->caller_entry_sp);
}
static const struct nf_descriptor *admitted(struct nf_thread *t,
    const struct nf_descriptor *candidate, void (*fn)(void)) {
  const struct nf_module *m = t->root_module;
  for (nf_u32 depth = 0; m && depth != LIMIT_MODULES; ++depth, m = m->next) {
    if (m->version != NF_ABI_VERSION || !m->generation ||
        m->flags != NF_RECORDS_ONLY || !m->descriptors ||
        m->descriptor_count > LIMIT_DESCRIPTORS)
      invalid();
    for (nf_u32 i = 0; i != m->descriptor_count; ++i) {
      const struct nf_descriptor *d = m->descriptors[i];
      if (!d || d->version != NF_ABI_VERSION || d->bytes != sizeof(*d) ||
          d->module != m || !m->generation ||
          (d->flags != NF_RECORDS_ONLY && d->flags != NF_PRIMITIVE_BRIDGE))
        invalid();
      if ((candidate && candidate == d) || (!candidate && d->function_identity == fn))
        return d;
    }
  }
  invalid();
}
void __wasm_gnu_frame_enter_v1(struct nf_frame *f,
    const struct nf_descriptor *d, nf_u32 caller_sp, nf_u32 fixed_sp) {
  struct nf_thread *t = thread();
  if (!geometry(t, f) || fixed_sp & 15u || fixed_sp < address(t->stack_low) ||
      fixed_sp > address(f) || caller_sp > address(t->stack_high) ||
      address(f) + 64 > caller_sp || d != admitted(t, d, 0) ||
      d->flags != NF_RECORDS_ONLY || !t->next_activation ||
      t->next_activation == ~0u)
    invalid();
  struct nf_frame *previous = __atomic_load_n(&t->head, __ATOMIC_ACQUIRE);
  if (previous && (!active(t, previous) || f == previous ||
      caller_sp != address(previous->active_sp)))
    invalid();
  ++t->critical_depth;
  f->previous = previous; f->owner_tp = t->owner_tp;
  f->task_epoch = t->task_epoch; f->activation_id = t->next_activation++;
  f->descriptor = d; f->caller_entry_sp = (void *)caller_sp;
  f->fixed_sp = (void *)fixed_sp; f->active_sp = (void *)fixed_sp;
  f->phase = NF_PHASE_ACTIVE; f->forced_epoch = f->stopped_epoch = 0;
  f->flags = NF_RECORDS_ONLY; f->jump_top = 0;
  f->version = NF_ABI_VERSION; f->reserved0 = f->reserved1 = 0;
  __atomic_store_n(&t->head, f, __ATOMIC_RELEASE);
  --t->critical_depth;
}
void __wasm_gnu_frame_leave_v1(struct nf_frame *f) {
  struct nf_thread *t = thread();
  if (__atomic_load_n(&t->head, __ATOMIC_ACQUIRE) != f || !active(t, f) ||
      f->jump_top || f->forced_epoch || f->stopped_epoch)
    invalid();
  if (f->previous && (!active(t, f->previous) ||
      f->caller_entry_sp != f->previous->active_sp))
    invalid();
  ++t->critical_depth;
  __atomic_store_n(&t->head, f->previous, __ATOMIC_RELEASE);
  f->phase = NF_PHASE_RETIRED;
  --t->critical_depth;
  /* Compiler epilogue releases linear storage only after this call returns. */
}
void __wasm_gnu_frame_admit_call_v1(void (*fn)(void)) {
  struct nf_thread *t = thread();
  if (!fn || !active(t, __atomic_load_n(&t->head, __ATOMIC_ACQUIRE)))
    invalid();
  (void)admitted(t, 0, fn);
}
