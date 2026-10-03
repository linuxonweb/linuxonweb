#ifndef GNU_WASM_NATIVE_FORCED_ABI_H
#define GNU_WASM_NATIVE_FORCED_ABI_H
#include "frame-abi.h"
#include "jump-abi-v2.h"
/* Separate admission from the immutable RECORDS_ONLY module contract. */
enum { NF_FORCED_ADMITTED = 4, NF_FORCED_LIVE = 1, NF_FORCED_RETIRED = 2,
       NF_ESCAPE_ORDINARY = 0, NF_ESCAPE_TAG1 = 1, NF_ESCAPE_TAG0 = 2 };
/* Compiler-only capture, erased by CFGStackify. A provider is forbidden. */
void __wasm_gnu_unwind_bind_v1(struct nf_frame *, struct nf_context *);
/* Caller-owned context; may throw native tag1 from genuine GNU stop. */
void __wasm_gnu_unwind_guard_v1(struct nf_frame *,
    struct _Unwind_Exception *, struct nf_context *);
/* Terminal delivery has authenticated END context (no application CFA),
   after ordinary root cleanup. The
   GNU NPTL stop must jump; a returned terminal callback invokes genuine abort.
   This does not implement returning generic libgcc END_OF_STACK semantics. */
void __wasm_gnu_unwind_terminal_v1(struct nf_frame *,
    struct _Unwind_Exception *, struct nf_context *);
/* Actual escaping frame only. Retained targets never invoke this operation. */
/* These metadata transitions are candidate no-stack primitives. A finite
   machine audit must prove no linear stack, unsealed calls/imports or reentrancy before
   admitting them. Return 0 rejects without mutation; caller invokes real abort.
   No unverified primitive is accepted just because its name is in this header. */
int __wasm_gnu_unwind_state_valid_v1(struct nf_thread *);
int __wasm_gnu_unwind_escape_v2(struct nf_frame *, nf_u32 reason,
                               struct _Unwind_Exception *actual_tag0, nf_u32 actual_tag1_handle);
int __wasm_gnu_unwind_target_v2(struct nf_jump *, void *actual_environment,
                               nf_u32 actual_registration_version, nf_u32 actual_tag1_handle);
/* Actual canonical setjmp producer supplies every argument; backend64 env
   embeds registration36 at byte28. Return0 rejects before mutation. */
nf_u32 __wasm_gnu_unwind_register_v1(struct nf_frame *,void *actual_environment,
    nf_u32 actual_label,void *actual_invocation,struct nf_jump *,nf_u32 actual_sp);
/* Coherent compiler/runtime extension; every generated consumer rebuilds. */
_Unwind_Reason_Code _Unwind_CallPersonality(struct _Unwind_Exception *,
                                            struct nf_context *);
/* Architecture predicate uses registered target ancestry, not biased CFA. */
int __wasm_gnu_unwind_cfa_descendant_v1(void *environment,
    struct _Unwind_Context *, nf_u32 stack_adjustment);
#endif
