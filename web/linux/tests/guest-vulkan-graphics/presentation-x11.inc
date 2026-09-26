/* Test application presentation of Vulkan readback through ordinary Xlib.
 * This is a CPU copy, not Vulkan WSI or a zero-copy compositor integration. */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <time.h>
struct x11_presenter {
    Display *display;
    Window window;
    GC gc;
    XImage *image;
    unsigned frames;
    unsigned long verified;
    int error;
};
static struct x11_presenter presentation;
static int x11_error(Display *d,XErrorEvent *e){
    (void)d;presentation.error=e->error_code;
    fprintf(stderr,"GUEST_VK_X11_ERROR code=%u request=%u minor=%u\n",e->error_code,e->request_code,e->minor_code);return 0;
}
static unsigned long x11_component(unsigned value,unsigned long mask){
    unsigned shift=0;if(!mask)return 0;
    while(!(mask&1)){mask>>=1;shift++;}
    return (unsigned long)(((uint64_t)value*mask+127)/255)<<shift;
}
static unsigned long x11_pixel(const unsigned char *p){
    return x11_component(p[0],presentation.image->red_mask)|x11_component(p[1],presentation.image->green_mask)|x11_component(p[2],presentation.image->blue_mask);
}
static int x11_open(void){
    XSetErrorHandler(x11_error);presentation.display=XOpenDisplay(":0");
    if(!presentation.display)return 0;
    Display *d=presentation.display;int screen=DefaultScreen(d);Visual *visual=DefaultVisual(d,screen);
    if(visual->class!=TrueColor||!visual->red_mask||!visual->green_mask||!visual->blue_mask)return 0;
    if(DisplayWidth(d,screen)<20+W*4||DisplayHeight(d,screen)<100+H*4)return 0;
    XSetWindowAttributes attr={.override_redirect=True,.background_pixel=0,.event_mask=ExposureMask|StructureNotifyMask};
    presentation.window=XCreateWindow(d,RootWindow(d,screen),20,100,W*4,H*4,0,DefaultDepth(d,screen),InputOutput,visual,
        CWOverrideRedirect|CWBackPixel|CWEventMask,&attr);
    if(!presentation.window)return 0;
    XStoreName(d,presentation.window,"Vulkan readback through X11 (experimental)");
    presentation.gc=XCreateGC(d,presentation.window,0,NULL);if(!presentation.gc)return 0;
    presentation.image=XCreateImage(d,visual,DefaultDepth(d,screen),ZPixmap,0,NULL,W*4,H*4,32,0);
    if(!presentation.image||presentation.image->bytes_per_line<=0||presentation.image->bytes_per_line>W*4*8)return 0;
    presentation.image->data=calloc(H*4,(size_t)presentation.image->bytes_per_line);if(!presentation.image->data)return 0;
    XMapRaised(d,presentation.window);XSync(d,False);
    XWindowAttributes actual;
    if(!XGetWindowAttributes(d,presentation.window,&actual)||actual.map_state!=IsViewable||presentation.error)return 0;
    printf("GUEST_VK_X11_OPEN depth=%d bpp=%d stride=%d red=%lu green=%lu blue=%lu\n",actual.depth,presentation.image->bits_per_pixel,
        presentation.image->bytes_per_line,visual->red_mask,visual->green_mask,visual->blue_mask);fflush(stdout);return 1;
}
static void x11_draw(void){
    XRaiseWindow(presentation.display,presentation.window);
    XPutImage(presentation.display,presentation.window,presentation.gc,presentation.image,0,0,0,0,W*4,H*4);
    XFlush(presentation.display);
}
static int x11_present(const unsigned char *rgba,unsigned round){
    for(unsigned y=0;y<H*4;y++)for(unsigned x=0;x<W*4;x++)
        XPutPixel(presentation.image,x,y,x11_pixel(rgba+((y/4)*W+x/4)*4));
    x11_draw();XSync(presentation.display,False);if(presentation.error)return 0;
    XImage *returned=XGetImage(presentation.display,presentation.window,0,0,W*4,H*4,AllPlanes,ZPixmap);
    if(!returned)return 0;
    unsigned long mask=presentation.image->red_mask|presentation.image->green_mask|presentation.image->blue_mask;
    int valid=1;
    for(unsigned y=0;y<H*4;y++)for(unsigned x=0;x<W*4;x++){
        presentation.verified++;
        if((XGetPixel(returned,x,y)&mask)!=x11_pixel(rgba+((y/4)*W+x/4)*4))valid=0;
    }
    XDestroyImage(returned);if(!valid||presentation.error)return 0;
    presentation.frames++;
    printf("GUEST_VK_X11_FRAME round=%u x=20 y=100 width=%u height=%u scale=4 verified=%lu\n",round,W*4,H*4,presentation.verified);fflush(stdout);
    /* Keep the real window visible while the independent browser framebuffer
       observer checks this round; repaint exposures during the bounded hold. */
    struct timespec start,now,delay={0,20000000};if(clock_gettime(CLOCK_MONOTONIC,&start))return 0;
    do {
        while(XPending(presentation.display)){XEvent event;XNextEvent(presentation.display,&event);if(event.type==DestroyNotify)return 0;}
        x11_draw();nanosleep(&delay,NULL);if(clock_gettime(CLOCK_MONOTONIC,&now))return 0;
    } while((now.tv_sec-start.tv_sec)*1000+(now.tv_nsec-start.tv_nsec)/1000000<(round==7?1500:400));
    XSync(presentation.display,False);return !presentation.error;
}
static int x11_close(void){
    if(presentation.image){XDestroyImage(presentation.image);presentation.image=NULL;}
    if(presentation.display){
        if(presentation.gc)XFreeGC(presentation.display,presentation.gc);
        if(presentation.window)XDestroyWindow(presentation.display,presentation.window);
        XSync(presentation.display,False);XCloseDisplay(presentation.display);
    }
    presentation.display=NULL;presentation.gc=NULL;presentation.window=0;
    printf("GUEST_VK_X11_CLOSE frames=%u verified=%lu error=%d live=0\n",presentation.frames,presentation.verified,presentation.error);fflush(stdout);
    return presentation.frames==8&&!presentation.error;
}
