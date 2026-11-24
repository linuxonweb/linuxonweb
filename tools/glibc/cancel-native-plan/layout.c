/* Compile-only proposal, not a runtime ABI or cancellation implementation. */
#include <unwind.h>
typedef unsigned u32;
struct proposed_frame {
  struct proposed_frame *previous;
  void *owner_tp;
  u32 generation;
  void *entry_sp;
  void *frame_low;
  u32 call_site;
  const void *descriptor;
  u32 state;
};
struct proposed_context {
  u32 lpad_index;
  const void *lsda;
  u32 selector;
  struct proposed_frame *frame;
  void *cfa;
  u32 action;
};
struct proposed_boundary {
  struct proposed_boundary *previous;
  void *owner_tp;
  u32 generation;
  u32 syscall_number;
  u32 phase;
  u32 signal_depth;
  u32 requested_action;
  int raw_result;
};
const unsigned plan_layout[] = {
  sizeof(struct _Unwind_Exception), _Alignof(struct _Unwind_Exception),
  sizeof(_Unwind_Stop_Fn), sizeof(_Unwind_Word), sizeof(void *),
  sizeof(struct proposed_frame), _Alignof(struct proposed_frame),
  __builtin_offsetof(struct proposed_frame,entry_sp),
  sizeof(struct proposed_context), _Alignof(struct proposed_context),
  __builtin_offsetof(struct proposed_context,cfa),
  sizeof(struct proposed_boundary), _Alignof(struct proposed_boundary),
  __builtin_offsetof(struct proposed_boundary,raw_result)
};
_Static_assert(sizeof(struct _Unwind_Exception)==24,"genuine GNU record");
_Static_assert(_Alignof(struct _Unwind_Exception)==8,"genuine GNU alignment");
_Static_assert(sizeof(struct proposed_frame)==32,"proposed frame");
_Static_assert(sizeof(struct proposed_context)==24,"proposed context");
_Static_assert(sizeof(struct proposed_boundary)==32,"proposed boundary");
