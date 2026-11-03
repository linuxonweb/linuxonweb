// Diagnostic only. Included inside js::pbl after ICCtx is defined.
// Separate from LOG budgets and the original PBLJIT_OBS observer.
namespace pbltier {

bool Enabled() {
  static const bool enabled = [] {
    const char* value = getenv("PBLTIER_OBSERVE");
    return value && strcmp(value, "1") == 0;
  }();
  return enabled;
}

struct PreserveErrno {
  int saved = errno;
  ~PreserveErrno() { errno = saved; }
};

// Store hashes, never unrooted source/string pointers across calls or GC.
struct Seen {
  uint64_t source, epoch;
  uint32_t fn, event;
  int32_t off = -1;  // Guard sites are distinct; call pairs are source-level.
};
struct ThreadState {
  Seen calls[256]{};
  Seen installs[128]{};
  Seen guards[64]{};
  uint32_t callCount = 0, installCount = 0, guardCount = 0;
  uint64_t sequence = 0;
  bool callsFull = false, installsFull = false, guardsFull = false;
};
thread_local ThreadState state;
thread_local ThreadState icState;
// Reserve guard records separately: hot calls cannot consume their budget.
std::atomic<uint32_t> callRecords{0}, installRecords{0}, guardRecords{0};
std::atomic<uint32_t> icCallRecords{0}, icInstallRecords{0};
constexpr uint32_t kCallRecords = 2048, kInstallRecords = 512,
                   kGuardRecords = 256;

uint64_t Source(JSScript* script) {
  const char* name = script->filename();
  static constexpr char prefix[] = "file:///home/admin/nightly-jit-safety/";
  if (!name || strncmp(name, prefix, sizeof(prefix) - 1) != 0) return 0;
  uint64_t hash = 14695981039346656037ULL;
  for (const unsigned char* p = reinterpret_cast<const unsigned char*>(name);
       *p; ++p) hash = (hash ^ *p) * 1099511628211ULL;
  return hash ? hash : 1;
}

void Exhausted(const char* reason) {
  js::pbljit::PrintObservation("PBLTIER_OBS_EXHAUSTED reason=emission-failed\n",
                            "PBLTIER_OBS_EXHAUSTED reason=%s\n", reason);
}

// A full set is not evicted: repeated hot calls cannot recycle the budget.
bool First(Seen* set, uint32_t& used, uint32_t capacity, bool& full,
           const Seen& key) {
  for (uint32_t i = 0; i < used; ++i) {
    if (set[i].source == key.source && set[i].epoch == key.epoch &&
        set[i].fn == key.fn && set[i].event == key.event &&
        set[i].off == key.off) return false;
  }
  if (used == capacity) {
    if (!full) { full = true; Exhausted("dedup-capacity"); }
    return false;
  }
  set[used++] = key;
  return true;
}

void Emit(const char* event, JSScript* script, JSContext* cx, uint32_t fn,
          uint64_t call, int32_t off, uint32_t result,
          bool ic = false, uint32_t generation = 0) {
  PreserveErrno saved;
  js::pbljit::PrintObservation("PBLTIER_OBS_EXHAUSTED reason=emission-failed\n",
      "PBLTIER_OBS tier=%s event=%s file=%s line=%u off=%d tid=%ld "
      "pthread=%lu tls=%p epoch=%llu fn=%u call=%llu result=%u generation=%u\n",
      ic ? "ic" : "method", event, script->filename(), script->lineno(), off,
      syscall(SYS_gettid), static_cast<unsigned long>(uintptr_t(pthread_self())),
      ic ? static_cast<void*>(&icState) : static_cast<void*>(&state),
      static_cast<unsigned long long>(cx->runtime()->gc.majorGCCount()), fn,
      static_cast<unsigned long long>(call), result, generation);
}

// 0 means deliberately unobserved. Reserve both records before emitting entry.
uint64_t Begin(JSScript* script, JSContext* cx, uint32_t fn, uint32_t off) {
  PreserveErrno saved;
  uint64_t source = Source(script);
  if (!source) return 0;
  Seen key{source, cx->runtime()->gc.majorGCCount(), fn, 0};
  if (!First(state.calls, state.callCount, 256, state.callsFull, key)) return 0;
  uint32_t before = callRecords.fetch_add(2, std::memory_order_relaxed);
  if (before >= kCallRecords) {
    if (before == kCallRecords) Exhausted("call-budget");
    return 0;
  }
  uint64_t call = ++state.sequence;
  Emit("entry", script, cx, fn, call, int32_t(off), 0);
  return call;
}

void End(JSScript* script, JSContext* cx, uint32_t fn, uint64_t call,
         uint32_t off, uint32_t result) {
  if (call) Emit("return", script, cx, fn, call, int32_t(off), result);
}

enum : uint32_t { kInstall = 1, kIncremental = 2, kIrqExit = 3 };
void Guard(uint32_t event, JSScript* script, JSContext* cx, uint32_t fn,
           int32_t off) {
  PreserveErrno saved;
  uint64_t source = Source(script);
  if (!source) return;
  Seen key{source, cx->runtime()->gc.majorGCCount(), fn, event, off};
  const bool install = event == kInstall;
  if (install) {
    if (!First(state.installs, state.installCount, 128, state.installsFull, key))
      return;
  } else if (!First(state.guards, state.guardCount, 64, state.guardsFull, key)) {
    return;
  }
  uint32_t limit = install ? kInstallRecords : kGuardRecords;
  auto& records = install ? installRecords : guardRecords;
  uint32_t before = records.fetch_add(1, std::memory_order_relaxed);
  if (before >= limit) {
    if (before == limit) Exhausted(install ? "install-budget" : "guard-budget");
    return;
  }
  Emit(event == kInstall ? "install" : event == kIncremental
       ? "method-skip-incremental" : "method-irq-exit",
       script, cx, fn, 0, off, 0);
}

// Diagnostic descriptors are never reused or freed while installed code can
// reference them. No script/GC pointers are retained. Original IC installs are
// already bounded; cap descriptor attempts independently, including failures.
struct IcDescriptor { uint32_t fn, generation; };
std::atomic<uint32_t> icDescriptorCount{0};
constexpr uint32_t kIcDescriptors = 20000;
IcDescriptor* NewIcDescriptor() {
  PreserveErrno saved;
  uint32_t generation = icDescriptorCount.fetch_add(1, std::memory_order_relaxed);
  if (generation >= kIcDescriptors) {
    if (generation == kIcDescriptors) Exhausted("ic-descriptor-capacity");
    return nullptr;
  }
  auto* descriptor = static_cast<IcDescriptor*>(malloc(sizeof(IcDescriptor)));
  if (!descriptor) { Exhausted("ic-descriptor-oom"); return nullptr; }
  *descriptor = IcDescriptor{0, generation + 1};
  return descriptor;
}

void IcInstall(IcDescriptor* descriptor, ICCtx& ctx) {
  PreserveErrno saved;
  JSScript* script = ctx.frame->script();
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  uint64_t source = Source(script);
  if (!source) return;
  Seen key{source, cx->runtime()->gc.majorGCCount(), descriptor->fn,
           descriptor->generation};
  if (!First(icState.installs, icState.installCount, 128,
             icState.installsFull, key)) return;
  uint32_t before = icInstallRecords.fetch_add(1, std::memory_order_relaxed);
  if (before >= kInstallRecords) {
    if (before == kInstallRecords) Exhausted("ic-install-budget");
    return;
  }
  Emit("install", script, cx, descriptor->fn, 0, -1, 0, true,
       descriptor->generation);
}

// Called by the generated prologue, including direct/next-stub dispatch.
uint64_t IcEnter(uint64_t descriptorA, uint64_t ctxA) {
  PreserveErrno saved;
  auto* descriptor = reinterpret_cast<IcDescriptor*>(uintptr_t(descriptorA));
  auto& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
  JSScript* script = ctx.frame->script();
  JSContext* cx = ctx.frameMgr.cxForLocalUseOnly();
  uint64_t source = Source(script);
  if (!source) return 0;
  Seen key{source, cx->runtime()->gc.majorGCCount(), descriptor->fn,
           descriptor->generation};
  if (!First(icState.calls, icState.callCount, 256, icState.callsFull, key))
    return 0;
  uint32_t before = icCallRecords.fetch_add(2, std::memory_order_relaxed);
  if (before >= kCallRecords) {
    if (before == kCallRecords) Exhausted("ic-call-budget");
    return 0;
  }
  uint64_t call = ++icState.sequence;
  Emit("entry", script, cx, descriptor->fn, call, -1, 0, true,
       descriptor->generation);
  return call;
}

// Every generated return passes through this helper with the original bits.
// Source-only attribution: no claim that interpreterPC is current here.
uint64_t IcReturn(uint64_t value, uint64_t descriptorA, uint64_t ctxA,
                  uint64_t call) {
  PreserveErrno saved;
  if (call) {
    auto* descriptor = reinterpret_cast<IcDescriptor*>(uintptr_t(descriptorA));
    auto& ctx = *reinterpret_cast<ICCtx*>(uintptr_t(ctxA));
    Emit("return", ctx.frame->script(), ctx.frameMgr.cxForLocalUseOnly(),
         descriptor->fn, call, -1, 0, true, descriptor->generation);
  }
  return value;
}

}  // namespace pbltier
