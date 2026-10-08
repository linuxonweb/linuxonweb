/* Firefox adapter: statically linked Mesa EGL (surfaceless, Zink) as NSPR
 * static libraries "libEGL.so" and "libGL.so" (packet F1a).
 *
 * Firefox's GLLibraryEGL::Init does PR_LoadLibrary("libEGL.so") then
 * PR_LoadLibrary("libGL.so") and resolves its core EGL entry points only
 * through the returned PRLibrary (no eglGetProcAddress fallback for those).
 * The guest has no dynamic loader, so this constructor registers both names
 * with PR_LoadStaticLibrary before any gfx code runs. NSPR looks a static
 * library up by basename, so the Firefox lookups find these tables without
 * any Firefox source change.
 *
 * - "libEGL.so": every EGL 1.0-1.5 core entry point Mesa's libEGL exports.
 *   Extension functions (eglCreateImageKHR, eglQueryDevicesEXT, ...) are
 *   reached through eglGetProcAddress, which Mesa implements.
 * - "libGL.so": an empty table. GLLibraryLoader tries the library first and
 *   falls back to eglGetProcAddress, which in Mesa resolves every GL/GLES
 *   function through glapi (EGL_KHR_get_all_proc_addresses).
 *
 * The same constructor sets Mesa defaults for the guest (only when unset):
 * EGL_PLATFORM=surfaceless (no DRM/GBM/X11 EGL platform in the static
 * build), MESA_LOADER_DRIVER_OVERRIDE=zink and LIBGL_ALWAYS_SOFTWARE=1 (Zink
 * on the guest Vulkan ICD, reached without a DRM render node).
 *
 * GUEST_GL_BACKEND picks the GL behind those names: "webgl2" registers
 * glremote (OpenGL ES 3.0 replayed on the host browser's WebGL2, see
 * web/linux/tests/guest-glremote), "zink" registers Mesa, and "auto" (the
 * default) uses glremote when the host offers it and Mesa otherwise. The
 * choice is written to GUEST_GL_BACKEND_ACTIVE for reports.
 *
 * With glremote, EGL window surfaces (hardware WebRender's RenderCompositorEGL)
 * are X11 windows: each eglSwapBuffers reads the host canvas back and this
 * file draws it into the window with XPutImage on a private connection.
 */
#define _POSIX_C_SOURCE 200809L /* setenv */
#include <EGL/egl.h>
#include <X11/Xlib-xcb.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <xcb/xcb.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "glremote.h"

/* NSPR ABI (prlink.h), declared locally to avoid NSPR include paths. */
typedef void (*PRFuncPtr)(void);
typedef struct PRStaticLinkTable {
  const char *name;
  PRFuncPtr fp;
} PRStaticLinkTable;
struct PRLibrary;
struct PRLibrary *PR_LoadStaticLibrary(const char *name,
                                       const PRStaticLinkTable *table);

#define E(fn) {#fn, (PRFuncPtr)fn}

static const PRStaticLinkTable zink_egl_table[] = {
    /* EGL 1.0 */
    E(eglChooseConfig), E(eglCopyBuffers), E(eglCreateContext),
    E(eglCreatePbufferSurface), E(eglCreatePixmapSurface),
    E(eglCreateWindowSurface), E(eglDestroyContext), E(eglDestroySurface),
    E(eglGetConfigAttrib), E(eglGetConfigs), E(eglGetCurrentDisplay),
    E(eglGetCurrentSurface), E(eglGetDisplay), E(eglGetError),
    E(eglGetProcAddress), E(eglInitialize), E(eglMakeCurrent),
    E(eglQueryContext), E(eglQueryString), E(eglQuerySurface),
    E(eglSwapBuffers), E(eglTerminate), E(eglWaitGL), E(eglWaitNative),
    /* EGL 1.1 */
    E(eglBindTexImage), E(eglReleaseTexImage), E(eglSurfaceAttrib),
    E(eglSwapInterval),
    /* EGL 1.2 */
    E(eglBindAPI), E(eglQueryAPI), E(eglCreatePbufferFromClientBuffer),
    E(eglReleaseThread), E(eglWaitClient),
    /* EGL 1.4 */
    E(eglGetCurrentContext),
    /* EGL 1.5 */
    E(eglCreateSync), E(eglDestroySync), E(eglClientWaitSync),
    E(eglGetSyncAttrib), E(eglCreateImage), E(eglDestroyImage),
    E(eglGetPlatformDisplay), E(eglCreatePlatformWindowSurface),
    E(eglCreatePlatformPixmapSurface), E(eglWaitSync),
    {0, 0},
};

static const PRStaticLinkTable zink_gl_table[] = {
    {0, 0},
};

/* ---- X11 window surfaces for glremote ---- */

static pthread_mutex_t x_lock = PTHREAD_MUTEX_INITIALIZER;
static Display *x_display;
static GC x_gc[2]; /* depth 24, depth 32 */

static Display *x_open(void) {
  if (!x_display && !(x_display = XOpenDisplay(NULL))) fprintf(stderr, "glremote: XOpenDisplay failed\n");
  return x_display;
}

/* What this connection knows about a window surface's X window. Depth and
 * visual never change for a window; size, exposures and destruction arrive as
 * events, so a frame needs no round trip to learn them. */
struct x_window {
  unsigned long id;
  int width, height, depth, exposed, gone;
  Visual *visual;
  /* Position on the root window, while placed (see x_origin). */
  int x, y, placed;
};
static struct x_window x_windows[32];

/* Applies every event that has already arrived; never waits. */
static void x_drain(Display *d) {
  while (XEventsQueued(d, QueuedAfterReading)) {
    XEvent event;
    XNextEvent(d, &event);
    /* Only window surfaces and their ancestors send these here: any of them
     * moving can move every window surface. */
    if (event.type == ConfigureNotify || event.type == ReparentNotify)
      for (unsigned i = 0; i < sizeof x_windows / sizeof *x_windows; i++) x_windows[i].placed = 0;
    for (unsigned i = 0; i < sizeof x_windows / sizeof *x_windows; i++) {
      struct x_window *w = &x_windows[i];
      if (!w->id || w->gone) continue;
      if (event.type == ConfigureNotify && event.xconfigure.window == (Window)w->id) {
        w->width = event.xconfigure.width;
        w->height = event.xconfigure.height;
      } else if (event.type == DestroyNotify && event.xdestroywindow.window == (Window)w->id) {
        w->gone = 1;
      } else if (event.type == Expose && event.xexpose.window == (Window)w->id) {
        w->exposed = 1;
      }
    }
  }
}

/* The window's entry, created on first use: events are selected before its
 * attributes are read, so no later change is missed. With the table full of
 * live windows, a window is read afresh on every call and always counts as
 * exposed. NULL when the window cannot be read. */
static struct x_window *x_window(Display *d, unsigned long window) {
  static struct x_window uncached;
  struct x_window *slot = NULL;
  for (unsigned i = 0; i < sizeof x_windows / sizeof *x_windows; i++) {
    struct x_window *w = &x_windows[i];
    if (w->id == window && !w->gone) return w;
    if (!slot && (!w->id || w->gone)) slot = w;
  }
  if (!slot) slot = &uncached;
  XWindowAttributes wa;
  XSelectInput(d, (Window)window, StructureNotifyMask | ExposureMask);
  if (!XGetWindowAttributes(d, (Window)window, &wa)) return NULL;
  *slot = (struct x_window){window, wa.width, wa.height, wa.depth, 1, 0, wa.visual, 0, 0, 0};
  return slot;
}

static int x_size(unsigned long window, int *width, int *height) {
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  struct x_window *w = NULL;
  if (d) {
    x_drain(d);
    w = x_window(d, window);
  }
  int ok = w && !w->gone;
  if (ok) { *width = w->width; *height = w->height; }
  pthread_mutex_unlock(&x_lock);
  return ok;
}

static int x_present(unsigned long window, const unsigned *pixels, int x, int y, int width, int height) {
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  struct x_window *w = NULL;
  if (d) {
    x_drain(d);
    w = x_window(d, window);
  }
  Visual *v = w ? w->visual : NULL;
  /* glremote hands over 0xAARRGGBB words: the common 24/32-bit TrueColor layout. */
  int ok = w && !w->gone && (w->depth == 24 || w->depth == 32) && v->red_mask == 0xff0000 &&
           v->green_mask == 0xff00 && v->blue_mask == 0xff;
  if (ok) {
    GC *gc = &x_gc[w->depth == 32];
    if (!*gc) *gc = XCreateGC(d, (Window)window, 0, NULL);
    XImage *image = XCreateImage(d, v, (unsigned)w->depth, ZPixmap, 0, (char *)pixels, (unsigned)width,
                                 (unsigned)height, 32, width * 4);
    if (image) {
      image->byte_order = LSBFirst;
      XPutImage(d, (Window)window, *gc, image, 0, 0, x, y, (unsigned)width, (unsigned)height);
      image->data = NULL; /* not ours to free */
      XDestroyImage(image);
      /* Sent, not awaited: XPutImage has already copied the pixels out, and a
       * full socket holds the next frame back until the server catches up. */
      XFlush(d);
    }
    ok = image != NULL;
  }
  pthread_mutex_unlock(&x_lock);
  return ok;
}

/* Expose events tell when a window lost what it showed; glremote then
 * presents a whole frame instead of the damage only. A window seen for the
 * first time counts as exposed. */
static int x_exposed(unsigned long window) {
  int exposed = 1;
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  struct x_window *w = NULL;
  if (d) {
    x_drain(d);
    w = x_window(d, window);
  }
  if (w) {
    exposed = w->exposed;
    w->exposed = 0;
  }
  pthread_mutex_unlock(&x_lock);
  return exposed;
}

/* Keyed presentation (glremote.h). The position on the root window is read
 * once and again only after the window or an ancestor was configured or
 * reparented; StructureNotify is selected on every ancestor for that. The
 * requests go through XCB so that an ancestor destroyed meanwhile is an error
 * reply here, not a call to the application's fatal Xlib error handler. */
static int x_origin(unsigned long window, int *x, int *y) {
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  struct x_window *w = NULL;
  if (d) {
    x_drain(d);
    w = x_window(d, window);
  }
  int ok = w && !w->gone;
  if (ok && !w->placed) {
    xcb_connection_t *conn = XGetXCBConnection(d);
    uint32_t mask = XCB_EVENT_MASK_STRUCTURE_NOTIFY;
    xcb_window_t root = 0;
    for (xcb_window_t at = (xcb_window_t)window; ok;) {
      xcb_query_tree_reply_t *tree = xcb_query_tree_reply(conn, xcb_query_tree(conn, at), NULL);
      if (!tree) { ok = 0; break; }
      root = tree->root;
      xcb_window_t parent = tree->parent;
      free(tree);
      if (!parent || parent == root) break;
      xcb_generic_error_t *error = xcb_request_check(conn, xcb_change_window_attributes_checked(conn, parent, XCB_CW_EVENT_MASK, &mask));
      if (error) { free(error); ok = 0; }
      at = parent;
    }
    xcb_translate_coordinates_reply_t *at = ok ? xcb_translate_coordinates_reply(conn, xcb_translate_coordinates(conn, (xcb_window_t)window, root, 0, 0), NULL) : NULL;
    if (at) {
      w->x = at->dst_x;
      w->y = at->dst_y;
      w->placed = 1;
      free(at);
    } else ok = 0;
  }
  if (ok) { *x = w->x; *y = w->y; }
  pthread_mutex_unlock(&x_lock);
  return ok;
}

static int x_fill(unsigned long window, unsigned rgb) {
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  struct x_window *w = NULL;
  if (d) {
    x_drain(d);
    w = x_window(d, window);
  }
  Visual *v = w ? w->visual : NULL;
  /* Opaque windows only: the host shows the key's pixels without alpha. */
  int ok = w && !w->gone && w->depth == 24 && v->red_mask == 0xff0000 && v->green_mask == 0xff00 && v->blue_mask == 0xff;
  if (ok) {
    GC *gc = &x_gc[0];
    if (!*gc) *gc = XCreateGC(d, (Window)window, 0, NULL);
    XSetForeground(d, *gc, rgb & 0xffffff);
    XFillRectangle(d, (Window)window, *gc, 0, 0, (unsigned)w->width, (unsigned)w->height);
    XFlush(d);
  }
  pthread_mutex_unlock(&x_lock);
  return ok;
}

static int x_visual(int depth) {
  static int ids[2] = {-1, -1};
  int *id = &ids[depth == 32];
  pthread_mutex_lock(&x_lock);
  if (*id < 0) {
    XVisualInfo info;
    Display *d = x_open();
    *id = d && XMatchVisualInfo(d, DefaultScreen(d), depth, TrueColor, &info) ? (int)info.visualid : 0;
  }
  int result = *id;
  pthread_mutex_unlock(&x_lock);
  return result;
}

static const struct glremote_window_ops x11_window_ops = {x_size, x_present, x_exposed, x_visual, x_origin, x_fill};

__attribute__((constructor)) static void zink_egl_static_register(void) {
  const char *backend = getenv("GUEST_GL_BACKEND");
  int remote = backend && !strcmp(backend, "webgl2");
  if (!backend || !*backend || !strcmp(backend, "auto")) remote = glremote_available();
  setenv("GUEST_GL_BACKEND_ACTIVE", remote ? "webgl2" : "zink", 1);
  if (remote) {
    /* struct glremote_export has PRStaticLinkTable's layout. */
    PR_LoadStaticLibrary("libEGL.so", (const PRStaticLinkTable *)glremote_egl_table);
    PR_LoadStaticLibrary("libGL.so", zink_gl_table);
    glremote_set_window_ops(&x11_window_ops);
    return;
  }
  setenv("EGL_PLATFORM", "surfaceless", 0);
  setenv("MESA_LOADER_DRIVER_OVERRIDE", "zink", 0);
  setenv("LIBGL_ALWAYS_SOFTWARE", "1", 0);
  PR_LoadStaticLibrary("libEGL.so", zink_egl_table);
  PR_LoadStaticLibrary("libGL.so", zink_gl_table);
}
