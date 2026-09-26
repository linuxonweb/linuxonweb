#ifndef LOWLAND_TEST_GPU_H
#define LOWLAND_TEST_GPU_H
#include <stddef.h>
#include <stdint.h>
enum gpu_op { GPU_HELLO, GPU_SHADER, GPU_BUFFER, GPU_PIPELINE, GPU_TARGET, GPU_DRAW, GPU_READBACK, GPU_DESTROY, GPU_CLOSE, GPU_CLEAR };
struct gpu_session { int fd; uint32_t sequence; };
/* Experimental transport, deliberately not a Vulkan/OpenGL/WebGPU-conformant API. */
int gpu_accept(struct gpu_session *session, unsigned port);
int gpu_call(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, void *reply, uint32_t capacity, uint32_t *received);
int gpu_resource(struct gpu_session *session, enum gpu_op op, const void *bytes, uint32_t length, uint32_t *id);
void gpu_close(struct gpu_session *session);
#endif
