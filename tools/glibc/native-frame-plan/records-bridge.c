/* Native normal-record fixture only: owner token is synthetic, not GNU TP.
   Leaf helpers are admitted as sealed primitives only after machine inspection. */
#include "frame-abi.h"
#ifndef COMPILER_MODULE
#error actual compiler-emitted module manifest symbol required
#endif
extern const struct nf_module compiler_module __asm__(COMPILER_MODULE);
extern nf_u32 read_sp(void);
static struct nf_thread state;
static void *owner;
static nf_u32 checks, polls, maximum_depth, reasons[9], observed[9];
void __wasm_gnu_cancel_poll_v1(nf_u32, nf_u32);
nf_u32 record_observe(nf_u32);
static const struct nf_module bridge_module;
static const struct nf_descriptor poll_descriptor = {
  1, 32, NF_PRIMITIVE_BRIDGE, &bridge_module,
  (void (*)(void))__wasm_gnu_cancel_poll_v1, 0, 0, 0
};
static const struct nf_descriptor observe_descriptor = {
  1, 32, NF_PRIMITIVE_BRIDGE, &bridge_module,
  (void (*)(void))record_observe, 0, 0, 0
};
static const struct nf_descriptor *const bridges[] = {
  &poll_descriptor, &observe_descriptor
};
static const struct nf_module bridge_module = {
  1, NF_RECORDS_ONLY, 1, bridges, 2, &compiler_module
};
struct nf_thread *__wasm_gnu_frame_thread_v1(void) { return &state; }
void *__wasm_gnu_frame_owner_tp_v1(void) { return owner; }
static __attribute__((always_inline)) inline void require(int condition) {
  ++checks;
  if (!condition) __builtin_trap();
}
static __attribute__((always_inline)) inline nf_u32 inspect(void) {
  nf_u32 sp = read_sp(), depth = 0;
  require(state.head != 0);
  require((nf_u32)state.head->active_sp == sp);
  for (struct nf_frame *f = state.head; f; f = f->previous) {
    require(++depth <= 256);
    require(f->version == 1 && f->phase == NF_PHASE_ACTIVE);
    require(f->owner_tp == owner && f->task_epoch == state.task_epoch);
    require(!((nf_u32)f & 15u));
    require((nf_u32)f->active_sp <= (nf_u32)f->fixed_sp);
    require((nf_u32)f->fixed_sp <= (nf_u32)f);
    require((nf_u32)f + 64 <= (nf_u32)f->caller_entry_sp);
    require(f->descriptor->module == &compiler_module);
    if (f->previous) {
      require(f->caller_entry_sp == f->previous->active_sp);
      require(f->activation_id > f->previous->activation_id);
    }
  }
  if (depth > maximum_depth) maximum_depth = depth;
  return sp;
}
void __wasm_gnu_cancel_poll_v1(nf_u32 caller_sp, nf_u32 reason) {
  (void)inspect();
  require((nf_u32)state.head->caller_entry_sp == caller_sp);
  require(reason < 9); ++reasons[reason]; ++polls;
}
nf_u32 record_observe(nf_u32 reason) {
  require(reason > 0 && reason < 9);
  nf_u32 sp = inspect(); observed[reason] = sp;
  return sp;
}
void record_init(void) {
  require(!state.head);
  owner = &state;
  state.owner_tp = owner; state.task_epoch = 7;
  state.stack_high = (void *)read_sp();
  state.stack_low = (void *)((nf_u32)state.stack_high - 65536);
  state.next_activation = state.next_forced_epoch = state.next_jump_version = 1;
  state.version = 1; state.root_module = &bridge_module;
}
nf_u32 record_status(void) {
  return !state.head && !state.forced && !state.critical_depth &&
      !state.import_depth && !state.callback_depth;
}
nf_u32 record_checks(void) { return checks; }
nf_u32 record_polls(void) { return polls; }
nf_u32 record_depth(void) { return maximum_depth; }
nf_u32 record_module(void) { return (nf_u32)&compiler_module; }
nf_u32 record_seen(nf_u32 reason) { return reason < 9 ? observed[reason] : 0; }
void record_invalidate(nf_u32 reason) {
  if (reason == 1) owner = (void *)19;
  if (reason == 2) state.task_epoch = 0;
  if (reason == 3) state.next_activation = ~0u;
  if (reason == 4) state.version = 9;
  if (reason == 5) state.root_module = 0;
  if (reason == 6) state.stack_low = state.stack_high;
  if (reason == 7) state.head = (void *)3;
}
