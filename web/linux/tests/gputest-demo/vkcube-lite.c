/* gputest G2: vkcube-lite. An animated, depth-tested, per-face coloured cube
 * rendered through the public Vulkan API (static Khronos loader + experimental
 * guest ICD, host WebGPU/WebGL2 over virtio-vsock). Each frame updates a
 * UNIFORM_BUFFER MVP, renders 128x128 colour + D32 depth, reads the colour back
 * and presents it scaled (nearest) in an ordinary X11 window through XPutImage.
 * This is a CPU-copy presenter, not Vulkan WSI. Prints GPUTEST_FPS about every
 * two seconds. Exit status: 0 window closed / frame limit, 3 GPU session lost
 * or refused, 4 X11 unavailable or lost, 5 Vulkan setup failed.
 *
 * Options (argv): --scale N (1..6, default 3), --max-fps N (0 = unlimited),
 * --frames N (0 = forever), --seconds N (0 = forever). */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "shaders.h"
#define W 128
#define H 128
#define PIXELS (W*H*4)
#define STRIDE 28
#define VERTICES 36
#define TITLE "Vulkan cube (guest)"

static int scale = 3, max_fps = 0;
static unsigned long frame_limit = 0, seconds_limit = 0;
static const char *backend = "unknown";

static void say(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
#include <stdarg.h>
static void say(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); fflush(stdout);
}
static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

/* ---- X11 presentation ---------------------------------------------------- */
static Display *dpy; static Window win; static GC gc; static XImage *image; static Atom wm_delete;
static int x_error_code;
static int on_x_error(Display *d, XErrorEvent *e) {
    (void)d; x_error_code = e->error_code;
    say("GPUTEST_CUBE_X11_ERROR code=%u request=%u minor=%u\n", e->error_code, e->request_code, e->minor_code);
    return 0;
}
static int on_x_io_error(Display *d) { (void)d; say("GPUTEST_CUBE_X11_LOST display connection closed\n"); _exit(4); return 0; }
static unsigned long component(unsigned v, unsigned long mask) {
    unsigned shift = 0; if (!mask) return 0;
    while (!(mask & 1)) { mask >>= 1; shift++; }
    return (unsigned long)(((uint64_t)v * mask + 127) / 255) << shift;
}
static int x11_open(void) {
    XSetErrorHandler(on_x_error); XSetIOErrorHandler(on_x_io_error);
    const char *name = getenv("DISPLAY"); if (!name || !*name) name = ":0";
    for (int attempt = 1; attempt <= 60 && !dpy; attempt++) {
        dpy = XOpenDisplay(name);
        if (!dpy) { if (attempt == 1 || attempt % 10 == 0) say("GPUTEST_CUBE_X11_RETRY display=%s attempt=%d\n", name, attempt); sleep(1); }
    }
    if (!dpy) return 0;
    int screen = DefaultScreen(dpy); Visual *visual = DefaultVisual(dpy, screen);
    if (visual->class != TrueColor) { say("GPUTEST_CUBE_X11_UNSUPPORTED visual class=%d\n", visual->class); return 0; }
    int sw = DisplayWidth(dpy, screen), sh = DisplayHeight(dpy, screen);
    while (scale > 1 && (W * scale > sw - 16 || H * scale > sh - 48)) scale--;
    const int size = W * scale;
    int x = sw > size + 64 ? sw - size - 32 : 0, y = sh > size + 96 ? 48 : 0;
    win = XCreateSimpleWindow(dpy, RootWindow(dpy, screen), x, y, size, size, 0, 0, BlackPixel(dpy, screen));
    if (!win) return 0;
    XStoreName(dpy, win, TITLE);
    XClassHint cls = { .res_name = "vkcube-lite", .res_class = "VkcubeLite" }; XSetClassHint(dpy, win, &cls);
    XSizeHints *hints = XAllocSizeHints();
    if (hints) { hints->flags = PMinSize | PMaxSize | PPosition; hints->x = x; hints->y = y;
        hints->min_width = hints->max_width = size; hints->min_height = hints->max_height = size;
        XSetWMNormalHints(dpy, win, hints); XFree(hints); }
    wm_delete = XInternAtom(dpy, "WM_DELETE_WINDOW", False); XSetWMProtocols(dpy, win, &wm_delete, 1);
    XSelectInput(dpy, win, ExposureMask | StructureNotifyMask | KeyPressMask);
    gc = XCreateGC(dpy, win, 0, NULL); if (!gc) return 0;
    image = XCreateImage(dpy, visual, DefaultDepth(dpy, screen), ZPixmap, 0, NULL, size, size, 32, 0);
    if (!image || image->bytes_per_line <= 0) return 0;
    image->data = calloc((size_t)size, (size_t)image->bytes_per_line); if (!image->data) return 0;
    XMapRaised(dpy, win); XSync(dpy, False);
    say("GPUTEST_CUBE_X11_OPEN display=%s screen=%dx%d window=%dx%d+%d+%d scale=%d depth=%d bpp=%d\n",
        name, sw, sh, size, size, x, y, scale, DefaultDepth(dpy, screen), image->bits_per_pixel);
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
static void x11_present(const unsigned char *rgba) {
    const int size = W * scale;
    if (image->bits_per_pixel == 32 && image->byte_order == LSBFirst) {
        uint32_t row[W];
        for (int sy = 0; sy < H; sy++) {
            for (int sx = 0; sx < W; sx++) {
                const unsigned char *p = rgba + (sy * W + sx) * 4;
                row[sx] = (uint32_t)(component(p[0], image->red_mask) | component(p[1], image->green_mask) | component(p[2], image->blue_mask));
            }
            for (int ry = 0; ry < scale; ry++) {
                uint32_t *out = (uint32_t *)(image->data + (size_t)(sy * scale + ry) * image->bytes_per_line);
                for (int sx = 0; sx < W; sx++) for (int rx = 0; rx < scale; rx++) *out++ = row[sx];
            }
        }
    } else {
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
            const unsigned char *p = rgba + ((y / scale) * W + x / scale) * 4;
            XPutPixel(image, x, y, component(p[0], image->red_mask) | component(p[1], image->green_mask) | component(p[2], image->blue_mask));
        }
    }
    XPutImage(dpy, win, gc, image, 0, 0, 0, 0, size, size);
    XSync(dpy, False);
}
static void x11_close(void) {
    if (!dpy) return;
    if (image) { XDestroyImage(image); image = NULL; }
    if (gc) XFreeGC(dpy, gc);
    if (win) XDestroyWindow(dpy, win);
    XSync(dpy, False); XCloseDisplay(dpy); dpy = NULL;
}

/* ---- Maths (column-major, Vulkan clip space: y down, z in [0,1]) -------- */
typedef struct { float m[16]; } mat4;
static mat4 mul(mat4 a, mat4 b) {
    mat4 r; for (int c = 0; c < 4; c++) for (int row = 0; row < 4; row++) {
        float s = 0; for (int k = 0; k < 4; k++) s += a.m[k * 4 + row] * b.m[c * 4 + k]; r.m[c * 4 + row] = s; }
    return r;
}
static mat4 identity(void) { mat4 r = {{0}}; r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1; return r; }
static mat4 rotate(float angle, float x, float y, float z) {
    float c = cosf(angle), s = sinf(angle), t = 1 - c, n = sqrtf(x * x + y * y + z * z); x /= n; y /= n; z /= n;
    mat4 r = identity();
    r.m[0] = t * x * x + c;     r.m[4] = t * x * y - s * z; r.m[8]  = t * x * z + s * y;
    r.m[1] = t * x * y + s * z; r.m[5] = t * y * y + c;     r.m[9]  = t * y * z - s * x;
    r.m[2] = t * x * z - s * y; r.m[6] = t * y * z + s * x; r.m[10] = t * z * z + c;
    return r;
}
static mat4 perspective(float fovy, float aspect, float near, float far) {
    float f = 1.0f / tanf(fovy / 2); mat4 r = {{0}};
    r.m[0] = f / aspect; r.m[5] = -f; r.m[10] = far / (near - far); r.m[11] = -1; r.m[14] = near * far / (near - far);
    return r;
}
static mat4 translate(float x, float y, float z) { mat4 r = identity(); r.m[12] = x; r.m[13] = y; r.m[14] = z; return r; }

/* ---- Vulkan ---------------------------------------------------------------- */
static VkInstance instance; static VkDevice device; static VkQueue queue; static VkCommandPool cpool; static VkCommandBuffer cb;
static VkImage color_image, depth_image; static VkImageView color_view, depth_view;
static VkDeviceMemory color_mem, depth_mem, read_mem, vertex_mem, uniform_mem;
static VkBuffer readback, vertices, uniform; static unsigned char *mapped, *vmap, *umap;
static VkShaderModule vs_module, fs_module; static VkDescriptorSetLayout set_layout; static VkDescriptorPool pool; static VkDescriptorSet set;
static VkPipelineLayout playout; static VkRenderPass pass; static VkFramebuffer framebuffer; static VkPipeline pipeline;
static VkImageLayout color_old = VK_IMAGE_LAYOUT_UNDEFINED, depth_old = VK_IMAGE_LAYOUT_UNDEFINED;
#define VK(call) do { VkResult r_ = (call); if (r_ != VK_SUCCESS) { say("GPUTEST_CUBE_VK_FAIL line=%d result=%d call=%s\n", __LINE__, (int)r_, #call); \
    return r_ == VK_ERROR_DEVICE_LOST || r_ == VK_ERROR_INITIALIZATION_FAILED ? 3 : 5; } } while (0)

static void cube_vertices(float *v) {
    /* Six faces, each two triangles; one colour per face. */
    static const float faces[6][4][3] = {
        {{-1,-1, 1},{ 1,-1, 1},{ 1, 1, 1},{-1, 1, 1}},   /* +z */
        {{ 1,-1,-1},{-1,-1,-1},{-1, 1,-1},{ 1, 1,-1}},   /* -z */
        {{ 1,-1, 1},{ 1,-1,-1},{ 1, 1,-1},{ 1, 1, 1}},   /* +x */
        {{-1,-1,-1},{-1,-1, 1},{-1, 1, 1},{-1, 1,-1}},   /* -x */
        {{-1, 1, 1},{ 1, 1, 1},{ 1, 1,-1},{-1, 1,-1}},   /* +y */
        {{-1,-1,-1},{ 1,-1,-1},{ 1,-1, 1},{-1,-1, 1}}};  /* -y */
    static const float colours[6][4] = {{0.90f,0.20f,0.20f,1},{0.20f,0.75f,0.25f,1},{0.20f,0.40f,0.95f,1},
                                        {0.95f,0.85f,0.20f,1},{0.85f,0.30f,0.85f,1},{0.20f,0.85f,0.85f,1}};
    static const int order[6] = {0, 1, 2, 0, 2, 3};
    for (int f = 0; f < 6; f++) for (int k = 0; k < 6; k++) {
        float *out = v + (f * 6 + k) * 7; memcpy(out, faces[f][order[k]], 12); memcpy(out + 3, colours[f], 16);
    }
}
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
static int setup(void) {
    VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .apiVersion = VK_API_VERSION_1_0, .pApplicationName = "vkcube-lite"};
    VkInstanceCreateInfo ii = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &app};
    VK(vkCreateInstance(&ii, NULL, &instance));
    uint32_t count = 1; VkPhysicalDevice physical; VK(vkEnumeratePhysicalDevices(instance, &count, &physical));
    if (count != 1) { say("GPUTEST_CUBE_VK_FAIL no physical device\n"); return 5; }
    VkPhysicalDeviceProperties props; vkGetPhysicalDeviceProperties(physical, &props);
    /* The ICD advertises the backend-specific vertex stride limit: 252 on WebGL2, 2048 on WebGPU. */
    backend = props.limits.maxVertexInputBindingStride == 252 ? "webgl2" : "webgpu";
    say("GPUTEST_CUBE_DEVICE name=\"%s\" backend=%s max_image=%u\n", props.deviceName, backend, props.limits.maxImageDimension2D);
    float priority = 1;
    VkDeviceQueueCreateInfo qi = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, .queueCount = 1, .pQueuePriorities = &priority};
    VkDeviceCreateInfo di = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, .queueCreateInfoCount = 1, .pQueueCreateInfos = &qi};
    VK(vkCreateDevice(physical, &di, NULL, &device)); vkGetDeviceQueue(device, 0, 0, &queue);
    /* Colour + depth targets. */
    VkImageCreateInfo im = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO, .imageType = VK_IMAGE_TYPE_2D, .format = VK_FORMAT_R8G8B8A8_UNORM, .extent = {W, H, 1},
        .mipLevels = 1, .arrayLayers = 1, .samples = VK_SAMPLE_COUNT_1_BIT, .tiling = VK_IMAGE_TILING_OPTIMAL,
        .usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT, .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
    VK(vkCreateImage(device, &im, NULL, &color_image)); VK(alloc_bind(VK_NULL_HANDLE, color_image, 0, 0, &color_mem));
    im.format = VK_FORMAT_D32_SFLOAT; im.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
    VK(vkCreateImage(device, &im, NULL, &depth_image)); VK(alloc_bind(VK_NULL_HANDLE, depth_image, 0, 0, &depth_mem));
    VkImageViewCreateInfo vi = {.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO, .image = color_image, .viewType = VK_IMAGE_VIEW_TYPE_2D,
        .format = VK_FORMAT_R8G8B8A8_UNORM, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
    VK(vkCreateImageView(device, &vi, NULL, &color_view));
    vi.image = depth_image; vi.format = VK_FORMAT_D32_SFLOAT; vi.subresourceRange.aspectMask = VK_IMAGE_ASPECT_DEPTH_BIT;
    VK(vkCreateImageView(device, &vi, NULL, &depth_view));
    /* Readback, vertex and uniform buffers (host-coherent memory type 1). */
    VkBufferCreateInfo bi = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO, .size = PIXELS, .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT, .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
    VK(vkCreateBuffer(device, &bi, NULL, &readback)); VK(alloc_bind(readback, VK_NULL_HANDLE, 1, 0, &read_mem));
    VK(vkMapMemory(device, read_mem, 0, VK_WHOLE_SIZE, 0, (void **)&mapped));
    bi.size = VERTICES * STRIDE; bi.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    VK(vkCreateBuffer(device, &bi, NULL, &vertices)); VK(alloc_bind(vertices, VK_NULL_HANDLE, 1, 0, &vertex_mem));
    VK(vkMapMemory(device, vertex_mem, 0, VK_WHOLE_SIZE, 0, (void **)&vmap)); cube_vertices((float *)vmap);
    bi.size = 64; bi.usage = VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;
    VK(vkCreateBuffer(device, &bi, NULL, &uniform)); VK(alloc_bind(uniform, VK_NULL_HANDLE, 1, 256, &uniform_mem));
    VK(vkMapMemory(device, uniform_mem, 0, VK_WHOLE_SIZE, 0, (void **)&umap)); memset(umap, 0, 64);
    /* Descriptors. */
    VkDescriptorSetLayoutBinding binding = {.binding = 0, .descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, .descriptorCount = 1, .stageFlags = VK_SHADER_STAGE_VERTEX_BIT};
    VkDescriptorSetLayoutCreateInfo dli = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO, .bindingCount = 1, .pBindings = &binding};
    VK(vkCreateDescriptorSetLayout(device, &dli, NULL, &set_layout));
    VkPipelineLayoutCreateInfo pli = {.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO, .setLayoutCount = 1, .pSetLayouts = &set_layout};
    VK(vkCreatePipelineLayout(device, &pli, NULL, &playout));
    VkDescriptorPoolSize ps = {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1};
    VkDescriptorPoolCreateInfo pci = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO, .maxSets = 1, .poolSizeCount = 1, .pPoolSizes = &ps};
    VK(vkCreateDescriptorPool(device, &pci, NULL, &pool));
    VkDescriptorSetAllocateInfo dai = {.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO, .descriptorPool = pool, .descriptorSetCount = 1, .pSetLayouts = &set_layout};
    VK(vkAllocateDescriptorSets(device, &dai, &set));
    VkDescriptorBufferInfo info = {uniform, 0, 64};
    VkWriteDescriptorSet write = {.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, .dstSet = set, .dstBinding = 0, .descriptorCount = 1,
        .descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, .pBufferInfo = &info};
    vkUpdateDescriptorSets(device, 1, &write, 0, NULL);
    /* Render pass: CLEAR/STORE colour and depth, layouts kept by explicit barriers. */
    VkAttachmentDescription a[2] = {
        {.format = VK_FORMAT_R8G8B8A8_UNORM, .samples = VK_SAMPLE_COUNT_1_BIT, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR, .storeOp = VK_ATTACHMENT_STORE_OP_STORE,
         .stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE, .stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE,
         .initialLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, .finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},
        {.format = VK_FORMAT_D32_SFLOAT, .samples = VK_SAMPLE_COUNT_1_BIT, .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR, .storeOp = VK_ATTACHMENT_STORE_OP_STORE,
         .stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE, .stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE,
         .initialLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL, .finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL}};
    VkAttachmentReference cref = {0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL}, dref = {1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
    VkSubpassDescription sub = {.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS, .colorAttachmentCount = 1, .pColorAttachments = &cref, .pDepthStencilAttachment = &dref};
    VkRenderPassCreateInfo rpi = {.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO, .attachmentCount = 2, .pAttachments = a, .subpassCount = 1, .pSubpasses = &sub};
    VK(vkCreateRenderPass(device, &rpi, NULL, &pass));
    VkImageView views[2] = {color_view, depth_view};
    VkFramebufferCreateInfo fi = {.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO, .renderPass = pass, .attachmentCount = 2, .pAttachments = views, .width = W, .height = H, .layers = 1};
    VK(vkCreateFramebuffer(device, &fi, NULL, &framebuffer));
    /* Pipeline. */
    VK(make_shader(shader_cube_vert, sizeof(shader_cube_vert), &vs_module));
    VK(make_shader(shader_cube_frag, sizeof(shader_cube_frag), &fs_module));
    VkPipelineShaderStageCreateInfo stages[2] = {
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_VERTEX_BIT, .module = vs_module, .pName = "main"},
        {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, .stage = VK_SHADER_STAGE_FRAGMENT_BIT, .module = fs_module, .pName = "main"}};
    VkVertexInputBindingDescription vb = {0, STRIDE, VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[2] = {{0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0}, {1, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 12}};
    VkPipelineVertexInputStateCreateInfo vin = {.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO, .vertexBindingDescriptionCount = 1,
        .pVertexBindingDescriptions = &vb, .vertexAttributeDescriptionCount = 2, .pVertexAttributeDescriptions = attr};
    VkPipelineInputAssemblyStateCreateInfo ia = {.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO, .topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport = {0, 0, W, H, 0, 1}; VkRect2D scissor = {{0, 0}, {W, H}};
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
    VK(vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &gpi, NULL, &pipeline));
    VkCommandPoolCreateInfo cpi = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO, .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
    VK(vkCreateCommandPool(device, &cpi, NULL, &cpool));
    VkCommandBufferAllocateInfo cai = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, .commandPool = cpool, .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY, .commandBufferCount = 1};
    VK(vkAllocateCommandBuffers(device, &cai, &cb));
    return 0;
}
static void color_barrier(VkImageLayout old, VkImageLayout next) {
    VkImageMemoryBarrier b = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .oldLayout = old, .newLayout = next, .image = color_image,
        .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1},
        .dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT};
    VkPipelineStageFlags src = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, dst = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    if (old == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) { src = VK_PIPELINE_STAGE_TRANSFER_BIT; b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT; }
    if (old == VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL) { src = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT; b.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT; }
    if (next == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) { dst = VK_PIPELINE_STAGE_TRANSFER_BIT; b.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT; }
    vkCmdPipelineBarrier(cb, src, dst, 0, 0, NULL, 0, NULL, 1, &b);
}
static void depth_barrier(VkImageLayout old) {
    VkImageMemoryBarrier b = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .oldLayout = old, .newLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        .image = depth_image, .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
        .subresourceRange = {VK_IMAGE_ASPECT_DEPTH_BIT, 0, 1, 0, 1},
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
/* Renders one frame at time t (seconds) and waits for its readback. */
static int render(double t) {
    mat4 model = mul(rotate((float)(t * 0.9), 0, 1, 0), rotate((float)(t * 0.6), 1, 0, 0.3f));
    mat4 mvp = mul(perspective(0.9f, 1.0f, 0.1f, 20.0f), mul(translate(0, 0, -4.2f), model));
    memcpy(umap, mvp.m, 64);
    VkCommandBufferBeginInfo begin = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    VK(vkResetCommandBuffer(cb, 0)); VK(vkBeginCommandBuffer(cb, &begin));
    color_barrier(color_old, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL); buffer_barrier(vertices, 1); buffer_barrier(uniform, 2); depth_barrier(depth_old);
    VkClearValue clear[2] = {{.color = {{0.08f, 0.09f, 0.12f, 1}}}, {.depthStencil = {1, 0}}};
    VkRenderPassBeginInfo rb = {.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO, .renderPass = pass, .framebuffer = framebuffer,
        .renderArea = {{0, 0}, {W, H}}, .clearValueCount = 2, .pClearValues = clear};
    vkCmdBeginRenderPass(cb, &rb, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
    VkDeviceSize offset = 0; vkCmdBindVertexBuffers(cb, 0, 1, &vertices, &offset);
    vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, playout, 0, 1, &set, 0, NULL);
    vkCmdDraw(cb, VERTICES, 1, 0, 0);
    vkCmdEndRenderPass(cb);
    color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy = {.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1}, .imageExtent = {W, H, 1}};
    vkCmdCopyImageToBuffer(cb, color_image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, readback, 1, &copy); buffer_barrier(readback, 0);
    VK(vkEndCommandBuffer(cb));
    VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .commandBufferCount = 1, .pCommandBuffers = &cb};
    VK(vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE)); VK(vkQueueWaitIdle(queue));
    color_old = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL; depth_old = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
    return 0;
}
static void teardown(void) {
    if (device) {
        vkDeviceWaitIdle(device);
        if (cb) vkFreeCommandBuffers(device, cpool, 1, &cb); if (cpool) vkDestroyCommandPool(device, cpool, NULL);
        if (pipeline) vkDestroyPipeline(device, pipeline, NULL); if (framebuffer) vkDestroyFramebuffer(device, framebuffer, NULL);
        if (pass) vkDestroyRenderPass(device, pass, NULL); if (vs_module) vkDestroyShaderModule(device, vs_module, NULL);
        if (fs_module) vkDestroyShaderModule(device, fs_module, NULL); if (pool) vkDestroyDescriptorPool(device, pool, NULL);
        if (playout) vkDestroyPipelineLayout(device, playout, NULL); if (set_layout) vkDestroyDescriptorSetLayout(device, set_layout, NULL);
        if (umap) vkUnmapMemory(device, uniform_mem); if (uniform) vkDestroyBuffer(device, uniform, NULL); if (uniform_mem) vkFreeMemory(device, uniform_mem, NULL);
        if (vmap) vkUnmapMemory(device, vertex_mem); if (vertices) vkDestroyBuffer(device, vertices, NULL); if (vertex_mem) vkFreeMemory(device, vertex_mem, NULL);
        if (mapped) vkUnmapMemory(device, read_mem); if (readback) vkDestroyBuffer(device, readback, NULL); if (read_mem) vkFreeMemory(device, read_mem, NULL);
        if (depth_view) vkDestroyImageView(device, depth_view, NULL); if (depth_image) vkDestroyImage(device, depth_image, NULL); if (depth_mem) vkFreeMemory(device, depth_mem, NULL);
        if (color_view) vkDestroyImageView(device, color_view, NULL); if (color_image) vkDestroyImage(device, color_image, NULL); if (color_mem) vkFreeMemory(device, color_mem, NULL);
        vkDestroyDevice(device, NULL);
    }
    if (instance) vkDestroyInstance(instance, NULL);
}
int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    for (int i = 1; i + 1 < argc; i += 2) {
        long v = strtol(argv[i + 1], NULL, 10);
        if (!strcmp(argv[i], "--scale") && v >= 1 && v <= 6) scale = (int)v;
        else if (!strcmp(argv[i], "--max-fps") && v >= 0) max_fps = (int)v;
        else if (!strcmp(argv[i], "--frames") && v >= 0) frame_limit = (unsigned long)v;
        else if (!strcmp(argv[i], "--seconds") && v >= 0) seconds_limit = (unsigned long)v;
        else { fprintf(stderr, "usage: vkcube-lite [--scale 1..6] [--max-fps N] [--frames N] [--seconds N]\n"); return 2; }
    }
    say("GPUTEST_CUBE_START render=%dx%d scale=%d max_fps=%d frames=%lu seconds=%lu\n", W, H, scale, max_fps, frame_limit, seconds_limit);
    int status = setup();
    if (status) { say("GPUTEST_CUBE_EXIT status=%d reason=%s\n", status, status == 3 ? "gpu-session-unavailable" : "vulkan-setup"); teardown(); return status; }
    if (!x11_open()) { say("GPUTEST_CUBE_EXIT status=4 reason=x11-unavailable\n"); teardown(); return 4; }
    const double start = now_s(); double window_start = start, busy = 0; unsigned long frames = 0, window_frames = 0;
    const char *reason = "frame-limit";
    for (;;) {
        if (!x11_events()) { reason = "window-closed"; break; }
        const double t0 = now_s();
        if ((status = render(t0 - start))) { reason = "gpu-session-lost"; say("GPUTEST_CUBE_GPU_LOST frames=%lu (host GPU session closed or device lost)\n", frames); break; }
        x11_present(mapped);
        if (x_error_code) { status = 4; reason = "x11-error"; break; }
        frames++; window_frames++;
        const double t1 = now_s(); busy += t1 - t0;
        if (t1 - window_start >= 2.0) {
            say("GPUTEST_FPS %.1f frames=%lu backend=%s frame_ms=%.1f uptime=%.0f\n", window_frames / (t1 - window_start), frames, backend,
                1000 * busy / window_frames, t1 - start);
            window_start = t1; window_frames = 0; busy = 0;
        }
        if ((frame_limit && frames >= frame_limit) || (seconds_limit && t1 - start >= seconds_limit)) break;
        if (max_fps > 0) {
            double wait = 1.0 / max_fps - (now_s() - t0);
            if (wait > 0) { struct timespec d = {(time_t)wait, (long)((wait - (time_t)wait) * 1e9)}; nanosleep(&d, NULL); }
        }
    }
    const double total = now_s() - start;
    say("GPUTEST_CUBE_EXIT status=%d reason=%s frames=%lu seconds=%.1f average_fps=%.1f backend=%s\n", status, reason, frames, total, total > 0 ? frames / total : 0, backend);
    x11_close();
    if (status != 3) teardown(); /* after loss the ICD refuses further host calls; skip teardown traffic */
    return status;
}
