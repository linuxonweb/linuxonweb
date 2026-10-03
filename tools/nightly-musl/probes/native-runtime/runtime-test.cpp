// Run with the actual native libc++/libc++abi/libunwind and Linux/Wasm threads.
#include <pthread.h>
#include <unwind.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
extern "C" int __cxa_thread_atexit_impl(void (*)(void*), void*, void*);
static int passes, failures, ehPasses, ehFailures;
static pthread_key_t ordinaryKey;
struct Events { int values[16]; int count; bool registrationFailed; };
static Events events[5];
static thread_local int identity;
static void check(bool ok, const char* label) {
  if (ok) ++passes;
  else { ++failures; std::printf("GUEST_RUNTIME FAIL %s\n", label); }
}
static void record(int value) {
  auto& e = events[identity];
  if (e.count < 16) e.values[e.count++] = value;
  else e.registrationFailed = true;
}
static void registered(void* value) {
  int number = int(uintptr_t(value));
  record(number);
  if (number == 3 && __cxa_thread_atexit_impl(registered, (void*)4, nullptr))
    events[identity].registrationFailed = true;
}
struct Local { int value; ~Local() { record(value); } };
static void locals() {
  thread_local Local first{1};
  thread_local Local second{2};
  (void)first; (void)second;
}
static void keyDestructor(void*) { record(6); }
static void cleanup(void*) { record(0); }
static void* worker(void* argument) {
  identity = int(uintptr_t(argument));
  auto& e = events[identity];
  if (pthread_setspecific(ordinaryKey, &e) ||
      __cxa_thread_atexit_impl(registered, (void*)3, nullptr)) e.registrationFailed = true;
  locals();
  pthread_cleanup_push(cleanup, nullptr);
  if (identity % 2 == 0) pthread_exit(argument);
  pthread_cleanup_pop(0);
  return argument;
}
static bool order(int who, bool processExit = false) {
  const int returned[] = {2,1,3,4,6};
  const int explicitExit[] = {0,2,1,3,4,6};
  const int mainExit[] = {2,1,3,4};
  auto& e = events[who];
  const int* expected = processExit ? mainExit : who % 2 == 0 ? explicitExit : returned;
  int count = processExit ? 4 : who % 2 == 0 ? 6 : 5;
  bool ok = !e.registrationFailed && e.count == count && !std::memcmp(e.values, expected, count*sizeof(int));
  std::printf("GUEST_RUNTIME_ORDER thread=%d events=", who);
  for (int i=0;i<e.count;i++) std::printf("%s%d",i ? "," : "", e.values[i]);
  std::printf(" expected=%s result=%s\n",processExit ? "2,1,3,4" : who%2==0 ? "0,2,1,3,4,6" : "2,1,3,4,6",ok ? "pass" : "fail");
  return ok;
}
static int traces;
static _Unwind_Reason_Code trace(struct _Unwind_Context*, void*) { ++traces; return _URC_NO_REASON; }
static void finalCheck() {
  check(order(0,true), "main TLS before process atexit");
  std::printf("GUEST_UNWIND_RESULT pass=%d fail=%d\n",ehPasses,ehFailures);
  std::printf("GUEST_RUNTIME_RESULT pass=%d fail=%d\n",passes,failures);
  std::fflush(stdout);
  if (failures || ehFailures) std::_Exit(1);
}
// The unchanged 100-case real Wasm exception fixture is compiled separately.
extern int run_exception_fixture(int&, int&);
int main() {
  (void)run_exception_fixture(ehPasses,ehFailures);
  check(pthread_key_create(&ordinaryKey,keyDestructor)==0,"ordinary pthread key");
  pthread_t threads[4]; bool created[4]{};
  for (int i=0;i<4;i++) {
    created[i] = pthread_create(&threads[i],nullptr,worker,(void*)uintptr_t(i+1))==0;
    check(created[i],"pthread_create");
  }
  for (int i=0;i<4;i++) {
    void* result=nullptr;
    check(created[i] && pthread_join(threads[i],&result)==0 && result==(void*)uintptr_t(i+1),"pthread_join result");
    check(order(i+1),"TLS LIFO, nested registration, cleanup/TSD ordering and thread isolation");
  }
  check(__cxa_thread_atexit_impl(nullptr,nullptr,nullptr)==-1,"reject null destructor");
  check(_Unwind_Backtrace(trace,nullptr)==_URC_END_OF_STACK,"backtrace unavailable status");
  check(traces==0,"no fabricated backtrace callbacks");
  check(_Unwind_GetCFA(nullptr)==0,"no fabricated CFA");
  check(_Unwind_FindEnclosingFunction((void*)uintptr_t(123))==nullptr,"no fabricated enclosing function");
  check(std::atexit(finalCheck)==0,"process atexit registration");
  identity=0;
  if (__cxa_thread_atexit_impl(registered,(void*)3,nullptr)) events[0].registrationFailed=true;
  locals();
  return failures || ehFailures ? 1 : 0;
}
