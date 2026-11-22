/* Compile-only control showing why late instrumentation loses cleanup scope. */
struct owned_object { ~owned_object(); };
extern void potentially_throwing_boundary();
extern unsigned busy_word;
extern "C" void busy_without_boundary() {
  owned_object object;
  while (__atomic_load_n(&busy_word, __ATOMIC_ACQUIRE)) {
    __asm__ volatile("" ::: "memory");
  }
}
extern "C" void busy_with_source_boundary() {
  owned_object object;
  while (__atomic_load_n(&busy_word, __ATOMIC_ACQUIRE)) {
    potentially_throwing_boundary();
  }
}
