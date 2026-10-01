#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE /* syscall() under -std=c11 */
#endif
#include "guest-gpu.h"
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/syscall.h>
/* Linux UAPI shape: the libc sysroot need not ship linux/vm_sockets.h. */
struct vm_address { unsigned short family, reserved; unsigned port, cid; unsigned char flags, zero[3]; };
_Static_assert(sizeof(struct vm_address) == 16, "vsock address ABI");
#ifndef AF_VSOCK
#define AF_VSOCK 40
#endif
#define MAGIC 0x31555047u
static void put32(unsigned char *p, uint32_t x) { for (unsigned i=0;i<4;i++) p[i]=(unsigned char)(x>>(8*i)); }
static uint32_t get32(const unsigned char *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static int all(int fd, void *p, size_t n, int sending) {
  unsigned char *b=p;
  while(n) { ssize_t r=sending ? write(fd,b,n) : read(fd,b,n); if(r<0 && errno==EINTR) continue; if(r<=0) return -1; b+=r; n-=(size_t)r; }
  return 0;
}
static int poisoned(struct gpu_session *s) { gpu_close(s); errno=EPROTO; return -1; }
/* gpu_hostcall channel (web/linux/dist/guest-gpu-vk.js): private syscall, same protocol bytes. */
#define GPU_HC_CALL 0x6a470001L
#define HC_VK_OPEN 0x20
#define HC_VK_CALL 0x21
#define HC_VK_CLOSE 0x22
static long hostcall(long op, long a0, long a1, long a2, long a3, long a4) {
  long r=syscall(GPU_HC_CALL,op,a0,a1,a2,a3,a4);
  return r<0 ? -errno : r;
}
static int hostcall_open(struct gpu_session *s) {
  const char *backend=getenv("GUEST_GPU_BACKEND");
  long flags=backend && !strcmp(backend,"webgl") ? 1 : backend && !strcmp(backend,"webgpu") ? 2 : 0;
  long r=hostcall(HC_VK_OPEN,flags,0,0,0,0);
  if(r<=0) { errno=r<0 ? (int)-r : EPROTO; return -1; }
  s->hc=(int32_t)r; return 0;
}
int gpu_accept(struct gpu_session *s, unsigned port) {
  s->fd=-1; s->sequence=0; s->hc=0;
  const char *transport=getenv("GUEST_GPU_TRANSPORT");
  if(!transport || strcmp(transport,"vsock")) {
    if(!hostcall_open(s)) { puts("GUEST_GPU_HOSTCALL"); fflush(stdout); return 0; }
    if(transport && !strcmp(transport,"hostcall")) return -1;
  }
  int listener=socket(AF_VSOCK,SOCK_STREAM,0); if(listener<0) return -1;
  struct vm_address address={.family=AF_VSOCK,.port=port,.cid=0xffffffffu};
  if(bind(listener,(struct sockaddr *)&address,sizeof(address)) || listen(listener,1)) { close(listener); return -1; }
  puts("GUEST_GPU_LISTENING"); fflush(stdout);
  s->fd=accept(listener,NULL,NULL); close(listener); return s->fd<0 ? -1 : 0;
}
int gpu_call(struct gpu_session *s, enum gpu_op op, const void *data, uint32_t length, void *reply, uint32_t capacity, uint32_t *received) {
  if(!s || (s->fd<0 && s->hc<=0) || op<GPU_HELLO || op>GPU_DEPTH_TARGET || !received || (!reply && capacity) || length>1048576 || (!data && length) || s->sequence==0xffffffffu) { errno=EINVAL; return -1; }
  *received=0;
  unsigned char h[16]={0}, status[4]; uint32_t seq=++s->sequence;
  put32(h,MAGIC); h[4]=1; h[6]=(unsigned char)op; put32(h+8,seq); put32(h+12,length);
  if(s->hc>0) {
    unsigned char io[20]; memcpy(io,h,16); memset(io+16,0,4);
    long r=hostcall(HC_VK_CALL,s->hc,(long)(uintptr_t)io,(long)(uintptr_t)data,(long)(uintptr_t)reply,(long)capacity);
    if(r) { errno=(int)-r; return poisoned(s); }
    memcpy(h,io,16); memcpy(status,io+16,4);
    uint32_t size=get32(h+12);
    if(get32(h)!=MAGIC || h[4]!=1 || h[5] || h[6]!=(unsigned)op || h[7]!=0x80 || get32(h+8)!=seq || size<4 || size-4>capacity) return poisoned(s);
    *received=size-4;
    int32_t result=(int32_t)get32(status);
    if(result) fprintf(stderr,"GPU status %d: %.*s\n",result,(int)(size-4),reply ? (char *)reply : "");
    return result;
  }
  if(all(s->fd,h,16,1) || all(s->fd,(void *)data,length,1) || all(s->fd,h,16,0)) return poisoned(s);
  uint32_t size=get32(h+12);
  if(get32(h)!=MAGIC || h[4]!=1 || h[5] || h[6]!=(unsigned)op || h[7]!=0x80 || get32(h+8)!=seq || size<4 || size>1048580) return poisoned(s);
  if(all(s->fd,status,4,0)) return poisoned(s);
  size-=4; if(size>capacity) return poisoned(s);
  if(all(s->fd,reply,size,0)) return poisoned(s);
  *received=size;
  int32_t result=(int32_t)get32(status);
  if(result) fprintf(stderr,"GPU status %d: %.*s\n",result,(int)size,reply ? (char *)reply : "");
  return result;
}
int gpu_resource(struct gpu_session *s, enum gpu_op op, const void *bytes, uint32_t length, uint32_t *id) {
  if(!id) { errno=EINVAL; return -1; }
  unsigned char response[512]; uint32_t n=0; int r=gpu_call(s,op,bytes,length,response,sizeof(response),&n);
  if(r) return r;
  if(n!=4) return -1;
  *id=get32(response); return *id ? 0 : -1;
}
void gpu_close(struct gpu_session *s) {
  if(s->hc>0) hostcall(HC_VK_CLOSE,s->hc,0,0,0,0);
  s->hc=0;
  if(s->fd>=0) close(s->fd);
  s->fd=-1;
}
