// Exercise the installed native C++ ABI and LLVM Wasm unwinder in Linux.
#include <cstdio>
#include <exception>
#include <stdexcept>
#include <vector>
static int cleaned, duringUnwind;
struct Guard {
  ~Guard() { ++cleaned; if (std::uncaught_exceptions() == 1) ++duringUnwind; }
};
__attribute__((noinline)) static void raise(int kind) {
  Guard a, b;
  if (kind == 0) throw 42;
  if (kind == 1) throw std::runtime_error("native-wasm");
  if (kind == 2) throw 2.5;
  if (kind == 3) throw std::bad_alloc();
  std::vector<int> empty;
  (void)empty.at(0);
}
static bool test(int kind) {
  cleaned = duringUnwind = 0;
  bool matched = false;
  try {
    if (kind == 2) {
      try { raise(kind); }
      catch (...) { throw; }
    } else {
      raise(kind);
    }
  } catch (int value) { matched = kind == 0 && value == 42; }
    catch (const std::runtime_error& value) { matched = kind == 1 && value.what()[0] == 'n'; }
    catch (double value) { matched = kind == 2 && value == 2.5; }
    catch (const std::bad_alloc&) { matched = kind == 3; }
    catch (const std::out_of_range&) { matched = kind == 4; }
    catch (...) { matched = false; }
  return matched && cleaned == 2 && duringUnwind == 2 && std::uncaught_exceptions() == 0;
}
int main() {
  int pass = 0, fail = 0;
  for (int round = 0; round < 20; ++round) {
    for (int kind = 0; kind < 5; ++kind) {
      if (round == 0) { std::printf("GUEST_UNWIND_CASE kind=%d\n", kind); std::fflush(stdout); }
      if (test(kind)) ++pass;
      else { ++fail; std::printf("GUEST_UNWIND FAIL round=%d kind=%d cleanup=%d unwind=%d\n", round, kind, cleaned, duringUnwind); }
    }
  }
  std::printf("GUEST_UNWIND_RESULT pass=%d fail=%d\n", pass, fail);
  return fail ? 1 : 0;
}
