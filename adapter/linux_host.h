/* SPDX-License-Identifier: MIT */
/*
 * Stable C declarations for the browser host boundary.
 *
 * This header is freestanding: it deliberately does not include libc or
 * compiler runtime headers.  A wasm module may include it from a kernel,
 * userspace shim, or a small probe while retaining the same import names.
 */
#ifndef LINUX_ON_WEB_HOST_H
#define LINUX_ON_WEB_HOST_H

/* ASCII "LWEB" and the ABI revision returned by the probe handshake. */
#define LINUX_HOST_ABI_MAGIC   0x4c574542u
#define LINUX_HOST_ABI_VERSION 1u

/* Stable host return values.  Successful byte operations return a byte count. */
#define LINUX_HOST_OK       0
#define LINUX_HOST_EFAULT  (-14)
#define LINUX_HOST_EINVAL  (-22)
#define LINUX_HOST_ENOSYS  (-38)

typedef unsigned char  linux_host_u8;
typedef unsigned int   linux_host_u32;
typedef int            linux_host_i32;
typedef long long      linux_host_i64;

#define LINUX_HOST_IMPORT(name) \
    __attribute__((import_module("linux_host"), import_name(name)))

/* Clock and cooperative scheduling. */
extern linux_host_i64 host_time_ns(void)
    LINUX_HOST_IMPORT("clock_monotonic_ns");
extern linux_host_i32 host_sleep_until_ns(linux_host_i64 deadline_ns)
    LINUX_HOST_IMPORT("sleep_until_ns");

/* Input and presentation. Pointers refer to exported wasm linear memory. */
extern linux_host_i32 host_poll_events(linux_host_u8 *buffer,
                                       linux_host_i32 capacity)
    LINUX_HOST_IMPORT("poll_events");
extern linux_host_i32 host_frame_present(const linux_host_u8 *buffer,
                                         linux_host_i32 width,
                                         linux_host_i32 height,
                                         linux_host_i32 stride,
                                         linux_host_i32 format)
    LINUX_HOST_IMPORT("frame_present");

/* Explicitly mounted persistence and asynchronous browser networking. */
extern linux_host_i32 host_file_read(linux_host_i32 handle,
                                     linux_host_u8 *buffer,
                                     linux_host_i32 length,
                                     linux_host_i64 offset)
    LINUX_HOST_IMPORT("file_read");
extern linux_host_i32 host_file_write(linux_host_i32 handle,
                                      const linux_host_u8 *buffer,
                                      linux_host_i32 length,
                                      linux_host_i64 offset)
    LINUX_HOST_IMPORT("file_write");
extern linux_host_i32 host_net_request(const linux_host_u8 *request,
                                       linux_host_i32 length)
    LINUX_HOST_IMPORT("net_request");

/* Diagnostic text; returns the number of bytes consumed. */
extern linux_host_i32 host_log(const linux_host_u8 *buffer,
                               linux_host_i32 length,
                               linux_host_i32 level)
    LINUX_HOST_IMPORT("log");

#endif /* LINUX_ON_WEB_HOST_H */
