/*
 * Freestanding adapter probe. This is intentionally not a Linux kernel and
 * does not emulate another CPU. It verifies the wasm32 import/export ABI that
 * the future arch/wasm host layer can build around.
 */

#include "linux_host.h"

static const char message[] = "linux_host wasm32 probe\n";

__attribute__((export_name("kernel_entry")))
int kernel_entry(void) {
    return host_log((const linux_host_u8 *)message,
                    (linux_host_i32)(sizeof(message) - 1u), 1);
}
