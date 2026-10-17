/* wasm32 musl cannot fork. In silent CLIPBOARD input mode, hand ownership to
 * the already-running bridge instead of keeping the caller alive. */
#define _POSIX_C_SOURCE 200809L
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/time.h>
#include <unistd.h>
static int all(int fd,void *data,size_t n,int sending) {
  unsigned char *p=data;
  while(n){ssize_t got=sending?write(fd,p,n):read(fd,p,n);if(got<=0)return -1;p+=got;n-=(size_t)got;}return 0;
}
int low_clipboard_set(const unsigned char *data,unsigned long n,unsigned kind) {
  if(n>16ul*1024ul*1024ul)return 1;
  int fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd<0)return 1;
  struct timeval timeout={10,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
  struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,"/tmp/linuxonweb-clipboard");
  unsigned char h[12]={0x43,0x4c,0x50,0x31,1,(unsigned char)kind};for(unsigned i=0;i<4;i++)h[8+i]=(unsigned char)(n>>(8*i));
  int result=connect(fd,(struct sockaddr *)&a,sizeof(a)) || all(fd,h,12,1) || all(fd,(void *)data,n,1) || all(fd,h,12,0) || h[0]!=0x43 || h[1]!=0x4c || h[2]!=0x50 || h[3]!=0x31 || h[4];
  close(fd);if(result)fprintf(stderr,"xclip: Linux clipboard bridge unavailable\n");return result?1:0;
}
