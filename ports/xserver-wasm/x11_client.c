/* Freestanding wasm32 X11 client using the core protocol directly. */
#include "host_abi.h"
static unsigned char packet[1024]; static int p;
static void put8(int v){packet[p++]=(unsigned char)v;}
static void put16(int v){put8(v);put8(v>>8);}
static void put32(unsigned v){put16((int)v);put16((int)(v>>16));}
static void flush(void){x11_host_send(packet,p);p=0;}
static void create_window(unsigned root,unsigned visual){
 p=0;put8(1);put8(0);put16(8);put32(0x200001);put32(root);put16(30);put16(30);put16(740);put16(500);put16(0);put16(1);put32(visual);put32(0);flush();
 p=0;put8(8);put8(0);put16(2);put32(0x200001);flush();
 p=0;put8(55);put8(0);put16(4);put32(0x200002);put32(0x200001);put32(0);flush();
}
static void rectangle(int x,int y,int w,int h){p=0;put8(70);put8(0);put16(6);put32(0x200002);put32(0x200001);put16(x);put16(y);put16(w);put16(h);put16(0);put16(0);flush();}
static void image_text(const unsigned char *s,int n,int x,int y){int words=(16+n+3)/4;if(n>240)n=240;p=0;put8(76);put8(0);put16(words);put32(0x200001);put32(0x200002);put16(x);put16(y);put8(n);put8(0);for(int i=0;i<n;i++)put8(s[i]);while(p&3)put8(0);flush();}
__attribute__((visibility("default"))) int x11_start(unsigned root,unsigned visual){create_window(root,visual);image_text((const unsigned char*)"linux-on-web: X11 via wasm",26,20,40);image_text((const unsigned char*)"type in this browser window",27,20,65);rectangle(10,80,500,30);return x11_host_log((const unsigned char*)"wasm X11 client requests sent\n",30);}
__attribute__((visibility("default"))) int x11_key(unsigned key){unsigned char t[2]={'[',(unsigned char)key};image_text(t,2,20,130);return 0;}
