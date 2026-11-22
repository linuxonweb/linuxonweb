/* Separate no-abort transition proposal. No runtime acceptance.
   No wrapper aliases replace existing void v1 symbols. A compiler status
   consumer and genuine GNU fatal-admission policy remain strong prerequisites.
   Exact emitted linear-stack and transitive machine closure audit is required. */
#include "transition-status-v2.h"
typedef unsigned long long nf_u64;
#define INLINE static __attribute__((always_inline)) inline
INLINE nf_u32 addr(const void *p) { return (nf_u32)p; }
INLINE int linear(const void *p, nf_u32 n, nf_u32 alignment) {
  nf_u64 bound = (nf_u64)__builtin_wasm_memory_size(0) * 65536u;
  return p && !(addr(p) & (alignment - 1u)) && (nf_u64)addr(p) + n <= bound;
}
INLINE struct nf_thread *owner(void) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!linear(t, sizeof(*t), 4) || t->version != NF_ABI_VERSION ||
      !t->owner_tp || t->owner_tp != __wasm_gnu_frame_owner_tp_v1() ||
      !t->task_epoch || !t->root_module || t->critical_depth ||
      addr(t->stack_low) >= addr(t->stack_high) ||
      (nf_u64)addr(t->stack_high) > (nf_u64)__builtin_wasm_memory_size(0) * 65536u ||
      (t->forced && !__wasm_gnu_unwind_state_valid_v1(t))) return 0;
  return t;
}
/* Authenticate every descriptor before lookup, including entries following a
   match. These are the same explicit finite module/descriptor limits as the
   existing candidate, not newly claimed general module admission. */
INLINE int modules(struct nf_thread *t) {
  const struct nf_module *m = t->root_module;
  nf_u32 depth = 0;
  for (; m && depth < 64; ++depth, m = m->next) {
    if (!linear(m, sizeof(*m), 4) || m->version != NF_ABI_VERSION ||
        m->flags != NF_FORCED_ADMITTED || !m->generation ||
        !m->descriptor_count || m->descriptor_count > 4096 ||
        !linear(m->descriptors, m->descriptor_count * sizeof(*m->descriptors), 4)) return 0;
    for (nf_u32 i = 0; i != m->descriptor_count; ++i) {
      const struct nf_descriptor *d = m->descriptors[i];
      if (!linear(d, sizeof(*d), 4) || d->version != NF_ABI_VERSION ||
          d->bytes != sizeof(*d) || d->module != m || !d->function_identity ||
          (d->flags != NF_FORCED_ADMITTED && d->flags != NF_PRIMITIVE_BRIDGE)) return 0;
    }
  }
  return m == 0;
}
INLINE const struct nf_descriptor *lookup(struct nf_thread *t,
    const struct nf_descriptor *candidate, void (*fn)(void)) {
  for (const struct nf_module *m = t->root_module; m; m = m->next)
    for (nf_u32 i = 0; i != m->descriptor_count; ++i) {
      const struct nf_descriptor *d = m->descriptors[i];
      if ((candidate && candidate == d) || (!candidate && d->function_identity == fn)) return d;
    }
  return 0;
}
INLINE int geometry(struct nf_thread *t, const struct nf_frame *f) {
  return linear(f, sizeof(*f), 16) &&
      addr(f) >= addr(t->stack_low) &&
      (nf_u64)addr(f) + sizeof(*f) <= addr(t->stack_high);
}
INLINE int active(struct nf_thread *t, const struct nf_frame *f) {
  if (!geometry(t, f) || f->version != NF_ABI_VERSION ||
      f->owner_tp != t->owner_tp || f->task_epoch != t->task_epoch ||
      !f->activation_id || f->activation_id >= t->next_activation ||
      f->phase != NF_PHASE_ACTIVE || f->flags != NF_FORCED_ADMITTED ||
      (addr(f->active_sp) & 15u) || (addr(f->fixed_sp) & 15u) ||
      (addr(f->caller_entry_sp) & 15u) ||
      addr(f->active_sp) < addr(t->stack_low) ||
      addr(f->active_sp) > addr(f->fixed_sp) || addr(f->fixed_sp) > addr(f) ||
      addr(f->caller_entry_sp) > addr(t->stack_high) ||
      (nf_u64)addr(f) + sizeof(*f) > addr(f->caller_entry_sp)) return 0;
  const struct nf_descriptor *d = lookup(t, f->descriptor, 0);
  return d && d->flags == NF_FORCED_ADMITTED;
}
INLINE int chain(struct nf_thread *t, struct nf_frame *head) {
  /* Actual record geometry and strictly decreasing activation IDs reject
     cycles; the iteration bound derives from genuine stack bytes / record64. */
  nf_u32 limit = (addr(t->stack_high) - addr(t->stack_low)) / sizeof(struct nf_frame);
  nf_u32 count = 0;
  for (struct nf_frame *f = head; f; f = f->previous) {
    if (++count > limit || !active(t, f)) return 0;
    if (f->previous && (!active(t, f->previous) ||
        f->previous->activation_id >= f->activation_id ||
        f->caller_entry_sp != f->previous->active_sp)) return 0;
  }
  return 1;
}
INLINE int jump_valid(struct nf_thread *t, struct nf_frame *f, struct nf_jump *j) {
  return linear(j, sizeof(*j), 4) && linear(j->environment, 64, 4) &&
      (nf_u64)addr(j->environment) + 28 == addr(j) && j->target == f &&
      j->owner_tp == t->owner_tp && j->task_epoch == t->task_epoch &&
      j->activation_id == f->activation_id && j->label &&
      j->registration_version && j->registration_version < t->next_jump_version &&
      !(addr(j->saved_sp) & 15u) && addr(j->saved_sp) >= addr(t->stack_low) &&
      addr(j->saved_sp) <= addr(f->fixed_sp);
}
enum nf_transition_status_v2 __wasm_gnu_frame_enter_status_v2(struct nf_frame *f,
    const struct nf_descriptor *d, nf_u32 caller_sp, nf_u32 fixed_sp) {
  struct nf_thread *t = owner();
  if (!t || !modules(t)) return NF_TRANSITION_CORRUPT;
  struct nf_frame *previous = __atomic_load_n(&t->head, __ATOMIC_ACQUIRE);
  if (!chain(t, previous) || !geometry(t, f) || (fixed_sp & 15u) ||
      (caller_sp & 15u) || fixed_sp < addr(t->stack_low) || fixed_sp > addr(f) ||
      caller_sp > addr(t->stack_high) || (nf_u64)addr(f) + sizeof(*f) > caller_sp ||
      (previous && (f == previous || caller_sp != addr(previous->active_sp))))
    return NF_TRANSITION_CORRUPT;
  const struct nf_descriptor *actual = lookup(t, d, 0);
  if (!actual || actual->flags != NF_FORCED_ADMITTED || !t->next_activation ||
      t->next_activation == ~0u) return NF_TRANSITION_ENTER_FATAL_ADMISSION_REQUIRED;
  ++t->critical_depth;
  f->previous = previous; f->owner_tp = t->owner_tp;
  f->task_epoch = t->task_epoch; f->activation_id = t->next_activation++;
  f->descriptor = actual; f->caller_entry_sp = (void *)caller_sp;
  f->fixed_sp = f->active_sp = (void *)fixed_sp;
  f->phase = NF_PHASE_ACTIVE; f->forced_epoch = f->stopped_epoch = 0;
  f->flags = NF_FORCED_ADMITTED; f->jump_top = 0;
  f->version = NF_ABI_VERSION; f->reserved0 = f->reserved1 = 0;
  __atomic_store_n(&t->head, f, __ATOMIC_RELEASE);
  --t->critical_depth;
  return NF_TRANSITION_OK;
}
enum nf_transition_status_v2 __wasm_gnu_frame_leave_status_v2(struct nf_frame *f) {
  struct nf_thread *t = owner();
  if (!t || !modules(t)) return NF_TRANSITION_CORRUPT;
  struct nf_frame *head = __atomic_load_n(&t->head, __ATOMIC_ACQUIRE);
  if (head != f || !head || !chain(t, head)) return NF_TRANSITION_CORRUPT;
  if (f->forced_epoch || f->stopped_epoch) return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;
  for (struct nf_forced *s = t->forced; s; s = s->previous)
    if (s->current == f) return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;
  nf_u32 count = 0;
  for (struct nf_jump *j = f->jump_top; j; j = j->previous)
    if (++count > 4096 || !jump_valid(t, f, j)) return NF_TRANSITION_CORRUPT;
  ++t->critical_depth;
  while (f->jump_top) {
    struct nf_jump *j = f->jump_top;
    f->jump_top = j->previous;
    j->environment = 0; j->target = 0; j->registration_version = 0;
  }
  __atomic_store_n(&t->head, f->previous, __ATOMIC_RELEASE);
  f->phase = NF_PHASE_RETIRED;
  --t->critical_depth;
  return NF_TRANSITION_OK;
}
enum nf_transition_status_v2 __wasm_gnu_frame_admit_status_v2(void (*fn)(void)) {
  struct nf_thread *t = owner();
  if (!t || !modules(t)) return NF_TRANSITION_CORRUPT;
  struct nf_frame *head = __atomic_load_n(&t->head, __ATOMIC_ACQUIRE);
  if (!head || !chain(t, head)) return NF_TRANSITION_CORRUPT;
  return fn && lookup(t, 0, fn) ? NF_TRANSITION_OK : NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;
}
