/* Bounded WSI for the experimental guest ICD (built with GUEST_VK_WSI plus
 * VK_USE_PLATFORM_XLIB_KHR/VK_USE_PLATFORM_XCB_KHR). Loader interface 3 uses
 * driver-owned Xlib/XCB surfaces and swapchain image IDs, never guest addresses.
 * Acquire/present are available only after the host negotiates presentProfile.
 * Swapchain images are ordinary colour targets; the renderer copies a stored
 * target to a host canvas. This is not a conformant Vulkan WSI implementation:
 * acquire does not wait for exhausted images, and presentation completion is
 * command acceptance rather than physical display timing. */
#define WSI_MAX_SURFACES 4
#define WSI_MAX_SWAPCHAINS 4
#define WSI_MAX_IMAGES 3
#define WSI_MIN_IMAGES 2
/* 512 with the host direct-present profile (colour targets are 512 there). */
#define WSI_MAX_EXTENT (live&&live->present_supported?color_extent():128u)
enum wsi_surface_kind { WSI_SURFACE_XLIB = 1, WSI_SURFACE_XCB };
struct wsi_surface { uint64_t id; unsigned kind; Display *dpy; Window window; xcb_connection_t *connection; xcb_window_t xcb_window; uint64_t active;
    /* Window size cache: a private connection selects StructureNotify on the window,
     * so a size query is a non-blocking event poll instead of an X round trip. */
    xcb_connection_t *watch; unsigned watch_state; uint32_t width, height; };
enum { WSI_WATCH_UNTRIED, WSI_WATCH_ACTIVE, WSI_WATCH_OFF, WSI_WATCH_GONE };
static void wsi_watch_close(struct wsi_surface *s, unsigned state) {
    if (s->watch) xcb_disconnect(s->watch);
    s->watch = NULL; s->watch_state = state;
}
struct wsi_swapchain { uint64_t id, surface; unsigned count, retired; uint64_t images[WSI_MAX_IMAGES], memories[WSI_MAX_IMAGES];
    VkExtent2D extent; VkPresentModeKHR mode; VkFormat format;
    /* A6b: presentation completes synchronously on the host canvas, so an image
     * is available again as soon as it is presented; acquire is round-robin. */
    unsigned acquired[WSI_MAX_IMAGES], next, presented; int x, y; double position_time;
};
static struct wsi_surface wsi_surfaces[WSI_MAX_SURFACES];
static struct wsi_swapchain wsi_swapchains[WSI_MAX_SWAPCHAINS];
static uint64_t wsi_next_surface = 0x5300000001ull, wsi_next_swapchain = 0x5700000001ull;
static unsigned wsi_surface_count, wsi_swapchain_count;
/* Zink builds add B8G8R8A8 (host RGBA storage, guest byte swap; see transfer.inc
 * bgra): Zink's kopper picks the X visual's BGRA format for EGL/GLX windows. */
static const VkSurfaceFormatKHR wsi_formats[] = {
#ifdef GUEST_VK_ZINK
    {VK_FORMAT_B8G8R8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR},
#endif
    {VK_FORMAT_R8G8B8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR} };
/* Advertised swapchain usages. Zink builds also accept (but do not advertise)
 * SAMPLED, which kopper requests unconditionally for every swapchain. */
#ifdef GUEST_VK_ZINK
#define WSI_USAGE (VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT)
#define WSI_USAGE_ACCEPTED (WSI_USAGE | VK_IMAGE_USAGE_SAMPLED_BIT)
#else
#define WSI_USAGE (VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT)
#define WSI_USAGE_ACCEPTED WSI_USAGE
#endif
/* IMMEDIATE is listed because A6b's CPU presenter has no tearing concept
 * distinct from FIFO other than skipping pacing; both are host-feasible.
 * MAILBOX too: every present copies one whole image without waiting, so the
 * newest frame replaces the shown one and none tears (vkmark's default). */
static const VkPresentModeKHR wsi_modes[] = { VK_PRESENT_MODE_FIFO_KHR, VK_PRESENT_MODE_IMMEDIATE_KHR, VK_PRESENT_MODE_MAILBOX_KHR };

static int wsi_instance_enabled(unsigned bit) { return live && (live->instance_extensions_enabled & (1u << bit)); }
static int wsi_swapchain_enabled(void) { return live && live->graphics_supported && (live->device_extensions_enabled & 1u); }
static struct wsi_surface *wsi_surface_get(VkSurfaceKHR h) {
    uint64_t id = RID(h);
    for (unsigned i = 0; i < WSI_MAX_SURFACES; i++) if (id && wsi_surfaces[i].id == id) return &wsi_surfaces[i];
    return NULL;
}
static struct wsi_swapchain *wsi_swapchain_get(VkSwapchainKHR h) {
    uint64_t id = RID(h);
    for (unsigned i = 0; i < WSI_MAX_SWAPCHAINS; i++) if (id && wsi_swapchains[i].id == id) return &wsi_swapchains[i];
    return NULL;
}
static VkResult wsi_surface_new(VkInstance instance, const VkAllocationCallbacks *a, VkSurfaceKHR *out, struct wsi_surface **slot) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE; *slot = NULL;
    if (!live || instance != live || a) return VK_ERROR_INITIALIZATION_FAILED;
    for (unsigned i = 0; i < WSI_MAX_SURFACES; i++) if (!wsi_surfaces[i].id) { *slot = &wsi_surfaces[i]; return VK_SUCCESS; }
    return VK_ERROR_OUT_OF_HOST_MEMORY;
}
static void wsi_surface_commit(struct wsi_surface *s, VkSurfaceKHR *out) {
    s->id = wsi_next_surface++; wsi_surface_count++; *out = HANDLE(VkSurfaceKHR, s->id);
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_create_xlib_surface(VkInstance instance, const VkXlibSurfaceCreateInfoKHR *info,
                                                             const VkAllocationCallbacks *a, VkSurfaceKHR *out) {
    struct wsi_surface *s; VkResult r = wsi_surface_new(instance, a, out, &s);
    if (r != VK_SUCCESS) return r;
    if (!wsi_instance_enabled(WSI_EXT_XLIB) || !info || info->sType != VK_STRUCTURE_TYPE_XLIB_SURFACE_CREATE_INFO_KHR ||
        info->pNext || info->flags || !info->dpy || !info->window) return VK_ERROR_INITIALIZATION_FAILED;
    *s = (struct wsi_surface){ .kind = WSI_SURFACE_XLIB, .dpy = info->dpy, .window = info->window };
    wsi_surface_commit(s, out); return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_create_xcb_surface(VkInstance instance, const VkXcbSurfaceCreateInfoKHR *info,
                                                            const VkAllocationCallbacks *a, VkSurfaceKHR *out) {
    struct wsi_surface *s; VkResult r = wsi_surface_new(instance, a, out, &s);
    if (r != VK_SUCCESS) return r;
    if (!wsi_instance_enabled(WSI_EXT_XCB) || !info || info->sType != VK_STRUCTURE_TYPE_XCB_SURFACE_CREATE_INFO_KHR ||
        info->pNext || info->flags || !info->connection || !info->window) {
        WSI_TRACE("wsi xcb_surface REJECT enabled=%d info=%d pNext=%d flags=0x%x\n", wsi_instance_enabled(WSI_EXT_XCB), !!info, info ? !!info->pNext : 0, info ? info->flags : 0);
        return VK_ERROR_INITIALIZATION_FAILED;
    }
    *s = (struct wsi_surface){ .kind = WSI_SURFACE_XCB, .connection = info->connection, .xcb_window = info->window };
    wsi_surface_commit(s, out); return VK_SUCCESS;
}
static void wsi_swapchain_free(struct wsi_swapchain *c);
static VKAPI_ATTR void VKAPI_CALL wsi_destroy_surface(VkInstance instance, VkSurfaceKHR h, const VkAllocationCallbacks *a) {
    (void)a;
    struct wsi_surface *s = wsi_surface_get(h);
    if (!live || instance != live || !s) return;
    /* Destroying a surface with a live swapchain is invalid usage; retire it
     * so later acquire returns OUT_OF_DATE instead of touching the window. */
    for (unsigned i = 0; i < WSI_MAX_SWAPCHAINS; i++) if (wsi_swapchains[i].id && wsi_swapchains[i].surface == s->id) wsi_swapchains[i].retired = 1;
    wsi_watch_close(s, WSI_WATCH_OFF);
    memset(s, 0, sizeof(*s)); wsi_surface_count--;
}
static VKAPI_ATTR VkBool32 VKAPI_CALL wsi_xlib_presentation_support(VkPhysicalDevice p, uint32_t family, Display *dpy, VisualID visual) {
    /* The A6b presenter converts RGBA8 to the window's TrueColor XImage on the
     * CPU; the visual is not inspected here. */
    (void)visual; return physical_valid(p) && !family && dpy && live->graphics_supported;
}
static VKAPI_ATTR VkBool32 VKAPI_CALL wsi_xcb_presentation_support(VkPhysicalDevice p, uint32_t family, xcb_connection_t *c, xcb_visualid_t visual) {
    (void)visual; return physical_valid(p) && !family && c && live->graphics_supported;
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_surface_support(VkPhysicalDevice p, uint32_t family, VkSurfaceKHR h, VkBool32 *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_FALSE;
    if (!physical_valid(p) || !wsi_instance_enabled(WSI_EXT_SURFACE)) return VK_ERROR_INITIALIZATION_FAILED;
    if (!wsi_surface_get(h)) return VK_ERROR_SURFACE_LOST_KHR;
    *out = !family && live->graphics_supported ? VK_TRUE : VK_FALSE;
    WSI_TRACE("wsi surface_support family=%u supported=%u\n", family, *out); return VK_SUCCESS;
}
/* Opens the watch connection: select StructureNotify, then read the size once. The
 * reply is ordered after the selection, so no later resize is missed. Any failure
 * (another display, no window) disables the cache for this surface. */
static void wsi_watch_open(struct wsi_surface *s) {
    s->watch_state = WSI_WATCH_OFF;
    if (getenv("GUEST_VK_WSI_GEOMETRY_CACHE") && !strcmp(getenv("GUEST_VK_WSI_GEOMETRY_CACHE"), "0")) return;
    xcb_connection_t *c = xcb_connect(NULL, NULL);
    if (!c || xcb_connection_has_error(c)) { if (c) xcb_disconnect(c); return; }
    s->watch = c;
    uint32_t mask = XCB_EVENT_MASK_STRUCTURE_NOTIFY;
    xcb_void_cookie_t select = xcb_change_window_attributes_checked(c, s->xcb_window, XCB_CW_EVENT_MASK, &mask);
    xcb_get_geometry_reply_t *reply = xcb_get_geometry_reply(c, xcb_get_geometry(c, s->xcb_window), NULL);
    xcb_generic_error_t *error = xcb_request_check(c, select);
    if (!reply || error) { free(reply); free(error); wsi_watch_close(s, WSI_WATCH_OFF); return; }
    s->width = reply->width; s->height = reply->height; free(reply);
    s->watch_state = WSI_WATCH_ACTIVE;
    WSI_TRACE("wsi geometry cache window=0x%x %ux%u\n", (unsigned)s->xcb_window, s->width, s->height);
}
/* Applies queued ConfigureNotify/DestroyNotify events. Returns 0 when the cache
 * cannot answer (disabled, connection error) and the caller must ask the server. */
static int wsi_watch_poll(struct wsi_surface *s) {
    if (s->watch_state == WSI_WATCH_UNTRIED) wsi_watch_open(s);
    if (s->watch_state == WSI_WATCH_GONE) return 1;
    if (s->watch_state != WSI_WATCH_ACTIVE) return 0;
    xcb_generic_event_t *event;
    while ((event = xcb_poll_for_event(s->watch))) {
        unsigned type = event->response_type & 0x7f;
        if (type == XCB_CONFIGURE_NOTIFY) {
            xcb_configure_notify_event_t *e = (xcb_configure_notify_event_t *)event;
            if (e->window == s->xcb_window) { s->width = e->width; s->height = e->height; }
        } else if (type == XCB_DESTROY_NOTIFY && ((xcb_destroy_notify_event_t *)event)->window == s->xcb_window) {
            free(event); wsi_watch_close(s, WSI_WATCH_GONE); return 1;
        }
        free(event);
    }
    if (xcb_connection_has_error(s->watch)) { wsi_watch_close(s, WSI_WATCH_OFF); return 0; }
    return 1;
}
static int wsi_window_size(struct wsi_surface *s, uint32_t *w, uint32_t *h) {
    if (s->kind == WSI_SURFACE_XCB && wsi_watch_poll(s)) {
        if (s->watch_state == WSI_WATCH_GONE) return 0;
        *w = s->width; *h = s->height; return 1;
    }
    if (s->kind == WSI_SURFACE_XLIB) {
        Window root; int x, y; unsigned width, height, border, depth;
        if (!XGetGeometry(s->dpy, s->window, &root, &x, &y, &width, &height, &border, &depth)) return 0;
        *w = width; *h = height; return 1;
    }
    xcb_generic_error_t *error = NULL;
    xcb_get_geometry_reply_t *reply = xcb_get_geometry_reply(s->connection, xcb_get_geometry(s->connection, s->xcb_window), &error);
    if (!reply) WSI_TRACE("wsi xcb geometry window=0x%x error=%d conn_error=%d\n", (unsigned)s->xcb_window, error ? error->error_code : -1, xcb_connection_has_error(s->connection));
    free(error);
    if (!reply) return 0;
    *w = reply->width; *h = reply->height; free(reply); return 1;
}
static uint32_t wsi_clamp(uint32_t v) { return v < 1 ? 1 : v > WSI_MAX_EXTENT ? WSI_MAX_EXTENT : v; }
static VkResult wsi_capabilities(VkPhysicalDevice p, struct wsi_surface *s, VkSurfaceCapabilitiesKHR *out) {
    uint32_t w, h;
    if (!wsi_window_size(s, &w, &h)) { WSI_TRACE("wsi capabilities window size LOST\n"); return VK_ERROR_SURFACE_LOST_KHR; }
    WSI_TRACE("wsi capabilities window=%ux%u max=%u\n", w, h, WSI_MAX_EXTENT);
    *out = (VkSurfaceCapabilitiesKHR){
        .minImageCount = WSI_MIN_IMAGES, .maxImageCount = WSI_MAX_IMAGES,
        /* The window size is reported (clamped to the renderer limit). A6b scales
         * the presented image when the window is larger than the extent. */
        .currentExtent = { wsi_clamp(w), wsi_clamp(h) }, .minImageExtent = { 1, 1 },
        .maxImageExtent = { WSI_MAX_EXTENT, WSI_MAX_EXTENT }, .maxImageArrayLayers = 1,
        .supportedTransforms = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR, .currentTransform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR,
        .supportedCompositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR,
        .supportedUsageFlags = WSI_USAGE };
    (void)p; return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_surface_capabilities(VkPhysicalDevice p, VkSurfaceKHR h, VkSurfaceCapabilitiesKHR *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    memset(out, 0, sizeof(*out));
    if (!physical_valid(p) || !wsi_instance_enabled(WSI_EXT_SURFACE) || !live->graphics_supported) return VK_ERROR_INITIALIZATION_FAILED;
    struct wsi_surface *s = wsi_surface_get(h);
    return s ? wsi_capabilities(p, s, out) : VK_ERROR_SURFACE_LOST_KHR;
}
static VkResult wsi_list(uint32_t *count, void *out, const void *items, uint32_t total, size_t size) {
    if (!count) return VK_ERROR_INITIALIZATION_FAILED;
    if (!out) { *count = total; return VK_SUCCESS; }
    uint32_t n = *count < total ? *count : total;
    memcpy(out, items, (size_t)n * size); *count = n;
    return n < total ? VK_INCOMPLETE : VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_surface_formats(VkPhysicalDevice p, VkSurfaceKHR h, uint32_t *count, VkSurfaceFormatKHR *out) {
    if (!physical_valid(p) || !wsi_instance_enabled(WSI_EXT_SURFACE) || !live->graphics_supported || !count) return VK_ERROR_INITIALIZATION_FAILED;
    if (!wsi_surface_get(h)) return VK_ERROR_SURFACE_LOST_KHR;
    return wsi_list(count, out, wsi_formats, sizeof(wsi_formats) / sizeof(wsi_formats[0]), sizeof(wsi_formats[0]));
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_surface_present_modes(VkPhysicalDevice p, VkSurfaceKHR h, uint32_t *count, VkPresentModeKHR *out) {
    if (!physical_valid(p) || !wsi_instance_enabled(WSI_EXT_SURFACE) || !live->graphics_supported || !count) return VK_ERROR_INITIALIZATION_FAILED;
    if (!wsi_surface_get(h)) return VK_ERROR_SURFACE_LOST_KHR;
    return wsi_list(count, out, wsi_modes, sizeof(wsi_modes) / sizeof(wsi_modes[0]), sizeof(wsi_modes[0]));
}
static void wsi_present_end(struct wsi_swapchain *c) {
    if (!c->presented || !live || live->failed) return;
    uint32_t request[7] = { 0, (uint32_t)c->id, 0, 0, 0, 0, 1 }; uint32_t reply[4], size = 0;
    (void)host_call(GPU_PRESENT, request, sizeof(request), reply, sizeof(reply), &size); c->presented = 0;
}
static void wsi_swapchain_free(struct wsi_swapchain *c) {
    wsi_present_end(c);
    for (unsigned i = 0; i < c->count; i++) {
        struct resource *r = resource_get(c->images[i], R_IMAGE); if (r) resource_drop(r);
    }
    for (unsigned i = 0; i < c->count; i++) {
        struct resource *m = resource_get(c->memories[i], R_MEMORY); if (m) resource_drop(m);
    }
    for (unsigned i = 0; i < WSI_MAX_SURFACES; i++) if (wsi_surfaces[i].id && wsi_surfaces[i].active == c->id) wsi_surfaces[i].active = 0;
    memset(c, 0, sizeof(*c)); wsi_swapchain_count--;
}
/* Allocate one swapchain-owned colour target and its device-local memory using
 * the same resource/host path as vkCreateImage+vkAllocateMemory+vkBindImageMemory. */
static VkResult wsi_image_new(VkDevice d, struct wsi_swapchain *c, unsigned index) {
    size_t size = (size_t)c->extent.width * c->extent.height * 4;
    if (size > GUEST_VK_HEAP_BYTES - allocated_bytes) return VK_ERROR_OUT_OF_DEVICE_MEMORY;
    struct resource *img = resource_new(R_IMAGE);
    if (!img) return VK_ERROR_OUT_OF_HOST_MEMORY;
    img->width = c->extent.width; img->height = c->extent.height; img->size = size; img->layout = VK_IMAGE_LAYOUT_UNDEFINED;
    img->graphics_target = 1; img->swapchain = c->id; img->bgra = c->format == VK_FORMAT_B8G8R8A8_UNORM; c->images[index] = img->id; c->count = index + 1;
    struct resource *mem = resource_new(R_MEMORY);
    if (!mem) return VK_ERROR_OUT_OF_HOST_MEMORY;
    mem->size = size; mem->type = 0; mem->swapchain = c->id; allocated_bytes += size; c->memories[index] = mem->id;
    return bind_memory(d, img->id, R_IMAGE, HANDLE(VkDeviceMemory, mem->id), 0);
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_create_swapchain(VkDevice d, const VkSwapchainCreateInfoKHR *i, const VkAllocationCallbacks *a, VkSwapchainKHR *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    if (!device_valid(d) || !wsi_swapchain_enabled() || !i || a || i->sType != VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR || i->pNext || i->flags) {
        WSI_TRACE("wsi swapchain REJECT enabled=%d pNext=%d flags=0x%x\n", wsi_swapchain_enabled(), i ? !!i->pNext : 0, i ? i->flags : 0);
        return VK_ERROR_INITIALIZATION_FAILED;
    }
    struct wsi_surface *s = wsi_surface_get(i->surface);
    if (!s) return VK_ERROR_SURFACE_LOST_KHR;
    struct wsi_swapchain *old = i->oldSwapchain ? wsi_swapchain_get(i->oldSwapchain) : NULL;
    if (i->oldSwapchain && (!old || old->surface != s->id || old->retired)) return VK_ERROR_INITIALIZATION_FAILED;
    if (s->active && (!old || old->id != s->active)) return VK_ERROR_NATIVE_WINDOW_IN_USE_KHR;
    /* A valid oldSwapchain is retired even if creating the new one fails; it
     * stays valid (images usable) until destroyed, but cannot be acquired. */
    if (old) old->retired = 1;
    VkSurfaceCapabilitiesKHR caps; VkResult status = wsi_capabilities(&live->physical, s, &caps);
    if (status != VK_SUCCESS) return status;
    const VkImageUsageFlags allowed = WSI_USAGE_ACCEPTED;
    int mode_ok = 0, format_ok = 0;
    for (unsigned m = 0; m < sizeof(wsi_modes) / sizeof(wsi_modes[0]); m++) if (i->presentMode == wsi_modes[m]) mode_ok = 1;
    for (unsigned f = 0; f < sizeof(wsi_formats) / sizeof(wsi_formats[0]); f++)
        if (i->imageFormat == wsi_formats[f].format && i->imageColorSpace == wsi_formats[f].colorSpace) format_ok = 1;
    if (i->minImageCount < caps.minImageCount || i->minImageCount > caps.maxImageCount ||
        !format_ok ||
        i->imageExtent.width < caps.minImageExtent.width || i->imageExtent.height < caps.minImageExtent.height ||
        i->imageExtent.width > caps.maxImageExtent.width || i->imageExtent.height > caps.maxImageExtent.height ||
        i->imageArrayLayers != 1 || !(i->imageUsage & VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT) || (i->imageUsage & ~allowed) ||
        i->imageSharingMode != VK_SHARING_MODE_EXCLUSIVE || i->preTransform != VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR ||
        i->compositeAlpha != VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR || !mode_ok || (i->clipped != VK_TRUE && i->clipped != VK_FALSE)) {
        WSI_TRACE("wsi swapchain REJECT count=%u format=%d space=%d extent=%ux%u usage=0x%x alpha=0x%x mode=%d\n", i->minImageCount, i->imageFormat, i->imageColorSpace,
                   i->imageExtent.width, i->imageExtent.height, i->imageUsage, i->compositeAlpha, i->presentMode);
        return VK_ERROR_INITIALIZATION_FAILED;
    }
    struct wsi_swapchain *c = NULL;
    for (unsigned k = 0; k < WSI_MAX_SWAPCHAINS; k++) if (!wsi_swapchains[k].id) { c = &wsi_swapchains[k]; break; }
    if (!c) return VK_ERROR_OUT_OF_HOST_MEMORY;
    *c = (struct wsi_swapchain){ .id = wsi_next_swapchain++, .surface = s->id, .extent = i->imageExtent, .mode = i->presentMode, .format = i->imageFormat };
    wsi_swapchain_count++;
    /* Exactly minImageCount images: the app sees them via GetSwapchainImagesKHR. */
    for (unsigned k = 0; k < i->minImageCount; k++) {
        status = wsi_image_new(d, c, k);
        if (status != VK_SUCCESS) { wsi_swapchain_free(c); return status; }
    }
    s->active = c->id; *out = HANDLE(VkSwapchainKHR, c->id); return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL wsi_destroy_swapchain(VkDevice d, VkSwapchainKHR h, const VkAllocationCallbacks *a) {
    (void)a; struct wsi_swapchain *c = wsi_swapchain_get(h);
    if (device_valid(d) && c) wsi_swapchain_free(c);
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_swapchain_images(VkDevice d, VkSwapchainKHR h, uint32_t *count, VkImage *out) {
    struct wsi_swapchain *c = wsi_swapchain_get(h);
    if (!device_valid(d) || !c || !count) return VK_ERROR_INITIALIZATION_FAILED;
    VkImage images[WSI_MAX_IMAGES];
    for (unsigned k = 0; k < c->count; k++) images[k] = HANDLE(VkImage, c->images[k]);
    return wsi_list(count, out, images, c->count, sizeof(images[0]));
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_acquire(VkDevice d, VkSwapchainKHR h, uint64_t timeout, VkSemaphore semaphore, VkFence fence, uint32_t *index) {
    struct wsi_swapchain *c = wsi_swapchain_get(h);
    if (!device_valid(d) || !c || !index || (!semaphore && !fence)) return VK_ERROR_INITIALIZATION_FAILED;
    if (live->failed) return VK_ERROR_DEVICE_LOST;
    if (c->retired) return VK_ERROR_OUT_OF_DATE_KHR;
    if (!live->present_supported) return VK_ERROR_FEATURE_NOT_PRESENT;
    struct sync_object *sem = NULL, *f = NULL;
    if (semaphore && (!(sem = sync_get(RID(semaphore), S_SEMAPHORE)) || sem->signaled)) return VK_ERROR_INITIALIZATION_FAILED;
    if (fence && (!(f = sync_get(RID(fence), S_FENCE)) || f->signaled)) return VK_ERROR_INITIALIZATION_FAILED;
    for (unsigned k = 0; k < c->count; k++) {
        unsigned n = (c->next + k) % c->count;
        if (c->acquired[n]) continue;
        c->acquired[n] = 1; c->next = (n + 1) % c->count; *index = n;
        if (sem) sem->signaled = 1;
        if (f) f->signaled = 1;
        return VK_SUCCESS;
    }
    return timeout ? VK_TIMEOUT : VK_NOT_READY;
}
/* C11 timespec_get (wall clock) is enough for rate-limiting position queries. */
static double wsi_now(void) { struct timespec t; if (!timespec_get(&t, TIME_UTC)) return 0; return t.tv_sec + t.tv_nsec / 1e9; }
/* The window's root position, refreshed at most every 0.25s (one X round trip). */
static void wsi_position(struct wsi_swapchain *c, const struct wsi_surface *s) {
    double t = wsi_now();
    if (c->position_time && t - c->position_time < 0.25) return;
    c->position_time = t;
    if (s->kind == WSI_SURFACE_XLIB) {
        Window child; int x, y;
        if (XTranslateCoordinates(s->dpy, s->window, DefaultRootWindow(s->dpy), 0, 0, &x, &y, &child)) { c->x = x; c->y = y; }
        return;
    }
    xcb_screen_t *screen = xcb_setup_roots_iterator(xcb_get_setup(s->connection)).data;
    if (!screen) return;
    xcb_translate_coordinates_reply_t *reply = xcb_translate_coordinates_reply(s->connection,
        xcb_translate_coordinates(s->connection, s->xcb_window, screen->root, 0, 0), NULL);
    if (reply) { c->x = reply->dst_x; c->y = reply->dst_y; free(reply); }
}
static VKAPI_ATTR VkResult VKAPI_CALL wsi_queue_present(VkQueue q, const VkPresentInfoKHR *info) {
    if (!live || !live->device || q != &live->device->queue || live->failed) return VK_ERROR_DEVICE_LOST;
    if (!info || info->sType != VK_STRUCTURE_TYPE_PRESENT_INFO_KHR || info->pNext || !info->swapchainCount || !info->pSwapchains || !info->pImageIndices ||
        (info->waitSemaphoreCount && !info->pWaitSemaphores)) return VK_ERROR_INITIALIZATION_FAILED;
    for (uint32_t w = 0; w < info->waitSemaphoreCount; w++) {
        struct sync_object *x = sync_get(RID(info->pWaitSemaphores[w]), S_SEMAPHORE);
        if (!x || !x->signaled) return VK_ERROR_INITIALIZATION_FAILED;
    }
    for (uint32_t w = 0; w < info->waitSemaphoreCount; w++) sync_get(RID(info->pWaitSemaphores[w]), S_SEMAPHORE)->signaled = 0;
    VkResult overall = VK_SUCCESS;
    for (uint32_t n = 0; n < info->swapchainCount; n++) {
        struct wsi_swapchain *c = wsi_swapchain_get(info->pSwapchains[n]); uint32_t index = info->pImageIndices[n];
        struct resource *r = c && index < c->count ? resource_get(c->images[index], R_IMAGE) : NULL;
        struct wsi_surface *s = c ? wsi_surface_get(HANDLE(VkSurfaceKHR, c->surface)) : NULL;
        VkResult result = VK_SUCCESS;
        if (!r || !c->acquired[index] || r->layout != VK_IMAGE_LAYOUT_PRESENT_SRC_KHR || !r->host) result = VK_ERROR_INITIALIZATION_FAILED;
        else if (c->retired || !s) result = VK_ERROR_OUT_OF_DATE_KHR;
        else {
            wsi_position(c, s);
            uint32_t request[7] = { r->host, (uint32_t)c->id, (uint32_t)c->x, (uint32_t)c->y, c->extent.width, c->extent.height, 0 };
            uint32_t reply[4], size = 0;
            result = host_call(GPU_PRESENT, request, sizeof(request), reply, sizeof(reply), &size);
            if (result == VK_SUCCESS) c->presented = 1;
        }
        if (c && index < c->count) c->acquired[index] = 0;
        if (info->pResults) info->pResults[n] = result;
        if (result != VK_SUCCESS && overall == VK_SUCCESS) overall = result;
    }
    return overall;
}
static PFN_vkVoidFunction wsi_swapchain_proc(const char *name) {
#define PROC(api, impl) if (!strcmp(name, #api)) return (PFN_vkVoidFunction)impl;
    PROC(vkCreateSwapchainKHR, wsi_create_swapchain)
    PROC(vkDestroySwapchainKHR, wsi_destroy_swapchain)
    PROC(vkGetSwapchainImagesKHR, wsi_swapchain_images)
    PROC(vkAcquireNextImageKHR, wsi_acquire)
    PROC(vkQueuePresentKHR, wsi_queue_present)
#undef PROC
    return NULL;
}
/* Device-level lookup: only when VK_KHR_swapchain was enabled on this device. */
static PFN_vkVoidFunction wsi_device_proc(const char *name) {
    return wsi_swapchain_enabled() ? wsi_swapchain_proc(name) : NULL;
}
/* Instance-level lookup. The loader fills its per-ICD dispatch (including
 * CreateSwapchainKHR, which its terminator substitutes the driver surface into)
 * from this GIPA right after vkCreateInstance, before any device exists. The
 * application-visible device procs remain gated by wsi_device_proc. */
static PFN_vkVoidFunction wsi_instance_proc(const char *name) {
#define PROC(bit, api, impl) if (!strcmp(name, #api)) return wsi_instance_enabled(bit) ? (PFN_vkVoidFunction)impl : NULL;
    PROC(WSI_EXT_SURFACE, vkDestroySurfaceKHR, wsi_destroy_surface)
    PROC(WSI_EXT_SURFACE, vkGetPhysicalDeviceSurfaceSupportKHR, wsi_surface_support)
    PROC(WSI_EXT_SURFACE, vkGetPhysicalDeviceSurfaceCapabilitiesKHR, wsi_surface_capabilities)
    PROC(WSI_EXT_SURFACE, vkGetPhysicalDeviceSurfaceFormatsKHR, wsi_surface_formats)
    PROC(WSI_EXT_SURFACE, vkGetPhysicalDeviceSurfacePresentModesKHR, wsi_surface_present_modes)
    PROC(WSI_EXT_XLIB, vkCreateXlibSurfaceKHR, wsi_create_xlib_surface)
    PROC(WSI_EXT_XLIB, vkGetPhysicalDeviceXlibPresentationSupportKHR, wsi_xlib_presentation_support)
    PROC(WSI_EXT_XCB, vkCreateXcbSurfaceKHR, wsi_create_xcb_surface)
    PROC(WSI_EXT_XCB, vkGetPhysicalDeviceXcbPresentationSupportKHR, wsi_xcb_presentation_support)
#undef PROC
    return live && live->graphics_supported ? wsi_swapchain_proc(name) : NULL;
}
static void wsi_device_cleanup(void) {
    unsigned leaked = wsi_swapchain_count;
    for (unsigned i = 0; i < WSI_MAX_SWAPCHAINS; i++) if (wsi_swapchains[i].id) wsi_swapchain_free(&wsi_swapchains[i]);
    printf("GUEST_VK_WSI_LIVE swapchains=%u leaked=%u\n", wsi_swapchain_count, leaked); fflush(stdout);
}
static void wsi_instance_cleanup(void) {
    unsigned leaked = wsi_surface_count;
    memset(wsi_surfaces, 0, sizeof(wsi_surfaces)); wsi_surface_count = 0;
    printf("GUEST_VK_WSI_SURFACES live=%u leaked=%u\n", wsi_surface_count, leaked); fflush(stdout);
}
