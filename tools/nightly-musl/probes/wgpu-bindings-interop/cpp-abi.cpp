#include "mozilla/webgpu/ffi/wgpu.h"
#include <type_traits>
using namespace mozilla::webgpu;
static_assert(std::is_same<decltype(&ffi::wgpu_vkimage_create_with_dma_buf), ffi::WGPUDMABufInfo (*)(const ffi::WGPUGlobal*,ffi::WGPUDeviceId,uint32_t,uint32_t,int32_t*)>::value);
static_assert(std::is_same<decltype(&ffi::wgpu_vksemaphore_create_signal_semaphore), ffi::WGPUVkSemaphoreHandle (*)(const ffi::WGPUGlobal*,ffi::WGPUQueueId,int32_t*)>::value);
static_assert(std::is_same<ffi::WGPUVkSemaphoreHandle,uint64_t>::value);
extern "C" int interop_failure_contract(const ffi::WGPUGlobal* global) {
 int32_t fd=17;const auto info=ffi::wgpu_vkimage_create_with_dma_buf(global,0,1,1,&fd);
 if(info.is_valid || fd!=-1) return 0;
 fd=17;const auto semaphore=ffi::wgpu_vksemaphore_create_signal_semaphore(global,0,&fd);
 return semaphore==0 && fd==-1;
}
