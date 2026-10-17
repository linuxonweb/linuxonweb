// SPDX-License-Identifier: MIT
// wasm32 C mirror of the Firefox 128.14.0esr wgpu_bindings server FFI (packet W4b).
//
// Source of truth: obj-wasm-browser/gfx/wgpu_bindings/wgpu_ffi_generated.h
// (cbindgen output of gfx/wgpu_bindings, SHA-256
// a9cd7efc43830cd3d07f6728fb037bf6c9d34e1d0b78ab544575904a606b8fdd). Every type
// below cites its line there; wgpu-server-wrap.c static-asserts the wasm32
// size/offset of each one. Only the types the W4 wrapper touches by value are
// mirrored; the rest are opaque (pointers only).
#ifndef W4B_WGPU_SERVER_ABI_H
#define W4B_WGPU_SERVER_ABI_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// header lines 28-51: every id is a raw u64 (index | epoch << 32 | backend << 61);
// Option<Id> is the same u64 with 0 == None.
typedef uint64_t WGPUOption_AdapterId, WGPUOption_SurfaceId, WGPUAdapterId, WGPUBindGroupId, WGPUBindGroupLayoutId,
    WGPUBufferId, WGPUCommandBufferId, WGPUCommandEncoderId, WGPUComputePipelineId, WGPUDeviceId,
    WGPUPipelineLayoutId, WGPUQueueId, WGPURenderBundleId, WGPURenderPipelineId, WGPUSamplerId, WGPUShaderModuleId,
    WGPUTextureId, WGPUTextureViewId;
typedef uint64_t WGPUBufferAddress; // line 3233

// line 1131: enum WGPUErrorBufferType : uint8_t (C++ / C23); pointed to by WGPUErrorBuffer.type.
enum {
    WGPUErrorBufferType_None = 0,
    WGPUErrorBufferType_DeviceLost = 1,
    WGPUErrorBufferType_Internal = 2,
    WGPUErrorBufferType_OutOfMemory = 3,
    WGPUErrorBufferType_Validation = 4,
};
typedef uint8_t WGPUErrorBufferType;

// line 1105: plain C++ enum (int-sized).
enum WGPUPowerPreference {
    WGPUPowerPreference_None = 0,
    WGPUPowerPreference_LowPower = 1,
    WGPUPowerPreference_HighPerformance = 2,
    WGPUPowerPreference_Sentinel,
};

// line 1154: plain enum, passed as i32.
enum WGPUHostMap { WGPUHostMap_Read, WGPUHostMap_Write, WGPUHostMap_Sentinel };

// line 1168: plain enum (int-sized), first callback argument.
enum WGPUBufferMapAsyncStatus {
    WGPUBufferMapAsyncStatus_Success,
    WGPUBufferMapAsyncStatus_AlreadyMapped,
    WGPUBufferMapAsyncStatus_MapAlreadyPending,
    WGPUBufferMapAsyncStatus_Error,
    WGPUBufferMapAsyncStatus_Aborted,
    WGPUBufferMapAsyncStatus_ContextLost,
    WGPUBufferMapAsyncStatus_Invalid,
    WGPUBufferMapAsyncStatus_InvalidRange,
    WGPUBufferMapAsyncStatus_InvalidAlignment,
    WGPUBufferMapAsyncStatus_InvalidUsageFlags,
    WGPUBufferMapAsyncStatus_Sentinel,
};

// wgpu-types lib.rs DeviceLostReason (u8 in the closure signature).
enum { W4B_LOST_UNKNOWN = 0, W4B_LOST_DESTROYED = 1, W4B_LOST_DROPPED = 2, W4B_LOST_REPLACED = 3, W4B_LOST_INVALID = 4 };

struct WGPUGlobal; // line 1265: opaque; the wrapper owns its own definition.

// line 1355 (gfx/wgpu_bindings/src/lib.rs:65-69): Vec<u8> parts; freed with free() by
// ipc::ByteBuf (ByteBuf.h:31,61) / Rust GeckoAlloc (libc malloc).
struct WGPUByteBuf {
    const uint8_t *data;
    uintptr_t len;
    uintptr_t capacity;
};

// nsTStringRepr.h:483-486 / xpcom/rust/nsstring/src/lib.rs:364-367.
typedef struct nsACString {
    const char *mData;
    uint32_t mLength;
    uint16_t mDataFlags;
    uint16_t mClassFlags;
} nsACString;
typedef nsACString nsCString;
typedef struct nsString {
    const uint16_t *mData;
    uint32_t mLength;
    uint16_t mDataFlags;
    uint16_t mClassFlags;
} nsString;

// line 2963 / line 3743.
struct WGPUCommandEncoderDescriptor {
    const nsACString *label;
};
struct WGPUCommandBufferDescriptor {
    const nsACString *label;
};

// line 3652, typedef at line 3669.
typedef struct WGPURequestAdapterOptions_SurfaceId {
    enum WGPUPowerPreference power_preference;
    bool force_fallback_adapter;
    WGPUOption_SurfaceId compatible_surface;
} WGPURequestAdapterOptions;

// line 3671: unsigned long / long (4 bytes each on wasm32).
struct WGPUFfiLUID {
    unsigned long low_part;
    long high_part;
};

// line 3686.
struct WGPUErrorBuffer {
    WGPUErrorBufferType *type;
    char *message;
    uintptr_t message_capacity;
};

// line 3705.
struct WGPUDeviceLostClosureC {
    void (*callback)(uint8_t *user_data, uint8_t reason, const char *message);
    uint8_t *user_data;
    bool consumed;
};

// line 3718.
struct WGPUShaderModuleCompilationMessage {
    uint64_t line_number;
    uint64_t line_pos;
    uint64_t utf16_offset;
    uint64_t utf16_length;
    nsString message;
};

// line 3726.
struct WGPUBufferMapCallbackC {
    void (*callback)(enum WGPUBufferMapAsyncStatus status, uint8_t *user_data);
    uint8_t *user_data;
};

// line 3732 (returned through an sret pointer on wasm32).
struct WGPUMappedBufferSlice {
    uint8_t *ptr;
    uint64_t length;
};

// line 3750.
struct WGPUSubmittedWorkDoneClosureC {
    void (*callback)(uint8_t *user_data);
    uint8_t *user_data;
};

// Opaque here: only passed by pointer to functions W4 rejects.
typedef struct WGPUImageCopyTexture_TextureId WGPUImageCopyTexture; // lines 3612, 3633
struct WGPUImageDataLayout;                                           // line 3635
struct WGPUExtent3d;                                                  // line 2363

// Prototypes, lines 4715-5050 (all 43 functions that take or create a WGPUGlobal).
// W4B_SERVER_FN(ret, name, params) is expanded by the wrapper as __wrap_<name> and
// by the test's abort stubs as the plain name.
#define W4B_SERVER_FUNCTIONS(X)                                                                                   \
    X(struct WGPUGlobal *, wgpu_server_new, (void *aOwner))                                                       \
    X(void, wgpu_server_delete, (struct WGPUGlobal * aGlobal))                                                    \
    X(void, wgpu_server_poll_all_devices, (const struct WGPUGlobal *aGlobal, bool aForceWait))                    \
    X(int8_t, wgpu_server_instance_request_adapter,                                                               \
      (const struct WGPUGlobal *aGlobal, const WGPURequestAdapterOptions *aDesc, const WGPUAdapterId *aIds,       \
       uintptr_t aIdLength, const struct WGPUFfiLUID *aAdapterLuid, struct WGPUErrorBuffer aErrorBuf))            \
    X(void, wgpu_server_adapter_pack_info,                                                                        \
      (const struct WGPUGlobal *aGlobal, WGPUOption_AdapterId aSelfId, struct WGPUByteBuf *aByteBuf))             \
    X(void, wgpu_server_adapter_request_device,                                                                   \
      (const struct WGPUGlobal *aGlobal, WGPUAdapterId aSelfId, const struct WGPUByteBuf *aByteBuf,               \
       WGPUDeviceId aNewId, struct WGPUErrorBuffer aErrorBuf))                                                    \
    X(void, wgpu_server_adapter_drop, (const struct WGPUGlobal *aGlobal, WGPUAdapterId aAdapterId))               \
    X(void, wgpu_server_device_destroy, (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId))                 \
    X(void, wgpu_server_device_drop, (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId))                    \
    X(void, wgpu_server_set_device_lost_callback,                                                                 \
      (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId, struct WGPUDeviceLostClosureC aCallback))          \
    X(bool, wgpu_server_device_create_shader_module,                                                              \
      (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId, WGPUShaderModuleId aModuleId,                      \
       const nsACString *aLabel, const nsCString *aCode, struct WGPUShaderModuleCompilationMessage *aOutMessage,  \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_device_create_buffer,                                                                     \
      (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId, WGPUBufferId aBufferId, const nsACString *aLabel,  \
       WGPUBufferAddress aSize, uint32_t aUsage, bool aMappedAtCreation, bool aShmAllocationFailed,               \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_buffer_map,                                                                               \
      (const struct WGPUGlobal *aGlobal, WGPUBufferId aBufferId, WGPUBufferAddress aStart,                        \
       WGPUBufferAddress aSize, enum WGPUHostMap aMapMode, struct WGPUBufferMapCallbackC aCallback,               \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(struct WGPUMappedBufferSlice, wgpu_server_buffer_get_mapped_range,                                          \
      (const struct WGPUGlobal *aGlobal, WGPUBufferId aBufferId, WGPUBufferAddress aStart,                        \
       WGPUBufferAddress aSize, struct WGPUErrorBuffer aErrorBuf))                                                \
    X(void, wgpu_server_buffer_unmap,                                                                             \
      (const struct WGPUGlobal *aGlobal, WGPUBufferId aBufferId, struct WGPUErrorBuffer aErrorBuf))               \
    X(void, wgpu_server_buffer_destroy, (const struct WGPUGlobal *aGlobal, WGPUBufferId aSelfId))                 \
    X(void, wgpu_server_buffer_drop, (const struct WGPUGlobal *aGlobal, WGPUBufferId aSelfId))                    \
    X(void *, wgpu_server_get_device_fence_handle, (const struct WGPUGlobal *aGlobal, WGPUDeviceId aDeviceId))    \
    X(void, wgpu_server_device_action,                                                                            \
      (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId, const struct WGPUByteBuf *aByteBuf,                \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_texture_action,                                                                           \
      (const struct WGPUGlobal *aGlobal, WGPUTextureId aSelfId, const struct WGPUByteBuf *aByteBuf,               \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_command_encoder_action,                                                                   \
      (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aSelfId, const struct WGPUByteBuf *aByteBuf,        \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_render_pass,                                                                              \
      (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aEncoderId, const struct WGPUByteBuf *aByteBuf,     \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_compute_pass,                                                                             \
      (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aEncoderId, const struct WGPUByteBuf *aByteBuf,     \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(void, wgpu_server_device_create_encoder,                                                                    \
      (const struct WGPUGlobal *aGlobal, WGPUDeviceId aSelfId, const struct WGPUCommandEncoderDescriptor *aDesc,  \
       WGPUCommandEncoderId aNewId, struct WGPUErrorBuffer aErrorBuf))                                            \
    X(void, wgpu_server_encoder_finish,                                                                           \
      (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aSelfId,                                            \
       const struct WGPUCommandBufferDescriptor *aDesc, struct WGPUErrorBuffer aErrorBuf))                        \
    X(void, wgpu_server_encoder_drop, (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aSelfId))           \
    X(void, wgpu_server_render_bundle_drop, (const struct WGPUGlobal *aGlobal, WGPURenderBundleId aSelfId))       \
    X(void, wgpu_server_encoder_copy_texture_to_buffer,                                                           \
      (const struct WGPUGlobal *aGlobal, WGPUCommandEncoderId aSelfId, const WGPUImageCopyTexture *aSource,       \
       WGPUBufferId aDstBuffer, const struct WGPUImageDataLayout *aDstLayout, const struct WGPUExtent3d *aSize,   \
       struct WGPUErrorBuffer aErrorBuf))                                                                         \
    X(uint64_t, wgpu_server_queue_submit,                                                                         \
      (const struct WGPUGlobal *aGlobal, WGPUQueueId aSelfId, const WGPUCommandBufferId *aCommandBufferIds,       \
       uintptr_t aCommandBufferIdLength, struct WGPUErrorBuffer aErrorBuf))                                       \
    X(void, wgpu_server_on_submitted_work_done,                                                                   \
      (const struct WGPUGlobal *aGlobal, WGPUQueueId aSelfId, struct WGPUSubmittedWorkDoneClosureC aCallback))    \
    X(void, wgpu_server_queue_write_action,                                                                       \
      (const struct WGPUGlobal *aGlobal, WGPUQueueId aSelfId, const struct WGPUByteBuf *aByteBuf,                 \
       const uint8_t *aData, uintptr_t aDataLength, struct WGPUErrorBuffer aErrorBuf))                            \
    X(void, wgpu_server_bind_group_layout_drop, (const struct WGPUGlobal *aGlobal, WGPUBindGroupLayoutId aSelfId)) \
    X(void, wgpu_server_pipeline_layout_drop, (const struct WGPUGlobal *aGlobal, WGPUPipelineLayoutId aSelfId))   \
    X(void, wgpu_server_bind_group_drop, (const struct WGPUGlobal *aGlobal, WGPUBindGroupId aSelfId))             \
    X(void, wgpu_server_shader_module_drop, (const struct WGPUGlobal *aGlobal, WGPUShaderModuleId aSelfId))       \
    X(void, wgpu_server_compute_pipeline_drop, (const struct WGPUGlobal *aGlobal, WGPUComputePipelineId aSelfId)) \
    X(void, wgpu_server_render_pipeline_drop, (const struct WGPUGlobal *aGlobal, WGPURenderPipelineId aSelfId))   \
    X(void, wgpu_server_texture_destroy, (const struct WGPUGlobal *aGlobal, WGPUTextureId aSelfId))               \
    X(void, wgpu_server_texture_drop, (const struct WGPUGlobal *aGlobal, WGPUTextureId aSelfId))                  \
    X(void, wgpu_server_texture_view_drop, (const struct WGPUGlobal *aGlobal, WGPUTextureViewId aSelfId))         \
    X(void, wgpu_server_sampler_drop, (const struct WGPUGlobal *aGlobal, WGPUSamplerId aSelfId))                  \
    X(void, wgpu_server_compute_pipeline_get_bind_group_layout,                                                   \
      (const struct WGPUGlobal *aGlobal, WGPUComputePipelineId aSelfId, uint32_t aIndex,                          \
       WGPUBindGroupLayoutId aAssignId, struct WGPUErrorBuffer aErrorBuf))                                        \
    X(void, wgpu_server_render_pipeline_get_bind_group_layout,                                                    \
      (const struct WGPUGlobal *aGlobal, WGPURenderPipelineId aSelfId, uint32_t aIndex,                           \
       WGPUBindGroupLayoutId aAssignId, struct WGPUErrorBuffer aErrorBuf))

// Declarations of the plain names (what Firefox C++ calls; --wrap redirects them).
#define W4B_DECLARE_PLAIN(ret, name, params) ret name params;
W4B_SERVER_FUNCTIONS(W4B_DECLARE_PLAIN)
#undef W4B_DECLARE_PLAIN

// Wrapper-private diagnostics (not part of the Firefox ABI).
struct w4b_wrap_stats {
    uint64_t host_handle;
    uint32_t pending_callbacks;   // map / work-done / lost closures not yet invoked
    uint32_t local_events;        // locally queued events awaiting the next poll
    uint32_t buffer_records;      // buffers with wrapper-side state
    uint32_t staging_ranges;      // live get_mapped_range staging allocations
    uint64_t staging_bytes;
    uint64_t hostcalls;
    uint64_t transport_errors;
    uint64_t callbacks_invoked;
    uint64_t events_unmatched;    // host events whose token has no pending closure
    uint64_t events_lost;         // POLL responses that did not fit (-ENOSPC)
    uint64_t polls;
    uint64_t ignored_errors;      // executor errors from calls that have no ErrorBuffer
};
int w4b_wrap_get_stats(const struct WGPUGlobal *global, struct w4b_wrap_stats *out);
// Global counters across all WGPUGlobals (for leak checks after delete).
void w4b_wrap_live_counts(uint32_t *globals, uint32_t *pending, uint32_t *buffers, uint32_t *staging);
// Encode AdapterInformation<String> (bincode) from an executor PACK_INFO payload.
// Returns a malloc'd buffer (*out) and its length, or 0 on a malformed payload.
size_t w4b_encode_adapter_info(uint64_t adapter_id, const uint8_t *payload, size_t payload_len, uint8_t **out);

#endif
