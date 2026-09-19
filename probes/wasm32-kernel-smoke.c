/*
 * Freestanding adapter probe. This is intentionally not a Linux kernel and
 * does not emulate another CPU. It verifies the wasm32 import/export ABI that
 * the future arch/wasm host layer can build around.
 */

typedef unsigned int u32;

__attribute__((import_module("linux_host"), import_name("log")))
extern int host_log(const char *ptr, u32 len, u32 level);

static const char message[] = "linux_host wasm32 probe\n";

__attribute__((export_name("kernel_entry")))
int kernel_entry(void) {
    return host_log(message, (u32)(sizeof(message) - 1u), 1u);
}

