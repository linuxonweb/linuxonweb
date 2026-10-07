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
#include <X11/Xlib.h>
#include <X11/Xutil.h>
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

static int x_size(unsigned long window, int *width, int *height) {
  pthread_mutex_lock(&x_lock);
  Window root;
  int x, y;
  unsigned w = 0, h = 0, border, depth;
  Display *d = x_open();
  int ok = d && XGetGeometry(d, (Window)window, &root, &x, &y, &w, &h, &border, &depth);
  pthread_mutex_unlock(&x_lock);
  if (ok) { *width = (int)w; *height = (int)h; }
  return ok;
}

static int x_present(unsigned long window, const unsigned *pixels, int x, int y, int width, int height) {
  pthread_mutex_lock(&x_lock);
  XWindowAttributes wa;
  Display *d = x_open();
  int ok = d && XGetWindowAttributes(d, (Window)window, &wa);
  Visual *v = ok ? wa.visual : NULL;
  /* glremote hands over 0xAARRGGBB words: the common 24/32-bit TrueColor layout. */
  ok = ok && (wa.depth == 24 || wa.depth == 32) && v->red_mask == 0xff0000 && v->green_mask == 0xff00 &&
       v->blue_mask == 0xff;
  if (ok) {
    GC *gc = &x_gc[wa.depth == 32];
    if (!*gc) *gc = XCreateGC(d, (Window)window, 0, NULL);
    XImage *image = XCreateImage(d, v, (unsigned)wa.depth, ZPixmap, 0, (char *)pixels, (unsigned)width,
                                 (unsigned)height, 32, width * 4);
    if (image) {
      image->byte_order = LSBFirst;
      XPutImage(d, (Window)window, *gc, image, 0, 0, x, y, (unsigned)width, (unsigned)height);
      image->data = NULL; /* not ours to free */
      XDestroyImage(image);
      XSync(d, False);
    }
    ok = image != NULL;
  }
  pthread_mutex_unlock(&x_lock);
  return ok;
}

/* Expose events on this private connection tell when a window lost what it
 * showed; glremote then presents a whole frame instead of the damage only.
 * A window seen for the first time (or beyond the table) counts as exposed. */
static int x_exposed(unsigned long window) {
  static unsigned long watched[32];
  static unsigned n_watched;
  int exposed = 1;
  pthread_mutex_lock(&x_lock);
  Display *d = x_open();
  if (d) {
    unsigned i = 0;
    while (i < n_watched && watched[i] != window) i++;
    if (i < n_watched) {
      XEvent event;
      exposed = 0;
      while (XCheckTypedWindowEvent(d, (Window)window, Expose, &event)) exposed = 1;
    } else if (n_watched < sizeof watched / sizeof *watched) {
      watched[n_watched++] = window;
      XSelectInput(d, (Window)window, ExposureMask);
    }
  }
  pthread_mutex_unlock(&x_lock);
  return exposed;
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

static const struct glremote_window_ops x11_window_ops = {x_size, x_present, x_exposed, x_visual};

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
