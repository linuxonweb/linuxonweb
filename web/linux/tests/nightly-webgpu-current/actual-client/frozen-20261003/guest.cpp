#include "mozilla/webgpu/ffi/wgpu.h"
#include "mozilla/ipc/ByteBuf.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
using namespace mozilla::webgpu;
using namespace mozilla::webgpu::ffi;
static_assert(sizeof(void*) == 4 && sizeof(WGPUBufferId) == 8);
static void require(bool ok, const char* what) {
  if (!ok) { fprintf(stderr, "CURRENT_GPU_CLIENT_FAIL %s\n", what); exit(1); }
}
#define CHECK(x) require(bool(x), #x)
struct State {
  WGPUAdapterId adapter{};
  WGPUDeviceQueueId deviceQueue{};
  WGPUBufferId destination{};
  WGPULimits limits{};
  unsigned queued{}, adapterCallbacks{}, deviceCallbacks{}, mapCallbacks{}, workCallbacks{};
  bool adapterPending{}, devicePending{}, mapPending{}, workPending{}, published{};
  uint32_t mapped[16]{};
  char adapterName[256]{};
};
static State state;
static WGPUWebGPUChildPtr owner() { return reinterpret_cast<WGPUWebGPUChildPtr>(&state); }
static State& owned(WGPUWebGPUChildPtr p) { CHECK(p == owner()); return state; }
static void queued(WGPUWebGPUChildPtr p) { ++owned(p).queued; }
namespace mozilla::webgpu::ffi {
extern "C" {
void wgpu_child_send_messages(WGPUWebGPUChildPtr p, uint32_t, WGPUByteBuf b) {
  mozilla::ipc::ByteBuf storage(b.data, b.len, b.capacity);
  owned(p); require(false, "unexpected automatic queue flush");
}
void wgpu_child_resolve_request_adapter_promise(WGPUWebGPUChildPtr p, WGPUAdapterId id,
                                               const WGPUAdapterInformation* info) {
  auto& s = owned(p);
  CHECK(s.adapterPending && !s.adapterCallbacks && id == s.adapter && info && info->id == id);
  CHECK(info->limits.max_buffer_size >= 64);
  s.limits = info->limits;
  NS_ConvertUTF16toUTF8 name(info->name);
  CHECK(name.Length() < sizeof(s.adapterName));
  memcpy(s.adapterName, name.get(), name.Length() + 1);
  s.adapterPending = false; ++s.adapterCallbacks;
}
void wgpu_child_resolve_request_device_promise(WGPUWebGPUChildPtr p, WGPUDeviceId d,
                                              WGPUQueueId q, const nsCString* error) {
  auto& s = owned(p);
  CHECK(s.devicePending && !s.deviceCallbacks && !error && d == s.deviceQueue.device && q == s.deviceQueue.queue);
  s.devicePending = false; ++s.deviceCallbacks;
}
void wgpu_child_resolve_buffer_map_promise(WGPUWebGPUChildPtr p, WGPUBufferId b, bool writable,
                                         uint64_t offset, uint64_t size, const nsCString* error) {
  auto& s = owned(p);
  CHECK(s.mapPending && !s.mapCallbacks && b == s.destination && !writable && !offset && size == 64 && !error);
  CHECK(s.published);
  for (unsigned i = 0; i < 16; ++i) CHECK(s.mapped[i] == i * 11 + 2);
  s.mapPending = false; ++s.mapCallbacks;
}
void wgpu_child_resolve_on_submitted_work_done_promise(WGPUWebGPUChildPtr p, WGPUQueueId q) {
  auto& s = owned(p); CHECK(s.workPending && !s.workCallbacks && q == s.deviceQueue.queue);
  s.workPending = false; ++s.workCallbacks;
}
void wgpu_child_resolve_pop_error_scope_promise(WGPUWebGPUChildPtr, WGPUDeviceId, WGPUFfiPopErrorScopeResultType, const nsCString*) { require(false, "unexpected error scope"); }
void wgpu_child_resolve_create_pipeline_promise(WGPUWebGPUChildPtr, WGPURawId, bool, bool, const nsCString*) { require(false, "unexpected pipeline"); }
void wgpu_child_resolve_create_shader_module_promise(WGPUWebGPUChildPtr, WGPUShaderModuleId, WGPUFfiSlice_FfiShaderModuleCompilationMessage) { require(false, "unexpected shader"); }
void wgpu_child_handle_uncaptured_error(WGPUWebGPUChildPtr, WGPUDeviceId, WGPUFfiErrorFilter, const nsCString*) { require(false, "uncaptured GPU error"); }
void wgpu_child_handle_device_lost(WGPUWebGPUChildPtr, WGPUDeviceId, WGPUFfiDeviceLostReason, const nsCString*) { require(false, "device lost"); }
}
}
static uint32_t read32(const uint8_t* p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
static long hostcall(long op, long a = 0, long b = 0, long c = 0, long d = 0) {
  return syscall(0x6a470001, op, a, b, c, d, 0);
}
static unsigned totalMessages;
static void flush(WGPUClient* client, long session, unsigned expectedMessages,
                  const void* data = nullptr, uint32_t dataBytes = 0, bool map = false) {
  mozilla::ipc::ByteBuf outgoing;
  unsigned count = wgpu_client_get_queued_messages(client, ToFFI(&outgoing));
  CHECK(count == expectedMessages && outgoing.mLen && outgoing.mLen <= 1048576);
  totalMessages += count;
  uint32_t envelope[] = {uint32_t(uintptr_t(outgoing.mData)), uint32_t(outgoing.mLen), count,
                         uint32_t(uintptr_t(data)), dataBytes};
  uint8_t response[16384];
  long length = hostcall(0x51, session, long(uintptr_t(envelope)), long(uintptr_t(response)), sizeof(response));
  CHECK(length >= 8 && length <= long(sizeof(response)));
  uint32_t replies = read32(response), cursor = 4;
  struct Reply { uint32_t offset, length; } messages[16];
  CHECK(replies <= 16);
  for (unsigned i = 0; i < replies; ++i) {
    CHECK(cursor + 4 <= unsigned(length)); uint32_t n = read32(response + cursor); cursor += 4;
    CHECK(n && n <= unsigned(length) - cursor); messages[i] = {cursor, n}; cursor += n;
  }
  CHECK(cursor + 4 <= unsigned(length)); unsigned maps = read32(response + cursor); cursor += 4;
  CHECK(maps == (map ? 1u : 0u));
  if (map) {
    CHECK(state.mapPending && !state.published && cursor + 4 <= unsigned(length));
    CHECK(read32(response + cursor) == sizeof(state.mapped)); cursor += 4;
    CHECK(cursor + sizeof(state.mapped) <= unsigned(length));
    memcpy(state.mapped, response + cursor, sizeof(state.mapped)); cursor += sizeof(state.mapped);
    state.published = true;
  }
  CHECK(cursor == unsigned(length));
  // The real Rust client borrows each complete ServerMessage; this view never owns the response stack.
  for (unsigned i = 0; i < replies; ++i) {
    WGPUByteBuf borrowed{response + messages[i].offset, messages[i].length, 0};
    wgpu_client_receive_server_message(client, &borrowed);
  }
}
int main() {
  FILE* protocolFile = fopen("/current-gpu/protocol.txt", "rb"); CHECK(protocolFile);
  char protocol[256]; unsigned protocolBytes = fread(protocol, 1, sizeof(protocol), protocolFile);
  CHECK(protocolBytes > 40 && protocolBytes < sizeof(protocol)); CHECK(fclose(protocolFile) == 0);
  bool gl = getenv("CURRENT_GPU_WEBGL") != nullptr;
  long session = hostcall(0x50, long(uintptr_t(protocol)), protocolBytes, gl); CHECK(session > 0);
  WGPUClient* client = wgpu_client_new(owner(), queued); CHECK(client);
  state.adapterPending = true;
  state.adapter = wgpu_client_request_adapter(client, WGPUPowerPreference_HighPerformance, false);
  CHECK(state.adapter); flush(client, session, 1); CHECK(state.adapterCallbacks == 1 && !state.adapterPending);
  WGPUFfiDeviceDescriptor device{}; device.required_limits = state.limits;
  state.devicePending = true; state.deviceQueue = wgpu_client_request_device(client, state.adapter, &device);
  CHECK(state.deviceQueue.device == state.adapter && state.deviceQueue.queue == state.adapter);
  flush(client, session, 1); CHECK(state.deviceCallbacks == 1 && !state.devicePending);
  WGPUFfiBufferDescriptor buffer{}; buffer.size = 64;
  buffer.usage = WGPUBufferUsages_COPY_SRC | WGPUBufferUsages_COPY_DST;
  WGPUBufferId source = wgpu_client_create_buffer(client, state.deviceQueue.device, &buffer, 0);
  buffer.usage = WGPUBufferUsages_COPY_DST | WGPUBufferUsages_MAP_READ;
  state.destination = wgpu_client_create_buffer(client, state.deviceQueue.device, &buffer, 0);
  CHECK(source && state.destination && source != state.destination);
  uint32_t input[16]; for (unsigned i = 0; i < 16; ++i) input[i] = 11 * i + 2;
  wgpu_queue_write_buffer_inline(client, state.deviceQueue.queue, source, 0, 0);
  WGPUFfiCommandEncoderDescriptor encoderDescriptor{};
  auto encoder = wgpu_client_create_command_encoder(client, state.deviceQueue.device, &encoderDescriptor);
  wgpu_client_command_encoder_copy_buffer_to_buffer(client, encoder, source, 0, state.destination, 0, 64);
  WGPUFfiCommandBufferDescriptor commandDescriptor{};
  auto command = wgpu_client_command_encoder_finish(client, encoder, &commandDescriptor);
  wgpu_client_queue_submit(client, state.deviceQueue.queue, {&command, 1}, {nullptr, 0}, {nullptr, 0});
  state.workPending = true;
  wgpu_client_on_submitted_work_done(client, state.deviceQueue.device, state.deviceQueue.queue);
  flush(client, session, 8, input, sizeof(input)); CHECK(state.workCallbacks == 1 && !state.workPending);
  state.mapPending = true;
  wgpu_client_buffer_map(client, state.deviceQueue.device, state.destination, 1, 0, 64);
  flush(client, session, 1, nullptr, 0, true); CHECK(state.mapCallbacks == 1 && !state.mapPending);
  wgpu_client_buffer_unmap(client, state.deviceQueue.device, state.destination, false);
  flush(client, session, 1);
  { mozilla::ipc::ByteBuf empty; CHECK(!wgpu_client_get_queued_messages(client, ToFFI(&empty)) && !empty.mLen); }
  CHECK(!state.adapterPending && !state.devicePending && !state.mapPending && !state.workPending);
  wgpu_client_delete(client); CHECK(hostcall(0x52, session) == 0);
  printf("CURRENT_GPU_CLIENT_COMPLETE backend=%s words=16 failures=0 adapter_callbacks=1 device_callbacks=1 map_callbacks=1 work_callbacks=1 actual_messages=%u queued=%u adapter=%s\n", gl ? "webgl" : "auto", totalMessages, state.queued, state.adapterName);
  puts("CURRENT_GPU_EXIT status=0"); return 0;
}
