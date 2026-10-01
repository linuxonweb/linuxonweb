/* B1 probe: surfaceless EGL contexts on Zink; prints versions and does a
 * clear + triangle draw + readback through an FBO.
 * B3: also built as a static wasm32 guest executable (tools/zink/link-wasm32.sh);
 * there it defaults the loader to Zink (no DRM render node, CPU device type). */
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#define GL_NUM_EXTENSIONS 0x821D
#define GL_MAJOR_VERSION 0x821B
#define GL_MINOR_VERSION 0x821C
typedef const GLubyte *(*PFNGETSTRING)(GLenum);
typedef void (*PFNGETINTEGERV)(GLenum, GLint *);
#ifdef __wasm__
/* Static build: the ES2 context calls core entry points through the
 * libGLESv2 public symbols (libgles2_public.c), so they are linked and used;
 * everything else (and the desktop GL contexts) goes through eglGetProcAddress. */
static void (*probe_proc(const char *n, int es))(void) {
    static const struct { const char *n; void (*f)(void); } pub[] = {
#define PUB(f) { #f, (void (*)(void))f }
        PUB(glGetString), PUB(glGetIntegerv), PUB(glGetError), PUB(glViewport), PUB(glClearColor),
        PUB(glClear), PUB(glReadPixels), PUB(glFinish), PUB(glDrawArrays), PUB(glCreateShader),
        PUB(glShaderSource), PUB(glCompileShader), PUB(glLinkProgram), PUB(glUseProgram),
#undef PUB
    };
    if (es == 2) for (unsigned i = 0; i < sizeof pub / sizeof pub[0]; i++) if (!strcmp(n, pub[i].n)) return pub[i].f;
    return eglGetProcAddress(n);
}
#define P(t, n) t n = (t)probe_proc(#n, es)
#else
#define P(t, n) t n = (t)eglGetProcAddress(#n)
#endif

static int run(EGLDisplay d, EGLenum api, const EGLint *cattr, const char *label, int es) {
    eglBindAPI(api);
    EGLint cfgattr[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, api == EGL_OPENGL_API ? EGL_OPENGL_BIT : (es == 3 ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_ES2_BIT), EGL_NONE };
    EGLConfig cfg; EGLint n = 0;
    EGLConfig use = EGL_NO_CONFIG_KHR;
    if (eglChooseConfig(d, cfgattr, &cfg, 1, &n) && n) use = cfg;
    EGLContext c = eglCreateContext(d, use, EGL_NO_CONTEXT, cattr);
    if (c == EGL_NO_CONTEXT) { printf("CTX %s FAIL egl=0x%x\n", label, eglGetError()); return 1; }
    if (!eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, c)) { printf("CTX %s MAKECURRENT_FAIL 0x%x\n", label, eglGetError()); return 1; }
    P(PFNGETSTRING, glGetString); P(PFNGETINTEGERV, glGetIntegerv);
    const char *ver = (const char *)glGetString(GL_VERSION);
    const char *sl = (const char *)glGetString(GL_SHADING_LANGUAGE_VERSION);
    const char *ren = (const char *)glGetString(GL_RENDERER);
    GLint next = 0;
    const char *ext = (const char *)glGetString(GL_EXTENSIONS);
    if (ext) { for (const char *p = ext; *p; p++) if (*p == ' ') next++; }
    else glGetIntegerv(GL_NUM_EXTENSIONS, &next);
    if (ext) printf("EXTS %s %s\n", label, ext);
    else { typedef const GLubyte *(*GSI)(GLenum, GLuint); GSI gsi = (GSI)eglGetProcAddress("glGetStringi");
           printf("EXTS %s", label); for (int i = 0; i < next; i++) printf(" %s", gsi(GL_EXTENSIONS, i)); printf("\n"); }
    GLint maxtex = 0; glGetIntegerv(GL_MAX_TEXTURE_SIZE, &maxtex);
    { GLenum (*ge)(void) = (void *)eglGetProcAddress("glGetError"); while (ge() != GL_NO_ERROR) {} }
    printf("CTX %s OK version=\"%s\" glsl=\"%s\" renderer=\"%s\" extensions=%d max_texture=%d\n", label, ver ? ver : "?", sl ? sl : "?", ren ? ren : "?", next, maxtex);
    /* FBO clear + draw */
    P(PFNGLGENFRAMEBUFFERSPROC, glGenFramebuffers); P(PFNGLBINDFRAMEBUFFERPROC, glBindFramebuffer);
    P(PFNGLGENRENDERBUFFERSPROC, glGenRenderbuffers); P(PFNGLBINDRENDERBUFFERPROC, glBindRenderbuffer);
    P(PFNGLRENDERBUFFERSTORAGEPROC, glRenderbufferStorage); P(PFNGLFRAMEBUFFERRENDERBUFFERPROC, glFramebufferRenderbuffer);
    P(PFNGLCHECKFRAMEBUFFERSTATUSPROC, glCheckFramebufferStatus); P(PFNGLCLEARCOLORPROC, glClearColor);
    P(PFNGLCLEARPROC, glClear); P(PFNGLREADPIXELSPROC, glReadPixels); P(PFNGLVIEWPORTPROC, glViewport);
    P(PFNGLCREATESHADERPROC, glCreateShader); P(PFNGLSHADERSOURCEPROC, glShaderSource); P(PFNGLCOMPILESHADERPROC, glCompileShader);
    P(PFNGLGETSHADERIVPROC, glGetShaderiv); P(PFNGLCREATEPROGRAMPROC, glCreateProgram); P(PFNGLATTACHSHADERPROC, glAttachShader);
    P(PFNGLLINKPROGRAMPROC, glLinkProgram); P(PFNGLGETPROGRAMIVPROC, glGetProgramiv); P(PFNGLUSEPROGRAMPROC, glUseProgram);
    P(PFNGLBINDATTRIBLOCATIONPROC, glBindAttribLocation); P(PFNGLVERTEXATTRIBPOINTERPROC, glVertexAttribPointer);
    P(PFNGLENABLEVERTEXATTRIBARRAYPROC, glEnableVertexAttribArray); P(PFNGLDRAWARRAYSPROC, glDrawArrays);
    P(PFNGLGETERRORPROC, glGetError); P(PFNGLGENBUFFERSPROC, glGenBuffers); P(PFNGLBINDBUFFERPROC, glBindBuffer);
    P(PFNGLBUFFERDATAPROC, glBufferData); P(PFNGLFINISHPROC, glFinish); P(PFNGLGETSHADERINFOLOGPROC, glGetShaderInfoLog);
    typedef void (*PFNGENVA)(GLsizei, GLuint *); typedef void (*PFNBINDVA)(GLuint);
    PFNGENVA glGenVertexArrays = (PFNGENVA)eglGetProcAddress("glGenVertexArrays");
    PFNBINDVA glBindVertexArray = (PFNBINDVA)eglGetProcAddress("glBindVertexArray");
    GLuint fb, rb; glGenFramebuffers(1, &fb); glBindFramebuffer(GL_FRAMEBUFFER, fb);
    glGenRenderbuffers(1, &rb); glBindRenderbuffer(GL_RENDERBUFFER, rb);
    glRenderbufferStorage(GL_RENDERBUFFER, es == 2 ? GL_RGBA4 : 0x8058 /* GL_RGBA8 */, 32, 32);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, rb);
    GLenum st = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    glViewport(0, 0, 32, 32);
    glClearColor(0.0f, 0.0f, 1.0f, 1.0f); glClear(GL_COLOR_BUFFER_BIT);
    { /* B2e: read back the clear before any draw (the draw may need push constants). */
      unsigned char c0[4] = {9,9,9,9}, c1[4] = {9,9,9,9};
      glReadPixels(4, 4, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, c0); glReadPixels(28, 28, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, c1);
      GLenum ce = glGetError();
      int cpass = st == GL_FRAMEBUFFER_COMPLETE && c0[0] == 0 && c0[1] == 0 && c0[2] == 255 && c0[3] == 255 && !memcmp(c0, c1, 4) && ce == GL_NO_ERROR;
      printf("CLEAR %s %s fbo=0x%x px4=%u,%u,%u,%u px28=%u,%u,%u,%u glerr=0x%x\n", label, cpass ? "PASS" : "FAIL", st,
             c0[0], c0[1], c0[2], c0[3], c1[0], c1[1], c1[2], c1[3], ce); }
    int core = api == EGL_OPENGL_API && strstr(label, "core");
    const char *vs, *fs;
    /* B2d: sampling a Zink image needs host textures that are also render
     * targets (not yet); EGLPROBE_TEXTURE=1 adds the 2x2 white texture term. */
    const char *te = getenv("EGLPROBE_TEXTURE"); int textured = te && *te == '1';
    if (!textured) {
        if (es == 3) { vs = "#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                       fs = "#version 300 es\nprecision mediump float; uniform vec4 u; out vec4 o; void main(){o=u;}"; }
        else if (es == 2) { vs = "attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                       fs = "precision mediump float; uniform vec4 u; void main(){gl_FragColor=u;}"; }
        else if (core) { vs = "#version 150\nin vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                       fs = "#version 150\nuniform vec4 u; out vec4 o; void main(){o=u;}"; }
        else { vs = "#version 110\nattribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
               fs = "#version 110\nuniform vec4 u; void main(){gl_FragColor=u;}"; }
    } else if (es == 3) { vs = "#version 300 es\nin vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                   fs = "#version 300 es\nprecision mediump float; uniform vec4 u; uniform sampler2D t; out vec4 o; void main(){o=u*texture(t,vec2(0.5));}"; }
    else if (es == 2) { vs = "attribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                   fs = "precision mediump float; uniform vec4 u; uniform sampler2D t; void main(){gl_FragColor=u*texture2D(t,vec2(0.5));}"; }
    else if (core) { vs = "#version 150\nin vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
                   fs = "#version 150\nuniform vec4 u; uniform sampler2D t; out vec4 o; void main(){o=u*texture(t,vec2(0.5));}"; }
    else { vs = "#version 110\nattribute vec2 p; void main(){gl_Position=vec4(p,0.0,1.0);}";
           fs = "#version 110\nuniform vec4 u; uniform sampler2D t; void main(){gl_FragColor=u*texture2D(t,vec2(0.5));}"; }
#define STEP(x) do { printf("STEP %s " x "\n", label); fflush(stdout); } while (0)
    STEP("create-shader");
    GLuint v = glCreateShader(GL_VERTEX_SHADER), f = glCreateShader(GL_FRAGMENT_SHADER); STEP("created");
    glShaderSource(v, 1, &vs, NULL); STEP("source-v"); glCompileShader(v); STEP("compiled-v");
    glShaderSource(f, 1, &fs, NULL); glCompileShader(f); printf("STEP %s compiled\n", label); fflush(stdout);
    GLint okv = 0, okf = 0, okl = 0; glGetShaderiv(v, GL_COMPILE_STATUS, &okv); glGetShaderiv(f, GL_COMPILE_STATUS, &okf);
    if (!okv || !okf) { char log[512] = ""; glGetShaderInfoLog(okv ? f : v, sizeof log, NULL, log); printf("  shader log: %s\n", log); }
    GLuint pr = glCreateProgram(); glAttachShader(pr, v); glAttachShader(pr, f); glBindAttribLocation(pr, 0, "p");
    STEP("link"); glLinkProgram(pr); STEP("linked-call"); glGetProgramiv(pr, GL_LINK_STATUS, &okl); glUseProgram(pr); printf("STEP %s linked=%d\n", label, okl); fflush(stdout);
    P(PFNGLGENTEXTURESPROC, glGenTextures); P(PFNGLACTIVETEXTUREPROC, glActiveTexture); P(PFNGLBINDTEXTUREPROC, glBindTexture);
    P(PFNGLTEXPARAMETERIPROC, glTexParameteri); P(PFNGLTEXIMAGE2DPROC, glTexImage2D); P(PFNGLGETUNIFORMLOCATIONPROC, glGetUniformLocation);
    P(PFNGLUNIFORM4FPROC, glUniform4f); P(PFNGLUNIFORM1IPROC, glUniform1i);
    static const unsigned char white[16] = {255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255};
    if (textured) {
        GLuint tex; glGenTextures(1, &tex); glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, tex);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, white);
        glUniform1i(glGetUniformLocation(pr, "t"), 0);
    }
    glUniform4f(glGetUniformLocation(pr, "u"), 1.0f, 0.0f, 0.0f, 1.0f);
    GLuint va = 0; if (core || es == 3) { glGenVertexArrays(1, &va); glBindVertexArray(va); }
    static const float tri[] = { -1, -1, 0, -1, -1, 0 }; /* lower-left quadrant triangle */
    GLuint b; glGenBuffers(1, &b); glBindBuffer(GL_ARRAY_BUFFER, b); glBufferData(GL_ARRAY_BUFFER, sizeof tri, tri, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0); glEnableVertexAttribArray(0); printf("STEP %s draw\n", label); fflush(stdout);
    glDrawArrays(GL_TRIANGLES, 0, 3); printf("STEP %s drawn\n", label); fflush(stdout); glFinish(); printf("STEP %s finished\n", label); fflush(stdout);
    unsigned char px_in[4] = {0}, px_out[4] = {0};
    glReadPixels(4, 4, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px_in);
    glReadPixels(28, 28, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px_out);
    GLenum err = glGetError();
    int pass = st == GL_FRAMEBUFFER_COMPLETE && okv && okf && okl && px_in[0] > 200 && px_in[2] < 50 && px_out[2] > 200 && px_out[0] < 50 && !err;
    printf("DRAW %s %s fbo=0x%x shaders=%d/%d link=%d inside=%u,%u,%u,%u outside=%u,%u,%u,%u glerr=0x%x\n", label, pass ? "PASS" : "FAIL",
           st, okv, okf, okl, px_in[0], px_in[1], px_in[2], px_in[3], px_out[0], px_out[1], px_out[2], px_out[3], err);
    eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroyContext(d, c);
    return !pass;
}

int main(int argc, char **argv) {
    const char *only = argc > 1 ? argv[1] : NULL;
    setvbuf(stdout, NULL, _IONBF, 0); /* B2a guest run: keep output if Mesa aborts mid-probe */
#ifdef __wasm__
    setenv("MESA_LOADER_DRIVER_OVERRIDE", "zink", 0);
    setenv("LIBGL_ALWAYS_SOFTWARE", "1", 0);
#endif
    PFNEGLGETPLATFORMDISPLAYEXTPROC gpd = (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay d = EGL_NO_DISPLAY;
    const char *plat = getenv("PROBE_PLATFORM");
    if (plat && !strcmp(plat, "device")) {
        PFNEGLQUERYDEVICESEXTPROC qd = (void *)eglGetProcAddress("eglQueryDevicesEXT");
        PFNEGLQUERYDEVICESTRINGEXTPROC qs = (void *)eglGetProcAddress("eglQueryDeviceStringEXT");
        EGLDeviceEXT devs[8]; EGLint nd = 0;
        EGLBoolean qok = qd ? qd(8, devs, &nd) : 0; printf("EGL_QUERY_DEVICES ok=%d n=%d err=0x%x\n", qok, nd, eglGetError());
        if (qok) for (int i = 0; i < nd; i++) {
            const char *e = qs(devs[i], EGL_EXTENSIONS);
            printf("EGL_DEVICE %d exts=%s\n", i, e ? e : "");
            if (e && strstr(e, "EGL_MESA_device_software")) { d = gpd(EGL_PLATFORM_DEVICE_EXT, devs[i], NULL); break; }
        }
    } else if (gpd) d = gpd(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    EGLint ma, mi;
    if (d == EGL_NO_DISPLAY || !eglInitialize(d, &ma, &mi)) { printf("EGL_INIT FAIL 0x%x\n", eglGetError()); return 2; }
    printf("EGL_INIT OK %d.%d vendor=%s\n", ma, mi, eglQueryString(d, EGL_VENDOR));
    int fails = 0;
    EGLint compat[] = { EGL_NONE };
    EGLint core[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2, EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE };
    EGLint es2[] = { EGL_CONTEXT_MAJOR_VERSION, 2, EGL_NONE };
    EGLint es3[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_NONE };
    if (!only || !strcmp(only, "compat")) fails += run(d, EGL_OPENGL_API, compat, "gl-compat", 0);
    if (!only || !strcmp(only, "core")) fails += run(d, EGL_OPENGL_API, core, "gl-core", 0);
    if (!only || !strcmp(only, "es2")) fails += run(d, EGL_OPENGL_ES_API, es2, "gles2", 2);
    if (!only || !strcmp(only, "es3")) fails += run(d, EGL_OPENGL_ES_API, es3, "gles3", 3);
    eglTerminate(d);
    printf("FAILS %d\n", fails);
    return fails ? 1 : 0;
}
