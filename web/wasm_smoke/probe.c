/*
 * A deliberately freestanding module used to verify the browser boundary.
 *
 * This is not an operating-system emulator. It is a native wasm32 module:
 * there is no libc, JavaScript CPU interpreter, or POSIX shim in this file.
 * The exported value gives the host a cheap ABI/version handshake to perform
 * before loading a larger Linux-derived module.
 */

#include "linux_host.h"

__attribute__((visibility("default")))
int runtime_probe(void) {
    /* ASCII "LWEB" (Linux-on-web adapter ABI v1). */
    return (int)LINUX_HOST_ABI_MAGIC;
}

static unsigned char framebuffer[64 * 32 * 4];
static unsigned char events[256];

__attribute__((visibility("default")))
int runtime_start(void) {
    static const unsigned char message[] =
        "[linux-on-web] native wasm adapter started\n";
    int written = host_log(message, (int)(sizeof(message) - 1), 1);
    if (written != (int)(sizeof(message) - 1)) {
        return -1;
    }
    /* Touch the clock import to prove host services are wired. */
    return (int)(host_time_ns() & 0x7fffffff);
}

__attribute__((visibility("default")))
int runtime_frame(void) {
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 64; ++x) {
            unsigned char *pixel = &framebuffer[(y * 64 + x) * 4];
            pixel[0] = (unsigned char)(x * 4);
            pixel[1] = (unsigned char)(y * 8);
            pixel[2] = 0x9a;
            pixel[3] = 0xff;
        }
    }
    return host_frame_present(framebuffer, 64, 32, 64 * 4, 0);
}

__attribute__((visibility("default")))
int runtime_poll(void) {
    return host_poll_events(events, (int)sizeof(events));
}

/* Probe-only accessor so the browser test can verify that a DOM event made it
 * through the host ABI and into wasm memory. */
__attribute__((visibility("default")))
int runtime_event_byte(int index) {
    if (index < 0 || index >= (int)sizeof(events)) {
        return -1;
    }
    return events[index];
}
