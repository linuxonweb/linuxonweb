/* Actual GNU public/NPTL layout measurement under the coherent backend64.
   This object is an ABI probe, not a synthetic pthread implementation. */
#include <pthreadP.h>
#include <setjmp.h>
#include "forced-abi.h"
#define OFFSET(type, member) __builtin_offsetof(type, member)
_Static_assert(sizeof(__jmp_buf) == 64, "real GNU backend64");
_Static_assert(sizeof(jmp_buf) == 196, "real GNU public jmp_buf196");
_Static_assert(sizeof(struct _Unwind_Exception) == 24, "genuine GNU exception24");
_Static_assert(_Alignof(struct _Unwind_Exception) == 8, "genuine GNU exception alignment8");
_Static_assert(sizeof(struct nf_frame) == 64, "compiler record64");
_Static_assert(sizeof(struct nf_context) == 40, "compiler context40");
_Static_assert(sizeof(struct nf_jump) == 36, "registration36");
_Static_assert(sizeof(struct nf_thread) == 60, "canonical thread60");
const unsigned gnu_jump64_layout[] = {
  sizeof(__jmp_buf), _Alignof(__jmp_buf), sizeof(jmp_buf), _Alignof(jmp_buf),
  OFFSET(struct __jmp_buf_tag, __mask_was_saved),
  OFFSET(struct __jmp_buf_tag, __saved_mask),
  sizeof(__pthread_unwind_buf_t), _Alignof(__pthread_unwind_buf_t),
  sizeof(struct pthread_unwind_buf), _Alignof(struct pthread_unwind_buf),
  OFFSET(struct pthread_unwind_buf, cancel_jmp_buf),
  OFFSET(struct pthread_unwind_buf, priv),
  sizeof(struct pthread), _Alignof(struct pthread),
  OFFSET(struct pthread, exc), OFFSET(struct pthread, cleanup_jmp_buf),
  sizeof(struct _Unwind_Exception), _Alignof(struct _Unwind_Exception),
  OFFSET(struct _Unwind_Exception, private_1),
  OFFSET(struct _Unwind_Exception, private_2),
  sizeof(struct nf_frame), _Alignof(struct nf_frame),
  sizeof(struct nf_context), _Alignof(struct nf_context),
  sizeof(struct nf_jump), _Alignof(struct nf_jump),
  sizeof(struct nf_thread), _Alignof(struct nf_thread),
};
