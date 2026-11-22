/* Actual admitted-frame control candidate. Compile with the coherent frame
   pass and call only after genuine GNU TP/module admission. No synthetic head,
   frame descriptor, cancellation flags or forced-unwind provider is supplied.
   This exercises token lifetimes, not real blocked syscall cancellation. */
#include <pthreadP.h>
#include "gnu-helper.h"
#include "native-bridge.h"

__attribute__((export_name("__wasm_boundary_v3_bridge_lifetime_tests"), noinline))
int bridge_lifetime_tests(void *sidecar, void *actual_tp,
                          uint32_t task_epoch, uint32_t instance_generation)
{
  int checks = 0;
#define CHECK(expression) do { if (!(expression)) return -1 - checks; ++checks; } while (0)
  void *old_import = 0, *old_checkpoint = 0;
  for (unsigned iteration = 0; iteration < 20; ++iteration) {
    CHECK(__wasm_gnu_frame_owner_tp_v1() == actual_tp);
    void *outer = __wasm_boundary_v3_import_enter(sidecar, 63);
    CHECK(outer != 0);
    void *first = __wasm_boundary_native_checkpoint_v3(outer, actual_tp,
        task_epoch, instance_generation);
    void *second = __wasm_boundary_native_checkpoint_v3(outer, actual_tp,
        task_epoch, instance_generation);
    CHECK(first && second && first != second && first != outer && second != outer);
    CHECK(__wasm_boundary_native_current_v3(first) == 1);
    CHECK(__wasm_boundary_native_current_v3(second) == 1);
    if (old_import) {
      CHECK(outer != old_import && first != old_checkpoint && second != old_checkpoint);
      CHECK(__wasm_boundary_native_checkpoint_v3(old_import, actual_tp,
          task_epoch, instance_generation) == 0);
      CHECK(__wasm_boundary_native_current_v3(old_checkpoint) == 0);
      CHECK(__wasm_boundary_native_callback_enter_v3(old_checkpoint) == -EINVAL);
      CHECK(__wasm_boundary_v3_import_leave(sidecar, old_import, 0) == -EINVAL);
    }
    void *inner = __wasm_boundary_v3_import_enter(sidecar, 98);
    CHECK(inner && inner != outer && inner != first && inner != second);
    void *nested = __wasm_boundary_native_checkpoint_v3(inner, actual_tp,
        task_epoch, instance_generation);
    CHECK(nested && nested != inner && nested != first && nested != second);
    CHECK(__wasm_boundary_v3_import_leave(sidecar, outer, 0) == -EINVAL);
    CHECK(__wasm_boundary_native_complete_v3() == -EINVAL);
    CHECK(__wasm_boundary_v3_import_leave(sidecar, inner, 0) == 0);
    CHECK(__wasm_boundary_v3_import_leave(sidecar, inner, 0) == -EINVAL);
    CHECK(__wasm_boundary_native_current_v3(nested) == 1);
    CHECK(__wasm_boundary_v3_import_leave(sidecar, outer, 0) == 0);
    CHECK(__wasm_boundary_native_current_v3(first) == 1);
    CHECK(__wasm_boundary_native_complete_v3() == 0);
    CHECK(__wasm_boundary_native_current_v3(first) == 0);
    CHECK(__wasm_boundary_native_current_v3(second) == 0);
    CHECK(__wasm_boundary_native_current_v3(nested) == 0);
    CHECK(__wasm_boundary_native_checkpoint_v3(inner, actual_tp,
        task_epoch, instance_generation) == 0);
    old_import = outer;
    old_checkpoint = first;
  }
  return checks;
#undef CHECK
}
