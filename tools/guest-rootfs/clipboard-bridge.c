/* X11 CLIPBOARD <-> browser, over virtio-vsock 4051. No shell or key injection.
 * Wire: 12 LE bytes: magic 0x31504c43, operation/status, kind, size.
 * Requests: op=1 set, op=2 CLIPBOARD get, op=3 PRIMARY-preferred get. kind=1 UTF8 text, 2 PNG. 16 MiB bound.
 * Native --unix PATH is for small X11 integration tests, not guest networking.
 */
#define _POSIX_C_SOURCE 200809L
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <poll.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#define LIMIT (16u*1024u*1024u)
#define CHUNK 32768u
#define MAGIC 0x31504c43u
struct vm_address { unsigned short family, reserved; unsigned port, cid; unsigned char flags, zero[3]; };
_Static_assert(sizeof(struct vm_address)==16,"vsock ABI");
static Display *d; static Window w; static Atom clip, utf8, png, targets, incr, prop, text;
static unsigned char *owned; static uint32_t owned_n; static unsigned owned_kind;
struct transfer { Window win; Atom property, type; unsigned char *data; uint32_t n, offset; double until; };
static struct transfer outgoing[8];
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec+t.tv_nsec/1e9; }
static void put32(unsigned char *p,uint32_t v) { for(int i=0;i<4;i++)p[i]=(unsigned char)(v>>(8*i)); }
static uint32_t get32(const unsigned char *p) { return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24; }
static int io(int fd,void *buf,size_t n,int write_it) {
  unsigned char *p=buf; double end=now()+10;
  while(n) { struct pollfd f={fd,write_it?POLLOUT:POLLIN,0}; int left=(int)((end-now())*1000);
    if(left<=0 || poll(&f,1,left)<=0) return -1;
    ssize_t r=write_it?send(fd,p,n,MSG_NOSIGNAL):read(fd,p,n);
    if(r<0 && (errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK))continue; if(r<=0)return -1; p+=r;n-=(size_t)r;
  } return 0;
}
static void reply(int fd,unsigned status,unsigned kind,const void *data,uint32_t n) {
  unsigned char h[12]={0};put32(h,MAGIC);h[4]=(unsigned char)status;h[5]=(unsigned char)kind;put32(h+8,n);
  if(!io(fd,h,12,1) && n)io(fd,(void *)data,n,1);
}
static void fail(int fd,const char *s) { reply(fd,1,0,s,(uint32_t)strlen(s)); }
static int xerror(Display *display,XErrorEvent *event) { (void)display;(void)event;return 0; }
static void selection_request(XSelectionRequestEvent *r) {
  XEvent e={0};e.xselection=(XSelectionEvent){.type=SelectionNotify,.display=d,.requestor=r->requestor,.selection=r->selection,.target=r->target,.property=None,.time=r->time};
  Atom p=r->property?r->property:r->target;
  if(r->selection==clip && XGetSelectionOwner(d,clip)==w) {
    if(r->target==targets) { Atom types[]={targets,owned_kind==2?png:utf8,text};int n=owned_kind==2?2:3;
      XChangeProperty(d,r->requestor,p,XA_ATOM,32,PropModeReplace,(unsigned char *)types,n);e.xselection.property=p;
    } else if((owned_kind==2 && r->target==png) || (owned_kind==1 && (r->target==utf8 || r->target==text))) {
      Atom type=owned_kind==2?png:utf8;
      if(owned_n<=CHUNK) { XChangeProperty(d,r->requestor,p,type,8,PropModeReplace,owned,(int)owned_n);e.xselection.property=p; }
      else for(unsigned i=0;i<8;i++)if(!outgoing[i].win) {
        unsigned char *copy=malloc(owned_n);if(!copy)break;memcpy(copy,owned,owned_n);
        outgoing[i]=(struct transfer){r->requestor,p,type,copy,owned_n,0,now()+10};
        XSelectInput(d,r->requestor,PropertyChangeMask); unsigned long n=owned_n;
        XChangeProperty(d,r->requestor,p,incr,32,PropModeReplace,(unsigned char *)&n,1);e.xselection.property=p;break;
      }
    }
  }
  XSendEvent(d,r->requestor,False,0,&e);XFlush(d);
}
static void event(XEvent *e) {
  if(e->type==SelectionRequest)selection_request(&e->xselectionrequest);
  if(e->type==PropertyNotify && e->xproperty.state==PropertyDelete)for(unsigned i=0;i<8;i++) {
    struct transfer *t=&outgoing[i];if(t->win==e->xproperty.window && t->property==e->xproperty.atom) {
      uint32_t n=t->n-t->offset;if(n>CHUNK)n=CHUNK;
      XChangeProperty(d,t->win,t->property,t->type,8,PropModeReplace,t->data+t->offset,(int)n);XFlush(d);t->offset+=n;t->until=now()+10;
      if(!n){free(t->data);memset(t,0,sizeof(*t));}break;
    }
  }
}
static int next_event(XEvent *e,double deadline) {
  while(!XPending(d)) { struct pollfd f={ConnectionNumber(d),POLLIN,0};int left=(int)((deadline-now())*1000);if(left<=0 || poll(&f,1,left)<=0)return -1; }
  XNextEvent(d,e);return 0;
}
/* Receive a selection, including ICCCM INCR. A timed-out conversion gets a
 * separate requestor window, so stale notifications cannot contaminate retry. */
static int receive(Atom selection,Atom target,unsigned char **out,uint32_t *size) {
  Window requestor=XCreateSimpleWindow(d,DefaultRootWindow(d),0,0,1,1,0,0,0);XSelectInput(d,requestor,PropertyChangeMask);
  XConvertSelection(d,selection,target,prop,requestor,CurrentTime);XFlush(d);double deadline=now()+5;int started=0,is_incr=0,ok=-1;
  unsigned char *data=NULL;uint32_t used=0;
  while(now()<deadline) {
    XEvent e;if(next_event(&e,deadline))break;
    int read_prop=0;
    if(e.type==SelectionNotify && e.xselection.requestor==requestor) { if(e.xselection.property==None)break;read_prop=1;started=1; }
    else if(e.type==PropertyNotify && e.xproperty.window==requestor) { if(started && is_incr && e.xproperty.state==PropertyNewValue)read_prop=1; }
    else event(&e);
    if(!read_prop)continue;
    Atom actual;int format;unsigned long n,after;unsigned char *chunk=NULL;
    if(XGetWindowProperty(d,requestor,prop,0,(long)(LIMIT/4+1),True,AnyPropertyType,&actual,&format,&n,&after,&chunk)!=Success)break;
    if(actual==incr && !is_incr) { is_incr=1;XFree(chunk);XFlush(d);continue; }
    if(actual!=target || format!=8 || after || n>LIMIT-used){XFree(chunk);break;}
    unsigned char *grown=realloc(data,(size_t)used+n+1);if(!grown){XFree(chunk);break;}data=grown;memcpy(data+used,chunk,n);used+=(uint32_t)n;XFree(chunk);
    XFlush(d);if(!is_incr || n==0){ok=0;break;}
  }
  XDestroyWindow(d,requestor);XFlush(d);
  if(ok){free(data);return -1;}*out=data;*size=used;return 0;
}
static void request(int fd) {
  unsigned char h[12];if(io(fd,h,12,0))return;uint32_t n=get32(h+8);
  if(get32(h)!=MAGIC || h[6] || h[7] || n>LIMIT){fail(fd,"Invalid clipboard request");return;}
  if(h[4]==1 && (h[5]==1 || h[5]==2)) {
    unsigned char *data=malloc((size_t)n+1);if(!data){fail(fd,"Clipboard allocation failed");return;}
    if(io(fd,data,n,0)){free(data);return;}
    if(h[5]==2 && (n<8 || memcmp(data,"\x89PNG\r\n\x1a\n",8))){free(data);fail(fd,"Clipboard image must be PNG");return;}
    XSetSelectionOwner(d,clip,w,CurrentTime);XSync(d,False);
    if(XGetSelectionOwner(d,clip)!=w){free(data);fail(fd,"Cannot own X11 clipboard");return;}
    free(owned);owned=data;owned_n=n;owned_kind=h[5];reply(fd,0,owned_kind,NULL,0);
  } else if((h[4]==2 || h[4]==3) && h[5]==0 && n==0) {
    if(h[4]==3 && XGetSelectionOwner(d,XA_PRIMARY)!=None) {
      unsigned char *data=NULL;uint32_t size=0;unsigned kind=2;
      if(!receive(XA_PRIMARY,png,&data,&size) || (kind=1,!receive(XA_PRIMARY,utf8,&data,&size))) {
        reply(fd,0,kind,data,size);free(data);return;
      }
    }
    if(XGetSelectionOwner(d,clip)==None){fail(fd,"Linux clipboard is empty");return;}
    if(XGetSelectionOwner(d,clip)==w){reply(fd,0,owned_kind,owned,owned_n);return;}
    unsigned char *data=NULL;uint32_t size=0;unsigned kind=2;
    if(receive(clip,png,&data,&size)){kind=1;if(receive(clip,utf8,&data,&size)){fail(fd,"Linux clipboard has no supported PNG or UTF8 text");return;}}
    reply(fd,0,kind,data,size);free(data);
  } else fail(fd,"Unsupported clipboard operation");
}
int main(int argc,char **argv) {
  signal(SIGPIPE,SIG_IGN);int listener;
  if(argc==3 && !strcmp(argv[1],"--unix")) {
    listener=socket(AF_UNIX,SOCK_STREAM,0);struct sockaddr_un a={.sun_family=AF_UNIX};
    if(strlen(argv[2])>=sizeof(a.sun_path))return 2;strcpy(a.sun_path,argv[2]);
    if(bind(listener,(struct sockaddr *)&a,sizeof(a))) { perror("clipboard bind");return 2; }
  } else if(argc==1) {
    listener=socket(40,SOCK_STREAM,0);struct vm_address a={.family=40,.port=4051,.cid=0xffffffffu};
    if(listener<0 || bind(listener,(struct sockaddr *)&a,sizeof(a))) { perror("clipboard vsock");return 2; }
  } else { fprintf(stderr,"usage: clipboard-bridge [--unix PATH]\n");return 2; }
  if(listen(listener,4))return 2;
  for(unsigned i=0;i<300 && !d;i++){d=XOpenDisplay(NULL);if(!d){struct timespec wait={0,100000000};nanosleep(&wait,NULL);}}
  if(!d){fprintf(stderr,"clipboard: X11 display unavailable\n");return 3;}
  int local=-1;
  if(argc==1) {
    local=socket(AF_UNIX,SOCK_STREAM,0);struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,"/tmp/linuxonweb-clipboard");
    if(local<0 || bind(local,(struct sockaddr *)&a,sizeof(a)) || chmod(a.sun_path,0666) || listen(local,4)) { perror("clipboard local socket");return 2; }
  }
  XSetErrorHandler(xerror);w=XCreateSimpleWindow(d,DefaultRootWindow(d),0,0,1,1,0,0,0);XSelectInput(d,w,PropertyChangeMask);
  clip=XInternAtom(d,"CLIPBOARD",False);utf8=XInternAtom(d,"UTF8_STRING",False);png=XInternAtom(d,"image/png",False);targets=XInternAtom(d,"TARGETS",False);incr=XInternAtom(d,"INCR",False);prop=XInternAtom(d,"_LOW_CLIPBOARD",False);text=XInternAtom(d,"TEXT",False);
  puts("clipboard: X11 bridge ready");fflush(stdout);
  for(;;) {
    while(XPending(d)){XEvent e;XNextEvent(d,&e);event(&e);}
    for(unsigned i=0;i<8;i++)if(outgoing[i].win && outgoing[i].until<now()){free(outgoing[i].data);memset(&outgoing[i],0,sizeof(outgoing[i]));}
    struct pollfd f[3]={{listener,POLLIN,0},{ConnectionNumber(d),POLLIN,0},{local,POLLIN,0}};
    if(poll(f,3,1000)<0 && errno!=EINTR)break;
    for(int i=0;i<3;i+=2)if(f[i].revents&POLLIN){int fd=accept(f[i].fd,NULL,NULL);if(fd>=0){fcntl(fd,F_SETFL,fcntl(fd,F_GETFL,0)|O_NONBLOCK);request(fd);close(fd);}}
  }
  return 0;
}
