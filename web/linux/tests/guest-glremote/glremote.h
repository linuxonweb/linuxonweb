/* Guest OpenGL ES 3.0 + EGL 1.5 forwarded to the host browser's WebGL2.
 *
 * glremote encodes GLES calls into a per-context command stream and sends it
 * over the gpu_hostcall channel (web/linux/dist/guest-gpu-hostcall.js) to the
 * host GPU-owner Worker, which replays it on a WebGL2 context of an
 * OffscreenCanvas (web/linux/dist/guest-gl-remote.js). Calls without a result
 * are batched; queries end the batch and wait for the reply. Object names are
 * allocated in the guest, so glGen* never waits.
 *
 * Every entry point is reachable only through glremote_get_proc_address() (and
 * the EGL table glremote_egl_table), so the library can be linked next to Mesa
 * without symbol clashes; an application picks it at runtime. */
#ifndef GLREMOTE_H
#define GLREMOTE_H

typedef void (*glremote_proc)(void);

/* "glXxx" / "eglXxx" -> function, or NULL. */
glremote_proc glremote_get_proc_address(const char *name);

struct glremote_export { const char *name; glremote_proc fn; };
/* NULL-terminated list of the EGL 1.0-1.5 core entry points. */
extern const struct glremote_export glremote_egl_table[];

/* 1 when the host offers the GL remote (probed once). */
int glremote_available(void);

#endif
