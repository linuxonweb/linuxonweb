/* Compile-only ABI client. Never link or execute this as a driver/test runtime.
 * Declarations come exclusively from the pinned official generated headers.
 * This is an inferred clear/readback subset, not a traced ANGLE call inventory.
 */
#include <stddef.h>
#include <stdint.h>
#include <dawn/dawn_proc_table.h>

#define PROC(member, type) \
    _Static_assert(_Generic(((DawnProcTable *)0)->member, type: 1, default: 0), \
                   "unexpected proc member type: " #member)
PROC(deviceGetLimits, WGPUProcDeviceGetLimits);
PROC(deviceGetQueue, WGPUProcDeviceGetQueue);
PROC(deviceCreateTexture, WGPUProcDeviceCreateTexture);
PROC(textureCreateView, WGPUProcTextureCreateView);
PROC(deviceCreateBuffer, WGPUProcDeviceCreateBuffer);
PROC(deviceCreateCommandEncoder, WGPUProcDeviceCreateCommandEncoder);
PROC(commandEncoderBeginRenderPass, WGPUProcCommandEncoderBeginRenderPass);
PROC(renderPassEncoderEnd, WGPUProcRenderPassEncoderEnd);
PROC(commandEncoderCopyTextureToBuffer, WGPUProcCommandEncoderCopyTextureToBuffer);
PROC(commandEncoderFinish, WGPUProcCommandEncoderFinish);
PROC(queueSubmit, WGPUProcQueueSubmit);
PROC(bufferMapAsync, WGPUProcBufferMapAsync);
PROC(instanceWaitAny, WGPUProcInstanceWaitAny);
PROC(bufferGetConstMappedRange, WGPUProcBufferGetConstMappedRange);
PROC(bufferUnmap, WGPUProcBufferUnmap);
PROC(instanceAddRef, WGPUProcInstanceAddRef);
PROC(instanceRelease, WGPUProcInstanceRelease);
PROC(deviceAddRef, WGPUProcDeviceAddRef);
PROC(deviceRelease, WGPUProcDeviceRelease);
PROC(queueRelease, WGPUProcQueueRelease);
PROC(textureRelease, WGPUProcTextureRelease);
PROC(textureViewRelease, WGPUProcTextureViewRelease);
PROC(bufferRelease, WGPUProcBufferRelease);
PROC(renderPassEncoderRelease, WGPUProcRenderPassEncoderRelease);
PROC(commandEncoderRelease, WGPUProcCommandEncoderRelease);
PROC(commandBufferRelease, WGPUProcCommandBufferRelease);

_Static_assert(sizeof(((WGPUFuture *)0)->id) == 8, "future IDs are uint64");
_Static_assert(sizeof(((DawnProcTable *)0)->version) == 20, "table version ABI");
#if defined(__wasm32__)
_Static_assert(sizeof(void *) == 4 && sizeof(size_t) == 4, "wasm32 pointers");
_Static_assert(sizeof(WGPUDevice) == 4, "opaque guest handle is pointer-sized");
#endif

struct MapState { WGPUMapAsyncStatus status; WGPUBool completed; };
static void mapped(WGPUMapAsyncStatus status, WGPUStringView message,
                   void *userdata1
#ifndef DAWN_ABI_NEGATIVE_CALLBACK
                   , void *userdata2
#endif
                   ) {
    struct MapState *state = userdata1;
    (void)message;
#ifndef DAWN_ABI_NEGATIVE_CALLBACK
    (void)userdata2;
#endif
    state->status = status;
    state->completed = 1;
}

/* The compiler verifies real table calls, descriptor fields, by-value future
 * and callback-info ABI, userdata slots, mapped-range pointer and cleanup types.
 * No backing implementation or correctness of asynchronous behavior is claimed.
 */
WGPUWaitStatus dawn_abi_compile_only(const DawnProcTable *p, WGPUInstance instance,
                                    WGPUDevice device) {
    WGPUBufferMapCallback callback = mapped;
    struct MapState state = {0};
    WGPULimits limits = WGPU_LIMITS_INIT;
    WGPUStatus limit_status = p->deviceGetLimits(device, &limits);
    (void)limit_status;
    p->instanceAddRef(instance);
    p->deviceAddRef(device);
    WGPUQueue queue = p->deviceGetQueue(device);
    WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
    td.dimension = WGPUTextureDimension_2D;
    td.size = (WGPUExtent3D){1, 1, 1};
    td.format = WGPUTextureFormat_RGBA8Unorm;
    td.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    WGPUTexture texture = p->deviceCreateTexture(device, &td);
    WGPUTextureView view = p->textureCreateView(texture, NULL);
    WGPUBufferDescriptor bd = WGPU_BUFFER_DESCRIPTOR_INIT;
    bd.size = 256;
    bd.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    WGPUBuffer buffer = p->deviceCreateBuffer(device, &bd);
    WGPUCommandEncoder encoder = p->deviceCreateCommandEncoder(device, NULL);
    WGPURenderPassColorAttachment color = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    color.view = view;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = (WGPUColor){0.25, 0.5, 0.75, 1.0};
    WGPURenderPassDescriptor pass_desc = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
    pass_desc.colorAttachmentCount = 1;
    pass_desc.colorAttachments = &color;
    WGPURenderPassEncoder pass = p->commandEncoderBeginRenderPass(encoder, &pass_desc);
    p->renderPassEncoderEnd(pass);
    WGPUTexelCopyTextureInfo source = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    source.texture = texture;
    WGPUTexelCopyBufferInfo destination = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    destination.buffer = buffer;
    destination.layout.bytesPerRow = 256;
    destination.layout.rowsPerImage = 1;
    WGPUExtent3D extent = {1, 1, 1};
    p->commandEncoderCopyTextureToBuffer(encoder, &source, &destination, &extent);
    WGPUCommandBuffer command = p->commandEncoderFinish(encoder, NULL);
    p->queueSubmit(queue, 1, &command);
    WGPUBufferMapCallbackInfo callback_info = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    callback_info.mode = WGPUCallbackMode_WaitAnyOnly;
    callback_info.callback = callback;
    callback_info.userdata1 = &state;
    callback_info.userdata2 = NULL;
    WGPUFuture future = p->bufferMapAsync(buffer, WGPUMapMode_Read, 0, 256, callback_info);
    WGPUFutureWaitInfo wait = WGPU_FUTURE_WAIT_INFO_INIT;
    wait.future = future;
    WGPUWaitStatus status = p->instanceWaitAny(instance, 1, &wait, UINT64_C(0));
    const void *readback = p->bufferGetConstMappedRange(buffer, 0, 256);
    (void)readback;
    p->bufferUnmap(buffer);
    p->commandBufferRelease(command);
    p->renderPassEncoderRelease(pass);
    p->commandEncoderRelease(encoder);
    p->bufferRelease(buffer);
    p->textureViewRelease(view);
    p->textureRelease(texture);
    p->queueRelease(queue);
    p->deviceRelease(device);
    p->instanceRelease(instance);
    return status;
}
