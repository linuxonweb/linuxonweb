/* libxshmfence link stubs for the wasm32 guest: DRI3 is unavailable, so every
 * fence allocation fails and Mesa falls back to Zink kopper presentation. */
#include <stddef.h>
struct xshmfence;
int xshmfence_trigger(struct xshmfence *f) { (void)f; return -1; }
int xshmfence_await(struct xshmfence *f) { (void)f; return -1; }
int xshmfence_query(struct xshmfence *f) { (void)f; return 0; }
void xshmfence_reset(struct xshmfence *f) { (void)f; }
int xshmfence_alloc_shm(void) { return -1; }
struct xshmfence *xshmfence_map_shm(int fd) { (void)fd; return NULL; }
void xshmfence_unmap_shm(struct xshmfence *f) { (void)f; }
