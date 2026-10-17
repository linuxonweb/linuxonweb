// SPDX-License-Identifier: MIT
// Packet W4b: guest-side __wrap_wgpu_server_* adapter for Firefox 128.14.0esr.
//
// Firefox's parent-process WebGPU code (dom/webgpu/ipc/WebGPUParent.cpp) calls the
// wgpu_server_* FFI of gfx/wgpu_bindings, whose wasm build only has the Empty HAL.
// Linking Firefox with `--wrap=wgpu_server_<fn>` for the 43 functions listed in
// wgpu-server-abi.h sends those calls here instead. Each one is forwarded through
// gpu_hostcall op 0x10 (docs/firefox-webgpu-w4a-20260930.md) to the host wgpu
// executor, which runs it on the browser's real WebGPU device.
//
// Behaviour kept from gfx/wgpu_bindings/src/server.rs + error.rs:
//  * ErrorBuffer is filled exactly like ErrorBuffer::init (type, assert cap != 0,
//    truncate to cap-1 bytes, NUL).
//  * adapter_pack_info emits bincode AdapterInformation<String> (with
//    restrict_limits applied) or u64 0, in a malloc'd ByteBuf (capacity == len).
//  * Out-of-memory / shm_allocation_failed buffers still bind their id (invalid).
//  * buffer_unmap ignores the "invalid buffer" error.
//  * queue ids are device ids.
// Deliberate differences (documented in docs/firefox-webgpu-w4b-20260930.md):
//  * Every closure (map, work-done, device-lost incl. ReplacedCallback and
//    DeviceInvalid) is queued and invoked only from wgpu_server_poll_all_devices
//    on the polling thread, never re-entrantly; wgpu-core sometimes calls them
//    synchronously.
//  * Host callback/userdata values are never trusted: the executor only sees an
//    opaque token and the wrapper looks the real closure up locally.
//  * Pending closures still queued at wgpu_server_delete are discarded.
#define _GNU_SOURCE
#include "wgpu-server-abi.h"

#include <errno.h>
#include <pthread.h>
#include <stdalign.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

// ---- wasm32 layout checks (header line numbers in wgpu-server-abi.h) ----
_Static_assert(sizeof(void *) == 4 && sizeof(uintptr_t) == 4, "wasm32 only");
_Static_assert(sizeof(bool) == 1, "bool");
_Static_assert(sizeof(enum WGPUPowerPreference) == 4 && sizeof(enum WGPUHostMap) == 4 &&
                   sizeof(enum WGPUBufferMapAsyncStatus) == 4, "C++ unscoped enums are int-sized");
_Static_assert(sizeof(WGPUErrorBufferType) == 1, "ErrorBufferType : uint8_t");
_Static_assert(sizeof(struct WGPUErrorBuffer) == 12 && offsetof(struct WGPUErrorBuffer, type) == 0 &&
                   offsetof(struct WGPUErrorBuffer, message) == 4 &&
                   offsetof(struct WGPUErrorBuffer, message_capacity) == 8, "ErrorBuffer");
_Static_assert(sizeof(struct WGPUByteBuf) == 12 && offsetof(struct WGPUByteBuf, data) == 0 &&
                   offsetof(struct WGPUByteBuf, len) == 4 && offsetof(struct WGPUByteBuf, capacity) == 8,
               "ByteBuf");
_Static_assert(sizeof(nsACString) == 12 && offsetof(nsACString, mData) == 0 && offsetof(nsACString, mLength) == 4 &&
                   offsetof(nsACString, mDataFlags) == 8 && offsetof(nsACString, mClassFlags) == 10,
               "nsACString");
_Static_assert(sizeof(nsString) == 12, "nsString");
_Static_assert(sizeof(struct WGPUCommandEncoderDescriptor) == 4 && sizeof(struct WGPUCommandBufferDescriptor) == 4,
               "descriptors");
_Static_assert(sizeof(WGPURequestAdapterOptions) == 16 && alignof(WGPURequestAdapterOptions) == 8 &&
                   offsetof(WGPURequestAdapterOptions, power_preference) == 0 &&
                   offsetof(WGPURequestAdapterOptions, force_fallback_adapter) == 4 &&
                   offsetof(WGPURequestAdapterOptions, compatible_surface) == 8,
               "RequestAdapterOptions");
_Static_assert(sizeof(struct WGPUFfiLUID) == 8 && offsetof(struct WGPUFfiLUID, high_part) == 4, "FfiLUID");
_Static_assert(sizeof(struct WGPUDeviceLostClosureC) == 12 && offsetof(struct WGPUDeviceLostClosureC, user_data) == 4 &&
                   offsetof(struct WGPUDeviceLostClosureC, consumed) == 8,
               "DeviceLostClosureC");
_Static_assert(sizeof(struct WGPUShaderModuleCompilationMessage) == 48 &&
                   offsetof(struct WGPUShaderModuleCompilationMessage, utf16_length) == 24 &&
                   offsetof(struct WGPUShaderModuleCompilationMessage, message) == 32,
               "ShaderModuleCompilationMessage");
_Static_assert(sizeof(struct WGPUBufferMapCallbackC) == 8 && offsetof(struct WGPUBufferMapCallbackC, user_data) == 4,
               "BufferMapCallbackC");
_Static_assert(sizeof(struct WGPUMappedBufferSlice) == 16 && alignof(struct WGPUMappedBufferSlice) == 8 &&
                   offsetof(struct WGPUMappedBufferSlice, length) == 8,
               "MappedBufferSlice");
_Static_assert(sizeof(struct WGPUSubmittedWorkDoneClosureC) == 8 &&
                   offsetof(struct WGPUSubmittedWorkDoneClosureC, user_data) == 4,
               "SubmittedWorkDoneClosureC");

// ---- executor protocol (web/linux/dist/guest-gpu-wgpu.js) ----
#define SYS_gpu_hostcall 0x6a470001
#define OP_WGPU 0x10
#define REQ_MAGIC 0x31514757u  // "WGQ1"
#define RESP_MAGIC 0x31524757u // "WGR1"
enum {
    C_SERVER_NEW = 1, C_SERVER_DELETE, C_REQUEST_ADAPTER, C_PACK_INFO, C_REQUEST_DEVICE, C_ADAPTER_DROP,
    C_CREATE_BUFFER, C_BUFFER_MAP, C_GET_MAPPED_RANGE, C_BUFFER_UNMAP, C_BUFFER_DESTROY, C_BUFFER_DROP,
    C_CREATE_ENCODER, C_ENCODER_ACTION, C_ENCODER_FINISH, C_ENCODER_DROP, C_QUEUE_WRITE_ACTION, C_QUEUE_SUBMIT,
    C_WORK_DONE, C_SET_LOST_CALLBACK, C_POLL, C_DEVICE_DESTROY, C_DEVICE_DROP, C_DEVICE_ACTION, C_STATS,
};
enum { EV_MAP = 1, EV_WORK_DONE = 2, EV_LOST = 3, EV_UNCAPTURED = 4 };
#define RESP_CAP (64u << 10)
#define POLL_CAP (4u << 20)
#define MAX_RANGES 8
#define MAX_BUFFER_SIZE (1ull << 30) // server.rs:45
#define ERR_TRANSPORT 0xffu

// ---- global live counters (leak checks) ----
static uint32_t live_globals, live_pending, live_buffers, live_staging;
#define LIVE_ADD(v, d) __atomic_add_fetch(&(v), (uint32_t)(d), __ATOMIC_RELAXED)

// ---- wrapper state ----
enum { PK_MAP = EV_MAP, PK_WORK_DONE = EV_WORK_DONE, PK_LOST = EV_LOST };
struct pending {
    uint64_t token;
    int kind;
    uint64_t object; // buffer id (map) or device id (work done / lost)
    union {
        struct WGPUBufferMapCallbackC map;
        struct WGPUSubmittedWorkDoneClosureC done;
        struct WGPUDeviceLostClosureC lost;
    } c;
};
struct event {
    int kind;
    uint32_t status;
    uint64_t object, token;
    char *message; // NUL-terminated, owned
};
struct range {
    uint64_t start, size;
    uint8_t *data;
};
struct bufrec {
    struct bufrec *next;
    uint64_t id;
    bool invalid;   // id bound to an invalid buffer (OOM / failed creation)
    int mode;       // 0 none, 1 READ, 2 WRITE (last accepted map / mapped_at_creation)
    uint32_t nranges;
    struct range ranges[MAX_RANGES];
};
#define NBUCKETS 256
struct WGPUGlobal {
    uint32_t magic;
    void *owner;
    uint64_t handle; // executor handle, 0 when SERVER_NEW failed
    pthread_mutex_t lock;
    uint8_t *resp;
    uint8_t *poll_resp;
    struct pending *pending;
    uint32_t npending, cap_pending;
    uint64_t next_token;
    struct event *local;
    uint32_t nlocal, cap_local;
    struct bufrec *buckets[NBUCKETS];
    bool dispatching;
    struct w4b_wrap_stats st;
};
#define GLOBAL_MAGIC 0x57344247u

struct result {
    uint32_t type;     // ErrorBufferType, or ERR_TRANSPORT
    const uint8_t *payload;
    uint32_t payload_len;
    const char *msg;
    uint32_t msg_len;
    int errno_value;
};

static struct WGPUGlobal *G(const struct WGPUGlobal *g) {
    return (struct WGPUGlobal *)g; // &Global in Rust: interior mutability behind the lock
}

// ---- ErrorBuffer::init (error.rs:51-85) ----
static void eb_init(struct WGPUErrorBuffer eb, uint8_t type, const char *msg, size_t len) {
    *eb.type = type;
    if (type == WGPUErrorBufferType_None)
        return;
    if (eb.message_capacity == 0)
        abort(); // assert_ne!(self.message_capacity, 0)
    size_t n = len >= eb.message_capacity ? eb.message_capacity - 1 : len;
    memcpy(eb.message, msg, n);
    eb.message[n] = 0;
}
static void eb_str(struct WGPUErrorBuffer eb, uint8_t type, const char *msg) {
    eb_init(eb, type, msg, strlen(msg));
}
static void eb_result(struct WGPUErrorBuffer eb, const struct result *r) {
    if (r->type == ERR_TRANSPORT) {
        char text[96];
        int n = snprintf(text, sizeof text, "W4b: gpu_hostcall transport failed (errno %d)", r->errno_value);
        eb_init(eb, WGPUErrorBufferType_Internal, text, (size_t)n);
    } else if (r->type != WGPUErrorBufferType_None) {
        eb_init(eb, (uint8_t)(r->type <= WGPUErrorBufferType_Validation ? r->type : WGPUErrorBufferType_Internal),
                r->msg, r->msg_len);
    }
}

// ---- transport ----
static int hostcall(const void *req, uint32_t req_len, void *resp, uint32_t cap, uint32_t *len_out) {
    long r = syscall(SYS_gpu_hostcall, OP_WGPU, (long)req, (long)req_len, (long)resp, (long)cap, (long)len_out);
    return r < 0 ? -errno : (int)r;
}

// Caller holds g->lock (except for SERVER_NEW). The response stays valid until the next call.
static int call_into(struct WGPUGlobal *g, uint16_t call, const uint64_t *fields, int n, uint8_t *resp, uint32_t cap,
                     struct result *r) {
    uint8_t req[16 + 8 * 10];
    uint32_t magic = REQ_MAGIC, plen = (uint32_t)n * 8, zero = 0, len = 0;
    uint16_t version = 1;
    memcpy(req, &magic, 4);
    memcpy(req + 4, &version, 2);
    memcpy(req + 6, &call, 2);
    memcpy(req + 8, &plen, 4);
    memcpy(req + 12, &zero, 4);
    memcpy(req + 16, fields, plen);
    memset(r, 0, sizeof *r);
    r->msg = "";
    if (g)
        g->st.hostcalls++;
    int rc = hostcall(req, 16 + plen, resp, cap, &len);
    uint32_t rmagic, type, rplen, mlen;
    uint16_t rversion, echo;
    if (rc >= 24) {
        memcpy(&rmagic, resp, 4);
        memcpy(&rversion, resp + 4, 2);
        memcpy(&echo, resp + 6, 2);
        memcpy(&type, resp + 8, 4);
        memcpy(&rplen, resp + 12, 4);
        memcpy(&mlen, resp + 16, 4);
        if (rmagic == RESP_MAGIC && rversion == 1 && echo == call && (uint64_t)24 + rplen + mlen == (uint64_t)rc &&
            rplen % 8 == 0) {
            r->type = type;
            r->payload = resp + 24;
            r->payload_len = rplen;
            r->msg = (const char *)resp + 24 + rplen;
            r->msg_len = mlen;
            return 0;
        }
        rc = -EPROTO;
    } else if (rc >= 0) {
        rc = -EPROTO;
    }
    r->type = ERR_TRANSPORT;
    r->errno_value = -rc;
    if (g) {
        g->st.transport_errors++;
        if (rc == -ENOSPC && call == C_POLL)
            g->st.events_lost++;
    }
    return rc;
}
static int call_g(struct WGPUGlobal *g, uint16_t call, const uint64_t *fields, int n, struct result *r) {
    if (!g->handle) {
        memset(r, 0, sizeof *r);
        r->type = WGPUErrorBufferType_Internal;
        r->msg = "W4b: no host wgpu executor (gpu_hostcall SERVER_NEW failed)";
        r->msg_len = (uint32_t)strlen(r->msg);
        return -ENODEV;
    }
    return call_into(g, call, fields, n, g->resp, RESP_CAP, r);
}
#define CALL(g, r, call, ...)                                                                                     \
    ({                                                                                                            \
        uint64_t _f[] = {(g)->handle, __VA_ARGS__};                                                               \
        call_g((g), (call), _f, (int)(sizeof _f / sizeof _f[0]), (r));                                            \
    })
static uint64_t payload_u64(const struct result *r, uint32_t index) {
    uint64_t v = 0;
    if (r->type == WGPUErrorBufferType_None && (index + 1) * 8 <= r->payload_len)
        memcpy(&v, r->payload + index * 8, 8);
    return v;
}
static uint64_t P(const void *p) {
    return (uint64_t)(uintptr_t)p;
}
static void label_of(const nsACString *label, uint64_t *ptr, uint64_t *len) {
    *ptr = label && label->mData ? P(label->mData) : 0;
    *len = label && label->mData ? label->mLength : 0;
}
static void note_ignored(struct WGPUGlobal *g, const struct result *r) {
    if (r->type != WGPUErrorBufferType_None)
        g->st.ignored_errors++;
}

// ---- pending closures / local events (caller holds the lock) ----
static uint64_t add_pending(struct WGPUGlobal *g, int kind, uint64_t object) {
    if (g->npending == g->cap_pending) {
        uint32_t cap = g->cap_pending ? g->cap_pending * 2 : 16;
        struct pending *p = realloc(g->pending, cap * sizeof *p);
        if (!p)
            abort();
        g->pending = p;
        g->cap_pending = cap;
    }
    struct pending *p = &g->pending[g->npending++];
    memset(p, 0, sizeof *p);
    p->token = ++g->next_token;
    p->kind = kind;
    p->object = object;
    LIVE_ADD(live_pending, 1);
    return p->token;
}
static struct pending *find_pending(struct WGPUGlobal *g, uint64_t token) {
    for (uint32_t i = 0; i < g->npending; i++)
        if (g->pending[i].token == token)
            return &g->pending[i];
    return NULL;
}
static struct pending *find_lost(struct WGPUGlobal *g, uint64_t device) {
    for (uint32_t i = 0; i < g->npending; i++)
        if (g->pending[i].kind == PK_LOST && g->pending[i].object == device)
            return &g->pending[i];
    return NULL;
}
static void remove_pending(struct WGPUGlobal *g, struct pending *p) {
    *p = g->pending[--g->npending];
    LIVE_ADD(live_pending, -1);
}
static void queue_local(struct WGPUGlobal *g, int kind, uint64_t object, uint32_t status, uint64_t token,
                        const char *message) {
    if (g->nlocal == g->cap_local) {
        uint32_t cap = g->cap_local ? g->cap_local * 2 : 8;
        struct event *e = realloc(g->local, cap * sizeof *e);
        if (!e)
            abort();
        g->local = e;
        g->cap_local = cap;
    }
    struct event *e = &g->local[g->nlocal++];
    e->kind = kind;
    e->object = object;
    e->status = status;
    e->token = token;
    e->message = strdup(message ? message : "");
    if (!e->message)
        abort();
}

// ---- buffer records (caller holds the lock) ----
static struct bufrec **bucket(struct WGPUGlobal *g, uint64_t id) {
    uint64_t h = id * 0x9e3779b97f4a7c15ull;
    return &g->buckets[(h >> 56) % NBUCKETS];
}
static struct bufrec *find_buf(struct WGPUGlobal *g, uint64_t id) {
    for (struct bufrec *b = *bucket(g, id); b; b = b->next)
        if (b->id == id)
            return b;
    return NULL;
}
static struct bufrec *get_buf(struct WGPUGlobal *g, uint64_t id) {
    struct bufrec *b = find_buf(g, id);
    if (b)
        return b;
    b = calloc(1, sizeof *b);
    if (!b)
        abort();
    b->id = id;
    struct bufrec **head = bucket(g, id);
    b->next = *head;
    *head = b;
    LIVE_ADD(live_buffers, 1);
    return b;
}
static void free_ranges(struct WGPUGlobal *g, struct bufrec *b) {
    for (uint32_t i = 0; i < b->nranges; i++) {
        g->st.staging_bytes -= b->ranges[i].size;
        free(b->ranges[i].data);
    }
    LIVE_ADD(live_staging, -(int)b->nranges);
    b->nranges = 0;
}
static void drop_buf(struct WGPUGlobal *g, uint64_t id) {
    for (struct bufrec **pp = bucket(g, id); *pp; pp = &(*pp)->next) {
        if ((*pp)->id == id) {
            struct bufrec *b = *pp;
            *pp = b->next;
            free_ranges(g, b);
            free(b);
            LIVE_ADD(live_buffers, -1);
            return;
        }
    }
}

// ---- lifecycle ----
struct WGPUGlobal *__wrap_wgpu_server_new(void *owner) {
    struct WGPUGlobal *g = calloc(1, sizeof *g);
    if (!g)
        abort();
    g->magic = GLOBAL_MAGIC;
    g->owner = owner;
    pthread_mutex_init(&g->lock, NULL);
    g->resp = malloc(RESP_CAP);
    if (!g->resp)
        abort();
    struct result r;
    uint64_t f[1] = {0};
    call_into(g, C_SERVER_NEW, f, 0, g->resp, RESP_CAP, &r);
    g->handle = payload_u64(&r, 0);
    if (!g->handle)
        fprintf(stderr, "W4b wgpu: SERVER_NEW failed (%s%.*s); WebGPU calls will report Internal errors\n",
                r.type == ERR_TRANSPORT ? "transport " : "", (int)r.msg_len, r.msg);
    g->st.host_handle = g->handle;
    LIVE_ADD(live_globals, 1);
    return g;
}

void __wrap_wgpu_server_delete(struct WGPUGlobal *g) {
    if (!g)
        return;
    pthread_mutex_lock(&g->lock);
    struct result r;
    if (g->handle)
        CALL(g, &r, C_SERVER_DELETE);
    for (uint32_t i = 0; i < NBUCKETS; i++) {
        while (g->buckets[i])
            drop_buf(g, g->buckets[i]->id);
    }
    LIVE_ADD(live_pending, -(int)g->npending);
    g->npending = 0;
    for (uint32_t i = 0; i < g->nlocal; i++)
        free(g->local[i].message);
    free(g->local);
    free(g->pending);
    free(g->poll_resp);
    free(g->resp);
    g->magic = 0;
    pthread_mutex_unlock(&g->lock);
    pthread_mutex_destroy(&g->lock);
    free(g);
    LIVE_ADD(live_globals, -1);
}

// ---- poll / dispatch ----
static int parse_poll(struct WGPUGlobal *g, const struct result *r, struct event **events, uint32_t *nevents,
                      uint32_t *capevents, uint64_t *still_queued) {
    const uint8_t *p = r->payload, *end = r->payload + r->payload_len;
    uint64_t count, v[5], len;
    if (r->payload_len < 16)
        return -1;
    memcpy(&count, p, 8);
    memcpy(still_queued, p + 8, 8);
    p += 16;
    for (uint64_t i = 0; i < count; i++) {
        if (end - p < 48)
            return -1;
        memcpy(v, p, 40);
        memcpy(&len, p + 40, 8);
        p += 48;
        uint64_t padded = (len + 7) & ~7ull;
        if (len > 16384 || (uint64_t)(end - p) < padded) // 4096 UTF-16 units, <= 3 bytes each
            return -1;
        if (*nevents == *capevents) {
            uint32_t cap = *capevents ? *capevents * 2 : 16;
            struct event *e = realloc(*events, cap * sizeof *e);
            if (!e)
                abort();
            *events = e;
            *capevents = cap;
        }
        struct event *e = &(*events)[(*nevents)++];
        e->kind = (int)v[0];
        e->object = v[1];
        e->status = (uint32_t)v[2];
        e->token = v[3]; // cb field carries the wrapper token; ud (v[4]) is unused
        e->message = malloc(len + 1);
        if (!e->message)
            abort();
        memcpy(e->message, p, len);
        e->message[len] = 0;
        p += padded;
    }
    (void)g;
    return 0;
}

void __wrap_wgpu_server_poll_all_devices(const struct WGPUGlobal *cg, bool force_wait) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    if (g->dispatching) { // re-entrant poll from inside a callback (or a concurrent poller)
        pthread_mutex_unlock(&g->lock);
        return;
    }
    g->dispatching = true;
    g->st.polls++;
    // Locally queued events first (they were generated by earlier calls).
    struct event *events = g->local;
    uint32_t nevents = g->nlocal, cap = g->cap_local;
    g->local = NULL;
    g->nlocal = g->cap_local = 0;
    if (g->handle) {
        if (!g->poll_resp) {
            g->poll_resp = malloc(POLL_CAP);
            if (!g->poll_resp)
                abort();
        }
        bool wait = force_wait;
        for (int round = 0; round < 8; round++) {
            uint64_t f[2] = {g->handle, wait ? 1 : 0}, still = 0;
            struct result r;
            if (call_into(g, C_POLL, f, 2, g->poll_resp, POLL_CAP, &r) < 0 || r.type != WGPUErrorBufferType_None) {
                if (r.type != ERR_TRANSPORT)
                    g->st.ignored_errors++;
                break;
            }
            if (parse_poll(g, &r, &events, &nevents, &cap, &still) < 0) {
                g->st.transport_errors++;
                break;
            }
            if (!still)
                break;
            wait = false;
        }
    }
    pthread_mutex_unlock(&g->lock);

    for (uint32_t i = 0; i < nevents; i++) {
        struct event *e = &events[i];
        if (e->kind == EV_UNCAPTURED) {
            fprintf(stderr, "W4b wgpu: uncaptured device error: %s\n", e->message);
            free(e->message);
            continue;
        }
        pthread_mutex_lock(&g->lock);
        struct pending *p = find_pending(g, e->token);
        struct pending copy;
        bool matched = p && p->kind == e->kind;
        if (matched) {
            copy = *p;
            remove_pending(g, p);
            g->st.callbacks_invoked++;
        } else {
            g->st.events_unmatched++;
        }
        pthread_mutex_unlock(&g->lock);
        if (matched) {
            switch (copy.kind) {
            case PK_MAP:
                if (copy.c.map.callback)
                    copy.c.map.callback((enum WGPUBufferMapAsyncStatus)e->status, copy.c.map.user_data);
                break;
            case PK_WORK_DONE:
                if (copy.c.done.callback)
                    copy.c.done.callback(copy.c.done.user_data);
                break;
            case PK_LOST:
                if (copy.c.lost.callback)
                    copy.c.lost.callback(copy.c.lost.user_data, (uint8_t)e->status, e->message);
                break;
            }
        }
        free(e->message);
    }
    free(events);

    pthread_mutex_lock(&g->lock);
    g->dispatching = false;
    pthread_mutex_unlock(&g->lock);
}

// ---- adapters ----
int8_t __wrap_wgpu_server_instance_request_adapter(const struct WGPUGlobal *cg, const WGPURequestAdapterOptions *desc,
                                                   const WGPUAdapterId *ids, uintptr_t id_length,
                                                   const struct WGPUFfiLUID *luid, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    (void)luid; // only used for the Windows Dx12 path upstream
    if (!id_length || id_length > 127) {
        eb_str(eb, WGPUErrorBufferType_Validation, "No suitable adapter found");
        return -1;
    }
    uintptr_t pick = 0;
    for (uintptr_t i = 0; i < id_length; i++) {
        if ((ids[i] >> 61) == 1) { // Backend::Vulkan: the backend the host executor reports
            pick = i;
            break;
        }
    }
    pthread_mutex_lock(&g->lock);
    struct result r;
    // Pass wgpu's PowerPreference through: executor maps 1 (LowPower) to "low-power", else "high-performance".
    // NB Firefox 128 WebGPUParent.cpp:299-306 casts the DOM enum into this field (see the W4b doc).
    CALL(g, &r, C_REQUEST_ADAPTER, (uint64_t)desc->power_preference, desc->force_fallback_adapter ? 1 : 0, ids[pick]);
    int8_t out = -1;
    if (r.type != WGPUErrorBufferType_None)
        eb_result(eb, &r);
    else if (payload_u64(&r, 0))
        out = (int8_t)pick;
    else
        eb_str(eb, WGPUErrorBufferType_Validation, "No suitable adapter found");
    pthread_mutex_unlock(&g->lock);
    return out;
}

// bincode 1 (fixint, little endian) writer.
struct wb {
    uint8_t *p;
    size_t n, cap;
    bool oom;
};
static void wb_put(struct wb *w, const void *data, size_t len) {
    if (w->oom)
        return;
    if (w->n + len > w->cap) {
        size_t cap = w->cap ? w->cap : 256;
        while (cap < w->n + len)
            cap *= 2;
        uint8_t *p = realloc(w->p, cap);
        if (!p) {
            w->oom = true;
            return;
        }
        w->p = p;
        w->cap = cap;
    }
    memcpy(w->p + w->n, data, len);
    w->n += len;
}
static void wb_u32(struct wb *w, uint32_t v) {
    wb_put(w, &v, 4);
}
static void wb_u64(struct wb *w, uint64_t v) {
    wb_put(w, &v, 8);
}
struct rd {
    const uint8_t *p;
    size_t n, off;
    bool bad;
};
static uint64_t rd_u64(struct rd *r) {
    uint64_t v = 0;
    if (r->bad || r->n - r->off < 8) {
        r->bad = true;
        return 0;
    }
    memcpy(&v, r->p + r->off, 8);
    r->off += 8;
    return v;
}
static const uint8_t *rd_str(struct rd *r, uint64_t *len) {
    *len = rd_u64(r);
    uint64_t padded = (*len + 7) & ~7ull;
    if (r->bad || *len > (1u << 20) || r->n - r->off < padded) {
        r->bad = true;
        *len = 0;
        return NULL;
    }
    const uint8_t *s = r->p + r->off;
    r->off += (size_t)padded;
    return s;
}
static uint32_t sat32(uint64_t v) {
    return v > 0xffffffffull ? 0xffffffffu : (uint32_t)v;
}
static uint64_t min64(uint64_t a, uint64_t b) {
    return a < b ? a : b;
}

// wgt::Limits field order (wgpu-types lib.rs, rev c7458638); executor LIMIT_FIELDS uses the same order.
enum {
    L_TEX1D, L_TEX2D, L_TEX3D, L_ARRAY_LAYERS, L_BIND_GROUPS, L_BINDINGS_PER_GROUP, L_DYN_UNIFORM, L_DYN_STORAGE,
    L_SAMPLED_TEX, L_SAMPLERS, L_STORAGE_BUFFERS, L_STORAGE_TEX, L_UNIFORM_BUFFERS, L_UNIFORM_BINDING,
    L_STORAGE_BINDING, L_VERTEX_BUFFERS, L_MAX_BUFFER_SIZE, L_COUNT = 34, L_NON_SAMPLER_BINDINGS = 33,
};

size_t w4b_encode_adapter_info(uint64_t adapter_id, const uint8_t *payload, size_t payload_len, uint8_t **out) {
    struct rd r = {payload, payload_len, 0, false};
    struct wb w = {0};
    *out = NULL;
    if (rd_u64(&r) != L_COUNT)
        return 0;
    uint64_t lim[L_COUNT];
    for (int i = 0; i < L_COUNT; i++)
        lim[i] = rd_u64(&r);
    uint64_t features = rd_u64(&r), vendor = rd_u64(&r), device = rd_u64(&r), device_type = rd_u64(&r),
             backend = rd_u64(&r);
    (void)rd_u64(&r); // is_fallback: implied by device_type upstream
    uint64_t name_len, driver_len, driver_info_len, skip;
    const uint8_t *name = rd_str(&r, &name_len), *driver = rd_str(&r, &driver_len),
                  *driver_info = rd_str(&r, &driver_info_len);
    for (int i = 0; i < 4; i++) // vendor, architecture, description, features csv: informational only
        (void)rd_str(&r, &skip);
    if (r.bad || r.off != r.n || device_type > 4 || backend > 5)
        return 0;

    // restrict_limits (gfx/wgpu_bindings/src/server.rs:59-91).
    const uint64_t tex_extent = 32767, per_resource = 64;
    lim[L_MAX_BUFFER_SIZE] = min64(lim[L_MAX_BUFFER_SIZE], MAX_BUFFER_SIZE);
    lim[L_TEX1D] = min64(lim[L_TEX1D], tex_extent);
    lim[L_TEX2D] = min64(lim[L_TEX2D], tex_extent);
    lim[L_TEX3D] = min64(lim[L_TEX3D], tex_extent);
    lim[L_SAMPLED_TEX] = min64(lim[L_SAMPLED_TEX], per_resource);
    lim[L_SAMPLERS] = min64(lim[L_SAMPLERS], per_resource);
    lim[L_STORAGE_TEX] = min64(lim[L_STORAGE_TEX], per_resource);
    lim[L_UNIFORM_BUFFERS] = min64(lim[L_UNIFORM_BUFFERS], per_resource);
    lim[L_STORAGE_BUFFERS] = min64(lim[L_STORAGE_BUFFERS], per_resource);
    lim[L_UNIFORM_BINDING] = min64(lim[L_UNIFORM_BINDING], MAX_BUFFER_SIZE);
    lim[L_STORAGE_BINDING] = min64(lim[L_STORAGE_BINDING], MAX_BUFFER_SIZE);
    lim[L_NON_SAMPLER_BINDINGS] = 10000;

    // AdapterInformation<String> (gfx/wgpu_bindings/src/lib.rs:96-107), bincode field order.
    // id: RawId serializes as SerialId::Id(index u32, epoch u32, backend enum u32) (wgpu-core id.rs:129-139).
    wb_u32(&w, 0); // variant index of SerialId::Id
    wb_u32(&w, (uint32_t)adapter_id);
    wb_u32(&w, (uint32_t)(adapter_id >> 32) & 0x1fffffffu);
    wb_u32(&w, (uint32_t)(adapter_id >> 61));
    for (int i = 0; i < L_COUNT; i++) {
        if (i == L_MAX_BUFFER_SIZE)
            wb_u64(&w, lim[i]);
        else
            wb_u32(&w, sat32(lim[i]));
    }
    wb_u64(&w, features); // bitflags Features: u64 bits
    wb_u64(&w, name_len);
    wb_put(&w, name, (size_t)name_len);
    wb_u32(&w, (uint32_t)vendor);
    wb_u32(&w, (uint32_t)device);
    wb_u32(&w, (uint32_t)device_type); // DeviceType variant index
    wb_u64(&w, driver_len);
    wb_put(&w, driver, (size_t)driver_len);
    wb_u64(&w, driver_info_len);
    wb_put(&w, driver_info, (size_t)driver_info_len);
    wb_u32(&w, (uint32_t)backend); // Backend variant index
    if (w.oom) {
        free(w.p);
        return 0;
    }
    uint8_t *exact = realloc(w.p, w.n); // capacity == len, like Vec::shrink-free from_vec here
    *out = exact ? exact : w.p;
    return w.n;
}

static void byte_buf_none(struct WGPUByteBuf *bb) {
    uint8_t *p = calloc(1, 8); // bincode::serialize(&0u64)
    if (!p)
        abort();
    bb->data = p;
    bb->len = bb->capacity = 8;
}

void __wrap_wgpu_server_adapter_pack_info(const struct WGPUGlobal *cg, WGPUOption_AdapterId id,
                                          struct WGPUByteBuf *bb) {
    struct WGPUGlobal *g = G(cg);
    if (!id) {
        byte_buf_none(bb);
        return;
    }
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_PACK_INFO, id);
    uint8_t *data = NULL;
    size_t n = 0;
    if (r.type == WGPUErrorBufferType_None)
        n = w4b_encode_adapter_info(id, r.payload, r.payload_len, &data);
    if (!n) // upstream would panic on unwrap(); report "no adapter" instead
        fprintf(stderr, "W4b wgpu: adapter_pack_info failed (%.*s); returning None\n", (int)r.msg_len, r.msg);
    pthread_mutex_unlock(&g->lock);
    if (!n) {
        byte_buf_none(bb);
        return;
    }
    bb->data = data;
    bb->len = bb->capacity = n;
}

void __wrap_wgpu_server_adapter_request_device(const struct WGPUGlobal *cg, WGPUAdapterId self_id,
                                               const struct WGPUByteBuf *bb, WGPUDeviceId new_id,
                                               struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_REQUEST_DEVICE, self_id, new_id, P(bb->data), bb->len);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

#define SIMPLE_CALL(g, call, ...)                                                                                 \
    do {                                                                                                          \
        pthread_mutex_lock(&(g)->lock);                                                                           \
        struct result _r;                                                                                         \
        CALL((g), &_r, (call), __VA_ARGS__);                                                                      \
        note_ignored((g), &_r);                                                                                   \
        pthread_mutex_unlock(&(g)->lock);                                                                         \
    } while (0)

void __wrap_wgpu_server_adapter_drop(const struct WGPUGlobal *cg, WGPUAdapterId id) {
    SIMPLE_CALL(G(cg), C_ADAPTER_DROP, id);
}

// ---- devices ----
void __wrap_wgpu_server_device_destroy(const struct WGPUGlobal *cg, WGPUDeviceId id) {
    SIMPLE_CALL(G(cg), C_DEVICE_DESTROY, id);
}
void __wrap_wgpu_server_device_drop(const struct WGPUGlobal *cg, WGPUDeviceId id) {
    SIMPLE_CALL(G(cg), C_DEVICE_DROP, id);
}

void __wrap_wgpu_server_set_device_lost_callback(const struct WGPUGlobal *cg, WGPUDeviceId id,
                                                 struct WGPUDeviceLostClosureC closure) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct pending *old = find_lost(g, id);
    if (old) { // device_set_device_lost_closure: the previous closure gets ReplacedCallback
        old->object = 0;
        queue_local(g, EV_LOST, id, W4B_LOST_REPLACED, old->token, "");
    }
    uint64_t token = add_pending(g, PK_LOST, id);
    find_pending(g, token)->c.lost = closure;
    struct result r;
    CALL(g, &r, C_SET_LOST_CALLBACK, id, token, 0);
    if (r.type != WGPUErrorBufferType_None) { // no such device: DeviceInvalid, like wgpu-core
        find_pending(g, token)->object = 0;
        queue_local(g, EV_LOST, id, W4B_LOST_INVALID, token, "");
    }
    pthread_mutex_unlock(&g->lock);
}

void *__wrap_wgpu_server_get_device_fence_handle(const struct WGPUGlobal *cg, WGPUDeviceId id) {
    (void)cg;
    (void)id;
    return NULL; // no shared fences: Firefox falls back to readback presentation
}

void __wrap_wgpu_server_device_action(const struct WGPUGlobal *cg, WGPUDeviceId id, const struct WGPUByteBuf *bb,
                                      struct WGPUErrorBuffer eb) {
    // The executor decodes DeviceAction and runs CreateCommandEncoder; other actions return Internal.
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_DEVICE_ACTION, id, P(bb->data), bb->len);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

// ---- buffers ----
void __wrap_wgpu_server_device_create_buffer(const struct WGPUGlobal *cg, WGPUDeviceId dev, WGPUBufferId id,
                                             const nsACString *label, WGPUBufferAddress size, uint32_t usage,
                                             bool mapped_at_creation, bool shm_allocation_failed,
                                             struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    uint64_t lp, ll;
    label_of(label, &lp, &ll);
    pthread_mutex_lock(&g->lock);
    struct result r;
    if (shm_allocation_failed || size > MAX_BUFFER_SIZE) { // server.rs:474-481
        eb_str(eb, WGPUErrorBufferType_OutOfMemory, "Out of memory");
        // create_buffer_error: bind the id to an invalid buffer (usage 0 is rejected by the executor).
        CALL(g, &r, C_CREATE_BUFFER, dev, id, 0, 0, 0, lp, ll);
        get_buf(g, id)->invalid = true;
    } else {
        CALL(g, &r, C_CREATE_BUFFER, dev, id, size, usage, mapped_at_creation ? 1 : 0, lp, ll);
        eb_result(eb, &r);
        if (r.type != WGPUErrorBufferType_None) {
            get_buf(g, id)->invalid = true;
        } else if (mapped_at_creation) {
            struct bufrec *b = get_buf(g, id);
            b->invalid = false;
            b->mode = 2;
        } else {
            drop_buf(g, id); // stale record from a reused id
        }
    }
    pthread_mutex_unlock(&g->lock);
}

static uint32_t map_status_for(const struct result *r) {
    if (r->type == ERR_TRANSPORT)
        return WGPUBufferMapAsyncStatus_ContextLost;
    char text[128];
    size_t n = r->msg_len < sizeof text - 1 ? r->msg_len : sizeof text - 1;
    memcpy(text, r->msg, n);
    text[n] = 0;
    if (strstr(text, "already mapped"))
        return WGPUBufferMapAsyncStatus_AlreadyMapped;
    if (strstr(text, "already pending"))
        return WGPUBufferMapAsyncStatus_MapAlreadyPending;
    if (strstr(text, "invalid"))
        return WGPUBufferMapAsyncStatus_Invalid;
    if (r->type == WGPUErrorBufferType_DeviceLost)
        return WGPUBufferMapAsyncStatus_ContextLost;
    return WGPUBufferMapAsyncStatus_Error;
}

void __wrap_wgpu_server_buffer_map(const struct WGPUGlobal *cg, WGPUBufferId id, WGPUBufferAddress start,
                                   WGPUBufferAddress size, enum WGPUHostMap mode,
                                   struct WGPUBufferMapCallbackC callback, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    uint64_t token = add_pending(g, PK_MAP, id);
    find_pending(g, token)->c.map = callback;
    struct result r;
    struct bufrec *b = find_buf(g, id);
    if (mode != WGPUHostMap_Read && mode != WGPUHostMap_Write) {
        eb_str(eb, WGPUErrorBufferType_Validation, "invalid map mode");
        queue_local(g, EV_MAP, id, WGPUBufferMapAsyncStatus_Error, token, "");
    } else if (b && b->invalid) {
        eb_str(eb, WGPUErrorBufferType_Validation, "Buffer is invalid");
        queue_local(g, EV_MAP, id, WGPUBufferMapAsyncStatus_Invalid, token, "");
    } else {
        CALL(g, &r, C_BUFFER_MAP, id, start, size, mode == WGPUHostMap_Read ? 1 : 2, token, 0);
        if (r.type != WGPUErrorBufferType_None) {
            // wgpu-core calls the callback with the error; we deliver it at the next poll.
            eb_result(eb, &r);
            queue_local(g, EV_MAP, id, map_status_for(&r), token, "");
        } else {
            b = get_buf(g, id);
            free_ranges(g, b);
            b->mode = mode == WGPUHostMap_Read ? 1 : 2;
        }
    }
    pthread_mutex_unlock(&g->lock);
}

struct WGPUMappedBufferSlice __wrap_wgpu_server_buffer_get_mapped_range(const struct WGPUGlobal *cg, WGPUBufferId id,
                                                                        WGPUBufferAddress start,
                                                                        WGPUBufferAddress size,
                                                                        struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    struct WGPUMappedBufferSlice out = {NULL, 0};
    pthread_mutex_lock(&g->lock);
    struct bufrec *b = find_buf(g, id);
    if (b) {
        for (uint32_t i = 0; i < b->nranges; i++) {
            if (b->ranges[i].start == start && b->ranges[i].size == size) {
                out.ptr = b->ranges[i].data;
                out.length = size;
                pthread_mutex_unlock(&g->lock);
                return out;
            }
        }
    }
    if (b && b->invalid) {
        eb_str(eb, WGPUErrorBufferType_Validation, "Buffer is invalid");
    } else if (b && b->mode == 2 && b->nranges >= 1) {
        eb_str(eb, WGPUErrorBufferType_Validation, "W4 supports one mapped range per write mapping");
    } else if (b && b->nranges >= MAX_RANGES) {
        eb_str(eb, WGPUErrorBufferType_Validation, "W4 supports at most 8 mapped ranges per buffer");
    } else if (size > MAX_BUFFER_SIZE) {
        eb_str(eb, WGPUErrorBufferType_Validation, "mapped range is larger than the maximum buffer size");
    } else {
        uint8_t *staging = malloc(size ? (size_t)size : 1);
        struct result r;
        if (!staging) {
            eb_str(eb, WGPUErrorBufferType_OutOfMemory, "Out of memory");
        } else if (CALL(g, &r, C_GET_MAPPED_RANGE, id, start, size, P(staging)), r.type != WGPUErrorBufferType_None) {
            eb_result(eb, &r);
            free(staging);
        } else {
            b = get_buf(g, id);
            b->ranges[b->nranges++] = (struct range){start, size, staging};
            g->st.staging_bytes += size;
            LIVE_ADD(live_staging, 1);
            out.ptr = staging;
            out.length = size;
        }
    }
    pthread_mutex_unlock(&g->lock);
    return out;
}

void __wrap_wgpu_server_buffer_unmap(const struct WGPUGlobal *cg, WGPUBufferId id, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct bufrec *b = find_buf(g, id);
    if (b && b->invalid) { // BufferAccessError::Invalid is ignored (server.rs:565-573)
        pthread_mutex_unlock(&g->lock);
        return;
    }
    struct result r;
    if (b && b->mode == 2 && b->nranges == 1) // copy the staging bytes back (WRITE / mapped_at_creation)
        CALL(g, &r, C_BUFFER_UNMAP, id, P(b->ranges[0].data), b->ranges[0].start, b->ranges[0].size);
    else
        CALL(g, &r, C_BUFFER_UNMAP, id, 0, 0, 0);
    char text[40] = {0};
    memcpy(text, r.msg, r.msg_len < sizeof text - 1 ? r.msg_len : sizeof text - 1);
    if (r.type == WGPUErrorBufferType_Validation && strstr(text, "invalid buffer id"))
        g->st.ignored_errors++; // unknown id == Invalid upstream
    else
        eb_result(eb, &r);
    if (b) {
        free_ranges(g, b);
        b->mode = 0;
    }
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_buffer_destroy(const struct WGPUGlobal *cg, WGPUBufferId id) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_BUFFER_DESTROY, id);
    note_ignored(g, &r);
    struct bufrec *b = find_buf(g, id);
    if (b) {
        free_ranges(g, b);
        b->mode = 0;
    }
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_buffer_drop(const struct WGPUGlobal *cg, WGPUBufferId id) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_BUFFER_DROP, id);
    note_ignored(g, &r);
    drop_buf(g, id);
    pthread_mutex_unlock(&g->lock);
}

// ---- command encoding and queue ----
void __wrap_wgpu_server_device_create_encoder(const struct WGPUGlobal *cg, WGPUDeviceId dev,
                                              const struct WGPUCommandEncoderDescriptor *desc,
                                              WGPUCommandEncoderId id, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    uint64_t lp, ll;
    label_of(desc ? desc->label : NULL, &lp, &ll);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_CREATE_ENCODER, dev, id, lp, ll);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_command_encoder_action(const struct WGPUGlobal *cg, WGPUCommandEncoderId id,
                                               const struct WGPUByteBuf *bb, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_ENCODER_ACTION, id, P(bb->data), bb->len);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_encoder_finish(const struct WGPUGlobal *cg, WGPUCommandEncoderId id,
                                       const struct WGPUCommandBufferDescriptor *desc, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    uint64_t lp, ll;
    label_of(desc ? desc->label : NULL, &lp, &ll);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_ENCODER_FINISH, id, lp, ll);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_encoder_drop(const struct WGPUGlobal *cg, WGPUCommandEncoderId id) {
    SIMPLE_CALL(G(cg), C_ENCODER_DROP, id);
}

uint64_t __wrap_wgpu_server_queue_submit(const struct WGPUGlobal *cg, WGPUQueueId queue, const WGPUCommandBufferId *ids,
                                         uintptr_t count, struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_QUEUE_SUBMIT, queue, P(ids), count);
    uint64_t index = 0;
    if (r.type == WGPUErrorBufferType_None)
        index = payload_u64(&r, 0);
    else
        eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
    return index;
}

void __wrap_wgpu_server_on_submitted_work_done(const struct WGPUGlobal *cg, WGPUQueueId queue,
                                               struct WGPUSubmittedWorkDoneClosureC closure) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    uint64_t token = add_pending(g, PK_WORK_DONE, queue);
    find_pending(g, token)->c.done = closure;
    struct result r;
    CALL(g, &r, C_WORK_DONE, queue, token, 0);
    if (r.type != WGPUErrorBufferType_None) { // still call it exactly once (it owns its userdata)
        g->st.ignored_errors++;
        queue_local(g, EV_WORK_DONE, queue, 1, token, "");
    }
    pthread_mutex_unlock(&g->lock);
}

void __wrap_wgpu_server_queue_write_action(const struct WGPUGlobal *cg, WGPUQueueId queue,
                                           const struct WGPUByteBuf *bb, const uint8_t *data, uintptr_t data_len,
                                           struct WGPUErrorBuffer eb) {
    struct WGPUGlobal *g = G(cg);
    pthread_mutex_lock(&g->lock);
    struct result r;
    CALL(g, &r, C_QUEUE_WRITE_ACTION, queue, P(bb->data), bb->len, P(data), data_len);
    eb_result(eb, &r);
    pthread_mutex_unlock(&g->lock);
}

// ---- outside the W4 subset ----
static void unsupported(struct WGPUErrorBuffer eb, const char *what) {
    char text[160];
    int n = snprintf(text, sizeof text, "%s is not supported in W4 (Firefox WebGPU host passthrough)", what);
    eb_init(eb, WGPUErrorBufferType_Internal, text, (size_t)n);
}

bool __wrap_wgpu_server_device_create_shader_module(const struct WGPUGlobal *cg, WGPUDeviceId dev,
                                                    WGPUShaderModuleId id, const nsACString *label,
                                                    const nsCString *code,
                                                    struct WGPUShaderModuleCompilationMessage *msg,
                                                    struct WGPUErrorBuffer eb) {
    (void)cg, (void)dev, (void)id, (void)label, (void)code;
    if (msg) { // leave the caller-owned nsString untouched
        msg->line_number = msg->line_pos = msg->utf16_offset = msg->utf16_length = 0;
    }
    unsupported(eb, "createShaderModule");
    return false;
}
void __wrap_wgpu_server_texture_action(const struct WGPUGlobal *cg, WGPUTextureId id, const struct WGPUByteBuf *bb,
                                       struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)bb;
    unsupported(eb, "TextureAction");
}
void __wrap_wgpu_server_render_pass(const struct WGPUGlobal *cg, WGPUCommandEncoderId id,
                                    const struct WGPUByteBuf *bb, struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)bb;
    unsupported(eb, "render pass");
}
void __wrap_wgpu_server_compute_pass(const struct WGPUGlobal *cg, WGPUCommandEncoderId id,
                                     const struct WGPUByteBuf *bb, struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)bb;
    unsupported(eb, "compute pass");
}
void __wrap_wgpu_server_encoder_copy_texture_to_buffer(const struct WGPUGlobal *cg, WGPUCommandEncoderId id,
                                                       const WGPUImageCopyTexture *src, WGPUBufferId dst,
                                                       const struct WGPUImageDataLayout *layout,
                                                       const struct WGPUExtent3d *size, struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)src, (void)dst, (void)layout, (void)size;
    unsupported(eb, "copyTextureToBuffer");
}
void __wrap_wgpu_server_compute_pipeline_get_bind_group_layout(const struct WGPUGlobal *cg,
                                                               WGPUComputePipelineId id, uint32_t index,
                                                               WGPUBindGroupLayoutId assign,
                                                               struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)index, (void)assign;
    unsupported(eb, "ComputePipeline.getBindGroupLayout");
}
void __wrap_wgpu_server_render_pipeline_get_bind_group_layout(const struct WGPUGlobal *cg, WGPURenderPipelineId id,
                                                              uint32_t index, WGPUBindGroupLayoutId assign,
                                                              struct WGPUErrorBuffer eb) {
    (void)cg, (void)id, (void)index, (void)assign;
    unsupported(eb, "RenderPipeline.getBindGroupLayout");
}
// Objects W4 never creates: dropping/destroying them is a no-op.
#define NOOP_DROP(name, type)                                                                                     \
    void __wrap_##name(const struct WGPUGlobal *cg, type id) {                                                    \
        (void)cg, (void)id;                                                                                       \
    }
NOOP_DROP(wgpu_server_render_bundle_drop, WGPURenderBundleId)
NOOP_DROP(wgpu_server_bind_group_layout_drop, WGPUBindGroupLayoutId)
NOOP_DROP(wgpu_server_pipeline_layout_drop, WGPUPipelineLayoutId)
NOOP_DROP(wgpu_server_bind_group_drop, WGPUBindGroupId)
NOOP_DROP(wgpu_server_shader_module_drop, WGPUShaderModuleId)
NOOP_DROP(wgpu_server_compute_pipeline_drop, WGPUComputePipelineId)
NOOP_DROP(wgpu_server_render_pipeline_drop, WGPURenderPipelineId)
NOOP_DROP(wgpu_server_texture_destroy, WGPUTextureId)
NOOP_DROP(wgpu_server_texture_drop, WGPUTextureId)
NOOP_DROP(wgpu_server_texture_view_drop, WGPUTextureViewId)
NOOP_DROP(wgpu_server_sampler_drop, WGPUSamplerId)

// Every wrapper must match the Firefox prototype exactly: redeclare them all from the X-macro.
#define W4B_DECLARE_WRAP(ret, name, params) ret __wrap_##name params;
W4B_SERVER_FUNCTIONS(W4B_DECLARE_WRAP)

// ---- diagnostics ----
int w4b_wrap_get_stats(const struct WGPUGlobal *cg, struct w4b_wrap_stats *out) {
    struct WGPUGlobal *g = G(cg);
    if (!g || g->magic != GLOBAL_MAGIC)
        return -1;
    pthread_mutex_lock(&g->lock);
    *out = g->st;
    out->pending_callbacks = g->npending;
    out->local_events = g->nlocal;
    uint32_t nb = 0, nr = 0;
    for (uint32_t i = 0; i < NBUCKETS; i++)
        for (struct bufrec *b = g->buckets[i]; b; b = b->next)
            nb++, nr += b->nranges;
    out->buffer_records = nb;
    out->staging_ranges = nr;
    pthread_mutex_unlock(&g->lock);
    return 0;
}
void w4b_wrap_live_counts(uint32_t *globals, uint32_t *pending, uint32_t *buffers, uint32_t *staging) {
    *globals = __atomic_load_n(&live_globals, __ATOMIC_RELAXED);
    *pending = __atomic_load_n(&live_pending, __ATOMIC_RELAXED);
    *buffers = __atomic_load_n(&live_buffers, __ATOMIC_RELAXED);
    *staging = __atomic_load_n(&live_staging, __ATOMIC_RELAXED);
}
