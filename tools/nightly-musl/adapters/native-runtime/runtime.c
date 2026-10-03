/* Native Linux/Wasm static runtime adapter. No upstream runtime source edits. */
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <unwind.h>

struct destructor_node {
  void (*destroy)(void *);
  void *object;
  struct destructor_node *next;
};
static _Thread_local struct destructor_node *destructors;
static _Thread_local int scheduled;
static pthread_key_t destructor_key;
static pthread_once_t destructor_once = PTHREAD_ONCE_INIT;
static int destructor_key_error = -1;

/* Pop before calling user code so registrations made by a destructor run
   in the same drain. Other threads have independent lists and TLS lifetimes. */
static void drain_destructors(void *unused) {
  (void)unused;
  while (destructors) {
    struct destructor_node *node = destructors;
    destructors = node->next;
    node->destroy(node->object);
    free(node);
  }
  scheduled = 0;
}
static void create_destructor_key(void) {
  destructor_key_error = pthread_key_create(&destructor_key, drain_destructors);
}

int __cxa_thread_atexit_impl(void (*destroy)(void *), void *object, void *dso) {
  /* All guest modules in this browser link are static; there is no native
     shared-object unload that can invalidate a registered destructor. */
  (void)dso;
  if (!destroy || pthread_once(&destructor_once, create_destructor_key) != 0 ||
      destructor_key_error != 0) return -1;
  struct destructor_node *node = malloc(sizeof(*node));
  if (!node) return -1;
  if (!scheduled && pthread_setspecific(destructor_key, &destructors) != 0) {
    free(node);
    return -1;
  }
  node->destroy = destroy;
  node->object = object;
  node->next = destructors;
  destructors = node;
  scheduled = 1;
  return 0;
}

/* Run before musl's process/TSD cleanup; its pthread key remains a fallback
   for paths that do not pass through these static-link entry points. */
_Noreturn void __real_exit(int);
void __real___pthread_tsd_run_dtors(void);
_Noreturn void __wrap_exit(int code) {
  drain_destructors(NULL);
  __real_exit(code);
}
void __wrap___pthread_tsd_run_dtors(void) {
  drain_destructors(NULL);
  __real___pthread_tsd_run_dtors();
}

/* A Wasm VM owns its call stack. This ABI has no native frame-walk facility.
   Return an explicit exhausted trace, never a fabricated frame or success.
   LLVM's real Wasm EH/personality/throw implementation stays in libunwind. */
_Unwind_Reason_Code _Unwind_Backtrace(_Unwind_Trace_Fn trace, void *argument) {
  (void)trace;
  (void)argument;
  return _URC_END_OF_STACK;
}
uintptr_t _Unwind_GetCFA(struct _Unwind_Context *context) {
  (void)context;
  return 0;
}
void *_Unwind_FindEnclosingFunction(void *pc) {
  (void)pc;
  return NULL;
}
