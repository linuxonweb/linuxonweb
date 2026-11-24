/* Owned GNU/kernel boundary proposal, not public ucontext or a PC provider. */
#ifndef GNU_WASM_CANCEL_BOUNDARY_HELPER_H
#define GNU_WASM_CANCEL_BOUNDARY_HELPER_H
#include <signal.h>
#include <stdint.h>
struct gnu_boundary_record {
  uint32_t magic, version, bytes, phase;
  uint32_t task, tp, pid, tgid, lo, hi;
  int32_t raw, nr, result, restart;
  uint32_t signal;
  int32_t copy_status;
  uint32_t handler, trampoline, flags, kind;
};
_Static_assert(sizeof(struct gnu_boundary_record) == 80, "version3 kernel record");
_Static_assert(__builtin_offsetof(struct gnu_boundary_record, raw) == 40, "raw result");
_Static_assert(__builtin_offsetof(struct gnu_boundary_record, handler) == 64, "actual handler identity");

/* Required real frame-provider operations. No implementation, constant
 * success, frame scan, PC synthesis, or cancellation stub is supplied here.
 * The provider must admit actual canonical TP/task/module/frame state. */
void *__wasm_boundary_native_checkpoint_v3(void *import_bridge, void *tp, uint32_t epoch,
                                           uint32_t module_generation);
int __wasm_boundary_native_leave_v3(void *checkpoint, int escaped);
int __wasm_boundary_native_cancellable_v3(void *checkpoint);
int __wasm_boundary_native_current_v3(void *checkpoint);
void __wasm_boundary_native_invalidate_v3(void *tp, uint32_t epoch);
/* Actual provider bodies are admitted no-stack/no-import/no-poll primitives;
 * enter snapshots the canonical head before any temporary recorded helper. */
void *__wasm_boundary_v3_import_enter(void *sidecar, int syscall_number);
int __wasm_boundary_v3_import_leave(void *sidecar, void *bridge, int outcome);
uintptr_t __wasm_boundary_gnu_sigcancel_handler_v3(void);
int __wasm_boundary_cancellation_pc_check_v3(const void *context);
#endif
