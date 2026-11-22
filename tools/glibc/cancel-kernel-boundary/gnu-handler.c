/* Architecture selection includes the actual GNU implementation unchanged.
 * Its static handler is published as a real function-table relocation. */
#include <nptl/pthread_cancel.c>
#include "gnu-helper.h"
__attribute__((visibility("hidden"))) uintptr_t
__wasm_boundary_gnu_sigcancel_handler_v3(void)
{
  return (uintptr_t)sigcancel_handler;
}
