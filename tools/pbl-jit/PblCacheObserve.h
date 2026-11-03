// Diagnostic side data only. Never retain/dereference a GC-managed source pointer.
namespace cacheobs {
constexpr unsigned Slots = 1024;
constexpr unsigned InstallLimit = 512;  // Each install reserves its final record.
struct Record {
  char file[512];
  uint32_t line, off, slot, fn;
  uint64_t epoch, generation;
  uintptr_t script, pc;
  bool stream;
};
thread_local Record** records;
std::atomic<unsigned> remaining{InstallLimit}, exhausted{0};
std::atomic<uint64_t> generation{0};
struct ErrnoScope {
  int saved = errno;
  ~ErrnoScope() { errno = saved; }
};
bool Flag(const char* name) {
  const char* value = getenv(name);
  return value && strcmp(value, "1") == 0;
}
bool StreamEnabled() {
  static const bool enabled = Flag("PBL_CACHE_OBSERVE");
  return enabled;
}
bool LegacyEnabled() {
  static const bool enabled = Flag("PBLJIT_OBSERVE");
  return enabled;
}
bool CaptureEnabled() {
  static const bool enabled = StreamEnabled() || LegacyEnabled();
  return enabled;
}
void Exhausted(unsigned bit, const char* reason) {
  if (!(exhausted.fetch_or(bit, std::memory_order_relaxed) & bit)) {
    PrintObservation("PBL_CACHE_EXHAUSTED reason=emission-failed\n",
                     "PBL_CACHE_EXHAUSTED reason=%s\n", reason);
    if (LegacyEnabled())
      PrintObservation("PBLJIT_OBS_EXHAUSTED reason=cache-provenance\n",
                       "PBLJIT_OBS_EXHAUSTED reason=cache-provenance\n");
  }
}
void Emit(const Record& r, const char* event, const char* cause,
          uint64_t currentEpoch, long rc, int error) {
  if (!r.stream) return;
  PrintObservation("PBL_CACHE_EXHAUSTED reason=emission-failed\n",
      "PBL_CACHE event=%s file=%s line=%u off=%u slot=%u fn=%u "
      "installEpoch=%llu currentEpoch=%llu generation=%llu script=%llu pc=%llu "
      "tid=%ld pthread=%lu tls=%p cause=%s rc=%ld error=%d\n",
      event, r.file, r.line, r.off, r.slot, r.fn,
      static_cast<unsigned long long>(r.epoch),
      static_cast<unsigned long long>(currentEpoch),
      static_cast<unsigned long long>(r.generation),
      static_cast<unsigned long long>(r.script),
      static_cast<unsigned long long>(r.pc), syscall(SYS_gettid),
      static_cast<unsigned long>(uintptr_t(pthread_self())),
      static_cast<void*>(&tCache), cause, rc, error);
}
void Installed(const char* file, uint32_t line, uint32_t off, uint32_t slot,
               uint32_t fn, uint64_t epoch, uintptr_t script, uintptr_t pc) {
  if (!CaptureEnabled()) return;
  ErrnoScope preserve;
  static constexpr char prefix[] = "file:///home/admin/nightly-jit-safety/";
  if (!file || strncmp(file, prefix, sizeof(prefix)-1) != 0) return;
  size_t length = strnlen(file, sizeof(Record::file));
  if (length == sizeof(Record::file)) { Exhausted(1, "source-too-long"); return; }
  for (size_t i = 0; i < length; ++i)
    if (static_cast<unsigned char>(file[i]) <= 32 || file[i] == 127) {
      Exhausted(2, "source-not-token"); return;
    }
  if (slot >= Slots) { Exhausted(4, "invalid-slot"); return; }
  if (records && records[slot]) { Exhausted(16, "occupied-side-slot"); return; }
  unsigned left = remaining.load(std::memory_order_relaxed);
  while (left && !remaining.compare_exchange_weak(left, left-1, std::memory_order_relaxed)) {}
  if (!left) { Exhausted(32, "install-budget"); return; }
  if (!records) records = static_cast<Record**>(calloc(Slots, sizeof(Record*)));
  if (!records) { Exhausted(8, "allocation"); return; }
  auto* r = static_cast<Record*>(malloc(sizeof(Record)));
  if (!r) { Exhausted(8, "allocation"); return; }
  memcpy(r->file, file, length+1);
  r->line=line; r->off=off; r->slot=slot; r->fn=fn; r->epoch=epoch;
  r->generation=generation.fetch_add(1, std::memory_order_relaxed)+1;
  r->script=script; r->pc=pc; r->stream=StreamEnabled();
  records[slot]=r;
  Emit(*r, "install", "installed", epoch, 0, 0);
}
const char* ReplacementCause(bool sameIdentity, bool sameEpoch) {
  return sameIdentity ? "epoch" : sameEpoch ? "identity" : "identity-epoch";
}
template<class LegacyEviction>
void Released(uint32_t slot, uint32_t fn, uint64_t currentEpoch,
              const char* cause, long rc, int error, bool gcEviction,
              LegacyEviction legacy) {
  if (!records || slot >= Slots || !records[slot]) return;
  ErrnoScope preserve;
  Record* r=records[slot];
  if (r->fn != fn) { Exhausted(64, "function-mismatch"); return; }
  // Report the actual syscall result, including failed frees. Never infer release.
  Emit(*r, "free-result", cause, currentEpoch, rc, error);
  if (gcEviction && rc == 0 && currentEpoch > r->epoch) legacy(*r);
  records[slot]=nullptr;
  free(r);
}
}  // namespace cacheobs
