/* Owned native boundary context hook; there is no architectural user PC. */
#ifndef GNU_WASM_BOUNDARY_CANCELLATION_PC_CHECK_H
#define GNU_WASM_BOUNDARY_CANCELLATION_PC_CHECK_H
#include "gnu-helper.h"
static __always_inline bool
cancellation_pc_check(void *context)
{
  return context != NULL && __wasm_boundary_cancellation_pc_check_v3(context);
}
#endif
