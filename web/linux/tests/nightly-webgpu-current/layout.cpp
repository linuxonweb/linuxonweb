// Exact cbindgen header is frozen by prepare.py; nsString remains opaque here.
#include <stdint.h>
#include <stddef.h>
#include <time.h>
#define WGPU_FUNC
#define WGPU_INLINE inline
#include "wgpu_ffi_generated.h"
static_assert(sizeof(void*) == 4);
static_assert(sizeof(time_t) == 8);
static_assert(sizeof(WGPUBufferId) == 8);
static_assert(sizeof(WGPUByteBuf) == 12);
static_assert(offsetof(WGPUByteBuf, len) == 4);
static_assert(offsetof(WGPUByteBuf, capacity) == 8);
static_assert(sizeof(WGPUBufferMapClosure) == 8);
static_assert(offsetof(WGPUBufferMapClosure, user_data) == 4);
static_assert(sizeof(WGPUFfiBufferDescriptor) == 24);
static_assert(offsetof(WGPUFfiBufferDescriptor, size) == 8);
static_assert(offsetof(WGPUFfiBufferDescriptor, usage) == 16);
static_assert(offsetof(WGPUFfiBufferDescriptor, mapped_at_creation) == 20);
extern "C" {
uint32_t layout[] = {sizeof(void*),sizeof(time_t),sizeof(WGPUBufferId),sizeof(WGPUByteBuf),alignof(WGPUByteBuf),offsetof(WGPUByteBuf,len),offsetof(WGPUByteBuf,capacity),sizeof(WGPUBufferMapClosure),alignof(WGPUBufferMapClosure),offsetof(WGPUBufferMapClosure,user_data),sizeof(WGPUFfiBufferDescriptor),alignof(WGPUFfiBufferDescriptor),offsetof(WGPUFfiBufferDescriptor,size),offsetof(WGPUFfiBufferDescriptor,usage),offsetof(WGPUFfiBufferDescriptor,mapped_at_creation),WGPUHostMap_Read,WGPUHostMap_Write,WGPUBufferMapAsyncStatus_Success};
uint32_t* get_layout(){return layout;}
uint32_t get_layout_count(){return sizeof(layout)/4;}
}
extern "C" {
static uint8_t map_golden[48];
static void put32(uint8_t *p,uint32_t n){for(int i=0;i<4;i++)p[i]=(n>>(8*i))&255;}
static void put64(uint8_t *p,uint64_t n){for(int i=0;i<8;i++)p[i]=(n>>(8*i))&255;}
uint8_t* get_map_golden(){
 // Current fixed-int Message::BufferMap tag9; Id is SerialId::Id tag0,index,epoch.
 put32(map_golden,9);put32(map_golden+4,0);put32(map_golden+8,1);put32(map_golden+12,1);
 put32(map_golden+16,0);put32(map_golden+20,2);put32(map_golden+24,1);
 put32(map_golden+28,1);put64(map_golden+32,8);put64(map_golden+40,16);return map_golden;
}
static uint32_t callbackValue;
static void map_callback(uint8_t *user, WGPUBufferMapAsyncStatus status){*reinterpret_cast<uint32_t*>(user)+=11+static_cast<uint32_t>(status);}
uint32_t invoke_map_callback(uint32_t initial){callbackValue=initial;WGPUBufferMapClosure c={map_callback,reinterpret_cast<uint8_t*>(&callbackValue)};c.callback(c.user_data,WGPUBufferMapAsyncStatus_Success);return callbackValue;}
}
