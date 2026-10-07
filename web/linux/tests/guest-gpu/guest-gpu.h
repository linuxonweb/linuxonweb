#ifndef LOWLAND_TEST_GPU_H
#define LOWLAND_TEST_GPU_H
#include <stddef.h>
#include <stdint.h>
#include <pthread.h>
enum gpu_op { GPU_HELLO, GPU_SHADER, GPU_BUFFER, GPU_PIPELINE, GPU_TARGET, GPU_DRAW, GPU_READBACK, GPU_DESTROY, GPU_CLOSE, GPU_CLEAR, GPU_SPIRV_SHADER, GPU_COMPUTE_PIPELINE, GPU_STORAGE_BUFFER, GPU_STORAGE_UPLOAD, GPU_COMPUTE_DISPATCH, GPU_STORAGE_READBACK,
  GPU_GRAPHICS_SHADER, GPU_GRAPHICS_PIPELINE, GPU_VERTEX_BUFFER, GPU_VERTEX_UPLOAD, GPU_GRAPHICS_TARGET, GPU_GRAPHICS_PASS, GPU_GRAPHICS_READBACK,
  GPU_UNIFORM_BUFFER, GPU_UNIFORM_UPLOAD, GPU_TEXTURE, GPU_TEXTURE_UPLOAD, GPU_SAMPLER, GPU_DEPTH_TARGET, GPU_GRAPHICS_READBACK_RANGE, GPU_PRESENT, GPU_BLIT };
/* fd >= 0: virtio-vsock stream; hc > 0: gpu_hostcall session (default when the
 * host provides it; GUEST_GPU_TRANSPORT=vsock|hostcall forces one). */
struct gpu_session { int fd; uint32_t sequence; int32_t hc; pthread_mutex_t call_lock; int lock_ready; };
/* Experimental transport, deliberately not a Vulkan/OpenGL/WebGPU-conformant API. */
int gpu_accept(struct gpu_session *session, unsigned port);
int gpu_call(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, void *reply, uint32_t capacity, uint32_t *received);
int gpu_resource(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, uint32_t *id);
void gpu_close(struct gpu_session *session);
#endif
