#ifndef LOWLAND_TEST_GPU_H
#define LOWLAND_TEST_GPU_H
#include <stddef.h>
#include <stdint.h>
enum gpu_op { GPU_HELLO, GPU_SHADER, GPU_BUFFER, GPU_PIPELINE, GPU_TARGET, GPU_DRAW, GPU_READBACK, GPU_DESTROY, GPU_CLOSE, GPU_CLEAR, GPU_SPIRV_SHADER, GPU_COMPUTE_PIPELINE, GPU_STORAGE_BUFFER, GPU_STORAGE_UPLOAD, GPU_COMPUTE_DISPATCH, GPU_STORAGE_READBACK,
  GPU_GRAPHICS_SHADER, GPU_GRAPHICS_PIPELINE, GPU_VERTEX_BUFFER, GPU_VERTEX_UPLOAD, GPU_GRAPHICS_TARGET, GPU_GRAPHICS_PASS, GPU_GRAPHICS_READBACK,
  GPU_UNIFORM_BUFFER, GPU_UNIFORM_UPLOAD, GPU_TEXTURE, GPU_TEXTURE_UPLOAD, GPU_SAMPLER, GPU_DEPTH_TARGET };
struct gpu_session { int fd; uint32_t sequence; };
/* Experimental transport, deliberately not a Vulkan/OpenGL/WebGPU-conformant API. */
int gpu_accept(struct gpu_session *session, unsigned port);
int gpu_call(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, void *reply, uint32_t capacity, uint32_t *received);
int gpu_resource(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, uint32_t *id);
void gpu_close(struct gpu_session *session);
#endif
