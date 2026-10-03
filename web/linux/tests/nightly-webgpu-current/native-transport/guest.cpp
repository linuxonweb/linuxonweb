#define _DEFAULT_SOURCE
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#define WGPU_FUNC
#define WGPU_INLINE inline
#include "wgpu_ffi_generated.h"
static_assert(sizeof(void*)==4&&sizeof(time_t)==8&&sizeof(WGPUBufferId)==8);
static_assert(sizeof(WGPUBufferMapClosure)==8&&offsetof(WGPUBufferMapClosure,user_data)==4);
#define REQUIRE(x) do{if(!(x)){fprintf(stderr,"CURRENT_GPU_FAIL line=%d expression=%s errno=%d\n",__LINE__,#x,errno);return 1;}}while(0)
static uint32_t read32(const uint8_t*p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static void put32(uint8_t*p,uint32_t v){for(int i=0;i<4;i++)p[i]=v>>(i*8);}static void put64(uint8_t*p,uint64_t v){for(int i=0;i<8;i++)p[i]=v>>(i*8);}
static void id(uint8_t*p,uint32_t index){put32(p,0);put32(p+4,index);put32(p+8,1);}
static long hc(long op,long a=0,long b=0,long c=0,long d=0,long e=0){return syscall(0x6a470001,op,a,b,c,d,e);}
static uint8_t*file(const char*name,uint32_t*n){char path[128];snprintf(path,sizeof(path),"/current-gpu/%s",name);FILE*f=fopen(path,"rb");if(!f)return nullptr;fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);if(size<0||size>1048576){fclose(f);return nullptr;}auto*p=(uint8_t*)malloc(size+1);if(!p){fclose(f);return nullptr;}*n=size;if(fread(p,1,size,f)!=(size_t)size){free(p);p=nullptr;}fclose(f);return p;}
static long dispatch(long s,const uint8_t*bytes,uint32_t size,uint32_t count,const uint8_t*data,uint32_t dataSize,uint8_t*out,uint32_t cap){uint32_t envelope[]={(uint32_t)(uintptr_t)bytes,size,count,(uint32_t)(uintptr_t)data,dataSize};return hc(0x51,s,(long)(uintptr_t)envelope,(long)(uintptr_t)out,cap);}
struct State{uint32_t called;WGPUBufferMapAsyncStatus status;};static void callback(uint8_t*user,WGPUBufferMapAsyncStatus status){auto*s=(State*)user;s->called++;s->status=status;}
static int run(long session,const char*fixture,bool compute){uint32_t size=0;uint8_t*bytes=file(fixture,&size);REQUIRE(bytes);uint32_t inputs[16];for(uint32_t i=0;i<16;i++)inputs[i]=11*i+2;uint8_t out[4096];long n=dispatch(session,bytes,size,compute?22:13,(uint8_t*)inputs,sizeof(inputs),out,sizeof(out));free(bytes);REQUIRE(n>8);uint32_t rows=read32(out),cursor=4,queue=0;REQUIRE(rows==(compute?7u:5u));for(uint32_t i=0;i<rows;i++){REQUIRE(cursor+4<=(uint32_t)n);uint32_t len=read32(out+cursor);cursor+=4;REQUIRE(cursor+len<=(uint32_t)n);if(read32(out+cursor)==7){uint8_t golden[16]={};put32(golden,7);id(golden+4,3);REQUIRE(len==16&&!memcmp(out+cursor,golden,16));queue++;}cursor+=len;}REQUIRE(queue==1&&cursor+4==(uint32_t)n&&read32(out+cursor)==0);
 uint8_t map[48]={};put32(map,9);id(map+4,2);id(map+16,5);put32(map+28,1);put64(map+32,0);put64(map+40,64);
 State state={0,WGPUBufferMapAsyncStatus_Error};volatile WGPUBufferMapClosure closure={callback,(uint8_t*)&state};REQUIRE(state.called==0);
 n=dispatch(session,map,sizeof(map),1,nullptr,0,out,sizeof(out));REQUIRE(n==117&&read32(out)==1&&read32(out+4)==37);uint8_t response[37]={};put32(response,6);id(response+4,5);put32(response+16,0);response[20]=0;put64(response+21,0);put64(response+29,64);REQUIRE(!memcmp(out+8,response,37));REQUIRE(read32(out+45)==1&&read32(out+49)==64);
 closure.callback(closure.user_data,WGPUBufferMapAsyncStatus_Success);REQUIRE(state.called==1&&state.status==WGPUBufferMapAsyncStatus_Success);
 for(uint32_t i=0;i<16;i++)REQUIRE(read32(out+53+i*4)==inputs[i]*(compute?3:1)+(compute?7:0));
 uint8_t unmap[29]={};put32(unmap,10);id(unmap+4,2);id(unmap+16,5);n=dispatch(session,unmap,sizeof(unmap),1,nullptr,0,out,sizeof(out));REQUIRE(n==8&&read32(out)==0&&read32(out+4)==0);
 printf("CURRENT_GPU_COMPLETE kind=%s values=16 failures=0 queue_callbacks=%u map_callbacks=%u map_response_bytes=37 mapped_bytes=64\n",compute?"compute":"copy",queue,state.called);fflush(stdout);return 0;}
int main(){uint32_t size=0;uint8_t*protocol=file("protocol.txt",&size);REQUIRE(protocol&&size>40);int gl=getenv("CURRENT_GPU_WEBGL")!=nullptr;uint8_t out[4096];REQUIRE(hc(0x50,(long)(uintptr_t)"wrong",5,gl)==-1&&errno==EIO);long s=hc(0x50,(long)(uintptr_t)protocol,size,gl);REQUIRE(s>0);REQUIRE(run(s,gl?"copy-gl.bin":"copy.bin",false)==0);REQUIRE(hc(0x52,s)==0);REQUIRE(dispatch(s,nullptr,0,0,nullptr,0,out,sizeof(out))==-1&&errno==EIO);
 if(!gl){s=hc(0x50,(long)(uintptr_t)protocol,size,0);REQUIRE(s>0);REQUIRE(run(s,"compute.bin",true)==0);REQUIRE(hc(0x52,s)==0);}
 s=hc(0x50,(long)(uintptr_t)protocol,size,gl);REQUIRE(s>0);uint32_t staleSize=0;uint8_t*stale=file("stale.bin",&staleSize);REQUIRE(stale);REQUIRE(dispatch(s,stale,staleSize,1,nullptr,0,out,sizeof(out))==-1&&errno==EIO);free(stale);REQUIRE(dispatch(s,nullptr,0,0,nullptr,0,out,sizeof(out))==-1&&errno==EIO);REQUIRE(hc(0x52,s)==0);s=hc(0x50,(long)(uintptr_t)protocol,size,gl);REQUIRE(s>0);uint8_t unsupported[16]={};put32(unsupported,20);id(unsupported+4,2);REQUIRE(dispatch(s,unsupported,sizeof(unsupported),1,nullptr,0,out,sizeof(out))==-1&&errno==EIO);REQUIRE(dispatch(s,nullptr,0,0,nullptr,0,out,sizeof(out))==-1&&errno==EIO);REQUIRE(hc(0x52,s)==0);free(protocol);
 uint32_t stats[11]={};REQUIRE(syscall(0x6a470002,stats)==0);printf("CURRENT_GPU_TRANSPORT backend=%s hostcall_calls=%u thread_calls=%u kernel_yields=%u protocol_rejected=1 closed_rejected=1 stale_device_rejected=1 poisoned_rejected=1 unsupported_destroy_device_rejected=1\n",gl?"webgl":"auto",stats[5],stats[8],stats[10]);puts("CURRENT_GPU_EXIT status=0");return 0;}
