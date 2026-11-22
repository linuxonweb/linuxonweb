/* Owned canonical GNU owner/import bridge candidate. No second frame chain.
   Opaque void* tokens encode monotonic i32 handles, not dereferenceable pointers.
   Handles saturate/reject and remain invalid after outer completion/address reuse. */
#ifndef GNU_WASM_BOUNDARY_NATIVE_BRIDGE_H
#define GNU_WASM_BOUNDARY_NATIVE_BRIDGE_H
#include "frame-abi.h"
struct pthread;
/* Root is the actual compiler-emitted, admitted immutable module table.
   Startup calls this sealed primitive before the first recorded activation. */
int __wasm_boundary_native_admit_v3(struct pthread *, nf_u32 task_epoch,
                                  nf_u32 module_generation,
                                  const struct nf_module *);
int __wasm_boundary_native_bind_v3(void *actual_sidecar, void *owner_tp,
                                 nf_u32 task_epoch, nf_u32 module_generation);
int __wasm_boundary_native_callback_enter_v3(void *checkpoint);
int __wasm_boundary_native_complete_v3(void);
nf_u32 __wasm_boundary_native_instance_generation_v3(void);
/* Supplied by final-module admission, never a synthetic module/descriptor. */
const struct nf_module *__wasm_boundary_native_root_v3(void);
#endif
