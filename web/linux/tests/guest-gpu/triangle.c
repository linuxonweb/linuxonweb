#define _POSIX_C_SOURCE 200809L
#include "guest-gpu.h"
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static void deadline(int sig) { (void)sig; _exit(124); }
static const char shader[]=
 "struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f };\n"
 "@vertex fn vs(@location(0) position: vec2f, @location(1) color: vec3f) -> Out {\n"
 " var o: Out; o.position=vec4f(position,0.0,1.0); o.color=color; return o; }\n"
 "@fragment fn fs(o: Out) -> @location(0) vec4f { return vec4f(o.color,1.0); }\n";
static unsigned long channel(unsigned char value,unsigned long mask) {
  unsigned shift=0; if(!mask) return 0; while(!(mask&1)) { mask>>=1; shift++; }
  return (((unsigned long)value*mask+127)/255)<<shift;
}
int main(void) {
  struct sigaction action={0}; action.sa_handler=deadline; sigemptyset(&action.sa_mask);
  if(sigaction(SIGALRM,&action,NULL)) return 2;
  alarm(90); signal(SIGPIPE,SIG_IGN);
  struct gpu_session gpu={.fd=-1}; Display *display=NULL; XImage *image=NULL; unsigned char *pixels=NULL;
  int result=1; uint32_t n=0, module,buffer,pipeline,target; char response[1024];
  if(gpu_accept(&gpu,4050)) { perror("GPU vsock"); goto done; }
  if(gpu_call(&gpu,GPU_HELLO,NULL,0,response,sizeof(response)-1,&n)) goto done;
  response[n]=0; printf("GUEST_GPU_ADAPTER %s\n",response);
  const float vertices[]={-.8f,-.8f,1,0,0, .8f,-.8f,0,1,0, 0,.8f,0,0,1};
  uint32_t size[]={128,128};
  if(gpu_resource(&gpu,GPU_SHADER,shader,sizeof(shader)-1,&module) ||
     gpu_resource(&gpu,GPU_BUFFER,vertices,sizeof(vertices),&buffer) ||
     gpu_resource(&gpu,GPU_PIPELINE,&module,4,&pipeline) ||
     gpu_resource(&gpu,GPU_TARGET,size,8,&target)) goto done;
  uint32_t draw[]={target,pipeline,buffer,3};
  if(gpu_call(&gpu,GPU_DRAW,draw,sizeof(draw),response,sizeof(response),&n)) goto done;
  pixels=malloc(128*128*4); if(!pixels) goto done;
  if(gpu_call(&gpu,GPU_READBACK,&target,4,pixels,128*128*4,&n) || n!=128*128*4) goto done;
  unsigned char *center=pixels+(64*128+64)*4;
  if(pixels[0] || pixels[1] || pixels[2] || pixels[3]!=255 || center[0]<20 || center[1]<20 || center[2]<40 || center[3]!=255) {
    fprintf(stderr,"GPU pixel mismatch %u %u %u %u\n",center[0],center[1],center[2],center[3]); goto done;
  }
  printf("GUEST_GPU_PIXELS_PASS center=%u,%u,%u,%u\n",center[0],center[1],center[2],center[3]); fflush(stdout);
  for(unsigned attempt=0;attempt<20 && !display;attempt++) { display=XOpenDisplay(":0"); if(!display) sleep(1); }
  if(!display) { fputs("X display unavailable\n",stderr); goto done; }
  int screen=DefaultScreen(display); Visual *visual=DefaultVisual(display,screen);
  Window window=XCreateSimpleWindow(display,RootWindow(display,screen),32,32,128,128,1,0,0);
  XStoreName(display,window,"Guest WGSL triangle (host WebGPU)"); XSelectInput(display,window,ExposureMask|StructureNotifyMask); XMapWindow(display,window);
  image=XCreateImage(display,visual,(unsigned)DefaultDepth(display,screen),ZPixmap,0,NULL,128,128,32,0);
  if(!image) goto done;
  image->data=calloc((size_t)image->bytes_per_line,128); if(!image->data) goto done;
  for(int y=0;y<128;y++) for(int x=0;x<128;x++) { unsigned char *p=pixels+(y*128+x)*4;
    XPutPixel(image,x,y,channel(p[0],visual->red_mask)|channel(p[1],visual->green_mask)|channel(p[2],visual->blue_mask)); }
  GC gc=XCreateGC(display,window,0,NULL);
  XEvent event; do { XNextEvent(display,&event); } while(event.type!=Expose);
  XPutImage(display,window,gc,image,0,0,0,0,128,128); XSync(display,False);
  puts("GUEST_GPU_X11_PRESENT_PASS"); fflush(stdout);
  uint32_t ids[]={target,pipeline,buffer,module};
  for(unsigned i=0;i<4;i++) if(gpu_call(&gpu,GPU_DESTROY,&ids[i],4,response,sizeof(response),&n)) goto done;
  if(gpu_call(&gpu,GPU_DESTROY,&target,4,response,sizeof(response),&n)!=-22) { fputs("stale resource not rejected\n",stderr); goto done; }
  if(gpu_call(&gpu,GPU_CLOSE,NULL,0,response,sizeof(response),&n)) goto done;
  puts("GUEST_GPU_LIFETIME_PASS"); fflush(stdout); result=0;
  /* Keep a real guest X11 window available for the acceptance screenshot. */
  sleep(10); XFreeGC(display,gc);
done:
  if(image) XDestroyImage(image);
  if(display) XCloseDisplay(display);
  free(pixels); gpu_close(&gpu);
  printf("GUEST_GPU_EXIT %d\n",result); return result;
}
