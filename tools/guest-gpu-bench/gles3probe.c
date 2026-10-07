/* gles3probe: reports what OpenGL ES version Mesa/Zink exposes on the guest
 * Vulkan ICD, which of Mesa's ES 3.0 prerequisites are missing (desktop and ES
 * extension names, see compute_version_es2 in mesa/main/version.c) and the
 * limits Firefox WebGL2 reads. Surfaceless EGL, no window. Every line goes to
 * stdout and, when writable, /dev/console so headless runs record it. */
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int console = -1;
static void say(const char *format, ...) {
  char line[4096]; va_list args; va_start(args, format);
  int n = vsnprintf(line, sizeof line, format, args); va_end(args);
  if (n < 0) return; if (n >= (int)sizeof line) n = sizeof line - 1;
  fwrite(line, 1, n, stdout); fflush(stdout);
  if (console >= 0) write(console, line, n);
}

#define GLF(ret, name, args) static ret (*p_##name) args;
#define GL_FUNCS(X) \
  X(const GLubyte *, glGetString, (GLenum)) X(const GLubyte *, glGetStringi, (GLenum, GLuint)) \
  X(void, glGetIntegerv, (GLenum, GLint *)) X(GLenum, glGetError, (void))
GL_FUNCS(GLF)

static const char *extensions;
static int has(const char *name) {
  size_t n = strlen(name);
  for (const char *at = extensions; at && (at = strstr(at, name)); at += n)
    if ((at == extensions || at[-1] == ' ') && (at[n] == ' ' || !at[n])) return 1;
  return 0;
}

static EGLDisplay display;
static int context(EGLenum api, int major, int minor) {
  if (!eglBindAPI(api)) return 0;
  static const EGLint config_attribs[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT | EGL_OPENGL_BIT, EGL_NONE };
  EGLConfig config = 0; EGLint count = 0;
  if (!eglChooseConfig(display, config_attribs, &config, 1, &count) || !count) config = 0;
  const EGLint attribs[] = { EGL_CONTEXT_MAJOR_VERSION, major, EGL_CONTEXT_MINOR_VERSION, minor, EGL_NONE };
  EGLContext c = eglCreateContext(display, config, EGL_NO_CONTEXT, attribs);
  if (c == EGL_NO_CONTEXT) return 0;
  if (!eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, c)) return 0;
#define LOAD(ret, name, args) p_##name = (ret (*) args)eglGetProcAddress(#name);
  GL_FUNCS(LOAD)
  return p_glGetString != NULL;
}

static void report(const char *label) {
  say("GLES3PROBE %s version=\"%s\" renderer=\"%s\" glsl=\"%s\"\n", label, p_glGetString(GL_VERSION), p_glGetString(GL_RENDERER),
      p_glGetString(GL_SHADING_LANGUAGE_VERSION));
  extensions = (const char *)p_glGetString(GL_EXTENSIONS);
  static char joined[65536];
  if (!extensions && p_glGetStringi) {
    GLint n = 0; size_t used = 0; p_glGetIntegerv(GL_NUM_EXTENSIONS, &n);
    for (GLint k = 0; k < n; k++) {
      const char *e = (const char *)p_glGetStringi(GL_EXTENSIONS, k); size_t l = e ? strlen(e) : 0;
      if (!l || used + l + 2 > sizeof joined) continue;
      memcpy(joined + used, e, l); used += l; joined[used++] = ' ';
    }
    joined[used] = 0; extensions = joined;
  }
  while (p_glGetError() != GL_NO_ERROR) {}
}

/* Mesa's ES 3.0 prerequisites; each lists the names it is advertised under. */
static const char *const needs[][3] = {
  { "ARB_half_float_vertex", "GL_ARB_half_float_vertex", "GL_OES_vertex_half_float" },
  { "ARB_shader_texture_lod", "GL_ARB_shader_texture_lod", "GL_EXT_shader_texture_lod" },
  { "OES_texture_float", "GL_ARB_texture_float", "GL_OES_texture_float" },
  { "OES_texture_half_float", "GL_ARB_texture_float", "GL_OES_texture_half_float" },
  { "OES_texture_half_float_linear", "GL_ARB_texture_float", "GL_OES_texture_half_float_linear" },
  { "ARB_texture_rg", "GL_ARB_texture_rg", "GL_EXT_texture_rg" },
  { "ARB_depth_buffer_float", "GL_ARB_depth_buffer_float", NULL },
  { "ARB_framebuffer_object", "GL_ARB_framebuffer_object", NULL },
  { "EXT_sRGB", "GL_EXT_framebuffer_sRGB", "GL_EXT_sRGB" },
  { "EXT_packed_float", "GL_EXT_packed_float", NULL },
  { "EXT_texture_array", "GL_EXT_texture_array", NULL },
  { "EXT_texture_shared_exponent", "GL_EXT_texture_shared_exponent", NULL },
  { "EXT_texture_sRGB", "GL_EXT_texture_sRGB", NULL },
  { "EXT_transform_feedback", "GL_EXT_transform_feedback", NULL },
  { "ARB_draw_instanced", "GL_ARB_draw_instanced", "GL_EXT_draw_instanced" },
  { "ARB_instanced_arrays", "GL_ARB_instanced_arrays", "GL_EXT_instanced_arrays" },
  { "ARB_uniform_buffer_object", "GL_ARB_uniform_buffer_object", NULL },
  { "EXT_texture_snorm", "GL_EXT_texture_snorm", NULL },
  { "NV_primitive_restart", "GL_NV_primitive_restart", "GL_ARB_ES3_compatibility" },
  { "OES_depth_texture_cube_map", "GL_ARB_depth_texture", "GL_OES_depth_texture_cube_map" },
  { "EXT_texture_type_2_10_10_10_REV", "GL_ARB_texture_rgb10_a2ui", "GL_EXT_texture_type_2_10_10_10_REV" },
  { "ARB_occlusion_query2", "GL_ARB_occlusion_query2", "GL_EXT_occlusion_query_boolean" },
  { "ARB_texture_float(color_buffer)", "GL_ARB_color_buffer_float", "GL_EXT_color_buffer_half_float" },
};

static void limits(void) {
  static const struct { GLenum e; const char *n; } list[] = {
    { GL_MAX_COLOR_ATTACHMENTS, "color_attachments" }, { GL_MAX_DRAW_BUFFERS, "draw_buffers" },
    { GL_MAX_3D_TEXTURE_SIZE, "tex3d" }, { GL_MAX_ARRAY_TEXTURE_LAYERS, "array_layers" },
    { GL_MAX_CUBE_MAP_TEXTURE_SIZE, "cube" }, { GL_MAX_TEXTURE_SIZE, "tex2d" }, { GL_MAX_RENDERBUFFER_SIZE, "renderbuffer" },
    { GL_MAX_VERTEX_UNIFORM_BLOCKS, "vs_ubo" }, { GL_MAX_FRAGMENT_UNIFORM_BLOCKS, "fs_ubo" },
    { GL_MAX_UNIFORM_BUFFER_BINDINGS, "ubo_bindings" }, { GL_MAX_UNIFORM_BLOCK_SIZE, "ubo_size" },
    { GL_MAX_VARYING_VECTORS, "varyings" }, { GL_MAX_VERTEX_ATTRIBS, "attribs" },
    { GL_MAX_TEXTURE_IMAGE_UNITS, "fs_tex" }, { GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS, "vs_tex" },
    { GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS, "tex_units" },
    { GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS, "xfb_attribs" }, { GL_MAX_SAMPLES, "samples" },
    { GL_MAX_VERTEX_UNIFORM_VECTORS, "vs_uniform_vectors" }, { GL_MAX_FRAGMENT_UNIFORM_VECTORS, "fs_uniform_vectors" },
  };
  char line[2048]; size_t used = 0;
  for (size_t k = 0; k < sizeof list / sizeof list[0]; k++) {
    GLint v = -1; p_glGetIntegerv(list[k].e, &v); GLenum error = p_glGetError();
    used += snprintf(line + used, sizeof line - used, " %s=%d%s", list[k].n, v, error ? "(err)" : "");
  }
  say("GLES3PROBE limits%s\n", line);
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  console = open("/dev/console", O_WRONLY | O_NOCTTY | O_CLOEXEC);
  PFNEGLGETPLATFORMDISPLAYEXTPROC platform = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
  display = platform ? platform(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL) : EGL_NO_DISPLAY;
  EGLint major = 0, minor = 0;
  if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor)) { say("GLES3PROBE FAIL egl-initialize error=0x%x\n", eglGetError()); return 1; }
  say("GLES3PROBE egl=%d.%d vendor=\"%s\"\n", major, minor, eglQueryString(display, EGL_VENDOR));

  int es3 = context(EGL_OPENGL_ES_API, 3, 0);
  if (!es3 && !context(EGL_OPENGL_ES_API, 2, 0)) { say("GLES3PROBE FAIL es-context error=0x%x\n", eglGetError()); return 1; }
  report(es3 ? "es3-context" : "es2-context");
  const char *es_extensions = strdup(extensions ? extensions : "");
  limits();
  say("GLES3PROBE es-extensions %s\n", es_extensions);

  /* Desktop names cover the prerequisites ES contexts do not list. */
  char *desktop_extensions = NULL;
  if (context(EGL_OPENGL_API, 3, 0) || context(EGL_OPENGL_API, 2, 1)) { report("gl-context"); desktop_extensions = strdup(extensions ? extensions : ""); }
  unsigned missing = 0; char line[4096]; size_t used = 0;
  for (size_t k = 0; k < sizeof needs / sizeof needs[0]; k++) {
    int ok = 0;
    for (int n = 1; n < 3; n++) if (needs[k][n]) {
      extensions = es_extensions; ok |= has(needs[k][n]);
      extensions = desktop_extensions; ok |= has(needs[k][n]);
    }
    if (!ok) { missing++; used += snprintf(line + used, sizeof line - used, " %s", needs[k][0]); }
  }
  say("GLES3PROBE es3-prerequisites missing=%u%s\n", missing, missing ? line : "");
  say("GLES3PROBE DONE es3=%d\n", es3);
  return 0;
}
