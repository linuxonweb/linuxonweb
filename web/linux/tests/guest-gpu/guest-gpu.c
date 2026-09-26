#include "guest-gpu.h"
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
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
int gpu_accept(struct gpu_session *s, unsigned port) {
  s->fd=-1; s->sequence=0;
  int listener=socket(AF_VSOCK,SOCK_STREAM,0); if(listener<0) return -1;
  struct vm_address address={.family=AF_VSOCK,.port=port,.cid=0xffffffffu};
  if(bind(listener,(struct sockaddr *)&address,sizeof(address)) || listen(listener,1)) { close(listener); return -1; }
  puts("GUEST_GPU_LISTENING"); fflush(stdout);
  s->fd=accept(listener,NULL,NULL); close(listener); return s->fd<0 ? -1 : 0;
}
int gpu_call(struct gpu_session *s, enum gpu_op op, const void *data, uint32_t length, void *reply, uint32_t capacity, uint32_t *received) {
  if(!s || s->fd<0 || op<GPU_HELLO || op>GPU_STORAGE_READBACK || !received || (!reply && capacity) || length>1048576 || (!data && length) || s->sequence==0xffffffffu) { errno=EINVAL; return -1; }
  *received=0;
  unsigned char h[16]={0}, status[4]; uint32_t seq=++s->sequence;
  put32(h,MAGIC); h[4]=1; h[6]=(unsigned char)op; put32(h+8,seq); put32(h+12,length);
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
void gpu_close(struct gpu_session *s) { if(s->fd>=0) close(s->fd); s->fd=-1; }
