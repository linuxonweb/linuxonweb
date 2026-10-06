/* Helper-only loader adaptor. Every returned graphics entry point is Mesa's;
 * unavailable GLX, DRM, PCI and other libraries retain musl loader failures.
 * This file emits no graphics-probe records and claims no acceleration. */
#define _POSIX_C_SOURCE 200809L
#include <EGL/egl.h>
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>

void *__real_dlopen(const char *, int);
void *__real_dlsym(void *, const char *);
int __real_dlclose(void *);
static char egl_handle, gl_handle;

void *__wrap_dlopen(const char *name, int flags) {
  if (name && (!strcmp(name, "libEGL.so") || !strcmp(name, "libEGL.so.1")))
    return &egl_handle;
  if (name && (!strcmp(name, "libGL.so") || !strcmp(name, "libGL.so.1") ||
               !strcmp(name, "libGLESv2.so") || !strcmp(name, "libGLESv2.so.2")))
    return &gl_handle;
  return __real_dlopen(name, flags);
}

void *__wrap_dlsym(void *handle, const char *name) {
  if (handle == &egl_handle || handle == &gl_handle) {
    if (!name) return NULL;
    if (handle == &egl_handle && !strcmp(name, "eglGetProcAddress"))
      return (void *)eglGetProcAddress;
    /* These are the only direct dlsym requests in current159's graphics
     * probe for the handled libraries. Other EGL methods use the real
     * eglGetProcAddress API. Never generate unknown dispatch entry points. */
    if (handle == &gl_handle && !strcmp(name, "glGetString"))
      return (void *)eglGetProcAddress("glGetString");
    return NULL;
  }
  return __real_dlsym(handle, name);
}

int __wrap_dlclose(void *handle) {
  if (handle == &egl_handle || handle == &gl_handle) return 0;
  return __real_dlclose(handle);
}

__attribute__((constructor)) static void mesa_guest_defaults(void) {
  setenv("EGL_PLATFORM", "surfaceless", 0);
  setenv("MESA_LOADER_DRIVER_OVERRIDE", "zink", 0);
  setenv("LIBGL_ALWAYS_SOFTWARE", "1", 0);
}
