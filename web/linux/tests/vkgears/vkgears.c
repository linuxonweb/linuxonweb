/*
 * vkgears (packet V1): glxgears on the public Vulkan API for the wasm32 Linux
 * guest (static Khronos loader + experimental guest ICD, host WebGPU with a
 * WebGL2 fallback over virtio-vsock). Comparison partner of glgears (S1).
 *
 * Scene: glxgears unchanged in content. The three gears are built on the CPU
 * by replaying glxgears' gear() through a tiny glBegin/glNormal/glVertex
 * emulator (QUAD_STRIP/QUADS -> triangles, current-normal tracking, GL flat
 * shading = provoking vertex normal on every vertex of the quad, smooth inner
 * cylinder). Same colours, light (eye-space direction (5,5,10), ambient 0.2,
 * diffuse 1, no specular), frustum(-1,1,-h,h,5,60), translate -40, view
 * rotation 20/30/0, gear placement and 70 degrees/second. Lighting is evaluated
 * per vertex in the vertex shader (as fixed function does).
 * Differences: no back-face culling (the guest ICD only accepts CULL_NONE; the
 * gears are closed, so the depth test hides back faces), D32 depth instead of
 * depth24, and the render target is limited by the ICD (maxImageDimension2D,
 * 128 today): the scene is rendered at the window aspect into at most 128x128
 * and nearest-scaled to the -size window when presenting.
 *
 * Per frame: one vertex buffer (all three gears, 2640 vertices), one uniform
 * buffer with three 256-byte aligned regions (mvp, modelview, colour per gear),
 * one descriptor set per gear, one render pass with three draws, one submit
 * followed by vkQueueWaitIdle.
 *   present (default): + copy colour image to a host buffer, wait, convert and
 *     XPutImage into an X11 window (CPU copy, like glgears/vkcube-lite).
 *   -nopresent: render pass only, submit + vkQueueWaitIdle, no readback and no
 *     X11 at all (glgears -nopresent ends each frame with glFinish).
 *   -wsi: render into VK_KHR_swapchain images of an Xlib surface and
 *     vkQueuePresentKHR them (no CPU readback; the ICD presents on the host).
 *
 * Output: glxgears-style "N frames in 5.0 seconds = X FPS" lines plus
 * parseable VKGEARS_START/READY/FPS/DONE/ERROR lines.
 * Options: -nopresent  -seconds N (0 = forever)  -size WxH  -info  -interval S
 * Exit codes: 0 ok, 1 usage, 3 GPU session lost or refused, 4 X11 failure,
 * 5 Vulkan setup failure.
 */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <math.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "shaders.h"

#ifndef M_PI
#define M_PI 3.14159265
#endif

static void say(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void say(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); fflush(stdout);
}
static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

/* ---- glxgears geometry through a minimal immediate-mode emulator --------- */
#define MAX_VERTICES 2640
#define STRIDE 24 /* vec3 position + vec3 normal */
struct vtx { float p[3], n[3]; };
static struct vtx mesh[MAX_VERTICES]; static int mesh_count, mesh_overflow;
enum { PRIM_QUADS, PRIM_QUAD_STRIP };
static struct vtx prim[512]; static int prim_count, prim_mode, flat_shading;
static float cur_normal[3] = {0, 0, 1};

static void emit(const struct vtx *v, const float *normal) {
    if (mesh_count >= MAX_VERTICES) { mesh_overflow = 1; return; }
    mesh[mesh_count] = *v;
    if (normal) memcpy(mesh[mesh_count].n, normal, sizeof mesh[0].n);
    mesh_count++;
}
static void quad(int a, int b, int c, int d, int provoking) {
    const float *n = flat_shading ? prim[provoking].n : NULL;
    emit(&prim[a], n); emit(&prim[b], n); emit(&prim[c], n);
    emit(&prim[a], n); emit(&prim[c], n); emit(&prim[d], n);
}
static void glShadeModelFlat(int flat) { flat_shading = flat; }
static void glNormal3f(float x, float y, float z) { cur_normal[0] = x; cur_normal[1] = y; cur_normal[2] = z; }
static void glBegin(int mode) { prim_mode = mode; prim_count = 0; }
static void glVertex3f(float x, float y, float z) {
    if (prim_count >= (int)(sizeof prim / sizeof prim[0])) { mesh_overflow = 1; return; }
    struct vtx v = {{x, y, z}, {cur_normal[0], cur_normal[1], cur_normal[2]}};
    prim[prim_count++] = v;
}
static void glEnd(void) {
    if (prim_mode == PRIM_QUADS) {
        /* GL quad i: vertices 4i..4i+3, provoking vertex 4i+3. */
        for (int i = 0; i + 3 < prim_count; i += 4) quad(i, i + 1, i + 2, i + 3, i + 3);
    } else {
        /* GL quad strip quad k: vertices 2k, 2k+1, 2k+3, 2k+2; provoking vertex 2k+3. */
        for (int k = 0; 2 * k + 3 < prim_count; k++) quad(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2, 2 * k + 3);
    }
    prim_count = 0;
}

/* glxgears gear(), statement for statement (Brian Paul, public domain / MIT). */
static void gear(float inner_radius, float outer_radius, float width, int teeth, float tooth_depth) {
    int i;
    float r0, r1, r2, angle, da, u, v, len;
    r0 = inner_radius;
    r1 = outer_radius - tooth_depth / 2.0;
    r2 = outer_radius + tooth_depth / 2.0;
    da = 2.0 * M_PI / teeth / 4.0;
    glShadeModelFlat(1);
    glNormal3f(0.0, 0.0, 1.0);
    /* front face */
    glBegin(PRIM_QUAD_STRIP);
    for (i = 0; i <= teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
        glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
        if (i < teeth) {
            glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
            glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), width * 0.5);
        }
    }
    glEnd();
    /* front sides of teeth */
    glBegin(PRIM_QUADS);
    for (i = 0; i < teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
        glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), width * 0.5);
        glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da), width * 0.5);
        glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), width * 0.5);
    }
    glEnd();
    glNormal3f(0.0, 0.0, -1.0);
    /* back face */
    glBegin(PRIM_QUAD_STRIP);
    for (i = 0; i <= teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
        glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
        if (i < teeth) {
            glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), -width * 0.5);
            glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
        }
    }
    glEnd();
    /* back sides of teeth */
    glBegin(PRIM_QUADS);
    for (i = 0; i < teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), -width * 0.5);
        glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da), -width * 0.5);
        glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), -width * 0.5);
        glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
    }
    glEnd();
    /* outward faces of teeth */
    glBegin(PRIM_QUAD_STRIP);
    for (i = 0; i < teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glVertex3f(r1 * cos(angle), r1 * sin(angle), width * 0.5);
        glVertex3f(r1 * cos(angle), r1 * sin(angle), -width * 0.5);
        u = r2 * cos(angle + da) - r1 * cos(angle);
        v = r2 * sin(angle + da) - r1 * sin(angle);
        len = sqrt(u * u + v * v);
        u /= len;
        v /= len;
        glNormal3f(v, -u, 0.0);
        glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), width * 0.5);
        glVertex3f(r2 * cos(angle + da), r2 * sin(angle + da), -width * 0.5);
        glNormal3f(cos(angle), sin(angle), 0.0);
        glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da), width * 0.5);
        glVertex3f(r2 * cos(angle + 2 * da), r2 * sin(angle + 2 * da), -width * 0.5);
        u = r1 * cos(angle + 3 * da) - r2 * cos(angle + 2 * da);
        v = r1 * sin(angle + 3 * da) - r2 * sin(angle + 2 * da);
        glNormal3f(v, -u, 0.0);
        glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), width * 0.5);
        glVertex3f(r1 * cos(angle + 3 * da), r1 * sin(angle + 3 * da), -width * 0.5);
        glNormal3f(cos(angle), sin(angle), 0.0);
    }
    glVertex3f(r1 * cos(0), r1 * sin(0), width * 0.5);
    glVertex3f(r1 * cos(0), r1 * sin(0), -width * 0.5);
    glEnd();
    glShadeModelFlat(0);
    /* inside radius cylinder (smooth) */
    glBegin(PRIM_QUAD_STRIP);
    for (i = 0; i <= teeth; i++) {
        angle = i * 2.0 * M_PI / teeth;
        glNormal3f(-cos(angle), -sin(angle), 0.0);
        glVertex3f(r0 * cos(angle), r0 * sin(angle), -width * 0.5);
        glVertex3f(r0 * cos(angle), r0 * sin(angle), width * 0.5);
    }
    glEnd();
}
static int gear_first[3], gear_count[3];
static const float gear_color[3][4] = {{0.8f, 0.1f, 0.0f, 1.0f}, {0.0f, 0.8f, 0.2f, 1.0f}, {0.2f, 0.2f, 1.0f, 1.0f}};
static int build_gears(void) {
    mesh_count = 0; mesh_overflow = 0;
    gear_first[0] = mesh_count; gear(1.0, 4.0, 1.0, 20, 0.7); gear_count[0] = mesh_count - gear_first[0];
    gear_first[1] = mesh_count; gear(0.5, 2.0, 2.0, 10, 0.7); gear_count[1] = mesh_count - gear_first[1];
    gear_first[2] = mesh_count; gear(1.3, 2.0, 0.5, 10, 0.7); gear_count[2] = mesh_count - gear_first[2];
    return !mesh_overflow && mesh_count == MAX_VERTICES;
}

/* ---- Maths (column-major, as OpenGL) ------------------------------------ */
typedef struct { float m[16]; } mat4;
static mat4 mul(mat4 a, mat4 b) {
    mat4 r; for (int c = 0; c < 4; c++) for (int row = 0; row < 4; row++) {
        float s = 0; for (int k = 0; k < 4; k++) s += a.m[k * 4 + row] * b.m[c * 4 + k]; r.m[c * 4 + row] = s; }
    return r;
}
static mat4 identity(void) { mat4 r = {{0}}; r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1; return r; }
/* glRotatef: angle in degrees. */
static mat4 rotatef(float degrees, float x, float y, float z) {
    float a = degrees * (float)M_PI / 180.0f;
    float c = cosf(a), s = sinf(a), t = 1 - c, n = sqrtf(x * x + y * y + z * z); x /= n; y /= n; z /= n;
    mat4 r = identity();
    r.m[0] = t * x * x + c;     r.m[4] = t * x * y - s * z; r.m[8]  = t * x * z + s * y;
    r.m[1] = t * x * y + s * z; r.m[5] = t * y * y + c;     r.m[9]  = t * y * z - s * x;
    r.m[2] = t * x * z - s * y; r.m[6] = t * y * z + s * x; r.m[10] = t * z * z + c;
    return r;
}
static mat4 translatef(float x, float y, float z) { mat4 r = identity(); r.m[12] = x; r.m[13] = y; r.m[14] = z; return r; }
static mat4 frustum(float l, float r_, float b, float t, float n, float f) {
    mat4 r = {{0}};
    r.m[0] = 2 * n / (r_ - l); r.m[5] = 2 * n / (t - b); r.m[8] = (r_ + l) / (r_ - l); r.m[9] = (t + b) / (t - b);
    r.m[10] = -(f + n) / (f - n); r.m[11] = -1; r.m[14] = -2 * f * n / (f - n);
    return r;
}
/* GL clip space (y up, z in [-w,w]) -> Vulkan (y down, z in [0,w]). With y
 * flipped, image row 0 is the top of the picture, as X11 expects. */
static mat4 gl_to_vulkan(void) { mat4 r = identity(); r.m[5] = -1; r.m[10] = 0.5f; r.m[14] = 0.5f; return r; }

/* ---- X11 presentation (CPU copy, nearest scaling) ------------------------ */
static Display *dpy; static Window win; static GC gc; static XImage *image; static Atom wm_delete;
static int x_error_code, direct_rgb;
static int on_x_error(Display *d, XErrorEvent *e) {
    (void)d; x_error_code = e->error_code;
    say("VKGEARS_X11_ERROR code=%u request=%u minor=%u\n", e->error_code, e->request_code, e->minor_code);
    return 0;
}
static int on_x_io_error(Display *d) { (void)d; say("VKGEARS_X11_LOST display connection closed\n"); _exit(4); return 0; }
static unsigned long component(unsigned v, unsigned long mask) {
    unsigned shift = 0; if (!mask) return 0;
    while (!(mask & 1)) { mask >>= 1; shift++; }
    return (unsigned long)(((uint64_t)v * mask + 127) / 255) << shift;
}
static int x11_open(int w, int h) {
    XSetErrorHandler(on_x_error); XSetIOErrorHandler(on_x_io_error);
    const char *name = getenv("DISPLAY"); if (!name || !*name) name = ":0";
    for (int attempt = 1; attempt <= 60 && !dpy; attempt++) {
        dpy = XOpenDisplay(name);
        if (!dpy) { if (attempt == 1 || attempt % 10 == 0) say("VKGEARS_X11_RETRY display=%s attempt=%d\n", name, attempt); sleep(1); }
    }
    if (!dpy) return 0;
    int screen = DefaultScreen(dpy); Visual *visual = DefaultVisual(dpy, screen);
    if (visual->class != TrueColor) { say("VKGEARS_X11_UNSUPPORTED visual class=%d\n", visual->class); return 0; }
    int sw = DisplayWidth(dpy, screen), sh = DisplayHeight(dpy, screen);
    int x = sw > w + 64 ? sw - w - 32 : 0, y = sh > h + 96 ? 48 : 0;
    win = XCreateSimpleWindow(dpy, RootWindow(dpy, screen), x, y, w, h, 0, 0, BlackPixel(dpy, screen));
    if (!win) return 0;
    XStoreName(dpy, win, "vkgears");
    XClassHint cls = { .res_name = "vkgears", .res_class = "Vkgears" }; XSetClassHint(dpy, win, &cls);
    XSizeHints *hints = XAllocSizeHints();
    if (hints) { hints->flags = PMinSize | PMaxSize | PPosition | USPosition; hints->x = x; hints->y = y;
        hints->min_width = hints->max_width = w; hints->min_height = hints->max_height = h;
        XSetWMNormalHints(dpy, win, hints); XFree(hints); }
    wm_delete = XInternAtom(dpy, "WM_DELETE_WINDOW", False); XSetWMProtocols(dpy, win, &wm_delete, 1);
    XSelectInput(dpy, win, ExposureMask | StructureNotifyMask | KeyPressMask);
    gc = XCreateGC(dpy, win, 0, NULL); if (!gc) return 0;
    image = XCreateImage(dpy, visual, DefaultDepth(dpy, screen), ZPixmap, 0, NULL, w, h, 32, 0);
    if (!image || image->bytes_per_line <= 0) return 0;
    image->data = calloc((size_t)h, (size_t)image->bytes_per_line); if (!image->data) return 0;
    direct_rgb = image->bits_per_pixel == 32 && image->byte_order == LSBFirst && image->red_mask == 0xff0000 &&
                 image->green_mask == 0xff00 && image->blue_mask == 0xff;
    XMapRaised(dpy, win); XSync(dpy, False);
    say("VKGEARS_X11_OPEN display=%s screen=%dx%d window=%dx%d+%d+%d depth=%d bpp=%d direct_rgb=%d\n",
        name, sw, sh, w, h, x, y, DefaultDepth(dpy, screen), image->bits_per_pixel, direct_rgb);
    return !x_error_code;
}
/* Returns 0 when the window was closed. */
static int x11_events(void) {
    while (XPending(dpy)) {
        XEvent e; XNextEvent(dpy, &e);
        if (e.type == DestroyNotify) return 0;
        if (e.type == ClientMessage && (Atom)e.xclient.data.l[0] == wm_delete) return 0;
        if (e.type == KeyPress) { KeySym k = XLookupKeysym(&e.xkey, 0); if (k == 'q' || k == 0xff1b) return 0; }
    }
    return 1;
}
/* rgba: rw x rh, top row first (Vulkan readback with the y-flipped projection). */
static int *xmap;
/* Per-phase seconds accumulated since the last FPS line (render, convert, XPutImage, XSync). */
static double ph_render, ph_convert, ph_put, ph_sync;
static void x11_present(const unsigned char *rgba, int rw, int rh, int w, int h) {
    double t0 = now_s();
    for (int y = 0; y < h; y++) {
        const unsigned char *src = rgba + (size_t)((int64_t)y * rh / h) * rw * 4;
        if (direct_rgb) {
            uint32_t *out = (uint32_t *)(image->data + (size_t)y * image->bytes_per_line);
            for (int x = 0; x < w; x++) { const unsigned char *p = src + xmap[x]; out[x] = (uint32_t)p[0] << 16 | (uint32_t)p[1] << 8 | p[2]; }
        } else {
            for (int x = 0; x < w; x++) {
                const unsigned char *p = src + xmap[x];
                XPutPixel(image, x, y, component(p[0], image->red_mask) | component(p[1], image->green_mask) | component(p[2], image->blue_mask));
            }
        }
    }
    double t1 = now_s();
    XPutImage(dpy, win, gc, image, 0, 0, 0, 0, w, h);
    double t2 = now_s();
    XSync(dpy, False);
    double t3 = now_s();
    ph_convert += t1 - t0; ph_put += t2 - t1; ph_sync += t3 - t2;
}
static void x11_close(void) {
    if (!dpy) return;
    if (image) { XDestroyImage(image); image = NULL; }
    if (gc) XFreeGC(dpy, gc);
    if (win) XDestroyWindow(dpy, win);
    XSync(dpy, False); XCloseDisplay(dpy); dpy = NULL;
}

/* ---- Vulkan ---------------------------------------------------------------- */
#define UBO_STRIDE 256 /* minUniformBufferOffsetAlignment of the guest ICD */
#define UBO_RANGE 144  /* std140: mat4 mvp, mat4 modelview, vec4 color */
static int RW, RH; /* render target size */
static VkPhysicalDeviceProperties props; static VkPhysicalDevice physical;
static const char *backend = "unknown";
static VkInstance instance; static VkDevice device; static VkQueue queue; static VkCommandPool cpool; static VkCommandBuffer cb;
static VkImage color_image, own_color_image, depth_image; static VkImageView color_view, depth_view;
static VkFormat depth_format = VK_FORMAT_D32_SFLOAT; static VkImageAspectFlags depth_aspect = VK_IMAGE_ASPECT_DEPTH_BIT;
static VkDeviceMemory color_mem, depth_mem, read_mem, vertex_mem, uniform_mem;
static VkBuffer readback, vertices, uniform; static unsigned char *mapped, *vmap, *umap;
static VkDescriptorSetLayout set_layout; static VkDescriptorPool pool; static VkDescriptorSet sets[3];
static VkPipelineLayout playout; static VkRenderPass pass; static VkFramebuffer framebuffer; static VkPipeline pipeline;
static VkImageLayout color_old = VK_IMAGE_LAYOUT_UNDEFINED, depth_old = VK_IMAGE_LAYOUT_UNDEFINED;
/* -wsi: Xlib surface, swapchain images with their views/framebuffers, acquire/render semaphores. */
#define MAX_SWAP 4
static int wsi; static VkSurfaceKHR surface; static VkSwapchainKHR swapchain; static uint32_t swap_count;
static VkImage swap_images[MAX_SWAP]; static VkImageView swap_views[MAX_SWAP]; static VkFramebuffer swap_fbs[MAX_SWAP];
static VkSemaphore acquire_sem, render_sem; static VkPresentModeKHR present_mode;
#define VK(call) do { VkResult r_ = (call); if (r_ != VK_SUCCESS) { say("VKGEARS_ERROR vulkan line=%d result=%d call=%s\n", __LINE__, (int)r_, #call); \
    return r_ == VK_ERROR_DEVICE_LOST || r_ == VK_ERROR_INITIALIZATION_FAILED ? 3 : 5; } } while (0)

static VkResult make_shader(const unsigned char *bytes, size_t size, VkShaderModule *out) {
    uint32_t *copy = malloc(size); if (!copy) return VK_ERROR_OUT_OF_HOST_MEMORY; memcpy(copy, bytes, size);
    VkShaderModuleCreateInfo i = {.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, .codeSize = size, .pCode = copy};
    VkResult r = vkCreateShaderModule(device, &i, NULL, out); free(copy); return r;
}
static VkResult alloc_bind(VkBuffer buffer, VkImage img, uint32_t type, VkDeviceSize min_size, VkDeviceMemory *mem) {
    VkMemoryRequirements mr;
    if (buffer) vkGetBufferMemoryRequirements(device, buffer, &mr); else vkGetImageMemoryRequirements(device, img, &mr);
    VkMemoryAllocateInfo ai = {.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, .allocationSize = mr.size > min_size ? mr.size : min_size, .memoryTypeIndex = type};
    VkResult r = vkAllocateMemory(device, &ai, NULL, mem); if (r != VK_SUCCESS) return r;
    return buffer ? vkBindBufferMemory(device, buffer, *mem, 0) : vkBindImageMemory(device, img, *mem, 0);
}
static int create_instance(void) {
    VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .apiVersion = VK_API_VERSION_1_0, .pApplicationName = "vkgears"};
    const char *instance_ext[] = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_XLIB_SURFACE_EXTENSION_NAME}, *device_ext[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    VkInstanceCreateInfo ii = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &app,
        .enabledExtensionCount = wsi ? 2 : 0, .ppEnabledExtensionNames = wsi ? instance_ext : NULL};
    VK(vkCreateInstance(&ii, NULL, &instance));
    uint32_t count = 1; VK(vkEnumeratePhysicalDevices(instance, &count, &physical));
    if (count != 1) { say("VKGEARS_ERROR no physical device\n"); return 5; }
    vkGetPhysicalDeviceProperties(physical, &props);
    /* The ICD advertises the backend-specific vertex stride limit: 252 on WebGL2, 2048 on WebGPU. */
    backend = props.limits.maxVertexInputBindingStride == 252 ? "webgl2" : "webgpu";
    float priority = 1;
    VkDeviceQueueCreateInfo qi = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, .queueCount = 1, .pQueuePriorities = &priority};
    VkDeviceCreateInfo di = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, .queueCreateInfoCount = 1, .pQueueCreateInfos = &qi,
        .enabledExtensionCount = wsi ? 1 : 0, .ppEnabledExtensionNames = wsi ? device_ext : NULL};
    VK(vkCreateDevice(physical, &di, NULL, &device)); vkGetDeviceQueue(device, 0, 0, &queue);
    return 0;
}
static int setup_swapchain(void);
static int setup(void) {
    /* Colour + depth targets. */
    VkImageCreateInfo im = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO, .imageType = VK_IMAGE_TYPE_2D, .format = VK_FORMAT_R8G8B8A8_UNORM,
        .extent = {(uint32_t)RW, (uint32_t)RH, 1}, .mipLevels = 1, .arrayLayers = 1, .samples = VK_SAMPLE_COUNT_1_BIT,
        .tiling = VK_IMAGE_TILING_OPTIMAL, .usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
        .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
    VK(vkCreateImage(device, &im, NULL, &color_image)); VK(alloc_bind(VK_NULL_HANDLE, color_image, 0, 0, &color_mem)); own_color_image = color_image;
    /* First depth format the ICD supports at the render size (drivers may limit D32 below combined depth/stencil). */
    static const VkFormat depth_formats[] = {VK_FORMAT_D32_SFLOAT, VK_FORMAT_D24_UNORM_S8_UINT, VK_FORMAT_D16_UNORM};
    for (unsigned f = 0; f < sizeof depth_formats / sizeof *depth_formats; f++) {
        VkImageFormatProperties fp;
        if (vkGetPhysicalDeviceImageFormatProperties(physical, depth_formats[f], VK_IMAGE_TYPE_2D, VK_IMAGE_TILING_OPTIMAL,
                VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT, 0, &fp) == VK_SUCCESS && fp.maxExtent.width >= (uint32_t)RW && fp.maxExtent.height >= (uint32_t)RH) {
            depth_format = depth_formats[f]; break;
        }
    }
    depth_aspect = depth_format == VK_FORMAT_D24_UNORM_S8_UINT ? VK_IMAGE_ASPECT_DEPTH_BIT | VK_IMAGE_ASPECT_STENCIL_BIT : VK_IMAGE_ASPECT_DEPTH_BIT;
    say("VKGEARS_DEPTH format=%d render=%dx%d\n", (int)depth_format, RW, RH);
    im.format = depth_format; im.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
    VK(vkCreateImage(device, &im, NULL, &depth_image)); VK(alloc_bind(VK_NULL_HANDLE, depth_image, 0, 0, &depth_mem));
    VkImageViewCreateInfo vi = {.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO, .image = color_image, .viewType = VK_IMAGE_VIEW_TYPE_2D,
        .format = VK_FORMAT_R8G8B8A8_UNORM, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    VK(vkCreateImageView(device, &vi, NULL, &color_view));
    vi.image = depth_image; vi.format = depth_format; vi.subresourceRange.aspectMask = depth_aspect;
    VK(vkCreateImageView(device, &vi, NULL, &depth_view));
    /* Readback, vertex and uniform buffers (host-coherent memory type 1). */
    VkBufferCreateInfo bi = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO, .size = (VkDeviceSize)RW * RH * 4,
        .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT, .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
    VK(vkCreateBuffer(device, &bi, NULL, &readback)); VK(alloc_bind(readback, VK_NULL_HANDLE, 1, 0, &read_mem));
    VK(vkMapMemory(device, read_mem, 0, VK_WHOLE_SIZE, 0, (void **)&mapped));
    bi.size = MAX_VERTICES * STRIDE; bi.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    VK(vkCreateBuffer(device, &bi, NULL, &vertices)); VK(alloc_bind(vertices, VK_NULL_HANDLE, 1, 0, &vertex_mem));
    VK(vkMapMemory(device, vertex_mem, 0, VK_WHOLE_SIZE, 0, (void **)&vmap));
    memcpy(vmap, mesh, sizeof mesh);
    bi.size = 3 * UBO_STRIDE; bi.usage = VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;
    VK(vkCreateBuffer(device, &bi, NULL, &uniform)); VK(alloc_bind(uniform, VK_NULL_HANDLE, 1, 3 * UBO_STRIDE, &uniform_mem));
    VK(vkMapMemory(device, uniform_mem, 0, VK_WHOLE_SIZE, 0, (void **)&umap)); memset(umap, 0, 3 * UBO_STRIDE);
    /* One descriptor set per gear, each pointing at its 256-byte region. */
    VkDescriptorSetLayoutBinding binding = {.binding = 0, .descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, .descriptorCount = 1, .stageFlags = VK_SHADER_STAGE_VERTEX_BIT};
    VkDescriptorSetLayoutCreateInfo dli = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO, .bindingCount = 1, .pBindings = &binding};
    VK(vkCreateDescriptorSetLayout(device, &dli, NULL, &set_layout));
    VkPipelineLayoutCreateInfo pli = {.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO, .setLayoutCount = 1, .pSetLayouts = &set_layout};
    VK(vkCreatePipelineLayout(device, &pli, NULL, &playout));
    VkDescriptorPoolSize ps = {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 3};
    VkDescriptorPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO, .maxSets = 3, .poolSizeCount = 1, .pPoolSizes = &ps};
    VK(vkCreateDescriptorPool(device, &pci, NULL, &pool));
    VkDescriptorSetLayout layouts[3] = {set_layout, set_layout, set_layout};
    VkDescriptorSetAllocateInfo dai = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO, .descriptorPool = pool, .descriptorSetCount = 3, .pSetLayouts = layouts};
    VK(vkAllocateDescriptorSets(device, &dai, sets));
    VkDescriptorBufferInfo info[3]; VkWriteDescriptorSet write[3];
    for (int g = 0; g < 3; g++) {
        info[g] = (VkDescriptorBufferInfo){uniform, (VkDeviceSize)g * UBO_STRIDE, UBO_RANGE};
        write[g] = (VkWriteDescriptorSet){.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, .dstSet = sets[g], .dstBinding = 0, .descriptorCount = 1,
            .descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, .pBufferInfo = &info[g]};
    }
    vkUpdateDescriptorSets(device, 3, write, 0, NULL);
    /* Render pass: CLEAR/STORE colour and depth, layouts kept by explicit barriers. */
    VkAttachmentDescription a[2] = {
        {.format = VK_FORMAT_R8G8B8A8_UNORM, .samples = VK_SAMPLE_COUNT_1_BIT, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR, .storeOp = VK_ATTACHMENT_STORE_OP_STORE,
         .stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE, .stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE,
         .initialLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, .finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},
        {.format = depth_format, .samples = VK_SAMPLE_COUNT_1_BIT, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR, .storeOp = VK_ATTACHMENT_STORE_OP_STORE,
         .stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE, .stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE,
         .initialLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, .finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL}};
    VkAttachmentReference cref = {0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL}, dref = {1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
    VkSubpassDescription sub = {.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS, .colorAttachmentCount = 1, .pColorAttachments = &cref, .pDepthStencilAttachment = &dref};
    VkRenderPassCreateInfo rpi = {.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO, .attachmentCount = 2, .pAttachments = a, .subpassCount = 1, .pSubpasses = &sub};
    VK(vkCreateRenderPass(device, &rpi, NULL, &pass));
    VkImageView views[2] = {color_view, depth_view};
    VkFramebufferCreateInfo fi = {.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO, .renderPass = pass, .attachmentCount = 2, .pAttachments = views,
        .width = (uint32_t)RW, .height = (uint32_t)RH, .layers = 1};
    VK(vkCreateFramebuffer(device, &fi, NULL, &framebuffer));
    /* Pipeline (shader modules are released right after creation). */
    VkShaderModule vs_module = VK_NULL_HANDLE, fs_module = VK_NULL_HANDLE;
    VK(make_shader(shader_gears_vert, sizeof(shader_gears_vert), &vs_module));
    VK(make_shader(shader_gears_frag, sizeof(shader_gears_frag), &fs_module));
    VkPipelineShaderStageCreateInfo stages[2] = {
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_VERTEX_BIT, .module = vs_module, .pName = "main"},
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_FRAGMENT_BIT, .module = fs_module, .pName = "main"}};
    VkVertexInputBindingDescription vb = {0, STRIDE, VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[2] = {{0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0}, {1, 0, VK_FORMAT_R32G32B32_SFLOAT, 12}};
    VkPipelineVertexInputStateCreateInfo vin = {.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO, .vertexBindingDescriptionCount = 1,
        .pVertexBindingDescriptions = &vb, .vertexAttributeDescriptionCount = 2, .pVertexAttributeDescriptions = attr};
    VkPipelineInputAssemblyStateCreateInfo ia = {.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO, .topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport = {0, 0, (float)RW, (float)RH, 0, 1}; VkRect2D scissor = {{0, 0}, {(uint32_t)RW, (uint32_t)RH}};
    VkPipelineViewportStateCreateInfo vps = {.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO, .viewportCount = 1, .pViewports = &viewport, .scissorCount = 1, .pScissors = &scissor};
    VkPipelineRasterizationStateCreateInfo rs = {.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO, .polygonMode = VK_POLYGON_MODE_FILL,
        .cullMode = VK_CULL_MODE_NONE, .frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE, .lineWidth = 1};
    VkPipelineMultisampleStateCreateInfo ms = {.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO, .rasterizationSamples = VK_SAMPLE_COUNT_1_BIT};
    VkPipelineDepthStencilStateCreateInfo ds = {.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO, .depthTestEnable = 1, .depthWriteEnable = 1,
        .depthCompareOp = VK_COMPARE_OP_LESS, .maxDepthBounds = 1};
    VkPipelineColorBlendAttachmentState blend_attachment = {.colorWriteMask = 15};
    VkPipelineColorBlendStateCreateInfo blend = {.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO, .attachmentCount = 1, .pAttachments = &blend_attachment};
    VkGraphicsPipelineCreateInfo gpi = {.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO, .stageCount = 2, .pStages = stages, .pVertexInputState = &vin,
        .pInputAssemblyState = &ia, .pViewportState = &vps, .pRasterizationState = &rs, .pMultisampleState = &ms, .pDepthStencilState = &ds,
        .pColorBlendState = &blend, .layout = playout, .renderPass = pass, .basePipelineIndex = -1};
    VkResult pr = vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &gpi, NULL, &pipeline);
    vkDestroyShaderModule(device, vs_module, NULL); vkDestroyShaderModule(device, fs_module, NULL);
    VK(pr);
    VkCommandPoolCreateInfo cpi = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO, .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
    VK(vkCreateCommandPool(device, &cpi, NULL, &cpool));
    VkCommandBufferAllocateInfo cai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, .commandPool = cpool, .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY, .commandBufferCount = 1};
    VK(vkAllocateCommandBuffers(device, &cai, &cb));
    return wsi ? setup_swapchain() : 0;
}
/* -wsi: surface on the X11 window, swapchain at the render size (IMMEDIATE when offered), one framebuffer per image. */
static int setup_swapchain(void) {
    VkXlibSurfaceCreateInfoKHR si = {.sType = VK_STRUCTURE_TYPE_XLIB_SURFACE_CREATE_INFO_KHR, .dpy = dpy, .window = win};
    VK(vkCreateXlibSurfaceKHR(instance, &si, NULL, &surface));
    VkBool32 supported = VK_FALSE; VK(vkGetPhysicalDeviceSurfaceSupportKHR(physical, 0, surface, &supported));
    if (!supported) { say("VKGEARS_ERROR surface not supported\n"); return 6; }
    VkSurfaceCapabilitiesKHR caps; VK(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical, surface, &caps));
    VkPresentModeKHR modes[8]; uint32_t mode_count = 8; VK(vkGetPhysicalDeviceSurfacePresentModesKHR(physical, surface, &mode_count, modes));
    present_mode = VK_PRESENT_MODE_FIFO_KHR;
    for (uint32_t m = 0; m < mode_count; m++) if (modes[m] == VK_PRESENT_MODE_IMMEDIATE_KHR) present_mode = VK_PRESENT_MODE_IMMEDIATE_KHR;
    if ((uint32_t)RW > caps.maxImageExtent.width || (uint32_t)RH > caps.maxImageExtent.height) {
        say("VKGEARS_ERROR swapchain max extent %ux%u < render %dx%d\n", caps.maxImageExtent.width, caps.maxImageExtent.height, RW, RH); return 6; }
    VkSwapchainCreateInfoKHR ci = {.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR, .surface = surface, .minImageCount = caps.minImageCount,
        .imageFormat = VK_FORMAT_R8G8B8A8_UNORM, .imageColorSpace = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR, .imageExtent = {(uint32_t)RW, (uint32_t)RH},
        .imageArrayLayers = 1, .imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT, .imageSharingMode = VK_SHARING_MODE_EXCLUSIVE,
        .preTransform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR, .compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR, .presentMode = present_mode, .clipped = VK_TRUE};
    VK(vkCreateSwapchainKHR(device, &ci, NULL, &swapchain));
    swap_count = MAX_SWAP; VK(vkGetSwapchainImagesKHR(device, swapchain, &swap_count, swap_images));
    for (uint32_t i = 0; i < swap_count; i++) {
        VkImageViewCreateInfo vi = {.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO, .image = swap_images[i], .viewType = VK_IMAGE_VIEW_TYPE_2D,
            .format = VK_FORMAT_R8G8B8A8_UNORM, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
        VK(vkCreateImageView(device, &vi, NULL, &swap_views[i]));
        VkImageView views[2] = {swap_views[i], depth_view};
        VkFramebufferCreateInfo fi = {.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO, .renderPass = pass, .attachmentCount = 2, .pAttachments = views,
            .width = (uint32_t)RW, .height = (uint32_t)RH, .layers = 1};
        VK(vkCreateFramebuffer(device, &fi, NULL, &swap_fbs[i]));
    }
    VkSemaphoreCreateInfo sci = {.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
    VK(vkCreateSemaphore(device, &sci, NULL, &acquire_sem)); VK(vkCreateSemaphore(device, &sci, NULL, &render_sem));
    say("VKGEARS_SWAPCHAIN images=%u mode=%s extent=%dx%d\n", swap_count, present_mode == VK_PRESENT_MODE_IMMEDIATE_KHR ? "immediate" : "fifo", RW, RH);
    return 0;
}
static void color_barrier(VkImageLayout old, VkImageLayout next) {
    VkImageMemoryBarrier b = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .oldLayout = old, .newLayout = next, .image = color_image,
        .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1},
        .dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT};
    VkPipelineStageFlags src = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, dst = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    if (old == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) { src = VK_PIPELINE_STAGE_TRANSFER_BIT; b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT; }
    if (old == VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL) { src = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT; b.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        /* attachment -> attachment (-nopresent frames): write-after-write hazard, the ICD requires READ|WRITE */
        if (next == VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL) b.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_READ_BIT | VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT; }
    if (next == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) { dst = VK_PIPELINE_STAGE_TRANSFER_BIT; b.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT; }
    if (next == VK_IMAGE_LAYOUT_PRESENT_SRC_KHR) { dst = VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT; b.dstAccessMask = 0; }
    vkCmdPipelineBarrier(cb, src, dst, 0, 0, NULL, 0, NULL, 1, &b);
}
static void depth_barrier(VkImageLayout old) {
    VkImageMemoryBarrier b = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .oldLayout = old, .newLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        .image = depth_image, .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
        .subresourceRange = {depth_aspect, 0, 1, 0, 1},
        .dstAccessMask = VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_READ_BIT | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT};
    VkPipelineStageFlags src = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
    if (old == VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL) { src = VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT; b.srcAccessMask = VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT; }
    vkCmdPipelineBarrier(cb, src, VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT | VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT, 0, 0, NULL, 0, NULL, 1, &b);
}
static void buffer_barrier(VkBuffer buffer, int kind) {
    /* kind 0: readback TRANSFER->HOST; 1: vertex HOST->VERTEX_INPUT; 2: uniform HOST->VERTEX_SHADER. */
    VkBufferMemoryBarrier b = {.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER, .buffer = buffer, .size = VK_WHOLE_SIZE,
        .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED};
    VkPipelineStageFlags src = VK_PIPELINE_STAGE_HOST_BIT, dst;
    if (kind == 0) { src = VK_PIPELINE_STAGE_TRANSFER_BIT; dst = VK_PIPELINE_STAGE_HOST_BIT; b.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; b.dstAccessMask = VK_ACCESS_HOST_READ_BIT; }
    else if (kind == 1) { dst = VK_PIPELINE_STAGE_VERTEX_INPUT_BIT; b.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT; b.dstAccessMask = VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT; }
    else { dst = VK_PIPELINE_STAGE_VERTEX_SHADER_BIT; b.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT; b.dstAccessMask = VK_ACCESS_UNIFORM_READ_BIT; }
    vkCmdPipelineBarrier(cb, src, dst, 0, 0, NULL, 1, &b, 0, NULL);
}
/* glxgears draw() state: view rotation and gear angle in degrees. */
static float view_rotx = 20.0f, view_roty = 30.0f, view_rotz = 0.0f, angle = 0.0f, aspect_h = 1.0f;
static void write_uniforms(void) {
    const mat4 proj = mul(gl_to_vulkan(), frustum(-1.0f, 1.0f, -aspect_h, aspect_h, 5.0f, 60.0f));
    mat4 view = mul(translatef(0.0f, 0.0f, -40.0f), rotatef(view_rotx, 1, 0, 0));
    view = mul(view, rotatef(view_roty, 0, 1, 0)); view = mul(view, rotatef(view_rotz, 0, 0, 1));
    const mat4 model[3] = {
        mul(translatef(-3.0f, -2.0f, 0.0f), rotatef(angle, 0, 0, 1)),
        mul(translatef(3.1f, -2.0f, 0.0f), rotatef(-2.0f * angle - 9.0f, 0, 0, 1)),
        mul(translatef(-3.1f, 4.2f, 0.0f), rotatef(-2.0f * angle - 25.0f, 0, 0, 1))};
    for (int g = 0; g < 3; g++) {
        mat4 mv = mul(view, model[g]), mvp = mul(proj, mv);
        unsigned char *u = umap + g * UBO_STRIDE;
        memcpy(u, mvp.m, 64); memcpy(u + 64, mv.m, 64); memcpy(u + 128, gear_color[g], 16);
    }
}
/* Records, submits and waits for one frame. present: also copies the colour image to the readback buffer. */
static int render(int present) {
    write_uniforms();
    uint32_t index = 0;
    if (wsi) VK(vkAcquireNextImageKHR(device, swapchain, UINT64_MAX, acquire_sem, VK_NULL_HANDLE, &index));
    VkCommandBufferBeginInfo begin = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    VK(vkResetCommandBuffer(cb, 0)); VK(vkBeginCommandBuffer(cb, &begin));
    if (wsi) { color_image = swap_images[index]; color_barrier(VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL); }
    else color_barrier(color_old, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    buffer_barrier(vertices, 1); buffer_barrier(uniform, 2); depth_barrier(depth_old);
    VkClearValue clear[2] = {{.color = {{0, 0, 0, 1}}}, {.depthStencil = {1, 0}}};
    VkRenderPassBeginInfo rb = {.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO, .renderPass = pass, .framebuffer = wsi ? swap_fbs[index] : framebuffer,
        .renderArea = {{0, 0}, {(uint32_t)RW, (uint32_t)RH}}, .clearValueCount = 2, .pClearValues = clear};
    vkCmdBeginRenderPass(cb, &rb, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
    VkDeviceSize offset = 0; vkCmdBindVertexBuffers(cb, 0, 1, &vertices, &offset);
    for (int g = 0; g < 3; g++) {
        vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, playout, 0, 1, &sets[g], 0, NULL);
        vkCmdDraw(cb, (uint32_t)gear_count[g], 1, (uint32_t)gear_first[g], 0);
    }
    vkCmdEndRenderPass(cb);
    if (wsi) color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, VK_IMAGE_LAYOUT_PRESENT_SRC_KHR);
    else if (present) {
        color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
        VkBufferImageCopy copy = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1}, .imageExtent = {(uint32_t)RW, (uint32_t)RH, 1}};
        vkCmdCopyImageToBuffer(cb, color_image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, readback, 1, &copy); buffer_barrier(readback, 0);
    }
    VK(vkEndCommandBuffer(cb));
    VkPipelineStageFlags wait_stage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cb};
    if (wsi) { submit.waitSemaphoreCount = 1; submit.pWaitSemaphores = &acquire_sem; submit.pWaitDstStageMask = &wait_stage;
        submit.signalSemaphoreCount = 1; submit.pSignalSemaphores = &render_sem; }
    VK(vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE));
    if (wsi) {
        VkPresentInfoKHR pi = {.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR, .waitSemaphoreCount = 1, .pWaitSemaphores = &render_sem,
            .swapchainCount = 1, .pSwapchains = &swapchain, .pImageIndices = &index};
        VK(vkQueuePresentKHR(queue, &pi));
    }
    VK(vkQueueWaitIdle(queue));
    color_old = present ? VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL : VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    depth_old = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
    return 0;
}
static void teardown(void) {
    if (device) {
        vkDeviceWaitIdle(device);
        for (uint32_t i = 0; i < swap_count; i++) { if (swap_fbs[i]) vkDestroyFramebuffer(device, swap_fbs[i], NULL); if (swap_views[i]) vkDestroyImageView(device, swap_views[i], NULL); }
        if (acquire_sem) vkDestroySemaphore(device, acquire_sem, NULL);
        if (render_sem) vkDestroySemaphore(device, render_sem, NULL);
        if (swapchain) vkDestroySwapchainKHR(device, swapchain, NULL);
        if (wsi) color_image = own_color_image;
        if (cb) vkFreeCommandBuffers(device, cpool, 1, &cb);
        if (cpool) vkDestroyCommandPool(device, cpool, NULL);
        if (pipeline) vkDestroyPipeline(device, pipeline, NULL);
        if (framebuffer) vkDestroyFramebuffer(device, framebuffer, NULL);
        if (pass) vkDestroyRenderPass(device, pass, NULL);
        if (pool) vkDestroyDescriptorPool(device, pool, NULL);
        if (playout) vkDestroyPipelineLayout(device, playout, NULL);
        if (set_layout) vkDestroyDescriptorSetLayout(device, set_layout, NULL);
        if (umap) vkUnmapMemory(device, uniform_mem);
        if (uniform) vkDestroyBuffer(device, uniform, NULL);
        if (uniform_mem) vkFreeMemory(device, uniform_mem, NULL);
        if (vmap) vkUnmapMemory(device, vertex_mem);
        if (vertices) vkDestroyBuffer(device, vertices, NULL);
        if (vertex_mem) vkFreeMemory(device, vertex_mem, NULL);
        if (mapped) vkUnmapMemory(device, read_mem);
        if (readback) vkDestroyBuffer(device, readback, NULL);
        if (read_mem) vkFreeMemory(device, read_mem, NULL);
        if (depth_view) vkDestroyImageView(device, depth_view, NULL);
        if (depth_image) vkDestroyImage(device, depth_image, NULL);
        if (depth_mem) vkFreeMemory(device, depth_mem, NULL);
        if (color_view) vkDestroyImageView(device, color_view, NULL);
        if (color_image) vkDestroyImage(device, color_image, NULL);
        if (color_mem) vkFreeMemory(device, color_mem, NULL);
        vkDestroyDevice(device, NULL);
    }
    if (surface) vkDestroySurfaceKHR(instance, surface, NULL);
    if (instance) vkDestroyInstance(instance, NULL);
}

/* ---- main ---------------------------------------------------------------- */
static void usage(void) {
    say("usage: vkgears [-nopresent|-noput|-wsi] [-seconds N] [-size WxH] [-info] [-interval S]\n");
}
int main(int argc, char **argv) {
    int present = 1, info = 0, w = 300, h = 300, noput = 0;
    double seconds = 0, interval = 5.0;
    signal(SIGPIPE, SIG_IGN);
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-nopresent")) present = 0;
        else if (!strcmp(argv[i], "-noput")) noput = 1;
        else if (!strcmp(argv[i], "-wsi")) wsi = 1;
        else if (!strcmp(argv[i], "-info")) info = 1;
        else if (!strcmp(argv[i], "-seconds") && i + 1 < argc) seconds = atof(argv[++i]);
        else if (!strcmp(argv[i], "-interval") && i + 1 < argc) interval = atof(argv[++i]);
        else if (!strcmp(argv[i], "-size") && i + 1 < argc) {
            if (sscanf(argv[++i], "%dx%d", &w, &h) != 2 || w < 1 || h < 1 || w > 4096 || h > 4096) { usage(); return 1; }
        } else { usage(); return 1; }
    }
    if (interval <= 0) interval = 5.0;
    say("VKGEARS_START present=%d size=%dx%d seconds=%g\n", present, w, h, seconds);
    if (!build_gears()) { say("VKGEARS_ERROR geometry vertices=%d expected=%d\n", mesh_count, MAX_VERTICES); return 5; }

    int status = create_instance();
    if (status) {
        say("VKGEARS_ERROR setup status=%d reason=%s\n", status, status == 3 ? "gpu-session-unavailable" : "vulkan-instance");
        teardown(); return status;
    }
    /* Render target: the window aspect, fitted into the ICD's image limit (no upscaling past the window). */
    int cap = (int)props.limits.maxImageDimension2D; if (cap < 1) cap = 128;
    if (props.limits.maxViewportDimensions[0] && (int)props.limits.maxViewportDimensions[0] < cap) cap = (int)props.limits.maxViewportDimensions[0];
    if (w <= cap && h <= cap) { RW = w; RH = h; }
    else if (w >= h) { RW = cap; RH = (int)((int64_t)h * cap / w); }
    else { RH = cap; RW = (int)((int64_t)w * cap / h); }
    if (RW < 1) RW = 1;
    if (RH < 1) RH = 1;
    aspect_h = (float)h / (float)w;
    if (info) {
        say("VK_DEVICE_NAME   = %s\n", props.deviceName);
        say("VK_API_VERSION   = %u.%u.%u\n", VK_VERSION_MAJOR(props.apiVersion), VK_VERSION_MINOR(props.apiVersion), VK_VERSION_PATCH(props.apiVersion));
        say("VK_DRIVER        = 0x%x vendor=0x%x device=0x%x type=%d\n", props.driverVersion, props.vendorID, props.deviceID, (int)props.deviceType);
        say("VK_BACKEND       = %s (host WebGPU or WebGL2 behind the guest ICD)\n", backend);
        say("VK_MAX_IMAGE_2D  = %u  render=%dx%d window=%dx%d\n", props.limits.maxImageDimension2D, RW, RH, w, h);
        say("VKGEARS_GEOMETRY vertices=%d gear1=%d+%d gear2=%d+%d gear3=%d+%d stride=%d\n", mesh_count, gear_first[0], gear_count[0],
            gear_first[1], gear_count[1], gear_first[2], gear_count[2], STRIDE);
    }
    if (wsi) {
        if (!x11_open(w, h)) { say("VKGEARS_ERROR X11 open failed\n"); x11_close(); teardown(); return 4; }
        RW = w <= RW ? w : RW; RH = h <= RH ? h : RH;
    }
    status = setup();
    if (status) {
        say("VKGEARS_ERROR setup status=%d reason=%s\n", status, status == 3 ? "gpu-session-unavailable" : "vulkan-setup");
        teardown(); return status;
    }
    if (present && !noput && !wsi) {
        xmap = malloc(sizeof(int) * (size_t)w);
        if (!xmap || !x11_open(w, h)) { say("VKGEARS_ERROR X11 open failed\n"); x11_close(); teardown(); return 4; }
        for (int x = 0; x < w; x++) xmap[x] = (int)((int64_t)x * RW / w) * 4;
    }
    say("VKGEARS_READY device=\"%s\" backend=%s present=%d wsi=%d size=%dx%d render=%dx%d\n", props.deviceName, backend, present, wsi, w, h, RW, RH);

    double t_start = now_s(), t_last = t_start, t_rot = t_start;
    int frames = 0, total = 0;
    const char *reason = "seconds";
    for (;;) {
        double t = now_s();
        /* advance rotation for next frame (glxgears: 70 degrees per second) */
        angle += 70.0 * (t - t_rot);
        t_rot = t;
        if (angle > 3600.0) angle -= 3600.0;

        double tr = now_s();
        status = render(present); ph_render += now_s() - tr;
        if (status) { reason = "gpu-session-lost"; say("VKGEARS_ERROR gpu frames=%d status=%d (host GPU session closed or device lost)\n", total, status); break; }
        if (wsi) { if (!x11_events()) { reason = "window-closed"; break; } }
        else if (present && !noput) {
            x11_present(mapped, RW, RH, w, h);
            if (x_error_code) { status = 4; reason = "x11-error"; break; }
            if (!x11_events()) { reason = "window-closed"; break; }
        }
        frames++; total++;

        t = now_s();
        if (t - t_last >= interval) {
            double secs = t - t_last, fps = frames / secs;
            say("%d frames in %3.1f seconds = %6.3f FPS\n", frames, secs, fps);
            say("VKGEARS_FPS backend=%s device=\"%s\" fps=%.3f frames=%d seconds=%.2f present=%d size=%dx%d render=%dx%d\n",
                backend, props.deviceName, fps, frames, secs, present, w, h, RW, RH);
            say("VKGEARS_PHASES_MS render=%.3f convert=%.3f put=%.3f sync=%.3f frames=%d\n", 1e3 * ph_render / frames,
                1e3 * ph_convert / frames, 1e3 * ph_put / frames, 1e3 * ph_sync / frames, frames);
            ph_render = ph_convert = ph_put = ph_sync = 0;
            t_last = t; frames = 0;
        }
        if (seconds > 0 && t - t_start >= seconds) break;
    }
    double elapsed = now_s() - t_start;
    say("VKGEARS_DONE backend=%s device=\"%s\" frames=%d seconds=%.2f avg_fps=%.3f present=%d size=%dx%d render=%dx%d status=%d reason=%s\n",
        backend, props.deviceName, total, elapsed, elapsed > 0 ? total / elapsed : 0.0, present, w, h, RW, RH, status, reason);
    x11_close();
    free(xmap);
    if (status != 3) teardown(); /* after loss the ICD refuses further host calls; skip teardown traffic */
    return status;
}
