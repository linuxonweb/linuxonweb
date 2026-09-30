// SPDX-License-Identifier: MIT
// Actual-guest test of the W4a host wgpu executor (web/linux/dist/guest-gpu-wgpu.js)
// reached through gpu_hostcall op 0x10 (docs/firefox-webgpu-w4a-20260930.md).
// It drives the calls the future __wrap_wgpu_server_* adapter will make, with
// Firefox wgpu ids (index, epoch, backend) and bincode ByteBufs laid out
// exactly as Firefox 128's client encoders produce them (W3 goldens).
#define _GNU_SOURCE
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define SYS_gpu_hostcall 0x6a470001
#define OP_WGPU 0x10
#define REQ_MAGIC 0x31514757u
#define RESP_MAGIC 0x31524757u

enum {
    SERVER_NEW = 1, SERVER_DELETE, INSTANCE_REQUEST_ADAPTER, ADAPTER_PACK_INFO, ADAPTER_REQUEST_DEVICE, ADAPTER_DROP,
    DEVICE_CREATE_BUFFER, BUFFER_MAP, BUFFER_GET_MAPPED_RANGE, BUFFER_UNMAP, BUFFER_DESTROY, BUFFER_DROP,
    DEVICE_CREATE_ENCODER, COMMAND_ENCODER_ACTION, ENCODER_FINISH, ENCODER_DROP, QUEUE_WRITE_ACTION, QUEUE_SUBMIT,
    QUEUE_ON_SUBMITTED_WORK_DONE, DEVICE_SET_LOST_CALLBACK, POLL_ALL_DEVICES, DEVICE_DESTROY, DEVICE_DROP,
    DEVICE_ACTION, STATS,
};
enum { ERR_NONE, ERR_DEVICE_LOST, ERR_INTERNAL, ERR_OOM, ERR_VALIDATION };
enum { EV_BUFFER_MAP = 1, EV_WORK_DONE, EV_DEVICE_LOST, EV_UNCAPTURED };
enum { BK_VULKAN = 1 };
// WebGPU usage bits
enum { U_MAP_READ = 1, U_MAP_WRITE = 2, U_COPY_SRC = 4, U_COPY_DST = 8 };

static int passes, failures;
#define CHECK(name, cond)                                                                  \
    do {                                                                                   \
        if (cond) {                                                                        \
            passes++;                                                                      \
        } else {                                                                           \
            failures++;                                                                    \
            printf("GUEST_WGPU FAIL %s (%s:%d)\n", name, __FILE__, __LINE__);              \
            fflush(stdout);                                                                \
        }                                                                                  \
    } while (0)

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}
static uint64_t id(uint32_t index, uint32_t epoch) {
    return (uint64_t)index | ((uint64_t)(epoch & 0x1fffffff) << 32) | ((uint64_t)BK_VULKAN << 61);
}

static long hc(int op, long a0, long a1, long a2, long a3, long a4) {
    long r = syscall(SYS_gpu_hostcall, op, a0, a1, a2, a3, a4);
    return r < 0 ? -errno : r;
}

typedef struct {
    long rc;          // hostcall result
    uint32_t type;    // ErrorBufferType
    uint32_t nf;      // payload u64 count
    uint64_t f[512];
    uint8_t *payload; // raw payload bytes
    uint32_t payload_len;
    char msg[4200];
} resp_t;

static uint8_t req_buf[16 + 8 * 64];
static uint8_t resp_buf[65536];
static uint32_t calls_made;
static uint64_t call_ns_total;

// Raw call with explicit request/response buffers (for transport tests).
static long raw_call(const void *req, uint32_t req_len, void *resp, uint32_t cap, uint32_t *len_out) {
    return hc(OP_WGPU, (long)req, (long)req_len, (long)resp, (long)cap, (long)len_out);
}

static void build_req(uint16_t call, const uint64_t *fields, int n) {
    uint32_t magic = REQ_MAGIC, plen = (uint32_t)n * 8, zero = 0;
    uint16_t version = 1;
    memcpy(req_buf, &magic, 4);
    memcpy(req_buf + 4, &version, 2);
    memcpy(req_buf + 6, &call, 2);
    memcpy(req_buf + 8, &plen, 4);
    memcpy(req_buf + 12, &zero, 4);
    memcpy(req_buf + 16, fields, plen);
}

static int wg(resp_t *r, uint16_t call, const uint64_t *fields, int n) {
    memset(r, 0, sizeof *r);
    build_req(call, fields, n);
    uint32_t len = 0;
    uint64_t t0 = now_ns();
    r->rc = raw_call(req_buf, 16 + (uint32_t)n * 8, resp_buf, sizeof resp_buf, &len);
    call_ns_total += now_ns() - t0;
    calls_made++;
    if (r->rc < 0) {
        r->type = 0xffffffffu;
        return -1;
    }
    uint32_t magic, type, plen, mlen;
    uint16_t version, echo;
    memcpy(&magic, resp_buf, 4);
    memcpy(&version, resp_buf + 4, 2);
    memcpy(&echo, resp_buf + 6, 2);
    memcpy(&type, resp_buf + 8, 4);
    memcpy(&plen, resp_buf + 12, 4);
    memcpy(&mlen, resp_buf + 16, 4);
    if (magic != RESP_MAGIC || version != 1 || echo != call || (uint32_t)r->rc != len ||
        24 + plen + mlen != (uint32_t)r->rc || plen % 8) {
        printf("GUEST_WGPU FAIL bad response header call=%u rc=%ld\n", call, r->rc);
        failures++;
        r->type = 0xfffffffeu;
        return -1;
    }
    r->type = type;
    r->payload = resp_buf + 24;
    r->payload_len = plen;
    r->nf = plen / 8 < 512 ? plen / 8 : 512;
    memcpy(r->f, resp_buf + 24, r->nf * 8);
    uint32_t m = mlen < sizeof r->msg - 1 ? mlen : sizeof r->msg - 1;
    memcpy(r->msg, resp_buf + 24 + plen, m);
    r->msg[m] = 0;
    return (int)type;
}
#define WG(r, call, ...)                                                                   \
    ({                                                                                     \
        uint64_t _f[] = {__VA_ARGS__};                                                     \
        wg(r, call, _f, (int)(sizeof _f / sizeof _f[0]));                                  \
    })

static int ok(const resp_t *r) {
    return r->rc > 0 && r->type == ERR_NONE;
}
static int err_is(const resp_t *r, uint32_t type, const char *needle) {
    return r->rc > 0 && r->type == type && (!needle || strstr(r->msg, needle) != NULL);
}
static void show(const char *tag, const resp_t *r) {
    printf("GUEST_WGPU ERR %s rc=%ld type=%u msg=%.300s\n", tag, r->rc, r->type, r->msg);
}

// ---- bincode builders (fixint LE, same bytes as Firefox 128's client) ----
typedef struct {
    uint8_t b[256];
    uint32_t n;
} bb_t;
static void put_u32(bb_t *bb, uint32_t v) {
    memcpy(bb->b + bb->n, &v, 4);
    bb->n += 4;
}
static void put_u64(bb_t *bb, uint64_t v) {
    memcpy(bb->b + bb->n, &v, 8);
    bb->n += 8;
}
static void put_serial_id(bb_t *bb, uint32_t index, uint32_t epoch) {
    put_u32(bb, 0); // SerialId::Id
    put_u32(bb, index);
    put_u32(bb, epoch);
    put_u32(bb, BK_VULKAN);
}
// CommandEncoderAction::CopyBufferToBuffer (variant 0)
static void bb_copy(bb_t *bb, uint32_t src, uint64_t src_off, uint32_t dst, uint64_t dst_off, uint64_t size) {
    bb->n = 0;
    put_u32(bb, 0);
    put_serial_id(bb, src, 1);
    put_u64(bb, src_off);
    put_serial_id(bb, dst, 1);
    put_u64(bb, dst_off);
    put_u64(bb, size);
}
// QueueWriteAction::Buffer (variant 0)
static void bb_write(bb_t *bb, uint32_t dst, uint32_t epoch, uint64_t offset) {
    bb->n = 0;
    put_u32(bb, 0);
    put_serial_id(bb, dst, epoch);
    put_u64(bb, offset);
}
// DeviceAction::CreateCommandEncoder (variant 12) with label
static void bb_create_encoder(bb_t *bb, uint32_t index, const char *label) {
    bb->n = 0;
    put_u32(bb, 12);
    put_serial_id(bb, index, 1);
    uint64_t len = strlen(label);
    bb->b[bb->n++] = 1; // Some(label)
    put_u64(bb, len);
    memcpy(bb->b + bb->n, label, len);
    bb->n += (uint32_t)len;
}

// W3 golden device-descriptor.bin (wgpu_client_serialize_device_descriptor,
// 166 bytes): label "w3-device", required_features 33, default limits.
static const char device_descriptor_hex[] =
    "01090000000000000077332d64657669636521000000000000000020000000200000000800000001000004000000e80300000800"
    "000004000000100000001000000008000000040000000c0000000000010000000008080000000000001000000000100000000008"
    "000000010000000100003c00000008000000200000000040000000010000000100000001000040000000ffff0000000000000000"
    "00000000000040420f00";
static uint8_t descriptor[166];
static void load_descriptor(uint64_t features) {
    for (size_t i = 0; i < sizeof descriptor; i++) {
        unsigned v;
        sscanf(device_descriptor_hex + 2 * i, "%2x", &v);
        descriptor[i] = (uint8_t)v;
    }
    memcpy(descriptor + 18, &features, 8); // Some(1) + len(8) + 9 label bytes = 18
}
// W3 golden encoder-copy-buffer-to-buffer.bin / queue-write-buffer.bin, to prove
// the hand-built builders above emit identical bytes.
static const char golden_copy_hex[] =
    "000000000000000002000000010000000100000010000000000000000000000003000000010000000100000020000000000000000004000000000000";
static const char golden_write_hex[] = "00000000000000000100000001000000010000000001000000000000";
static const char golden_encoder_hex[] = "0c00000000000000000000000100000001000000010a0000000000000077332d656e636f646572";
static int hex_equals(const bb_t *bb, const char *hex) {
    if (strlen(hex) != bb->n * 2)
        return 0;
    for (uint32_t i = 0; i < bb->n; i++) {
        unsigned v;
        sscanf(hex + 2 * i, "%2x", &v);
        if (bb->b[i] != v)
            return 0;
    }
    return 1;
}

// ---- helpers ----------------------------------------------------------------
static uint64_t G; // Global handle
static resp_t R;

typedef struct {
    uint64_t kind, id, status, callback, user_data;
    char message[512];
} event_t;
static event_t events[64];
static int nevents;
static int unrelated_events;

static int poll_once(int force) {
    nevents = 0;
    if (WG(&R, POLL_ALL_DEVICES, G, (uint64_t)force) != ERR_NONE || R.nf < 2)
        return -1;
    uint64_t count = R.f[0];
    const uint8_t *p = R.payload + 16;
    for (uint64_t i = 0; i < count; i++) {
        event_t e;
        memcpy(&e.kind, p, 8);
        memcpy(&e.id, p + 8, 8);
        memcpy(&e.status, p + 16, 8);
        memcpy(&e.callback, p + 24, 8);
        memcpy(&e.user_data, p + 32, 8);
        uint64_t len;
        memcpy(&len, p + 40, 8);
        size_t m = len < sizeof e.message - 1 ? (size_t)len : sizeof e.message - 1;
        memcpy(e.message, p + 48, m);
        e.message[m] = 0;
        p += 48 + ((len + 7) & ~7ull);
        if (nevents < 64)
            events[nevents++] = e;
    }
    return (int)count;
}
// Poll until an event of kind for id arrives; returns it (or NULL on timeout).
static event_t found;
static event_t *wait_event(uint64_t kind, uint64_t for_id, int force, int *polls) {
    uint64_t deadline = now_ns() + 10000000000ull;
    *polls = 0;
    while (now_ns() < deadline) {
        (*polls)++;
        int n = poll_once(force);
        if (n < 0)
            return NULL;
        event_t *hit = NULL;
        for (int i = 0; i < nevents; i++) {
            if (events[i].kind == kind && events[i].id == for_id && !hit) {
                found = events[i];
                hit = &found;
            } else {
                unrelated_events++;
                printf("GUEST_WGPU EVENT kind=%llu status=%llu msg=%.200s\n", (unsigned long long)events[i].kind,
                       (unsigned long long)events[i].status, events[i].message);
            }
        }
        if (hit)
            return hit;
        if (!force)
            usleep(2000);
    }
    return NULL;
}

static uint8_t pattern(uint32_t seed, uint32_t i) {
    return (uint8_t)(i * 7u + seed * 131u + 3u);
}
static int bytes_match(const uint8_t *p, uint32_t seed, uint32_t n) {
    int bad = 0;
    for (uint32_t i = 0; i < n; i++)
        bad += p[i] != pattern(seed, i);
    return bad == 0;
}

// Copy src->dst on the queue with an encoder built via DEVICE_ACTION or DEVICE_CREATE_ENCODER.
static int copy_and_submit(uint64_t dev, uint32_t enc_index, uint32_t src, uint32_t dst, uint64_t size, int via_action,
                           uint64_t *submission) {
    bb_t bb;
    int good = 1;
    if (via_action) {
        bb_create_encoder(&bb, enc_index, "w4a-encoder");
        WG(&R, DEVICE_ACTION, G, dev, (uint64_t)(uintptr_t)bb.b, bb.n);
    } else {
        static const char label[] = "w4a-direct-encoder";
        WG(&R, DEVICE_CREATE_ENCODER, G, dev, id(enc_index, 1), (uint64_t)(uintptr_t)label, sizeof label - 1);
    }
    good &= ok(&R);
    if (!ok(&R))
        show("create encoder", &R);
    bb_copy(&bb, src, 0, dst, 0, size);
    WG(&R, COMMAND_ENCODER_ACTION, G, id(enc_index, 1), (uint64_t)(uintptr_t)bb.b, bb.n);
    good &= ok(&R);
    if (!ok(&R))
        show("copy", &R);
    WG(&R, ENCODER_FINISH, G, id(enc_index, 1), 0, 0);
    good &= ok(&R);
    if (!ok(&R))
        show("finish", &R);
    uint64_t cb = id(enc_index, 1);
    WG(&R, QUEUE_SUBMIT, G, dev, (uint64_t)(uintptr_t)&cb, 1);
    good &= ok(&R) && R.nf == 1;
    if (!ok(&R))
        show("submit", &R);
    if (submission)
        *submission = R.f[0];
    return good;
}

static int map_read_verify(uint32_t buf, uint32_t seed, const char *tag, uint64_t cb_value) {
    WG(&R, BUFFER_MAP, G, id(buf, 1), 0, 256, 1, cb_value, cb_value ^ 0xffff);
    int good = ok(&R);
    int polls = 0;
    event_t *e = wait_event(EV_BUFFER_MAP, id(buf, 1), 0, &polls);
    good &= e && e->status == 0 && e->callback == cb_value && e->user_data == (cb_value ^ 0xffff);
    printf("GUEST_WGPU MAP %s polls=%d status=%lld\n", tag, polls, e ? (long long)e->status : -1LL);
    static uint8_t out[256];
    memset(out, 0xee, sizeof out);
    WG(&R, BUFFER_GET_MAPPED_RANGE, G, id(buf, 1), 0, 256, (uint64_t)(uintptr_t)out);
    good &= ok(&R) && R.nf == 1 && R.f[0] == 256;
    good &= bytes_match(out, seed, 256);
    WG(&R, BUFFER_UNMAP, G, id(buf, 1), 0, 0, 0);
    good &= ok(&R);
    return good;
}

// ---- the test ---------------------------------------------------------------
static void print_stats(const char *tag, uint64_t handle, uint64_t *s) {
    WG(&R, STATS, handle);
    memcpy(s, R.f, 12 * 8);
    printf("GUEST_WGPU STATS %s globals=%llu adapters=%llu devices=%llu buffers=%llu encoders=%llu cmdbufs=%llu "
           "pending=%llu events=%llu mapped=%llu calls=%llu errors=%llu dropped=%llu\n",
           tag, (unsigned long long)s[0], (unsigned long long)s[1], (unsigned long long)s[2], (unsigned long long)s[3],
           (unsigned long long)s[4], (unsigned long long)s[5], (unsigned long long)s[6], (unsigned long long)s[7],
           (unsigned long long)s[8], (unsigned long long)s[9], (unsigned long long)s[10], (unsigned long long)s[11]);
}

static void test_transport(void) {
    uint32_t len = 0;
    uint64_t f[1] = {0};
    build_req(STATS, f, 1);
    CHECK("NULL request -> EFAULT", raw_call(NULL, 24, resp_buf, sizeof resp_buf, &len) == -EFAULT);
    CHECK("short request -> EINVAL", raw_call(req_buf, 8, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    CHECK("length mismatch -> EINVAL", raw_call(req_buf, 32, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    CHECK("NULL len_out -> EFAULT", raw_call(req_buf, 24, resp_buf, sizeof resp_buf, NULL) == -EFAULT);
    CHECK("NULL response -> EFAULT", raw_call(req_buf, 24, NULL, 64, &len) == -EFAULT);
    req_buf[0] ^= 1;
    CHECK("bad magic -> EINVAL", raw_call(req_buf, 24, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    req_buf[0] ^= 1;
    req_buf[4] = 2;
    CHECK("bad version -> EINVAL", raw_call(req_buf, 24, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    req_buf[4] = 1;
    build_req(999, f, 1);
    CHECK("unknown call -> EINVAL", raw_call(req_buf, 24, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    build_req(ADAPTER_DROP, f, 0);
    CHECK("missing argument -> EINVAL", raw_call(req_buf, 16, resp_buf, sizeof resp_buf, &len) == -EINVAL);
    build_req(STATS, f, 1);
    long small = raw_call(req_buf, 24, resp_buf, 16, &len);
    CHECK("small response -> ENOSPC with needed length", small == -ENOSPC && len == 24 + 12 * 8);
    CHECK("stats ok", raw_call(req_buf, 24, resp_buf, sizeof resp_buf, &len) == 24 + 12 * 8);
}

int main(void) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    printf("GUEST_WGPU START\n");
    uint64_t s[12];
    const char *vendor = getenv("WGPU_EXPECT_VENDOR");

    test_transport();

    // --- server / adapter ---
    CHECK("server_new", WG(&R, SERVER_NEW, 0) == ERR_NONE && R.nf == 1 && R.f[0] > 0);
    G = R.f[0];
    CHECK("invalid global handle", err_is((WG(&R, STATS, G + 1000), &R), ERR_VALIDATION, "invalid global"));
    const uint64_t A = id(0, 1);
    uint64_t t0 = now_ns();
    CHECK("request adapter (high-performance)", WG(&R, INSTANCE_REQUEST_ADAPTER, G, 0, 0, A) == ERR_NONE && R.f[0] == 1);
    printf("GUEST_WGPU REQUEST_ADAPTER ms=%llu\n", (unsigned long long)((now_ns() - t0) / 1000000));
    CHECK("adapter id reuse rejected", WG(&R, INSTANCE_REQUEST_ADAPTER, G, 0, 0, A) == ERR_VALIDATION &&
                                           strstr(R.msg, "already in use"));
    CHECK("adapter live index, other epoch rejected",
          err_is((WG(&R, INSTANCE_REQUEST_ADAPTER, G, 0, 0, id(0, 2)), &R), ERR_VALIDATION, "reused with epoch"));
    CHECK("pack_info stale adapter epoch", err_is((WG(&R, ADAPTER_PACK_INFO, G, id(0, 2)), &R), ERR_VALIDATION, "stale adapter"));
    CHECK("pack_info invalid adapter", err_is((WG(&R, ADAPTER_PACK_INFO, G, id(7, 1)), &R), ERR_VALIDATION, "invalid adapter"));

    CHECK("adapter pack_info", WG(&R, ADAPTER_PACK_INFO, G, A) == ERR_NONE);
    {
        // 34 limits, features, pci vendor, pci device, device type, backend, fallback, then 7 strings.
        CHECK("limit count 34", R.nf > 41 && R.f[0] == 34);
        uint64_t *L = R.f + 1;
        uint64_t features = L[34], pci_vendor = L[35], device_type = L[37], backend = L[38], fallback = L[39];
        CHECK("maxTextureDimension2D >= 8192", L[1] >= 8192);
        CHECK("maxBindGroups >= 4", L[4] >= 4);
        CHECK("maxUniformBufferBindingSize >= 65536", L[13] >= 65536);
        CHECK("maxBufferSize >= 256 MiB", L[16] >= 268435456ull);
        CHECK("minUniformBufferOffsetAlignment <= 256", L[19] >= 1 && L[19] <= 256);
        CHECK("maxComputeInvocationsPerWorkgroup >= 256", L[25] >= 256);
        CHECK("backend echoes id backend", backend == BK_VULKAN);
        const uint8_t *p = R.payload + 41 * 8;
        const char *names[7] = {"name", "driver", "driver_info", "vendor", "architecture", "description", "features"};
        char strs[7][512];
        for (int i = 0; i < 7; i++) {
            uint64_t len;
            memcpy(&len, p, 8);
            size_t m = len < 511 ? (size_t)len : 511;
            memcpy(strs[i], p + 8, m);
            strs[i][m] = 0;
            p += 8 + ((len + 7) & ~7ull);
        }
        CHECK("pack_info payload length consistent", (uint32_t)(p - R.payload) == R.payload_len);
        printf("GUEST_WGPU ADAPTER name=\"%s\" driver=\"%s\" vendor=\"%s\" architecture=\"%s\" pci_vendor=0x%llx "
               "device_type=%llu fallback=%llu features_bits=0x%llx maxBufferSize=%llu maxTextureDimension2D=%llu "
               "maxStorageBufferBindingSize=%llu\n",
               strs[0], strs[1], strs[3], strs[4], (unsigned long long)pci_vendor, (unsigned long long)device_type,
               (unsigned long long)fallback, (unsigned long long)features, (unsigned long long)L[16],
               (unsigned long long)L[1], (unsigned long long)L[14]);
        printf("GUEST_WGPU ADAPTER_FEATURES %s\n", strs[6]);
        (void)names;
        if (vendor && *vendor) {
            printf("GUEST_WGPU EXPECT_VENDOR %s\n", vendor);
            CHECK("adapter vendor as expected", strcmp(strs[3], vendor) == 0);
            CHECK("not a fallback adapter", fallback == 0);
            if (strcmp(vendor, "nvidia") == 0)
                CHECK("PCI vendor 0x10de", pci_vendor == 0x10de);
        }
    }

    // --- device ---
    bb_t bb;
    bb_copy(&bb, 2, 16, 3, 32, 1024);
    CHECK("copy builder == W3 golden bytes", hex_equals(&bb, golden_copy_hex));
    bb_write(&bb, 1, 1, 256);
    CHECK("write builder == W3 golden bytes", hex_equals(&bb, golden_write_hex));
    bb_create_encoder(&bb, 0, "w3-encoder");
    CHECK("encoder builder == W3 golden bytes", hex_equals(&bb, golden_encoder_hex));

    const uint64_t D = id(0, 1);
    load_descriptor(1ull << 63);
    CHECK("device: unmappable feature bit rejected",
          err_is((WG(&R, ADAPTER_REQUEST_DEVICE, G, A, D, (uint64_t)(uintptr_t)descriptor, sizeof descriptor), &R),
                 ERR_VALIDATION, "no WebGPU equivalent"));
    load_descriptor(0);
    CHECK("device: truncated descriptor rejected",
          err_is((WG(&R, ADAPTER_REQUEST_DEVICE, G, A, D, (uint64_t)(uintptr_t)descriptor, 100), &R), ERR_VALIDATION,
                 "malformed DeviceDescriptor"));
    CHECK("device: invalid adapter",
          err_is((WG(&R, ADAPTER_REQUEST_DEVICE, G, id(9, 1), D, (uint64_t)(uintptr_t)descriptor, sizeof descriptor), &R),
                 ERR_VALIDATION, "invalid adapter"));
    t0 = now_ns();
    WG(&R, ADAPTER_REQUEST_DEVICE, G, A, D, (uint64_t)(uintptr_t)descriptor, sizeof descriptor);
    CHECK("request device (W3 golden descriptor, features 0)", ok(&R));
    if (!ok(&R))
        show("request device", &R);
    printf("GUEST_WGPU REQUEST_DEVICE ms=%llu\n", (unsigned long long)((now_ns() - t0) / 1000000));
    CHECK("device id reuse rejected",
          err_is((WG(&R, ADAPTER_REQUEST_DEVICE, G, A, D, (uint64_t)(uintptr_t)descriptor, sizeof descriptor), &R),
                 ERR_VALIDATION, "already in use"));
    CHECK("set device lost callback", WG(&R, DEVICE_SET_LOST_CALLBACK, G, D, 0x1234, 0x5678) == ERR_NONE);

    // Second device from the same adapter (host takes a fresh GPUAdapter), then drop it.
    const uint64_t D2 = id(1, 1);
    CHECK("second device from same adapter",
          WG(&R, ADAPTER_REQUEST_DEVICE, G, A, D2, (uint64_t)(uintptr_t)descriptor, sizeof descriptor) == ERR_NONE);

    // --- buffers ---
    static const char src_label[] = "w4a-src";
    CHECK("create src buffer", WG(&R, DEVICE_CREATE_BUFFER, G, D, id(1, 1), 256, U_COPY_SRC | U_COPY_DST, 0,
                                  (uint64_t)(uintptr_t)src_label, sizeof src_label - 1) == ERR_NONE);
    CHECK("create dst buffer", WG(&R, DEVICE_CREATE_BUFFER, G, D, id(2, 1), 256, U_MAP_READ | U_COPY_DST, 0, 0, 0) == ERR_NONE);
    CHECK("buffer live index, other epoch rejected",
          err_is((WG(&R, DEVICE_CREATE_BUFFER, G, D, id(1, 2), 256, U_COPY_DST, 0, 0, 0), &R), ERR_VALIDATION, "reused with epoch"));
    CHECK("create buffer on invalid device",
          err_is((WG(&R, DEVICE_CREATE_BUFFER, G, id(5, 1), id(4, 1), 256, U_COPY_DST, 0, 0, 0), &R), ERR_VALIDATION, "invalid device"));
    // Host WebGPU validation error (MAP_READ|MAP_WRITE) comes back in this call's response.
    WG(&R, DEVICE_CREATE_BUFFER, G, D, id(9, 1), 256, U_MAP_READ | U_MAP_WRITE, 0, 0, 0);
    CHECK("invalid usage -> synchronous validation error", R.rc > 0 && R.type == ERR_VALIDATION && R.msg[0]);
    show("invalid usage (expected)", &R);
    CHECK("invalid buffer id is bound (like wgpu-core)",
          err_is((WG(&R, DEVICE_CREATE_BUFFER, G, D, id(9, 1), 256, U_COPY_DST, 0, 0, 0), &R), ERR_VALIDATION, "already in use"));

    // --- queue write 256 known bytes into src ---
    static uint8_t data[256];
    for (uint32_t i = 0; i < 256; i++)
        data[i] = pattern(1, i);
    bb_write(&bb, 1, 1, 0);
    CHECK("queue write 256 bytes",
          WG(&R, QUEUE_WRITE_ACTION, G, D, (uint64_t)(uintptr_t)bb.b, bb.n, (uint64_t)(uintptr_t)data, 256) == ERR_NONE);
    memset(data, 0, sizeof data); // snapshot semantics: the guest may reuse the buffer after return
    bb_write(&bb, 1, 2, 0);
    CHECK("queue write stale buffer epoch",
          err_is((WG(&R, QUEUE_WRITE_ACTION, G, D, (uint64_t)(uintptr_t)bb.b, bb.n, (uint64_t)(uintptr_t)data, 256), &R),
                 ERR_VALIDATION, "stale buffer"));
    bb_write(&bb, 1, 1, 0);
    CHECK("queue write malformed ByteBuf",
          err_is((WG(&R, QUEUE_WRITE_ACTION, G, D, (uint64_t)(uintptr_t)bb.b, bb.n - 1, (uint64_t)(uintptr_t)data, 256), &R),
                 ERR_VALIDATION, "malformed"));

    // --- encoder (via DeviceAction ByteBuf) + copyBufferToBuffer + submit + map READ ---
    uint64_t submission = 0;
    CHECK("encode copy src->dst and submit", copy_and_submit(D, 0, 1, 2, 256, 1, &submission));
    CHECK("submission index 1", submission == 1);
    CHECK("map READ + exact bytes", map_read_verify(2, 1, "read", 0xAAAA0001));

    // --- mapped_at_creation WRITE path ---
    CHECK("create mapped_at_creation buffer",
          WG(&R, DEVICE_CREATE_BUFFER, G, D, id(3, 1), 256, U_MAP_WRITE | U_COPY_SRC, 1, 0, 0) == ERR_NONE);
    static uint8_t staging[256];
    memset(staging, 0xcc, sizeof staging);
    WG(&R, BUFFER_GET_MAPPED_RANGE, G, id(3, 1), 0, 256, (uint64_t)(uintptr_t)staging);
    int zero = ok(&R);
    for (int i = 0; i < 256; i++)
        zero &= staging[i] == 0;
    CHECK("mapped_at_creation range is zeroed", zero);
    for (uint32_t i = 0; i < 256; i++)
        staging[i] = pattern(2, i);
    CHECK("unmap with write-back", WG(&R, BUFFER_UNMAP, G, id(3, 1), (uint64_t)(uintptr_t)staging, 0, 256) == ERR_NONE);
    CHECK("unmap when not mapped", err_is((WG(&R, BUFFER_UNMAP, G, id(3, 1), 0, 0, 0), &R), ERR_VALIDATION, "not mapped"));
    CHECK("encode copy (direct encoder) and submit", copy_and_submit(D, 1, 3, 2, 256, 0, &submission) && submission == 2);
    CHECK("mapped_at_creation bytes reach GPU", map_read_verify(2, 2, "created", 0xAAAA0002));

    // --- buffer_map WRITE ---
    WG(&R, BUFFER_MAP, G, id(3, 1), 0, 256, 2, 0xBEEF, 0xF00D);
    CHECK("map WRITE", ok(&R));
    CHECK("second map while pending rejected",
          err_is((WG(&R, BUFFER_MAP, G, id(3, 1), 0, 256, 2, 0, 0), &R), ERR_VALIDATION, "pending"));
    {
        int polls = 0;
        event_t *e = wait_event(EV_BUFFER_MAP, id(3, 1), 1, &polls);
        CHECK("map WRITE callback (force_wait poll)", e && e->status == 0 && e->callback == 0xBEEF && e->user_data == 0xF00D);
        WG(&R, BUFFER_GET_MAPPED_RANGE, G, id(3, 1), 0, 256, (uint64_t)(uintptr_t)staging);
        CHECK("get WRITE mapped range", ok(&R));
        for (uint32_t i = 0; i < 256; i++)
            staging[i] = pattern(3, i);
        CHECK("unmap WRITE with write-back", WG(&R, BUFFER_UNMAP, G, id(3, 1), (uint64_t)(uintptr_t)staging, 0, 256) == ERR_NONE);
    }
    CHECK("encode copy and submit (3)", copy_and_submit(D, 2, 3, 2, 256, 1, &submission) && submission == 3);
    CHECK("map WRITE bytes reach GPU", map_read_verify(2, 3, "write", 0xAAAA0003));

    // READ mapping write-back must be refused.
    WG(&R, BUFFER_MAP, G, id(2, 1), 0, 256, 1, 1, 2);
    {
        int polls = 0;
        event_t *e = wait_event(EV_BUFFER_MAP, id(2, 1), 1, &polls);
        CHECK("map READ again", e && e->status == 0);
        WG(&R, BUFFER_GET_MAPPED_RANGE, G, id(2, 1), 0, 256, (uint64_t)(uintptr_t)staging);
        CHECK("write-back into READ mapping rejected",
              err_is((WG(&R, BUFFER_UNMAP, G, id(2, 1), (uint64_t)(uintptr_t)staging, 0, 256), &R), ERR_VALIDATION, "READ mapping"));
        CHECK("plain unmap after refusal", WG(&R, BUFFER_UNMAP, G, id(2, 1), 0, 0, 0) == ERR_NONE);
    }
    // Map failure completes through the queue (invalid range): status != 0, callback echoed.
    WG(&R, BUFFER_MAP, G, id(2, 1), 0, 4096, 1, 0x77, 0x88);
    {
        int polls = 0;
        event_t *e = wait_event(EV_BUFFER_MAP, id(2, 1), 1, &polls);
        CHECK("out-of-range map completes with error status", ok(&R) && e && e->status != 0 && e->callback == 0x77);
        if (e)
            printf("GUEST_WGPU MAP_ERROR status=%llu msg=%.200s\n", (unsigned long long)e->status, e->message);
    }

    // --- error policy for encoders: invalid copy fails at finish, submit refuses it ---
    bb_create_encoder(&bb, 4, "w4a-bad");
    CHECK("create encoder 4", WG(&R, DEVICE_ACTION, G, D, (uint64_t)(uintptr_t)bb.b, bb.n) == ERR_NONE);
    bb_copy(&bb, 1, 0, 2, 0, 250); // size not a multiple of 4
    WG(&R, COMMAND_ENCODER_ACTION, G, id(4, 1), (uint64_t)(uintptr_t)bb.b, bb.n);
    CHECK("invalid copy is recorded (host WebGPU defers encoder errors)", ok(&R));
    WG(&R, ENCODER_FINISH, G, id(4, 1), 0, 0);
    CHECK("finish reports the deferred validation error", R.type == ERR_VALIDATION && R.msg[0]);
    show("finish invalid encoder (expected)", &R);
    {
        uint64_t cb = id(4, 1);
        CHECK("submit invalid command buffer rejected",
              err_is((WG(&R, QUEUE_SUBMIT, G, D, (uint64_t)(uintptr_t)&cb, 1), &R), ERR_VALIDATION, "invalid"));
    }
    bb_copy(&bb, 1, 0, 42, 0, 256);
    CHECK("create encoder 5", WG(&R, DEVICE_CREATE_ENCODER, G, D, id(5, 1), 0, 0) == ERR_NONE);
    CHECK("copy to invalid buffer id",
          err_is((WG(&R, COMMAND_ENCODER_ACTION, G, id(5, 1), (uint64_t)(uintptr_t)bb.b, bb.n), &R), ERR_VALIDATION, "invalid buffer"));
    CHECK("encoder_drop unfinished encoder", WG(&R, ENCODER_DROP, G, id(5, 1)) == ERR_NONE);
    CHECK("encoder action on dropped encoder",
          err_is((WG(&R, COMMAND_ENCODER_ACTION, G, id(5, 1), (uint64_t)(uintptr_t)bb.b, bb.n), &R), ERR_VALIDATION, "invalid command encoder"));
    CHECK("get_mapped_range invalid buffer",
          err_is((WG(&R, BUFFER_GET_MAPPED_RANGE, G, id(77, 1), 0, 4, (uint64_t)(uintptr_t)staging), &R), ERR_VALIDATION, "invalid buffer"));
    CHECK("map stale buffer epoch",
          err_is((WG(&R, BUFFER_MAP, G, id(2, 3), 0, 256, 1, 0, 0), &R), ERR_VALIDATION, "stale buffer"));

    // --- work done ---
    WG(&R, QUEUE_ON_SUBMITTED_WORK_DONE, G, D, 0xD0E, 0xD0F);
    {
        int polls = 0;
        event_t *e = wait_event(EV_WORK_DONE, D, 1, &polls);
        CHECK("on_submitted_work_done callback", ok(&R) || (e && e->status == 0 && e->callback == 0xD0E && e->user_data == 0xD0F));
        CHECK("work done echoes callback", e && e->status == 0 && e->callback == 0xD0E && e->user_data == 0xD0F);
    }

    // --- destroy / drop ---
    print_stats("before-drop", G, s);
    CHECK("buffer_destroy src", WG(&R, BUFFER_DESTROY, G, id(1, 1)) == ERR_NONE);
    for (uint32_t b = 1; b <= 3; b++)
        CHECK("buffer_drop", WG(&R, BUFFER_DROP, G, id(b, 1)) == ERR_NONE);
    CHECK("buffer_drop invalid-usage buffer", WG(&R, BUFFER_DROP, G, id(9, 1)) == ERR_NONE);
    CHECK("buffer_drop twice rejected", err_is((WG(&R, BUFFER_DROP, G, id(1, 1)), &R), ERR_VALIDATION, "invalid buffer"));
    CHECK("reuse dropped index with new epoch",
          WG(&R, DEVICE_CREATE_BUFFER, G, D, id(1, 2), 64, U_COPY_DST, 0, 0, 0) == ERR_NONE);
    // Left alive on purpose: device_drop releases the device's buffers.

    CHECK("device_drop second device", WG(&R, DEVICE_DROP, G, D2) == ERR_NONE);
    CHECK("device_destroy", WG(&R, DEVICE_DESTROY, G, D) == ERR_NONE);
    {
        int polls = 0;
        event_t *e = wait_event(EV_DEVICE_LOST, D, 0, &polls);
        CHECK("device lost reported on poll", e != NULL);
        CHECK("device lost reason Destroyed + callback echoed",
              e && e->status == 1 && e->callback == 0x1234 && e->user_data == 0x5678);
        printf("GUEST_WGPU DEVICE_LOST polls=%d status=%lld msg=%.200s\n", polls, e ? (long long)e->status : -1LL,
               e ? e->message : "");
    }
    CHECK("call on lost device -> DeviceLost",
          err_is((WG(&R, DEVICE_CREATE_BUFFER, G, D, id(20, 1), 64, U_COPY_DST, 0, 0, 0), &R), ERR_DEVICE_LOST, "lost"));
    CHECK("device_drop", WG(&R, DEVICE_DROP, G, D) == ERR_NONE);
    CHECK("adapter_drop", WG(&R, ADAPTER_DROP, G, A) == ERR_NONE);
    // Drain remaining events (the dropped second device's lost event).
    for (int i = 0; i < 20 && poll_once(1) > 0; i++)
        ;
    print_stats("end", G, s);
    CHECK("no live adapters/devices/buffers/encoders/command buffers",
          s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0);
    CHECK("no pending host work, no queued events, no mappings", s[6] == 0 && s[7] == 0 && s[8] == 0);
    CHECK("no events dropped", s[11] == 0);
    CHECK("server_delete", WG(&R, SERVER_DELETE, G) == ERR_NONE);
    CHECK("deleted global rejected", err_is((WG(&R, POLL_ALL_DEVICES, G, 0), &R), ERR_VALIDATION, "invalid global"));
    print_stats("after-delete", 0, s);
    CHECK("no globals remain", s[0] == 0);
    printf("GUEST_WGPU LATENCY calls=%u mean_us=%llu unrelated_events=%d\n", calls_made,
           (unsigned long long)(call_ns_total / (calls_made ? calls_made : 1) / 1000), unrelated_events);
    printf("GUEST_WGPU SUMMARY passes=%d failures=%d\n", passes, failures);
    fflush(stdout);
    return failures ? 1 : 0;
}
