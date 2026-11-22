/* Canonical GNU thread/frame bridge candidate. Not cancellation acceptance.
   All functions in this unit require emitted no-linear-stack/no-import audits
   before primitive admission. Compiler TLS is storage, not the raw GNU TP. */
#include <pthreadP.h>
#include "gnu-helper.h"
#include "native-bridge.h"

#define EXPORT(name) __attribute__((export_name("__wasm_boundary_v3_" #name), noinline))
#define INLINE static __attribute__((always_inline)) inline
#define LIMIT 16
#define FORCE_ADMITTED 4u
struct import_bridge {
  struct nf_frame *owner;
  void *sidecar, *owner_tp, *active_sp;
  const struct nf_module *root;
  nf_u32 epoch, generation, activation, serial, depth, nr, phase, callback_base;
};
struct checkpoint {
  struct import_bridge *bridge;
  nf_u32 serial, bridge_serial, used, callback;
};
/* This is the one canonical nf_thread returned to the compiler/runtime.
   No copied head, host-side frame list, or independently published chain. */
static _Thread_local struct {
  struct nf_thread thread;
  void *sidecar;
  nf_u32 generation, admitted, retired, next_serial, imports, checkpoints, bridge_count;
  struct import_bridge *import_stack[LIMIT];
  struct checkpoint *callback_stack[LIMIT];
  struct import_bridge bridges[LIMIT];
  struct checkpoint saved[LIMIT];
} state;

INLINE nf_u32 address(const void *p) { return (nf_u32)(uintptr_t)p; }
INLINE int linear(const void *p, nf_u32 bytes, nf_u32 alignment)
{
  unsigned long long end = (unsigned long long)address(p) + bytes;
  return p && !(address(p) & (alignment - 1))
    && end <= (unsigned long long)__builtin_wasm_memory_size(0) * 65536u;
}
INLINE int valid_thread(void)
{
  return state.admitted && state.thread.version == NF_ABI_VERSION
    && state.thread.owner_tp && state.thread.task_epoch && state.generation
    && state.thread.flags == FORCE_ADMITTED && !state.thread.critical_depth
    && state.thread.root_module;
}
INLINE int descriptor(const struct nf_descriptor *candidate)
{
  for (const struct nf_module *m = state.thread.root_module, *next = 0;
       m; m = next) {
    /* Production multi-module admission is not supplied by this finite gate.
       A single actual LLVM-linked compiler manifest is required. */
    if (!linear(m, sizeof(*m), 4) || m != state.thread.root_module
        || m->version != NF_ABI_VERSION || m->flags != FORCE_ADMITTED
        || !m->generation || m->next
        || !m->descriptor_count || m->descriptor_count > 4096
        || !linear(m->descriptors, m->descriptor_count * 4, 4)) return 0;
    for (nf_u32 i = 0; i < m->descriptor_count; ++i) {
      const struct nf_descriptor *d = m->descriptors[i];
      if (!linear(d, sizeof(*d), 4) || d->version != NF_ABI_VERSION
          || d->bytes != sizeof(*d) || d->module != m || !d->function_identity
          || (d->flags != FORCE_ADMITTED && d->flags != NF_PRIMITIVE_BRIDGE)) return 0;
      if (d == candidate) return d->flags == FORCE_ADMITTED;
    }
    next = m->next;
  }
  return 0;
}
INLINE int active(const struct nf_frame *f)
{
  return linear(f, sizeof(*f), 16)
    && address(f) >= address(state.thread.stack_low)
    && (unsigned long long)address(f) + sizeof(*f) <= address(state.thread.stack_high)
    && f->version == NF_ABI_VERSION && f->phase == NF_PHASE_ACTIVE
    && f->flags == FORCE_ADMITTED && f->owner_tp == state.thread.owner_tp
    && f->task_epoch == state.thread.task_epoch && f->activation_id
    && f->activation_id < state.thread.next_activation
    && address(f->active_sp) >= address(state.thread.stack_low)
    && address(f->active_sp) <= address(f->fixed_sp)
    && address(f->fixed_sp) <= address(f)
    && (unsigned long long)address(f) + sizeof(*f) <= address(f->caller_entry_sp)
    && address(f->caller_entry_sp) <= address(state.thread.stack_high)
    && descriptor(f->descriptor);
}
INLINE int bridge_pointer(const struct import_bridge *b)
{
  nf_u32 p = address(b), base = address(state.bridges);
  return p >= base && p < address(state.bridges + LIMIT)
    && (p - base) % sizeof(*b) == 0;
}
INLINE int checkpoint_pointer(const struct checkpoint *c)
{
  nf_u32 p = address(c), base = address(state.saved);
  return p >= base && p < address(state.saved + LIMIT)
    && (p - base) % sizeof(*c) == 0;
}
/* Handles carry immutable caller-held serials, never reusable slot addresses.
   One nonwrapping serial namespace covers import and checkpoint lifetimes. */
INLINE struct import_bridge *resolve_bridge(void *handle)
{
  nf_u32 serial = address(handle);
  if (!serial) return 0;
  for (nf_u32 i = 0; i < state.bridge_count; ++i)
    if (state.bridges[i].phase && state.bridges[i].serial == serial) return &state.bridges[i];
  return 0;
}
INLINE struct checkpoint *resolve_checkpoint(void *handle)
{
  nf_u32 serial = address(handle);
  if (!serial) return 0;
  for (nf_u32 i = 0; i < state.checkpoints; ++i)
    if (state.saved[i].used && state.saved[i].serial == serial) return &state.saved[i];
  return 0;
}
INLINE int valid_bridge(const struct import_bridge *b)
{
  return valid_thread() && bridge_pointer(b) && (b->phase == 1 || b->phase == 2)
    && b->sidecar == state.sidecar && b->owner_tp == state.thread.owner_tp
    && b->epoch == state.thread.task_epoch && b->generation == state.generation
    && b->root == state.thread.root_module && active(b->owner)
    && b->activation == b->owner->activation_id && b->serial
    && b->serial < state.next_serial && b->active_sp == b->owner->active_sp;
}
INLINE int valid_checkpoint(const struct checkpoint *c)
{
  return checkpoint_pointer(c) && c->used && valid_bridge(c->bridge)
    && c->bridge_serial == c->bridge->serial;
}
INLINE int ancestor(const struct import_bridge *b)
{
  const struct nf_frame *f = state.thread.head;
  for (nf_u32 count = 0; f && count < 4096; ++count) {
    if (!active(f)) return 0;
    if (f == b->owner) return 1;
    const struct nf_frame *previous = f->previous;
    if (previous && (!active(previous) || f->caller_entry_sp != previous->active_sp)) return 0;
    f = previous;
  }
  return 0;
}

/* Called with the exact kernel-verified raw TP. Descriptor self pointers and
   real stack bounds are verified before caching the owner for import-free use. */
int __wasm_boundary_native_admit_v3(struct pthread *pd, nf_u32 epoch,
                                  nf_u32 generation, const struct nf_module *root)
{
  if (state.admitted || state.retired || !epoch || !generation || !linear(pd, sizeof(*pd), 32)
      || pd->header.self != pd || pd->header.tcb != pd || !pd->stackblock
      || !pd->stackblock_size || (address(pd->stackblock) & 15)
      || (unsigned long long)address(pd->stackblock) + pd->stackblock_size
         > (unsigned long long)__builtin_wasm_memory_size(0) * 65536u
      || !linear(root, sizeof(*root), 4) || root->version != NF_ABI_VERSION
      || root->flags != FORCE_ADMITTED || !root->generation || root->next
      || !root->descriptor_count || root->descriptor_count > 4096
      || !linear(root->descriptors, root->descriptor_count * 4, 4)) return -EINVAL;
  for (nf_u32 i = 0; i < root->descriptor_count; ++i) {
    const struct nf_descriptor *d = root->descriptors[i];
    if (!linear(d, sizeof(*d), 4) || d->version != NF_ABI_VERSION
        || d->bytes != sizeof(*d) || d->module != root || !d->function_identity
        || (d->flags != FORCE_ADMITTED && d->flags != NF_PRIMITIVE_BRIDGE)) return -EINVAL;
  }
  state.thread.owner_tp = pd;
  state.thread.task_epoch = epoch;
  state.thread.stack_low = pd->stackblock;
  state.thread.stack_high = (void *)(address(pd->stackblock) + pd->stackblock_size);
  state.thread.next_activation = state.thread.next_forced_epoch = state.thread.next_jump_version = 1;
  state.thread.root_module = root;
  state.thread.version = NF_ABI_VERSION;
  state.thread.flags = FORCE_ADMITTED;
  state.generation = generation;
  state.next_serial = 1;
  state.admitted = 1;
  return 0;
}
struct nf_thread *__wasm_gnu_frame_thread_v1(void) { return state.admitted ? &state.thread : 0; }
void *__wasm_gnu_frame_owner_tp_v1(void) { return state.admitted ? state.thread.owner_tp : 0; }
nf_u32 __wasm_boundary_native_instance_generation_v3(void)
{ return valid_thread() ? state.generation : 0; }
int __wasm_boundary_native_bind_v3(void *sidecar, void *tp, nf_u32 epoch, nf_u32 generation)
{
  if (!valid_thread() || state.sidecar || !sidecar || tp != state.thread.owner_tp
      || epoch != state.thread.task_epoch || generation != state.generation) return -EINVAL;
  state.sidecar = sidecar;
  return 0;
}
EXPORT(import_enter) void *__wasm_boundary_v3_import_enter(void *sidecar, int nr)
{
  if (!valid_thread() || sidecar != state.sidecar || state.imports >= LIMIT
      || state.bridge_count >= LIMIT || state.next_serial == ~0u
      || state.thread.import_depth != state.imports || !active(state.thread.head)) return 0;
  struct import_bridge *b = &state.bridges[state.bridge_count];
  if (b->phase) return 0;
  ++state.bridge_count;
  b->owner = state.thread.head; b->sidecar = sidecar;
  b->owner_tp = state.thread.owner_tp; b->epoch = state.thread.task_epoch;
  b->generation = state.generation; b->root = state.thread.root_module;
  b->activation = b->owner->activation_id; b->active_sp = b->owner->active_sp;
  state.import_stack[state.imports] = b;
  b->serial = state.next_serial++; b->depth = ++state.imports; b->nr = nr; b->phase = 1;
  b->callback_base = state.thread.callback_depth;
  ++state.thread.import_depth;
  return (void *)(uintptr_t)b->serial;
}
void *__wasm_boundary_native_checkpoint_v3(void *token, void *tp, nf_u32 epoch, nf_u32 generation)
{
  struct import_bridge *b = resolve_bridge(token);
  if (!valid_bridge(b) || b->phase != 1 || tp != b->owner_tp || epoch != b->epoch
      || generation != b->generation || state.checkpoints >= LIMIT
      || state.next_serial == ~0u || !ancestor(b)) return 0;
  struct checkpoint *c = &state.saved[state.checkpoints++];
  c->bridge = b; c->bridge_serial = b->serial; c->serial = state.next_serial++;
  c->used = 1; c->callback = 0;
  return (void *)(uintptr_t)c->serial;
}
int __wasm_boundary_native_callback_enter_v3(void *token)
{
  struct checkpoint *c = resolve_checkpoint(token);
  if (!valid_checkpoint(c) || c->callback || state.thread.callback_depth >= LIMIT) return -EINVAL;
  c->callback = 1;
  state.callback_stack[state.thread.callback_depth] = c;
  ++state.thread.callback_depth;
  return 0;
}
/* Exact actual recorded host-entry facade. Its temporary activation may sit
   above the importing owner when this primitive runs; callback activations
   must already have retired through their compiled guards. */
struct boundary_sidecar;
extern int boundary_callback_leave(struct boundary_sidecar *, void *, int);
int __wasm_boundary_native_leave_v3(void *token, int escaped)
{
  struct checkpoint *c = resolve_checkpoint(token);
  if ((escaped != 0 && escaped != 1) || !valid_checkpoint(c) || !c->callback
      || !state.thread.callback_depth
      || state.callback_stack[state.thread.callback_depth - 1] != c
      || !ancestor(c->bridge)) return -EINVAL;
  const struct nf_frame *head = state.thread.head;
  if (head != c->bridge->owner &&
      (head->previous != c->bridge->owner || head->descriptor->function_identity
       != (void (*)(void))boundary_callback_leave)) return -EINVAL;
  /* Compiled guards must already retire escaped callback activations. Never
     pop arbitrary live records or modify target jump registrations here. */
  c->callback = 0;
  --state.thread.callback_depth;
  return 0;
}
int __wasm_boundary_native_current_v3(void *token)
{
  struct checkpoint *c = resolve_checkpoint(token);
  return valid_checkpoint(c) && !c->callback && ancestor(c->bridge);
}
/* Exact genuine arch activation identity, not a fabricated program counter.
   The architecture implementation must be compiled into the admitted module. */
extern long __syscall_cancel_arch(volatile int *, __syscall_arg_t, __syscall_arg_t,
  __syscall_arg_t, __syscall_arg_t, __syscall_arg_t, __syscall_arg_t,
  __syscall_arg_t);
int __wasm_boundary_native_cancellable_v3(void *token)
{
  struct checkpoint *c = resolve_checkpoint(token);
  if (!valid_checkpoint(c) || !ancestor(c->bridge)) return 0;
  const struct nf_frame *f = c->bridge->owner;
  for (nf_u32 count = 0; f && count < 4096; ++count, f = f->previous) {
    if (!active(f)) return 0;
    if (f->descriptor->function_identity == (void (*)(void))__syscall_cancel_arch) return 1;
  }
  return 0;
}
EXPORT(import_leave) int __wasm_boundary_v3_import_leave(void *sidecar, void *token, int outcome)
{
  struct import_bridge *b = resolve_bridge(token);
  if (outcome != 0 || !valid_bridge(b) || b->phase != 1 || sidecar != state.sidecar
      || !state.imports || b != state.import_stack[state.imports - 1]
      || b->depth != state.imports || state.thread.import_depth != state.imports
      || state.thread.head != b->owner || state.thread.callback_depth != b->callback_base) return -EINVAL;
  b->phase = 2;
  --state.imports;
  --state.thread.import_depth;
  return 0;
}
/* Only outermost acknowledged drain retires tokens; retained checkpoints must
   remain inspectable between import_leave and genuine handler dispatch. */
int __wasm_boundary_native_complete_v3(void)
{
  if (!valid_thread() || state.imports || state.thread.import_depth || state.thread.callback_depth) return -EINVAL;
  for (nf_u32 i = 0; i < LIMIT; ++i)
    if (state.bridges[i].phase == 1) return -EINVAL;
  for (nf_u32 i = 0; i < LIMIT; ++i) {
    state.bridges[i].phase = 0;
    state.saved[i].used = 0;
  }
  state.checkpoints = state.bridge_count = 0;
  return 0;
}
void __wasm_boundary_native_invalidate_v3(void *tp, nf_u32 epoch)
{
  if (state.admitted && state.thread.owner_tp == tp && state.thread.task_epoch == epoch) {
    state.admitted = 0;
    state.retired = 1;
    state.thread.version = 0;
    state.sidecar = 0;
    /* Do not resume or reuse retired TLS storage after exit/exec. A fresh
       module/TLS instance must perform new kernel-verified admission. */
  }
}
