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
 */
#define _POSIX_C_SOURCE 200809L /* setenv */
#include <EGL/egl.h>
#include <stdlib.h>

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

__attribute__((constructor)) static void zink_egl_static_register(void) {
  setenv("EGL_PLATFORM", "surfaceless", 0);
  setenv("MESA_LOADER_DRIVER_OVERRIDE", "zink", 0);
  setenv("LIBGL_ALWAYS_SOFTWARE", "1", 0);
  PR_LoadStaticLibrary("libEGL.so", zink_egl_table);
  PR_LoadStaticLibrary("libGL.so", zink_gl_table);
}
