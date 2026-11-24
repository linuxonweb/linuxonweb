/* Separate production-candidate module4 providers. Not runtime accepted.
   Requires the exact coherent forced-abi.h and admitted canonical TP accessors.
   Primitive admission also requires emitted no-linear-stack/call-graph audit. */
#include "forced-abi.h"
extern void abort(void) __attribute__((noreturn));
typedef unsigned long long nf_u64;
static __attribute__((noreturn)) void invalid(void) { abort(); }
static nf_u32 addr(const void *p) { return (nf_u32)p; }
static int linear(const void *p, nf_u32 bytes, nf_u32 alignment) {
  nf_u64 bound = (nf_u64)__builtin_wasm_memory_size(0) * 65536u;
  nf_u32 a = addr(p);
  return p && !(a & (alignment - 1u)) && (nf_u64)a + bytes <= bound;
}
static struct nf_thread *thread(void) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!linear(t, sizeof(*t), 4) || t->version != NF_ABI_VERSION ||
      !t->owner_tp || t->owner_tp != __wasm_gnu_frame_owner_tp_v1() ||
      !t->task_epoch || !t->root_module || t->critical_depth ||
      addr(t->stack_low) >= addr(t->stack_high) ||
      (nf_u64)addr(t->stack_high) > (nf_u64)__builtin_wasm_memory_size(0) * 65536u ||
      (t->forced && !__wasm_gnu_unwind_state_valid_v1(t))) invalid();
  return t;
}
static const struct nf_descriptor *admitted(struct nf_thread *t,
    const struct nf_descriptor *candidate, void (*fn)(void)) {
  const struct nf_module *m = t->root_module;
  for (nf_u32 depth = 0; m && depth != 64; ++depth, m = m->next) {
    if (!linear(m, sizeof(*m), 4) || m->version != NF_ABI_VERSION ||
        m->flags != NF_FORCED_ADMITTED || !m->generation ||
        !m->descriptor_count || m->descriptor_count > 4096 ||
        !linear(m->descriptors, m->descriptor_count * sizeof(*m->descriptors), 4)) invalid();
    for (nf_u32 i = 0; i != m->descriptor_count; ++i) {
      const struct nf_descriptor *d = m->descriptors[i];
      if (!linear(d, sizeof(*d), 4) || d->version != NF_ABI_VERSION ||
          d->bytes != sizeof(*d) || d->module != m || !d->function_identity ||
          (d->flags != NF_FORCED_ADMITTED && d->flags != NF_PRIMITIVE_BRIDGE)) invalid();
      if ((candidate && candidate == d) || (!candidate && d->function_identity == fn)) return d;
    }
  }
  invalid();
}
static int geometry(struct nf_thread *t, const struct nf_frame *f) {
  nf_u32 p = addr(f), high = addr(t->stack_high);
  return linear(f, sizeof(*f), 16) && high >= sizeof(*f) &&
      p >= addr(t->stack_low) && p <= high - sizeof(*f);
}
static int active(struct nf_thread *t, const struct nf_frame *f) {
  return geometry(t, f) && f->version == NF_ABI_VERSION &&
      f->owner_tp == t->owner_tp && f->task_epoch == t->task_epoch &&
      f->activation_id && f->activation_id < t->next_activation &&
      f->phase == NF_PHASE_ACTIVE && f->flags == NF_FORCED_ADMITTED &&
      addr(f->active_sp) >= addr(t->stack_low) &&
      addr(f->active_sp) <= addr(f->fixed_sp) && addr(f->fixed_sp) <= addr(f) &&
      addr(f->caller_entry_sp) <= addr(t->stack_high) &&
      (nf_u64)addr(f) + sizeof(*f) <= addr(f->caller_entry_sp) &&
      f->descriptor == admitted(t, f->descriptor, 0) &&
      f->descriptor->flags == NF_FORCED_ADMITTED;
}
static int jump_valid(struct nf_thread *t, struct nf_frame *f, struct nf_jump *j) {
  return linear(j, sizeof(*j), 4) && linear(j->environment, 64, 4) &&
      (nf_u64)addr(j->environment) + 28 == addr(j) && j->target == f &&
      j->owner_tp == t->owner_tp && j->task_epoch == t->task_epoch &&
      j->activation_id == f->activation_id && j->label &&
      j->registration_version && j->registration_version < t->next_jump_version &&
      addr(j->saved_sp) >= addr(t->stack_low) && addr(j->saved_sp) <= addr(f->fixed_sp);
}
void __wasm_gnu_frame_enter_v1(struct nf_frame *f,
    const struct nf_descriptor *d, nf_u32 caller_sp, nf_u32 fixed_sp) {
  struct nf_thread *t = thread();
  if (!geometry(t, f) || (fixed_sp & 15u) || fixed_sp < addr(t->stack_low) ||
      fixed_sp > addr(f) || caller_sp > addr(t->stack_high) ||
      (nf_u64)addr(f) + sizeof(*f) > caller_sp || d != admitted(t, d, 0) ||
      d->flags != NF_FORCED_ADMITTED || !t->next_activation || t->next_activation == ~0u) invalid();
  struct nf_frame *previous = __atomic_load_n(&t->head, __ATOMIC_ACQUIRE);
  if (previous && (!active(t, previous) || f == previous ||
      caller_sp != addr(previous->active_sp))) invalid();
  ++t->critical_depth;
  f->previous = previous; f->owner_tp = t->owner_tp;
  f->task_epoch = t->task_epoch; f->activation_id = t->next_activation++;
  f->descriptor = d; f->caller_entry_sp = (void *)caller_sp;
  f->fixed_sp = f->active_sp = (void *)fixed_sp;
  f->phase = NF_PHASE_ACTIVE; f->forced_epoch = f->stopped_epoch = 0;
  f->flags = NF_FORCED_ADMITTED; f->jump_top = 0;
  f->version = NF_ABI_VERSION; f->reserved0 = f->reserved1 = 0;
  __atomic_store_n(&t->head, f, __ATOMIC_RELEASE);
  --t->critical_depth;
}
void __wasm_gnu_frame_leave_v1(struct nf_frame *f) {
  struct nf_thread *t = thread();
  if (__atomic_load_n(&t->head, __ATOMIC_ACQUIRE) != f || !active(t, f) ||
      f->forced_epoch || f->stopped_epoch) invalid();
  if (f->previous && (!active(t, f->previous) ||
      f->caller_entry_sp != f->previous->active_sp)) invalid();
  /* Authenticated forced ownership is preserved; normal leave cannot retire E. */
  for (struct nf_forced *s = t->forced; s; s = s->previous)
    if (s->current == f) invalid();
  nf_u32 count = 0;
  for (struct nf_jump *j = f->jump_top; j; j = j->previous)
    if (++count > 4096 || !jump_valid(t, f, j)) invalid();
  ++t->critical_depth;
  while (f->jump_top) {
    struct nf_jump *j = f->jump_top;
    f->jump_top = j->previous;
    j->environment = 0; j->target = 0; j->registration_version = 0;
  }
  __atomic_store_n(&t->head, f->previous, __ATOMIC_RELEASE);
  f->phase = NF_PHASE_RETIRED;
  --t->critical_depth;
}
void __wasm_gnu_frame_admit_call_v1(void (*fn)(void)) {
  struct nf_thread *t = thread();
  if (!fn || !active(t, __atomic_load_n(&t->head, __ATOMIC_ACQUIRE))) invalid();
  (void)admitted(t, 0, fn);
}
