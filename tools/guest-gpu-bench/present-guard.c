#define _POSIX_C_SOURCE 200809L
/* Mesa's kopper frontend sends Present requests without checking that the X
 * server has the extension; libxcb then closes the whole connection with
 * XCB_CONN_CLOSED_EXT_NOTSUPPORTED. The guest X server has no Present, so these
 * link-time wraps drop the requests when the extension is absent. */
#include <xcb/xcb.h>
#include <xcb/present.h>

xcb_void_cookie_t __real_xcb_present_select_input(xcb_connection_t *c, xcb_present_event_t eid, xcb_window_t window, uint32_t event_mask);
xcb_void_cookie_t __real_xcb_present_notify_msc(xcb_connection_t *c, xcb_window_t window, uint32_t serial, uint64_t target_msc, uint64_t divisor, uint64_t remainder);

static int present_available(xcb_connection_t *c) {
    const xcb_query_extension_reply_t *e = xcb_get_extension_data(c, &xcb_present_id);
    return e && e->present;
}
xcb_void_cookie_t __wrap_xcb_present_select_input(xcb_connection_t *c, xcb_present_event_t eid, xcb_window_t window, uint32_t event_mask) {
    if (!present_available(c)) return (xcb_void_cookie_t){ 0 };
    return __real_xcb_present_select_input(c, eid, window, event_mask);
}
xcb_void_cookie_t __wrap_xcb_present_notify_msc(xcb_connection_t *c, xcb_window_t window, uint32_t serial, uint64_t target_msc, uint64_t divisor, uint64_t remainder) {
    if (!present_available(c)) return (xcb_void_cookie_t){ 0 };
    return __real_xcb_present_notify_msc(c, window, serial, target_msc, divisor, remainder);
}

/* Round-trip statistics for diagnosing per-frame X requests (reset per read). */
#include <time.h>
void *__real_xcb_wait_for_reply(xcb_connection_t *c, unsigned int request, xcb_generic_error_t **e);
static unsigned trips; static double trip_seconds;
static double seconds_now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
void *__wrap_xcb_wait_for_reply(xcb_connection_t *c, unsigned int request, xcb_generic_error_t **e) {
    double start = seconds_now(); void *reply = __real_xcb_wait_for_reply(c, request, e);
    trips++; trip_seconds += seconds_now() - start; return reply;
}
void guest_xcb_stats(unsigned *round_trips, double *seconds) {
    *round_trips = trips; *seconds = trip_seconds; trips = 0; trip_seconds = 0;
}

/* Request counts by extension/major opcode (diagnostic, reset per report). */
#include <stdio.h>
#include <string.h>
#include <xcb/xcbext.h>
static struct { const char *ext; unsigned op, n; } req_counts[48];
static void count_request(const xcb_protocol_request_t *r) {
    const char *ext = r->ext ? r->ext->name : "core";
    for (unsigned i = 0; i < 48; i++) {
        if (!req_counts[i].ext) { req_counts[i].ext = ext; req_counts[i].op = r->opcode; }
        if (req_counts[i].op == r->opcode && !strcmp(req_counts[i].ext, ext)) { req_counts[i].n++; return; }
    }
}
unsigned int __real_xcb_send_request(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r);
uint64_t __real_xcb_send_request64(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r);
unsigned int __real_xcb_send_request_with_fds(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r, unsigned int n, int *fds);
uint64_t __real_xcb_send_request_with_fds64(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r, unsigned int n, int *fds);
unsigned int __wrap_xcb_send_request(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r) { count_request(r); return __real_xcb_send_request(c, flags, v, r); }
uint64_t __wrap_xcb_send_request64(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r) { count_request(r); return __real_xcb_send_request64(c, flags, v, r); }
unsigned int __wrap_xcb_send_request_with_fds(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r, unsigned int n, int *fds) { count_request(r); return __real_xcb_send_request_with_fds(c, flags, v, r, n, fds); }
uint64_t __wrap_xcb_send_request_with_fds64(xcb_connection_t *c, int flags, struct iovec *v, const xcb_protocol_request_t *r, unsigned int n, int *fds) { count_request(r); return __real_xcb_send_request_with_fds64(c, flags, v, r, n, fds); }
void guest_xcb_report(char *out, unsigned size) {
    size_t used = 0; out[0] = 0;
    for (unsigned i = 0; i < 48 && req_counts[i].ext; i++) {
        int w = snprintf(out + used, size - used, "%s:%u=%u ", req_counts[i].ext, req_counts[i].op, req_counts[i].n);
        if (w < 0 || (size_t)w >= size - used) break;
        used += (size_t)w;
    }
    memset(req_counts, 0, sizeof req_counts);
}
