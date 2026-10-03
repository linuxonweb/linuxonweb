/* Compiler TLS in the same canonical module; no second frame chain. All
   pointers identify actual canonical records. No caller-supplied token exists. */
enum { NF_FATAL_NONE, NF_FATAL_PENDING, NF_FATAL_ACTIVE };
struct nf_fatal_v3 {
  struct nf_thread *thread;
  struct nf_frame *anchor;
  const struct nf_module *root;
  nf_u32 owner, epoch, activation, active_sp, serial, phase, operation;
};
static __thread struct nf_fatal_v3 fatal_v3;
static __thread nf_u32 fatal_serial_v3;
INLINE int modules(struct nf_thread *);
INLINE int chain(struct nf_thread *, struct nf_frame *);
INLINE int fatal_identity(struct nf_thread *t) {
  return fatal_v3.thread == t && fatal_v3.owner == t->owner_tp &&
      fatal_v3.epoch == t->task_epoch && fatal_v3.root == t->root_module &&
      fatal_v3.serial && fatal_v3.serial == fatal_serial_v3;
}
INLINE int fatal_live(struct nf_thread *t) {
  if (fatal_v3.phase != NF_FATAL_ACTIVE || !fatal_identity(t) ||
      t->critical_depth != 1 || !modules(t) || !chain(t, t->head)) return 0;
  for (struct nf_frame *f = t->head; f; f = f->previous)
    if (f == fatal_v3.anchor)
      return f->activation_id == fatal_v3.activation;
  return 0;
}
INLINE enum nf_transition_status_v2 published_fatal(struct nf_thread *t,
    struct nf_frame *head, nf_u32 operation) {
  /* A failure inside the fatal path cannot overwrite its authentic anchor.
     Nested fatal failure is an explicit unresolved reject, not another scope. */
  if (fatal_v3.phase == NF_FATAL_ACTIVE || fatal_serial_v3 == ~0u)
    return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;
  fatal_v3.thread = t; fatal_v3.anchor = head;
  fatal_v3.root = t->root_module; fatal_v3.owner = t->owner_tp;
  fatal_v3.epoch = t->task_epoch; fatal_v3.activation = head->activation_id;
  fatal_v3.active_sp = addr(head->active_sp);
  fatal_v3.serial = ++fatal_serial_v3;
  fatal_v3.phase = NF_FATAL_PENDING; fatal_v3.operation = operation;
  return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;
}
INLINE void fatal_clear(void) {
  fatal_v3.phase = NF_FATAL_NONE; fatal_v3.anchor = 0;
  fatal_v3.thread = 0; fatal_v3.root = 0;
}
int __wasm_gnu_fatal_begin_v3(struct nf_frame *actual) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!linear(t, sizeof(*t), 4) || t->version != NF_ABI_VERSION ||
      !t->owner_tp || t->owner_tp != __wasm_gnu_frame_owner_tp_v1() ||
      fatal_v3.phase != NF_FATAL_PENDING || !fatal_identity(t) ||
      (fatal_v3.operation != 1 && fatal_v3.operation != 2) ||
      t->critical_depth || t->import_depth || t->callback_depth ||
      t->head != actual || actual != fatal_v3.anchor || !modules(t) ||
      !chain(t, actual) || actual->activation_id != fatal_v3.activation ||
      addr(actual->active_sp) != fatal_v3.active_sp ||
      (t->forced && !__wasm_gnu_unwind_state_valid_v1(t))) return 0;
  t->critical_depth = 1; fatal_v3.phase = NF_FATAL_ACTIVE;
  return 1;
}
int __wasm_gnu_fatal_escape_v3(struct nf_frame *actual) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (fatal_v3.phase == NF_FATAL_NONE) return 1;
  if (!linear(t, sizeof(*t), 4) || t->head != actual || !fatal_live(t)) return 0;
  if (actual == fatal_v3.anchor) {
    t->critical_depth = 0; fatal_clear();
  }
  return 1;
}
int __wasm_gnu_fatal_target_v3(struct nf_frame *target) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (fatal_v3.phase == NF_FATAL_NONE) return 1;
  if (!linear(t, sizeof(*t), 4) || t->head != target || !fatal_live(t)) return 0;
  /* Younger handler-local target retains the authentic fatal critical scope.
     Older targets are reconciled by the exact anchor escape hook beforehand. */
  if (target == fatal_v3.anchor) {
    t->critical_depth = 0; fatal_clear();
  }
  return 1;
}
