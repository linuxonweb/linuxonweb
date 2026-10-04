// Isolated fixture control, restored before threads; no kernel AT_SECURE claim.
#define hidden __attribute__((visibility("hidden")))
#include "/nix/store/drmrcqyqqvyngx2jv0wp6hisphs738j1-source/src/internal/libc.h"
int fixture_secure(int next) { int old=__libc.secure;__libc.secure=next;return old; }
