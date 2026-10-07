/* Helper-only loader adaptor: Firefox's gfxtest graphics probe on glremote
 * (guest OpenGL ES 3.0 / EGL 1.5 replayed on the host browser's WebGL2, see
 * web/linux/tests/guest-glremote), the GL that the Firefox libEGL adaptor
 * (web/linux/firefox-shims/zink-egl-static.c) selects when the host offers it.
 *
 * gfxtest dlopens libEGL.so and libGL.so; the guest has no dynamic loader, so
 * those names resolve here to glremote's entry points. Every value the probe
 * records (vendor, renderer, version, device extensions) comes from glremote
 * and the host context; this file records nothing itself.
 *
 * One adaptation: on non-ARM targets the probe binds EGL_OPENGL_API (desktop
 * GL) before creating its test context. glremote offers OpenGL ES only, which
 * is what Firefox itself uses with gfx.egl.prefer-gles.enabled, so the probe's
 * desktop request is bound as EGL_OPENGL_ES_API. The probe's version string
 * then names OpenGL ES. */
#define _POSIX_C_SOURCE 200809L
#include <EGL/egl.h>
#include <dlfcn.h>
#include <string.h>

#include "glremote.h"

void *__real_dlopen(const char *, int);
void *__real_dlsym(void *, const char *);
int __real_dlclose(void *);
static char egl_handle, gl_handle;

static EGLBoolean probe_bind_api(EGLenum api) {
  EGLBoolean (*bind)(EGLenum) = (EGLBoolean (*)(EGLenum))glremote_get_proc_address("eglBindAPI");
  return bind(api == EGL_OPENGL_API ? EGL_OPENGL_ES_API : api);
}

static glremote_proc probe_get_proc_address(const char *name) {
  if (name && !strcmp(name, "eglBindAPI")) return (glremote_proc)probe_bind_api;
  return glremote_get_proc_address(name);
}

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
    /* The probe's only direct dlsym requests for these libraries. */
    if (handle == &egl_handle && !strcmp(name, "eglGetProcAddress"))
      return (void *)probe_get_proc_address;
    if (handle == &gl_handle && !strcmp(name, "glGetString"))
      return (void *)glremote_get_proc_address("glGetString");
    return NULL;
  }
  return __real_dlsym(handle, name);
}

int __wrap_dlclose(void *handle) {
  if (handle == &egl_handle || handle == &gl_handle) return 0;
  return __real_dlclose(handle);
}
