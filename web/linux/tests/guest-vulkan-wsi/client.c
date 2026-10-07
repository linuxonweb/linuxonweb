/* A6a WSI application. Only public Vulkan, Xlib/XCB and POSIX entrypoints:
 * VK_KHR_surface + VK_KHR_xlib_surface + VK_KHR_xcb_surface instance
 * extensions and the VK_KHR_swapchain device extension through the static
 * Khronos loader. Real X11 windows (override-redirect, so the window manager
 * cannot resize them) back an Xlib and an XCB surface. Surface support,
 * capabilities (currentExtent from the actual window geometry), formats and
 * present modes are checked with the two-call/VK_INCOMPLETE pattern. Every
 * swapchain image is rendered through a CLEAR render pass and read back byte
 * for byte followed by an untouched sentinel tail. Acquire/present are A6b
 * work and must still refuse with VK_ERROR_FEATURE_NOT_PRESENT. */
#define _POSIX_C_SOURCE 200809L
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <xcb/xcb.h>
#include <vulkan/vulkan.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#define XW 96u
#define XH 80u
#define BW 200u
#define BH 150u
#define CW 64u
#define CH 48u
#define READ_BYTES (XW*XH*4+16)
#define TOTAL (XW*XH*4+32)
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_WSI_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
static int x_errors;
static int x_error(Display *d,XErrorEvent *e){(void)d;(void)e;x_errors++;return 0;}
static void nap(long ms){struct timespec t={ms/1000,(ms%1000)*1000000L};nanosleep(&t,NULL);}
static int has_ext(const VkExtensionProperties *p,uint32_t n,const char *name){for(uint32_t k=0;k<n;k++)if(!strcmp(p[k].extensionName,name))return 1;return 0;}

static VkDevice device;static VkQueue queue;static VkCommandBuffer cb;static unsigned char *mapped;static VkBuffer readback;static VkRenderPass pass;
static VkCommandBufferBeginInfo begin_info={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
static VkSubmitInfo submit_info={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
static void color_barrier(VkImage image,VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
static void readback_barrier(void){
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=readback,.size=VK_WHOLE_SIZE,.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,
        .dstAccessMask=VK_ACCESS_HOST_READ_BIT,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED};
    vkCmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&b,0,NULL);
}
/* Render one swapchain image with a CLEAR render pass and compare the readback
 * exactly (w*h*4 bytes) followed by the untouched 0xa5 tail up to TOTAL. */
static int render_image(VkImage image,uint32_t w,uint32_t h,const float color[4],const char *label,unsigned index){
    int ok=0;VkImageView view=VK_NULL_HANDLE;VkFramebuffer fb=VK_NULL_HANDLE;
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_SUCCESS&&view);
    VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=pass,.attachmentCount=1,.pAttachments=&view,.width=w,.height=h,.layers=1};
    VkFramebuffer bad=VK_NULL_HANDLE;fi.width=w+1;CHECK(vkCreateFramebuffer(device,&fi,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);   /* extent must match the image */
    fi.width=w;CHECK(vkCreateFramebuffer(device,&fi,NULL,&fb)==VK_SUCCESS&&fb);
    CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);
    color_barrier(image,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    VkClearValue clear={.color={{color[0],color[1],color[2],color[3]}}};
    VkRenderPassBeginInfo bi={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=pass,.framebuffer=fb,.renderArea={{0,0},{w,h}},.clearValueCount=1,.pClearValues=&clear};
    vkCmdBeginRenderPass(cb,&bi,VK_SUBPASS_CONTENTS_INLINE);vkCmdEndRenderPass(cb);
    color_barrier(image,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={w,h,1}};
    vkCmdCopyImageToBuffer(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);readback_barrier();
    CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
    memset(mapped,0xa5,TOTAL);
    CHECK(vkQueueSubmit(queue,1,&submit_info,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);
    unsigned char want[4];for(unsigned c=0;c<4;c++)want[c]=(unsigned char)(color[c]*255.0f+0.5f);
    const size_t bytes=(size_t)w*h*4;
    for(size_t n=0;n<bytes;n++){checks++;
        if(mapped[n]!=want[n%4]){fprintf(stderr,"GUEST_VK_WSI_PIXEL_FAIL %s image=%u x=%zu y=%zu component=%zu actual=%u expected=%u\n",label,index,(n/4)%w,n/4/w,n%4,mapped[n],want[n%4]);goto done;}}
    for(size_t n=bytes;n<TOTAL;n++){checks++;if(mapped[n]!=0xa5){fprintf(stderr,"GUEST_VK_WSI_TAIL_FAIL %s image=%u offset=%zu\n",label,index,n);goto done;}}
    printf("GUEST_VK_WSI_IMAGE_PASS %s image=%u width=%u height=%u exact=%zu tail=%zu\n",label,index,w,h,bytes,(size_t)TOTAL-bytes);fflush(stdout);
    ok=1;
done:
    if(fb)vkDestroyFramebuffer(device,fb,NULL);if(view)vkDestroyImageView(device,view,NULL);
    return ok;
}
static VkSwapchainCreateInfoKHR swapchain_info(VkSurfaceKHR surface,uint32_t count,uint32_t w,uint32_t h,VkPresentModeKHR mode,VkSwapchainKHR old){
    return (VkSwapchainCreateInfoKHR){.sType=VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR,.surface=surface,.minImageCount=count,.imageFormat=VK_FORMAT_R8G8B8A8_UNORM,
        .imageColorSpace=VK_COLOR_SPACE_SRGB_NONLINEAR_KHR,.imageExtent={w,h},.imageArrayLayers=1,.imageUsage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
        .imageSharingMode=VK_SHARING_MODE_EXCLUSIVE,.preTransform=VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR,.compositeAlpha=VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR,
        .presentMode=mode,.clipped=VK_TRUE,.oldSwapchain=old};
}
static VkDeviceCreateInfo device_info(const char *const *ext,uint32_t n,const VkDeviceQueueCreateInfo *qi){
    return (VkDeviceCreateInfo){.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=qi,.enabledExtensionCount=n,.ppEnabledExtensionNames=ext};
}
static xcb_window_t xcb_window_new(xcb_connection_t *c,uint16_t w,uint16_t h,int16_t x,int16_t y){
    const xcb_setup_t *setup=xcb_get_setup(c);xcb_screen_iterator_t it=xcb_setup_roots_iterator(setup);xcb_screen_t *screen=it.data;
    if(!screen)return 0;
    xcb_window_t id=xcb_generate_id(c);uint32_t values[2]={screen->black_pixel,1};
    xcb_void_cookie_t k=xcb_create_window_checked(c,XCB_COPY_FROM_PARENT,id,screen->root,x,y,w,h,0,XCB_WINDOW_CLASS_INPUT_OUTPUT,screen->root_visual,
        XCB_CW_BACK_PIXEL|XCB_CW_OVERRIDE_REDIRECT,values);
    xcb_generic_error_t *e=xcb_request_check(c,k);if(e){free(e);return 0;}
    xcb_map_window(c,id);xcb_flush(c);return id;
}

int main(void){
    int result=1;Display *dpy=NULL;Window xwin=0,big=0;xcb_connection_t *xc=NULL;xcb_window_t cwin=0;
    VkInstance instance=VK_NULL_HANDLE;VkSurfaceKHR xsurf=VK_NULL_HANDLE,bsurf=VK_NULL_HANDLE,csurf=VK_NULL_HANDLE;
    VkSwapchainKHR chain=VK_NULL_HANDLE,chain2=VK_NULL_HANDLE,cchain=VK_NULL_HANDLE;VkDeviceMemory read_mem=VK_NULL_HANDLE;VkCommandPool cpool=VK_NULL_HANDLE;
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(120);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_WSI_SCOPE public static Khronos loader; VK_KHR_surface/xlib/xcb surfaces and VK_KHR_swapchain objects; acquire/present deferred to A6b; bounded nonconformant ICD");
    fflush(stdout);
    /* X is started by /init before this client, but its socket may still be settling. */
    XSetErrorHandler(x_error);
    for(unsigned n=0;n<120&&!dpy;n++){dpy=XOpenDisplay(":0");if(!dpy)nap(500);}
    CHECK(dpy);
    {
        const int screen=DefaultScreen(dpy);XSetWindowAttributes wa={.override_redirect=True,.background_pixel=BlackPixel(dpy,screen)};
        xwin=XCreateWindow(dpy,RootWindow(dpy,screen),24,24,XW,XH,0,CopyFromParent,InputOutput,CopyFromParent,CWOverrideRedirect|CWBackPixel,&wa);
        big=XCreateWindow(dpy,RootWindow(dpy,screen),140,24,BW,BH,0,CopyFromParent,InputOutput,CopyFromParent,CWOverrideRedirect|CWBackPixel,&wa);
        CHECK(xwin&&big);XMapWindow(dpy,xwin);XMapWindow(dpy,big);XSync(dpy,False);CHECK(!x_errors);
    }
    xc=xcb_connect(":0",NULL);CHECK(xc&&!xcb_connection_has_error(xc));cwin=xcb_window_new(xc,CW,CH,24,120);CHECK(cwin);
    printf("GUEST_VK_WSI_X11 xlib=%ux%u big=%ux%u xcb=%ux%u\n",XW,XH,BW,BH,CW,CH);fflush(stdout);
    const char *surface_exts[3]={VK_KHR_SURFACE_EXTENSION_NAME,VK_KHR_XLIB_SURFACE_EXTENSION_NAME,VK_KHR_XCB_SURFACE_EXTENSION_NAME};
    /* Instance extensions: all three are listed; the two-call pattern reports VK_INCOMPLETE. */
    {
        uint32_t n=0;CHECK(vkEnumerateInstanceExtensionProperties(NULL,&n,NULL)==VK_SUCCESS&&n>=3&&n<=16);
        VkExtensionProperties props[16];uint32_t one=1;CHECK(vkEnumerateInstanceExtensionProperties(NULL,&one,props)==VK_INCOMPLETE&&one==1);
        uint32_t all=n;CHECK(vkEnumerateInstanceExtensionProperties(NULL,&all,props)==VK_SUCCESS&&all==n);
        for(unsigned k=0;k<3;k++)CHECK(has_ext(props,all,surface_exts[k]));
        CHECK(!has_ext(props,all,"VK_KHR_wayland_surface")&&!has_ext(props,all,"VK_KHR_display")&&!has_ext(props,all,"VK_KHR_get_surface_capabilities2"));
        printf("GUEST_VK_WSI_INSTANCE_EXTENSIONS count=%u surface=1 xlib=1 xcb=1\n",all);fflush(stdout);
    }
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_1,.pApplicationName="public-wsi"};
    VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    /* Negative: unknown extension rejected; without the surface extensions the entrypoints are NULL. */
    {
        const char *unknown[1]={"VK_KHR_wayland_surface"};ii.enabledExtensionCount=1;ii.ppEnabledExtensionNames=unknown;
        CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_ERROR_EXTENSION_NOT_PRESENT&&!instance);
        ii.enabledExtensionCount=0;ii.ppEnabledExtensionNames=NULL;CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);
        CHECK(!vkGetInstanceProcAddr(instance,"vkCreateXlibSurfaceKHR"));CHECK(!vkGetInstanceProcAddr(instance,"vkCreateXcbSurfaceKHR"));
        CHECK(!vkGetInstanceProcAddr(instance,"vkGetPhysicalDeviceSurfaceSupportKHR"));CHECK(!vkGetInstanceProcAddr(instance,"vkDestroySurfaceKHR"));
        CHECK(!vkGetInstanceProcAddr(instance,"vkCreateWaylandSurfaceKHR"));
        vkDestroyInstance(instance,NULL);instance=VK_NULL_HANDLE;
        /* xlib alone without VK_KHR_surface is refused by the loader or the ICD. */
        const char *xlib_only[1]={VK_KHR_XLIB_SURFACE_EXTENSION_NAME};ii.enabledExtensionCount=1;ii.ppEnabledExtensionNames=xlib_only;
        VkResult r=vkCreateInstance(&ii,NULL,&instance);
        printf("GUEST_VK_WSI_XLIB_WITHOUT_SURFACE result=%d\n",(int)r);fflush(stdout);
        if(r==VK_SUCCESS){vkDestroyInstance(instance,NULL);instance=VK_NULL_HANDLE;}
        printf("GUEST_VK_WSI_PROC_DISABLED instance_null=5\n");fflush(stdout);
    }
    ii.enabledExtensionCount=3;ii.ppEnabledExtensionNames=surface_exts;
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);
    PFN_vkCreateXlibSurfaceKHR create_xlib=(PFN_vkCreateXlibSurfaceKHR)vkGetInstanceProcAddr(instance,"vkCreateXlibSurfaceKHR");
    PFN_vkCreateXcbSurfaceKHR create_xcb=(PFN_vkCreateXcbSurfaceKHR)vkGetInstanceProcAddr(instance,"vkCreateXcbSurfaceKHR");
    CHECK(create_xlib&&create_xlib==vkCreateXlibSurfaceKHR&&create_xcb&&create_xcb==vkCreateXcbSurfaceKHR);
    CHECK(vkGetInstanceProcAddr(instance,"vkGetPhysicalDeviceSurfaceCapabilitiesKHR")&&vkGetInstanceProcAddr(instance,"vkDestroySurfaceKHR"));
    CHECK(!vkGetInstanceProcAddr(instance,"vkCreateWaylandSurfaceKHR")&&!vkGetInstanceProcAddr(instance,"vkGuestUnknownFunctionKHR"));
    uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(count==1&&(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT));
    /* Surfaces. */
    {
        VkXlibSurfaceCreateInfoKHR xi={.sType=VK_STRUCTURE_TYPE_XLIB_SURFACE_CREATE_INFO_KHR,.dpy=dpy,.window=0};
        CHECK(vkCreateXlibSurfaceKHR(instance,&xi,NULL,&xsurf)!=VK_SUCCESS);xsurf=VK_NULL_HANDLE;               /* no window */
        xi.window=xwin;CHECK(vkCreateXlibSurfaceKHR(instance,&xi,NULL,&xsurf)==VK_SUCCESS&&xsurf);
        xi.window=big;CHECK(vkCreateXlibSurfaceKHR(instance,&xi,NULL,&bsurf)==VK_SUCCESS&&bsurf);
        VkXcbSurfaceCreateInfoKHR ci={.sType=VK_STRUCTURE_TYPE_XCB_SURFACE_CREATE_INFO_KHR,.connection=xc,.window=cwin};
        CHECK(vkCreateXcbSurfaceKHR(instance,&ci,NULL,&csurf)==VK_SUCCESS&&csurf);
        const VisualID visual=XVisualIDFromVisual(DefaultVisual(dpy,DefaultScreen(dpy)));
        CHECK(vkGetPhysicalDeviceXlibPresentationSupportKHR(physical,0,dpy,visual)==VK_TRUE);
        CHECK(vkGetPhysicalDeviceXlibPresentationSupportKHR(physical,1,dpy,visual)==VK_FALSE);
        xcb_screen_t *screen=xcb_setup_roots_iterator(xcb_get_setup(xc)).data;
        CHECK(vkGetPhysicalDeviceXcbPresentationSupportKHR(physical,0,xc,screen->root_visual)==VK_TRUE);
        VkBool32 supported=VK_FALSE;
        CHECK(vkGetPhysicalDeviceSurfaceSupportKHR(physical,0,xsurf,&supported)==VK_SUCCESS&&supported==VK_TRUE);
        CHECK(vkGetPhysicalDeviceSurfaceSupportKHR(physical,0,csurf,&supported)==VK_SUCCESS&&supported==VK_TRUE);
        CHECK(vkGetPhysicalDeviceSurfaceSupportKHR(physical,1,xsurf,&supported)==VK_SUCCESS&&supported==VK_FALSE);
        printf("GUEST_VK_WSI_SURFACES_CREATED xlib=2 xcb=1 support_family0=1\n");fflush(stdout);
    }
    /* Capabilities: currentExtent follows the real window (clamped to 128). */
    {
        VkSurfaceCapabilitiesKHR caps;
        CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical,xsurf,&caps)==VK_SUCCESS);
        CHECK(caps.currentExtent.width==XW&&caps.currentExtent.height==XH&&caps.minImageCount==2&&caps.maxImageCount==3);
        CHECK(caps.minImageExtent.width==1&&caps.maxImageExtent.width==128&&caps.maxImageExtent.height==128&&caps.maxImageArrayLayers==1);
        CHECK(caps.supportedTransforms==VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR&&caps.currentTransform==VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR);
        CHECK(caps.supportedCompositeAlpha==VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR&&caps.supportedUsageFlags==(VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT));
        CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical,bsurf,&caps)==VK_SUCCESS&&caps.currentExtent.width==128&&caps.currentExtent.height==128);
        CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical,csurf,&caps)==VK_SUCCESS&&caps.currentExtent.width==CW&&caps.currentExtent.height==CH);
        /* The extent is live: resizing the X window changes currentExtent. */
        XResizeWindow(dpy,xwin,XW-16,XH-8);XSync(dpy,False);
        CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical,xsurf,&caps)==VK_SUCCESS&&caps.currentExtent.width==XW-16&&caps.currentExtent.height==XH-8);
        XResizeWindow(dpy,xwin,XW,XH);XSync(dpy,False);
        CHECK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical,xsurf,&caps)==VK_SUCCESS&&caps.currentExtent.width==XW&&caps.currentExtent.height==XH);
        printf("GUEST_VK_WSI_CAPABILITIES xlib=%ux%u big=128x128 xcb=%ux%u images=2..3 resized=1\n",XW,XH,CW,CH);fflush(stdout);
        /* Formats and present modes, two-call pattern. */
        uint32_t n=0;VkSurfaceFormatKHR formats[4];
        CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physical,xsurf,&n,NULL)==VK_SUCCESS&&n==1);
        n=0;CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physical,xsurf,&n,formats)==VK_INCOMPLETE&&n==0);
        n=4;CHECK(vkGetPhysicalDeviceSurfaceFormatsKHR(physical,xsurf,&n,formats)==VK_SUCCESS&&n==1);
        CHECK(formats[0].format==VK_FORMAT_R8G8B8A8_UNORM&&formats[0].colorSpace==VK_COLOR_SPACE_SRGB_NONLINEAR_KHR);
        VkPresentModeKHR modes[4];n=0;
        CHECK(vkGetPhysicalDeviceSurfacePresentModesKHR(physical,csurf,&n,NULL)==VK_SUCCESS&&n==3);
        n=1;CHECK(vkGetPhysicalDeviceSurfacePresentModesKHR(physical,csurf,&n,modes)==VK_INCOMPLETE&&n==1&&modes[0]==VK_PRESENT_MODE_FIFO_KHR);
        n=4;CHECK(vkGetPhysicalDeviceSurfacePresentModesKHR(physical,csurf,&n,modes)==VK_SUCCESS&&n==3&&modes[0]==VK_PRESENT_MODE_FIFO_KHR&&modes[1]==VK_PRESENT_MODE_IMMEDIATE_KHR&&modes[2]==VK_PRESENT_MODE_MAILBOX_KHR);
        printf("GUEST_VK_WSI_FORMATS formats=1 r8g8b8a8_unorm_srgb_nonlinear=1 modes=3 fifo=1 immediate=1 mailbox=1 incomplete=2\n");fflush(stdout);
    }
    /* Device extensions: VK_KHR_swapchain is listed. */
    {
        uint32_t n=0;VkExtensionProperties props[8];
        CHECK(vkEnumerateDeviceExtensionProperties(physical,NULL,&n,NULL)==VK_SUCCESS&&n==1);
        n=0;CHECK(vkEnumerateDeviceExtensionProperties(physical,NULL,&n,props)==VK_INCOMPLETE&&n==0);
        n=8;CHECK(vkEnumerateDeviceExtensionProperties(physical,NULL,&n,props)==VK_SUCCESS&&n==1&&!strcmp(props[0].extensionName,VK_KHR_SWAPCHAIN_EXTENSION_NAME));
        printf("GUEST_VK_WSI_DEVICE_EXTENSIONS count=1 swapchain=1\n");fflush(stdout);
    }
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};
    /* Negative: unknown device extension; device without swapchain returns NULL device procs. */
    {
        const char *unknown[1]={"VK_KHR_display_swapchain"};VkDeviceCreateInfo di=device_info(unknown,1,&qi);
        CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_ERROR_EXTENSION_NOT_PRESENT&&!device);
        di=device_info(NULL,0,&qi);CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS&&device);
        CHECK(!vkGetDeviceProcAddr(device,"vkCreateSwapchainKHR"));CHECK(!vkGetDeviceProcAddr(device,"vkGetSwapchainImagesKHR"));
        CHECK(!vkGetDeviceProcAddr(device,"vkAcquireNextImageKHR"));CHECK(!vkGetDeviceProcAddr(device,"vkQueuePresentKHR"));
        CHECK(!vkGetDeviceProcAddr(device,"vkGuestUnknownFunctionKHR"));
        vkDestroyDevice(device,NULL);device=VK_NULL_HANDLE;
        printf("GUEST_VK_WSI_PROC_DISABLED device_null=5\n");fflush(stdout);
    }
    const char *swapchain_ext[1]={VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    {VkDeviceCreateInfo di=device_info(swapchain_ext,1,&qi);CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS&&device);}
    vkGetDeviceQueue(device,0,0,&queue);CHECK(queue);
    PFN_vkCreateSwapchainKHR create_swapchain=(PFN_vkCreateSwapchainKHR)vkGetDeviceProcAddr(device,"vkCreateSwapchainKHR");
    PFN_vkQueuePresentKHR queue_present=(PFN_vkQueuePresentKHR)vkGetDeviceProcAddr(device,"vkQueuePresentKHR");
    CHECK(create_swapchain&&queue_present&&vkGetDeviceProcAddr(device,"vkGetSwapchainImagesKHR")&&vkGetDeviceProcAddr(device,"vkAcquireNextImageKHR")&&vkGetDeviceProcAddr(device,"vkDestroySwapchainKHR"));
    CHECK(!vkGetDeviceProcAddr(device,"vkAcquireNextImage2KHR")&&!vkGetDeviceProcAddr(device,"vkGuestUnknownFunctionKHR"));
    /* Readback buffer, render pass, command buffer. */
    {
        VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=READ_BYTES,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
        CHECK(vkCreateBuffer(device,&bi,NULL,&readback)==VK_SUCCESS);VkMemoryRequirements mr;vkGetBufferMemoryRequirements(device,readback,&mr);CHECK(mr.memoryTypeBits==2);
        VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=TOTAL,.memoryTypeIndex=1};
        CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,readback,read_mem,0)==VK_SUCCESS);
        CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
        VkAttachmentDescription a={.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,
            .stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkSubpassDescription s={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref};
        VkRenderPassCreateInfo pi={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=1,.pAttachments=&a,.subpassCount=1,.pSubpasses=&s};
        CHECK(vkCreateRenderPass(device,&pi,NULL,&pass)==VK_SUCCESS);
        VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&cpool)==VK_SUCCESS);
        VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=cpool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};
        CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    }
    /* Swapchain creation refusals: every one leaves *out NULL. */
    {
        VkSwapchainKHR bad=VK_NULL_HANDLE;VkSwapchainCreateInfoKHR si=swapchain_info(xsurf,3,XW,XH,VK_PRESENT_MODE_FIFO_KHR,VK_NULL_HANDLE);unsigned rejected=0;
#define REJECT(field_change,expected) do{si=swapchain_info(xsurf,3,XW,XH,VK_PRESENT_MODE_FIFO_KHR,VK_NULL_HANDLE);field_change;bad=VK_NULL_HANDLE;\
        CHECK(vkCreateSwapchainKHR(device,&si,NULL,&bad)==(expected)&&!bad);rejected++;}while(0)
        REJECT(si.imageExtent.width=0,VK_ERROR_INITIALIZATION_FAILED);                         /* zero extent */
        REJECT(si.imageExtent.width=129,VK_ERROR_INITIALIZATION_FAILED);                       /* beyond maxImageExtent */
        REJECT(si.imageExtent.height=129,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageFormat=VK_FORMAT_B8G8R8A8_UNORM,VK_ERROR_INITIALIZATION_FAILED);         /* unsupported format */
        REJECT(si.imageFormat=VK_FORMAT_R8G8B8A8_SRGB,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageColorSpace=VK_COLOR_SPACE_EXTENDED_SRGB_LINEAR_EXT,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.minImageCount=1,VK_ERROR_INITIALIZATION_FAILED);                             /* below minImageCount */
        REJECT(si.minImageCount=4,VK_ERROR_INITIALIZATION_FAILED);                             /* above maxImageCount */
        REJECT(si.presentMode=VK_PRESENT_MODE_MAILBOX_KHR,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageUsage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_SAMPLED_BIT,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageUsage=VK_IMAGE_USAGE_TRANSFER_SRC_BIT,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageArrayLayers=2,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.preTransform=VK_SURFACE_TRANSFORM_ROTATE_90_BIT_KHR,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.compositeAlpha=VK_COMPOSITE_ALPHA_PRE_MULTIPLIED_BIT_KHR,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.imageSharingMode=VK_SHARING_MODE_CONCURRENT,VK_ERROR_INITIALIZATION_FAILED);
        REJECT(si.flags=VK_SWAPCHAIN_CREATE_MUTABLE_FORMAT_BIT_KHR,VK_ERROR_INITIALIZATION_FAILED);
#undef REJECT
        printf("GUEST_VK_WSI_SWAPCHAIN_REJECTED count=%u\n",rejected);fflush(stdout);
    }
    /* The 3-image FIFO swapchain on the Xlib window. */
    static const float colors[4][4]={{1,0,0,1},{0,1,0,1},{0,0,1,1},{1,1,0,1}};
    {
        VkSwapchainCreateInfoKHR si=swapchain_info(xsurf,3,XW,XH,VK_PRESENT_MODE_FIFO_KHR,VK_NULL_HANDLE);
        CHECK(create_swapchain(device,&si,NULL,&chain)==VK_SUCCESS&&chain);
        VkSwapchainKHR second=VK_NULL_HANDLE;CHECK(vkCreateSwapchainKHR(device,&si,NULL,&second)==VK_ERROR_NATIVE_WINDOW_IN_USE_KHR&&!second);
        uint32_t n=0;VkImage images[4]={0};CHECK(vkGetSwapchainImagesKHR(device,chain,&n,NULL)==VK_SUCCESS&&n==3);
        n=2;CHECK(vkGetSwapchainImagesKHR(device,chain,&n,images)==VK_INCOMPLETE&&n==2);
        n=4;CHECK(vkGetSwapchainImagesKHR(device,chain,&n,images)==VK_SUCCESS&&n==3);
        CHECK(images[0]&&images[1]&&images[2]&&images[0]!=images[1]&&images[1]!=images[2]&&images[0]!=images[2]);
        VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,images[0],&mr);CHECK(mr.size==XW*XH*4&&mr.memoryTypeBits==1);
        /* Destroy-order negative: vkDestroyImage on a swapchain-owned image is ignored; it stays renderable. */
        vkDestroyImage(device,images[1],NULL);
        VkImage again[3]={0};n=3;CHECK(vkGetSwapchainImagesKHR(device,chain,&n,again)==VK_SUCCESS&&n==3&&again[1]==images[1]);
        for(unsigned k=0;k<3;k++)CHECK(render_image(images[k],XW,XH,colors[k],"xlib-fifo",k));
        /* Images keep their contents independently: re-render image 0 last with a new colour. */
        CHECK(render_image(images[0],XW,XH,colors[3],"xlib-fifo-rerender",0));
        uint32_t index=77;
        CHECK(vkAcquireNextImageKHR(device,chain,0,VK_NULL_HANDLE,VK_NULL_HANDLE,&index)==VK_ERROR_FEATURE_NOT_PRESENT);
        VkResult present_result=VK_SUCCESS;uint32_t zero=0;
        VkPresentInfoKHR pi={.sType=VK_STRUCTURE_TYPE_PRESENT_INFO_KHR,.swapchainCount=1,.pSwapchains=&chain,.pImageIndices=&zero,.pResults=&present_result};
        CHECK(queue_present(queue,&pi)==VK_ERROR_FEATURE_NOT_PRESENT);
        printf("GUEST_VK_WSI_SWAPCHAIN_PASS images=3 extent=%ux%u mode=fifo rendered=4 acquire=feature_not_present present=feature_not_present\n",XW,XH);fflush(stdout);
        /* oldSwapchain retirement: a 2-image IMMEDIATE replacement. */
        si=swapchain_info(xsurf,2,XW,XH,VK_PRESENT_MODE_IMMEDIATE_KHR,chain);
        CHECK(vkCreateSwapchainKHR(device,&si,NULL,&chain2)==VK_SUCCESS&&chain2&&chain2!=chain);
        CHECK(vkAcquireNextImageKHR(device,chain,0,VK_NULL_HANDLE,VK_NULL_HANDLE,&index)==VK_ERROR_OUT_OF_DATE_KHR);
        CHECK(vkAcquireNextImageKHR(device,chain2,0,VK_NULL_HANDLE,VK_NULL_HANDLE,&index)==VK_ERROR_FEATURE_NOT_PRESENT);
        VkSwapchainKHR third=VK_NULL_HANDLE;si.oldSwapchain=chain;                                /* a retired swapchain cannot be replaced again */
        CHECK(vkCreateSwapchainKHR(device,&si,NULL,&third)!=VK_SUCCESS&&!third);
        si.oldSwapchain=VK_NULL_HANDLE;CHECK(vkCreateSwapchainKHR(device,&si,NULL,&third)==VK_ERROR_NATIVE_WINDOW_IN_USE_KHR&&!third);
        /* The retired swapchain still owns valid images until destroyed. */
        n=4;CHECK(vkGetSwapchainImagesKHR(device,chain,&n,again)==VK_SUCCESS&&n==3&&again[2]==images[2]);
        CHECK(render_image(images[2],XW,XH,colors[1],"xlib-retired",2));
        vkDestroySwapchainKHR(device,chain,NULL);chain=VK_NULL_HANDLE;
        n=0;CHECK(vkGetSwapchainImagesKHR(device,chain2,&n,NULL)==VK_SUCCESS&&n==2);n=2;CHECK(vkGetSwapchainImagesKHR(device,chain2,&n,images)==VK_SUCCESS&&n==2);
        for(unsigned k=0;k<2;k++)CHECK(render_image(images[k],XW,XH,colors[2-k],"xlib-immediate",k));
        printf("GUEST_VK_WSI_RETIRE_PASS old=out_of_date replacement_images=2 replace_retired=refused in_use=refused\n");fflush(stdout);
    }
    /* XCB surface: 2-image swapchain at the window extent. */
    {
        VkSwapchainCreateInfoKHR si=swapchain_info(csurf,2,CW,CH,VK_PRESENT_MODE_FIFO_KHR,VK_NULL_HANDLE);
        CHECK(vkCreateSwapchainKHR(device,&si,NULL,&cchain)==VK_SUCCESS&&cchain);
        uint32_t n=2;VkImage images[2];CHECK(vkGetSwapchainImagesKHR(device,cchain,&n,images)==VK_SUCCESS&&n==2);
        for(unsigned k=0;k<2;k++)CHECK(render_image(images[k],CW,CH,colors[k?3:0],"xcb-fifo",k));
        /* Destroy-order negative: destroying the surface first retires the swapchain. */
        vkDestroySurfaceKHR(instance,csurf,NULL);csurf=VK_NULL_HANDLE;uint32_t index=0;
        CHECK(vkAcquireNextImageKHR(device,cchain,0,VK_NULL_HANDLE,VK_NULL_HANDLE,&index)==VK_ERROR_OUT_OF_DATE_KHR);
        vkDestroySwapchainKHR(device,cchain,NULL);cchain=VK_NULL_HANDLE;
        printf("GUEST_VK_WSI_XCB_PASS images=2 extent=%ux%u surface_first=out_of_date\n",CW,CH);fflush(stdout);
    }
    /* Large window: extent 128x128 (clamped) swapchain, then destroyed before the device. */
    {
        VkSwapchainCreateInfoKHR si=swapchain_info(bsurf,2,128,128,VK_PRESENT_MODE_FIFO_KHR,VK_NULL_HANDLE);VkSwapchainKHR bchain=VK_NULL_HANDLE;
        CHECK(vkCreateSwapchainKHR(device,&si,NULL,&bchain)==VK_SUCCESS&&bchain);
        uint32_t n=0;CHECK(vkGetSwapchainImagesKHR(device,bchain,&n,NULL)==VK_SUCCESS&&n==2);
        VkImage image;n=1;CHECK(vkGetSwapchainImagesKHR(device,bchain,&n,&image)==VK_INCOMPLETE&&n==1);
        VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,image,&mr);CHECK(mr.size==128*128*4);
        vkDestroySwapchainKHR(device,bchain,NULL);
        printf("GUEST_VK_WSI_CLAMPED_PASS images=2 extent=128x128\n");fflush(stdout);
    }
    result=0;
done:
    if(device){
        if(cb)vkFreeCommandBuffers(device,cpool,1,&cb);if(cpool)vkDestroyCommandPool(device,cpool,NULL);if(pass)vkDestroyRenderPass(device,pass,NULL);
        if(mapped)vkUnmapMemory(device,read_mem);if(readback)vkDestroyBuffer(device,readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(chain)vkDestroySwapchainKHR(device,chain,NULL);if(chain2)vkDestroySwapchainKHR(device,chain2,NULL);if(cchain)vkDestroySwapchainKHR(device,cchain,NULL);
        vkDestroyDevice(device,NULL);
    }
    if(instance){
        if(xsurf)vkDestroySurfaceKHR(instance,xsurf,NULL);if(bsurf)vkDestroySurfaceKHR(instance,bsurf,NULL);if(csurf)vkDestroySurfaceKHR(instance,csurf,NULL);
        vkDestroyInstance(instance,NULL);
    }
    if(xc){if(cwin)xcb_destroy_window(xc,cwin);xcb_flush(xc);xcb_disconnect(xc);}
    if(dpy){if(xwin)XDestroyWindow(dpy,xwin);if(big)XDestroyWindow(dpy,big);XCloseDisplay(dpy);}
    printf("GUEST_VK_WSI_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
