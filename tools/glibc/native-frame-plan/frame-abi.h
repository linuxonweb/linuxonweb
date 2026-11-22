/* Versioned design proposal only. No runtime or compiler consumes this ABI. */
#ifndef GNU_WASM_NATIVE_FRAME_PLAN_H
#define GNU_WASM_NATIVE_FRAME_PLAN_H
#include <unwind.h>
typedef unsigned nf_u32;
struct nf_module;
struct nf_jump;
struct nf_frame;
struct nf_descriptor {
  nf_u32 version, bytes, flags;
  const struct nf_module *module;
  void (*function_identity)(void); /* Actual table relocation, never a PC. */
  _Unwind_Personality_Fn personality;
  const void *lsda;
  nf_u32 pad_count;
};
/* Owned loader publishes immutable tables only after full input admission.
   RECORDS_ONLY does not permit cancellation or escaping language EH. */
enum { NF_ABI_VERSION = 1, NF_RECORDS_ONLY = 1, NF_PRIMITIVE_BRIDGE = 2,
       NF_PHASE_ACTIVE = 1, NF_PHASE_RETIRED = 2 };
struct nf_module {
  nf_u32 version, flags, generation;
  const struct nf_descriptor *const *descriptors;
  nf_u32 descriptor_count;
  const struct nf_module *next;
};
struct nf_frame {
  struct nf_frame *previous;
  void *owner_tp;
  nf_u32 task_epoch, activation_id;
  const struct nf_descriptor *descriptor;
  void *caller_entry_sp, *fixed_sp, *active_sp;
  nf_u32 phase, forced_epoch, stopped_epoch, flags;
  struct nf_jump *jump_top;
  nf_u32 version, reserved0, reserved1;
} __attribute__((aligned(16)));
/* Prefix matches LLVM's existing landing-pad channel. Never mix versioned
   context providers: every accessor and compiler consumer is rebuilt together. */
struct nf_context {
  nf_u32 lpad_index;
  const void *lsda;
  nf_u32 selector;
  struct nf_frame *frame;
  void *cfa;
  _Unwind_Action actions;
  struct _Unwind_Exception *exception;
  nf_u32 forced_epoch, activation_id, version;
};
struct nf_forced {
  struct nf_forced *previous;
  void *owner_tp;
  nf_u32 task_epoch, epoch;
  struct _Unwind_Exception *exception;
  _Unwind_Stop_Fn stop;
  void *stop_parameter;
  struct nf_frame *current;
  nf_u32 stopped_activation, phase, suspended_depth, flags;
};
/* Compiler-generated registration at the real setjmp site. It preserves the
   current 24-byte backend jmpbuf; it is not a public jmpbuf enlargement. */
struct nf_jump {
  struct nf_jump *previous;
  void *environment;
  struct nf_frame *target;
  void *saved_sp;
  void *owner_tp;
  nf_u32 task_epoch, activation_id, label;
  nf_u32 registration_version;
};
struct nf_thread {
  struct nf_frame *head;
  struct nf_forced *forced;
  void *owner_tp;
  nf_u32 task_epoch;
  void *stack_low, *stack_high;
  nf_u32 next_activation, next_forced_epoch;
  nf_u32 import_depth, callback_depth, critical_depth;
  const struct nf_module *root_module;
  nf_u32 flags, version;
  nf_u32 next_jump_version;
};
/* Required canonical raw-GNU-TP binding; no provider is supplied by this plan.
   Must be independently admitted no-stack, no-import primitive bridge bodies. */
struct nf_thread *__wasm_gnu_frame_thread_v1(void);
void *__wasm_gnu_frame_owner_tp_v1(void);
void __wasm_gnu_frame_enter_v1(struct nf_frame *, const struct nf_descriptor *,
                             nf_u32 caller_sp, nf_u32 fixed_sp);
void __wasm_gnu_frame_leave_v1(struct nf_frame *);
void __wasm_gnu_frame_admit_call_v1(void (*)(void));
/* Compiler-owned operation, no definition or external provider permitted. */
void __wasm_gnu_frame_commit_sp_v1(nf_u32);
#endif
