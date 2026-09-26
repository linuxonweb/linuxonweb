/* SPDX-License-Identifier: MIT
 * Exit 0 when Aurora is ready OR the original delay has elapsed.
 * Exit 2 if the deadline cannot be armed: caller must use its old sleep.
 */
#define _POSIX_C_SOURCE 200809L
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static void deadline(int signal_number) {
    (void)signal_number;
    static const char message[] = "[wm-ready] deadline elapsed; using timed fallback\n";
    (void)write(STDERR_FILENO, message, sizeof(message) - 1);
    _exit(0);
}
static int ignore_x_error(Display *display, XErrorEvent *event) {
    (void)display; (void)event;
    return 0; /* The supporting window can disappear during a WM restart. */
}
static int connection_lost(Display *display) {
    (void)display;
    /* Returning from an Xlib I/O error handler is not permitted. Retain the
       already-armed deadline, so an early socket failure cannot skip the wait. */
    for (;;) pause();
}
static int window_property(Display *display, Window target, Atom property, Window *value) {
    Atom type = None;
    int format = 0;
    unsigned long items = 0, remaining = 0;
    unsigned char *data = NULL;
    int status = XGetWindowProperty(display, target, property, 0, 1, False,
                                   XA_WINDOW, &type, &format, &items, &remaining, &data);
    int valid = status == Success && type == XA_WINDOW && format == 32 &&
                items == 1 && remaining == 0 && data;
    if (valid) *value = *(unsigned long *)data;
    if (data) XFree(data);
    return valid;
}
static int aurora_ready(Display *display) {
    Atom supporting = XInternAtom(display, "_NET_SUPPORTING_WM_CHECK", True);
    Atom name = XInternAtom(display, "_NET_WM_NAME", True);
    Atom utf8 = XInternAtom(display, "UTF8_STRING", True);
    if (!supporting || !name || !utf8) return 0;
    Window child = None, self = None;
    if (!window_property(display, DefaultRootWindow(display), supporting, &child) || !child ||
        !window_property(display, child, supporting, &self) || self != child) return 0;
    Atom type = None;
    int format = 0;
    unsigned long items = 0, remaining = 0;
    unsigned char *data = NULL;
    int status = XGetWindowProperty(display, child, name, 0, 16, False,
                                   utf8, &type, &format, &items, &remaining, &data);
    int valid = status == Success && type == utf8 && format == 8 && items == 6 &&
                remaining == 0 && data && memcmp(data, "Aurora", 6) == 0;
    if (data) XFree(data);
    return valid;
}
int main(int argc, char **argv) {
    int self_test = argc == 2 && strcmp(argv[1], "--self-test-timeout") == 0;
    if (argc > 1 && !self_test) {
        fputs("usage: wait-for-aurora [--self-test-timeout]\n", stderr);
        return 2;
    }
    struct sigaction action = {0};
    action.sa_handler = deadline;
    sigemptyset(&action.sa_mask);
    sigset_t unblocked;
    sigemptyset(&unblocked);
    sigaddset(&unblocked, SIGALRM);
    struct itimerval timer = {0}, armed = {0};
    timer.it_value.tv_sec = self_test ? 1 : 10;
    if (sigaction(SIGALRM, &action, NULL) || sigprocmask(SIG_UNBLOCK, &unblocked, NULL) ||
        setitimer(ITIMER_REAL, &timer, NULL) ||
        getitimer(ITIMER_REAL, &armed) || (!armed.it_value.tv_sec && !armed.it_value.tv_usec)) {
        fputs("[wm-ready] cannot arm deadline; caller must retain sleep 10\n", stderr);
        return 2;
    }
    if (self_test) for (;;) pause();
    XSetErrorHandler(ignore_x_error);
    XSetIOErrorHandler(connection_lost);
    struct timespec start = {0};
    clock_gettime(CLOCK_MONOTONIC, &start);
    Display *display = NULL;
    for (;;) {
        if (!display) display = XOpenDisplay(NULL);
        if (display && aurora_ready(display)) {
            struct timespec end = {0};
            clock_gettime(CLOCK_MONOTONIC, &end);
            long elapsed = (end.tv_sec - start.tv_sec) * 1000 +
                           (end.tv_nsec - start.tv_nsec) / 1000000;
            fprintf(stderr, "[wm-ready] Aurora handshake ready after %ld ms\n", elapsed);
            /* Process exit closes its socket; avoid a final blocking Xlib flush. */
            return 0;
        }
        const struct timespec interval = { .tv_sec = 0, .tv_nsec = 100000000 };
        nanosleep(&interval, NULL);
    }
}
