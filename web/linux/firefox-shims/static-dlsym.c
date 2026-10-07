/* Firefox is linked statically for the guest, so dlsym() on the program
 * itself ("a.out", opened by js-ctypes) finds nothing. Firefox's Subprocess
 * module reads the C environment through ctypes as libc.environ; about:support
 * (Troubleshoot.sys.mjs, environmentVariables) waits on it and never finishes
 * when the lookup throws. Linked with --wrap=dlsym; every other name goes to
 * the real dlsym unchanged. */
#include <string.h>

extern char **environ;
void *__real_dlsym(void *, const char *);

void *__wrap_dlsym(void *handle, const char *name) {
  void *found = __real_dlsym(handle, name);
  if (!found && name && !strcmp(name, "environ")) return (void *)&environ;
  return found;
}
