#define _GNU_SOURCE 1
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include <math.h>
#include <string.h>
#define REQUIRE(x) do {if(!(x)){printf("GUEST_WGPU_EGL_FAIL line=%d egl=0x%x gl=0x%x\n",__LINE__,eglGetError(),glGetError());return 1;}}while(0)
static GLuint shader(GLenum kind,const char *text){GLuint s=glCreateShader(kind);glShaderSource(s,1,&text,NULL);glCompileShader(s);GLint ok=0;glGetShaderiv(s,GL_COMPILE_STATUS,&ok);if(!ok){char log[2048];glGetShaderInfoLog(s,sizeof log,NULL,log);printf("GUEST_WGPU_EGL_FAIL shader=%s\n",log);return 0;}return s;}
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000.+t.tv_nsec/1e6;}
int main(void){
 setvbuf(stdout,NULL,_IONBF,0);setenv("MESA_LOADER_DRIVER_OVERRIDE","zink",1);setenv("LIBGL_ALWAYS_SOFTWARE","1",1);setenv("GUEST_VK_TRACE","1",1);
 printf("GUEST_WGPU_EGL_CONFIG width=64 height=64 frames=6 workload=zink-indexed-uniform-texture-depth-v1\n");
 PFNEGLGETPLATFORMDISPLAYEXTPROC platform=(void*)eglGetProcAddress("eglGetPlatformDisplayEXT");REQUIRE(platform);EGLDisplay d=platform(EGL_PLATFORM_SURFACELESS_MESA,EGL_DEFAULT_DISPLAY,NULL);EGLint major,minor;REQUIRE(eglInitialize(d,&major,&minor));REQUIRE(eglBindAPI(EGL_OPENGL_ES_API));
 EGLConfig config=NULL;EGLint count=0,choose[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES2_BIT,EGL_NONE};REQUIRE(eglChooseConfig(d,choose,&config,1,&count));if(!count)config=EGL_NO_CONFIG_KHR;
 EGLint attr[]={EGL_CONTEXT_CLIENT_VERSION,2,EGL_NONE};EGLContext context=eglCreateContext(d,config,EGL_NO_CONTEXT,attr);REQUIRE(context!=EGL_NO_CONTEXT);REQUIRE(eglMakeCurrent(d,EGL_NO_SURFACE,EGL_NO_SURFACE,context));
 printf("GUEST_WGPU_EGL_IDENTITY egl=%d.%d vendor=%s gl=%s renderer=%s glsl=%s\n",major,minor,eglQueryString(d,EGL_VENDOR),glGetString(GL_VERSION),glGetString(GL_RENDERER),glGetString(GL_SHADING_LANGUAGE_VERSION));
 GLuint fb,color,depth;glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glGenRenderbuffers(1,&color);glBindRenderbuffer(GL_RENDERBUFFER,color);glRenderbufferStorage(GL_RENDERBUFFER,GL_RGBA8_OES,64,64);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_RENDERBUFFER,color);glGenRenderbuffers(1,&depth);glBindRenderbuffer(GL_RENDERBUFFER,depth);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT16,64,64);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);REQUIRE(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE);
 GLuint vs=shader(GL_VERTEX_SHADER,"attribute vec4 p;attribute vec2 uv;varying vec2 v;void main(){gl_Position=p;v=uv;}"),fs=shader(GL_FRAGMENT_SHADER,"precision highp float;varying vec2 v;uniform sampler2D tex;uniform vec4 tint;void main(){gl_FragColor=texture2D(tex,v)*tint;}");REQUIRE(vs&&fs);GLuint program=glCreateProgram();glAttachShader(program,vs);glAttachShader(program,fs);glBindAttribLocation(program,0,"p");glBindAttribLocation(program,1,"uv");glLinkProgram(program);GLint linked=0;glGetProgramiv(program,GL_LINK_STATUS,&linked);REQUIRE(linked);glUseProgram(program);
 const unsigned char texels[]={255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255};GLuint texture;glGenTextures(1,&texture);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,texture);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,2,2,0,GL_RGBA,GL_UNSIGNED_BYTE,texels);glUniform1i(glGetUniformLocation(program,"tex"),0);
 float vertices[]={-1,-1,-.5,1,0,0, 0,-1,-.5,1,1,0, 0,1,-.5,1,1,1, -1,1,-.5,1,0,1};const unsigned short indices[]={0,1,2,0,2,3};GLuint vb,ib;glGenBuffers(1,&vb);glBindBuffer(GL_ARRAY_BUFFER,vb);glBufferData(GL_ARRAY_BUFFER,sizeof vertices,vertices,GL_DYNAMIC_DRAW);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,6*sizeof(float),(void*)0);glVertexAttribPointer(1,2,GL_FLOAT,GL_FALSE,6*sizeof(float),(void*)(4*sizeof(float)));glEnableVertexAttribArray(0);glEnableVertexAttribArray(1);glGenBuffers(1,&ib);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ib);glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);glEnable(GL_DEPTH_TEST);glDepthFunc(GL_LESS);glDepthMask(GL_TRUE);glViewport(0,0,64,64);
 unsigned failures=0,checks=0;uint32_t previous=0;double elapsed=0;unsigned char pixels[64*64*4];
 for(unsigned frame=0;frame<6;frame++){
  glEnable(GL_DEPTH_TEST);glDepthMask(GL_TRUE);
  glClearColor(17.f/255,34.f/255,51.f/255,1);glClearDepthf(1);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  double start=now();for(unsigned i=0;i<4;i++)vertices[i*6+2]=-.5;glBufferData(GL_ARRAY_BUFFER,sizeof vertices,vertices,GL_DYNAMIC_DRAW);glUniform4f(glGetUniformLocation(program,"tint"),.5,1,1,1);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);
  if(frame>=3)glDisable(GL_DEPTH_TEST);
  for(unsigned i=0;i<4;i++)vertices[i*6+2]=.5;glBufferData(GL_ARRAY_BUFFER,sizeof vertices,vertices,GL_DYNAMIC_DRAW);glUniform4f(glGetUniformLocation(program,"tint"),0,0,0,1);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);glFinish();glReadPixels(0,0,64,64,GL_RGBA,GL_UNSIGNED_BYTE,pixels);elapsed+=now()-start;REQUIRE(glGetError()==GL_NO_ERROR);
  uint32_t hash=2166136261u;for(unsigned y=0;y<64;y++)for(unsigned x=0;x<64;x++){unsigned char expected[4]={17,34,51,255};if(x<32){unsigned offset=((y>=32)*2+(x>=16))*4;memcpy(expected,texels+offset,4);expected[0]=(unsigned char)lround(expected[0]*.5);if(frame>=3)expected[0]=expected[1]=expected[2]=0;}for(unsigned k=0;k<4;k++){unsigned char value=pixels[(y*64+x)*4+k];if(abs((int)value-expected[k])>2){if(failures<8)printf("GUEST_WGPU_EGL_PIXEL_FAIL frame=%u x=%u y=%u channel=%u actual=%u expected=%u\n",frame,x,y,k,value,expected[k]);failures++;}checks++;hash=(hash^value)*16777619u;}}
  if(frame&&frame!=3&&hash!=previous)failures++;previous=hash;printf("GUEST_WGPU_EGL_FRAME index=%u checksum=%u completed=1\n",frame,hash);
 }
 glDeleteBuffers(1,&ib);glDeleteBuffers(1,&vb);glDeleteTextures(1,&texture);glDeleteProgram(program);glDeleteShader(vs);glDeleteShader(fs);glDeleteRenderbuffers(1,&depth);glDeleteRenderbuffers(1,&color);glDeleteFramebuffers(1,&fb);REQUIRE(glGetError()==GL_NO_ERROR);REQUIRE(eglMakeCurrent(d,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT));REQUIRE(eglDestroyContext(d,context));REQUIRE(eglTerminate(d));
 printf("GUEST_WGPU_EGL_RESULT completed=6 elapsed_ms=%.3f pixel_checks=%u pixel_failures=%u checksum=%u\n",elapsed,checks,failures,previous);printf("GUEST_WGPU_EXIT status=%u\n",failures?1:0);return failures?1:0;
}
