// Compiler ownership/LSDA controls only; actual runtime closure is separate.
extern void consumer_throw_int();
extern void consumer_destroy(unsigned);
struct ConsumerScope {
  unsigned value;
  ~ConsumerScope() { consumer_destroy(value); }
};
unsigned consumer_typed(unsigned n) {
  ConsumerScope scope{n};
  try {
    consumer_throw_int();
  } catch (int value) {
    return unsigned(value) + scope.value;
  } catch (...) {
    throw;
  }
  return n;
}
