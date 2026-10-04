// Real native shared_timed_mutex construction, overlapping readers and timed contention.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <pthread.h>
#include <shared_mutex>
#include <unistd.h>

static std::shared_timed_mutex gate; // Same guarded static constructor as RLBox.
static std::atomic<int> readers{0}, ready{0}, release_readers{0};
static std::atomic<int> writer_timeout{0}, writer_acquired{0};
static int protected_value = 0;
static int pass = 0, fail = 0;
static void check(bool value, const char* name) {
  std::printf("GUEST_MUTEX %s %s\n", value ? "PASS" : "FAIL", name);
  value ? ++pass : ++fail;
}
static bool wait_for(std::atomic<int>& value, int expected) {
  auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  while (value.load() != expected && std::chrono::steady_clock::now() < deadline)
    usleep(1000);
  return value.load() == expected;
}
static void* reader(void*) {
  gate.lock_shared();
  readers.fetch_add(1);
  ready.fetch_add(1);
  while (!release_readers.load()) usleep(1000);
  readers.fetch_sub(1);
  gate.unlock_shared();
  return nullptr;
}
static void* timed_writer(void*) {
  auto before = std::chrono::steady_clock::now();
  bool locked = gate.try_lock_for(std::chrono::milliseconds(100));
  if (locked) gate.unlock();
  auto elapsed = std::chrono::steady_clock::now() - before;
  writer_timeout.store(!locked && elapsed >= std::chrono::milliseconds(70));
  return nullptr;
}
static void* writer(void*) {
  gate.lock();
  if (readers.load() == 0) {
    ++protected_value;
    writer_acquired.store(1);
  }
  gate.unlock();
  return nullptr;
}
static void* timed_reader(void*) {
  auto before = std::chrono::steady_clock::now();
  bool locked = gate.try_lock_shared_until(before + std::chrono::milliseconds(100));
  if (locked) gate.unlock_shared();
  auto elapsed = std::chrono::steady_clock::now() - before;
  writer_timeout.store(!locked && elapsed >= std::chrono::milliseconds(70));
  return nullptr;
}
int main() {
  std::puts("GUEST_MUTEX START");
  check(gate.try_lock(), "constructed mutex acquires exclusive"); gate.unlock();
  check(gate.try_lock_shared(), "constructed mutex acquires shared"); gate.unlock_shared();
  pthread_t a, b, c;
  int ac = pthread_create(&a, nullptr, reader, nullptr);
  int bc = pthread_create(&b, nullptr, reader, nullptr);
  check(ac == 0 && bc == 0, "two real reader threads created");
  bool both = wait_for(ready, 2);
  check(both && readers.load() == 2, "readers overlap while holding shared locks");
  check(!gate.try_lock(), "exclusive try_lock blocked by readers");
  int cc = pthread_create(&c, nullptr, timed_writer, nullptr);
  check(cc == 0, "timed writer thread created");
  check(cc == 0 && pthread_join(c, nullptr) == 0, "timed writer joined");
  check(writer_timeout.load() == 1, "exclusive timed wait expires behind readers");
  release_readers.store(1);
  check(ac == 0 && pthread_join(a, nullptr) == 0, "first reader joined");
  check(bc == 0 && pthread_join(b, nullptr) == 0, "second reader joined");
  check(readers.load() == 0, "readers released");
  cc = pthread_create(&c, nullptr, writer, nullptr);
  check(cc == 0, "exclusive writer thread created");
  check(cc == 0 && pthread_join(c, nullptr) == 0, "exclusive writer joined");
  check(writer_acquired.load() == 1 && protected_value == 1, "writer updates value after readers release");
  gate.lock(); writer_timeout.store(0);
  cc = pthread_create(&c, nullptr, timed_reader, nullptr);
  check(cc == 0, "timed reader thread created");
  check(cc == 0 && pthread_join(c, nullptr) == 0, "timed reader joined");
  check(writer_timeout.load() == 1, "shared timed wait expires behind exclusive owner");
  gate.unlock();
  check(gate.try_lock_for(std::chrono::seconds(1)), "exclusive timed acquisition succeeds after release");
  gate.unlock();
  check(gate.try_lock_shared_for(std::chrono::seconds(1)), "shared timed acquisition succeeds after release");
  check(protected_value == 1, "shared reader observes writer value"); gate.unlock_shared();
  std::printf("GUEST_MUTEX_RESULT pass=%d fail=%d\n", pass, fail);
  return fail ? 1 : 0;
}
