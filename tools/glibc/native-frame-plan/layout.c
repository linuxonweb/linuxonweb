/* Compile-only shape assertions against real selected GNU/native headers. */
#include "frame-abi.h"
#include <bits/wordsize.h>
#define _SETJMP_H 1
#include <bits/setjmp.h>
#define OFF(T,F) __builtin_offsetof(struct T,F)
_Static_assert(__WORDSIZE == 32, "selected GNU word size");
_Static_assert(sizeof(struct _Unwind_Exception) == 24, "genuine GNU exception");
_Static_assert(_Alignof(struct _Unwind_Exception) == 8, "GNU alignment");
_Static_assert(OFF(_Unwind_Exception,private_1) == 12, "GNU private1");
_Static_assert(OFF(_Unwind_Exception,private_2) == 16, "GNU private2");
_Static_assert(sizeof(__jmp_buf) == 24, "current owned native backend");
_Static_assert(sizeof(struct nf_descriptor) == 32, "descriptor proposal");
_Static_assert(sizeof(struct nf_module) == 24, "immutable module manifest");
_Static_assert(sizeof(struct nf_frame) == 64, "frame proposal");
_Static_assert(_Alignof(struct nf_frame) == 16, "frame stack alignment");
_Static_assert(OFF(nf_frame,active_sp) == 28, "live dynamic SP");
_Static_assert(OFF(nf_frame,caller_entry_sp) == 20, "captured CFA field");
_Static_assert(sizeof(struct nf_context) == 40, "context proposal");
_Static_assert(OFF(nf_context,cfa) == 16, "context CFA");
_Static_assert(sizeof(struct nf_forced) == 48, "forced proposal");
_Static_assert(sizeof(struct nf_jump) == 36, "jump registration proposal");
_Static_assert(OFF(nf_jump,registration_version) == 32, "nonwrapping registration version");
_Static_assert(sizeof(struct nf_thread) == 60, "thread sidecar proposal");
_Static_assert(OFF(nf_thread,next_jump_version) == 56, "thread-owned registration counter");
const unsigned native_frame_layout[] = {
  sizeof(struct _Unwind_Exception), _Alignof(struct _Unwind_Exception),
  OFF(_Unwind_Exception,private_1), OFF(_Unwind_Exception,private_2),
  sizeof(__jmp_buf), sizeof(struct nf_descriptor), sizeof(struct nf_frame),
  OFF(nf_frame,caller_entry_sp), sizeof(struct nf_context), OFF(nf_context,cfa),
  sizeof(struct nf_forced), sizeof(struct nf_jump), sizeof(struct nf_thread),
  sizeof(_Unwind_Stop_Fn), _UA_FORCE_UNWIND|_UA_CLEANUP_PHASE,
  _UA_FORCE_UNWIND|_UA_CLEANUP_PHASE|_UA_END_OF_STACK
};
unsigned native_frame_layout_probe(unsigned i) {
  return i < sizeof(native_frame_layout)/sizeof(*native_frame_layout)
      ? native_frame_layout[i] : 0;
}
