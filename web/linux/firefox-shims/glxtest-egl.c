/* Guest replacement for Firefox's /opt/firefox/glxtest helper (packet F1a).
 *
 * Firefox (widget/gtk/GfxInfo.cpp) spawns "<appdir>/glxtest -f <fd>" at
 * startup and parses its line protocol. gfxPlatformGtk::InitX11EGLConfig
 * force-disables the X11_EGL feature, regardless of
 * gfx.x11-egl.force-enabled, unless the helper reported "TEST_TYPE EGL". The
 * stock glxtest dlopen()s libEGL.so.1 and libGL.so.1, which do not exist in the
 * static wasm32 guest, and the stock binary was never shipped (spawn failed with
 * ENOENT). Without TEST_TYPE EGL, WebGL's headless GL context goes through GLX,
 * which the guest does not have either.
 *
 * Mesa EGL + Zink is linked statically into the firefox binary itself (see
 * zink-egl-static.c), so this helper cannot dlopen and probe it. Running a
 * second full Mesa + ICD instance here would also have to finish within
 * Firefox's 4 s GFX_TEST_TIMEOUT. The helper therefore runs no GL probe and
 * says so: it reports an ERROR line (this keeps GfxInfo's
 * "glxtest failed" blocklist default for features that need a known
 * configuration, exactly as when the helper was missing) plus
 * TEST_TYPE EGL, which lets the user-forced X11_EGL feature route WebGL to
 * EGL. The real EGL/Zink outcome is reported by Firefox's own WebGL context
 * creation.
 *
 * Usage (as upstream): glxtest [-f|--fd N] [-w|--wayland] [-h]
 */
#define _GNU_SOURCE /* getopt_long */
#include <getopt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int write_all(int fd, const char *s) {
  size_t len = strlen(s);
  while (len) {
    ssize_t n = write(fd, s, len);
    if (n < 0) return -1;
    s += n;
    len -= (size_t)n;
  }
  return 0;
}

int main(int argc, char **argv) {
  static const struct option longopts[] = {{"help", no_argument, 0, 'h'},
                                           {"fd", required_argument, 0, 'f'},
                                           {"wayland", no_argument, 0, 'w'},
                                           {0, 0, 0, 0}};
  int fd = 1, c, wayland = 0;
  while ((c = getopt_long(argc, argv, "hf:w", longopts, 0)) != -1) {
    switch (c) {
      case 'f': fd = atoi(optarg); break;
      case 'w': wayland = 1; break;
      case 'h':
        printf("Firefox OpenGL probe adapter (wasm32 guest, static Mesa EGL)\n"
               "usage: glxtest [-f|--fd num] [-w|--wayland]\n");
        return 0;
      default: break;
    }
  }
  if (getenv("MOZ_AVOID_OPENGL_ALTOGETHER")) {
    write_all(fd, "ERROR\nMOZ_AVOID_OPENGL_ALTOGETHER envvar set");
    return EXIT_FAILURE;
  }
  if (wayland) {
    write_all(fd, "ERROR\nwasm guest: no Wayland EGL platform\n");
    close(fd);
    return EXIT_SUCCESS;
  }
  int rc = write_all(fd,
                     "ERROR\nwasm guest glxtest adapter: no GL probe run; "
                     "Mesa EGL (surfaceless, Zink) is linked into firefox\n"
                     "TEST_TYPE\nEGL\n");
  close(fd);
  return rc ? EXIT_FAILURE : EXIT_SUCCESS;
}
