import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('actual portable-tier admission guards observation and admits cold loops without changing straight-line warmup', () => {
  const filename = process.env.PBL_ADMISSION_SOURCE;
  assert.ok(filename?.startsWith('/mnt/'), 'explicit retained native source required');
  const source = readFileSync(filename, 'utf8');
  const admission = source.match(/MethodStatus CanEnterPortableBaselineInterpreter\(JSContext\* cx,[\s\S]*?\n\}(?=\n\nbool PortablebaselineInterpreterStackCheck)/)?.[0];
  assert.ok(admission, 'extract complete production admission function');
  const scratch = process.env.TMPDIR;
  assert.ok(scratch?.startsWith('/mnt/'), 'explicit disk-backed scratch required');
  const directory = mkdtempSync(path.join(scratch, 'entry-guards-'));
  const program = `#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#define __wasm__ 1
#define JS_CODEGEN_NONE 1
#define ENABLE_PORTABLE_BASELINE_INTERP 1
#define ENABLE_INTERRUPT_CHECKS 1
#define MOZ_ASSERT(value) do { if (!(value)) std::abort(); } while (0)
#define MOZ_RELEASE_ASSERT(value) MOZ_ASSERT(value)
using jsbytecode = uint8_t;
enum class MethodStatus { Method_CantCompile, Method_Compiled, Method_Skipped, Method_Error };
enum class JSOp : uint8_t { Nop, Throw, ThrowWithStack };
enum class TryNoteKind { Catch, Finally, Other };
struct TryNote { TryNoteKind value; TryNoteKind kind() const { return value; } };
struct Options { bool portableBaselineInterpreter = true; unsigned portableBaselineInterpreterWarmUpThreshold = 10; } JitOptions;
struct Profiler { bool active = false; bool enabled() const { return active; } };
struct Runtime { Profiler profiler; Profiler& geckoProfiler() { return profiler; } };
struct Zone { bool available = true; bool ensureJitZoneExists(void*) { return available; } };
struct Realm { bool collecting = false; bool collectCoverageForDebug() const { return collecting; } };
struct JSContext { Runtime storage; Zone compartment; Realm currentRealm; Runtime* runtime() { return &storage; } Zone* zone() { return &compartment; } Realm* realm() { return &currentRealm; } };
struct AutoKeepJitScripts { explicit AutoKeepJitScripts(void*) {} };
struct JSScript {
  bool disabled = false, cached = false, debuggee = false, counts = false;
  bool loops = false, async = false, generator = false, allocationSucceeds = true;
  std::vector<TryNote> notes;
  unsigned warmup = 0, allocations = 0, updates = 0;
  jsbytecode bytes[1] = {0};
  bool baselineDisabled() const { return disabled; }
  bool hasJitScript() const { return cached; }
  bool isDebuggee() const { return debuggee; }
  bool hasScriptCounts() const { return counts; }
  bool hasLoops() const { return loops; }
  bool isAsync() const { return async; }
  bool isGenerator() const { return generator; }
  unsigned getWarmUpCount() const { return warmup; }
  const std::vector<TryNote>& trynotes() const { return notes; }
  jsbytecode* code() { return bytes; }
  jsbytecode* codeEnd() { return bytes + 1; }
  void disableBaselineCompile() { disabled = true; }
  bool ensureHasJitScript(JSContext*, AutoKeepJitScripts&) { ++allocations; cached = allocationSucceeds; return allocationSucceeds; }
  void updateJitCodeRaw(Runtime*) { ++updates; }
};
struct Arguments { unsigned length() const { return 0; } };
struct InvokeState { Arguments args() { return {}; } };
struct ExecuteState { bool isDebuggerEval() const { return false; } };
struct RunState {
  JSScript storage; InvokeState invocation; ExecuteState execution;
  JSScript* script() { return &storage; }
  bool isGeneratorResume() const { return false; }
  bool isInvoke() const { return true; }
  InvokeState* asInvoke() { return &invocation; }
  ExecuteState* asExecute() { return &execution; }
};
bool TooManyActualArguments(unsigned) { return false; }
unsigned GetBytecodeLength(jsbytecode*) { return 1; }
namespace pblic { bool enabled = false; bool Enabled() { return enabled; } }
struct Observation { JSScript* script; jsbytecode* pc; JSContext* context; std::string reason; };
std::vector<Observation> observations;
namespace js { namespace pbljit {
void ObservePolicy(JSScript*, JSContext*) {}
void ObserveSkip(JSScript* script, jsbytecode* pc, JSContext* context, const char* reason) {
  observations.push_back({script, pc, context, reason});
}
} }
${admission}
int main() {
  int failures = 0, checks = 0;
  auto check = [&](const char* label, bool pass) {
    ++checks;
    std::printf("%s: %s\\n", label, pass ? "pass" : "FAIL");
    failures += !pass;
  };
  JSContext context;
  struct GuardCase { bool debuggee, counts, collecting; };
  const GuardCase variants[] = {{true, false, false}, {false, true, false}, {false, false, true}, {true, true, true}};
  for (bool cached : {false, true}) {
    for (const auto& variant : variants) {
      RunState state;
      state.storage.cached = cached;
      state.storage.debuggee = variant.debuggee;
      state.storage.counts = variant.counts;
      context.currentRealm.collecting = variant.collecting;
      std::vector<std::string> expected;
      if (variant.debuggee) expected.push_back("skip-debuggee");
      if (variant.counts || variant.collecting) expected.push_back("skip-coverage");
      observations.clear();
      auto result = CanEnterPortableBaselineInterpreter(&context, state);
      check(cached ? "cached observed script rejects tier admission" : "cold observed script rejects tier admission",
            result == MethodStatus::Method_CantCompile);
      bool exact = observations.size() == expected.size();
      for (size_t index = 0; exact && index < expected.size(); ++index) {
        const auto& record = observations[index];
        exact = record.script == state.script() && record.pc == state.script()->code() &&
                record.context == &context && record.reason == expected[index];
      }
      check("guard observes the exact source, entry PC, context and reasons", exact);
      check("guard performs no JitScript allocation, update or permanent disable",
            state.storage.allocations == 0 && state.storage.updates == 0 && !state.storage.disabled);
      state.storage.debuggee = false;
      state.storage.counts = false;
      context.currentRealm.collecting = false;
      state.storage.warmup = 11;
      check("script remains eligible after observation ends",
            CanEnterPortableBaselineInterpreter(&context, state) == MethodStatus::Method_Compiled);
    }
  }
  RunState ordinary;
  observations.clear();
  check("ordinary cold call keeps original warmup threshold",
        CanEnterPortableBaselineInterpreter(&context, ordinary) == MethodStatus::Method_Skipped && observations.empty());
  ordinary.storage.warmup = 11;
  check("ordinary hot call allocates and updates once",
        CanEnterPortableBaselineInterpreter(&context, ordinary) == MethodStatus::Method_Compiled &&
        ordinary.storage.allocations == 1 && ordinary.storage.updates == 1);
  check("cached ordinary call does not allocate again",
        CanEnterPortableBaselineInterpreter(&context, ordinary) == MethodStatus::Method_Compiled && ordinary.storage.allocations == 1);
  ordinary.storage.debuggee = true;
  JitOptions.portableBaselineInterpreter = false;
  check("disabled tier remains silent and cannot enter cached code",
        CanEnterPortableBaselineInterpreter(&context, ordinary) == MethodStatus::Method_CantCompile && observations.empty());
  JitOptions.portableBaselineInterpreter = true;
  ordinary.storage.disabled = true;
  check("baseline-disabled policy remains silent",
        CanEnterPortableBaselineInterpreter(&context, ordinary) == MethodStatus::Method_CantCompile && observations.empty());
  for (unsigned warmup : {0u, 10u}) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.warmup = warmup;
    check("cold loop enters portable interpreter without additional invocations",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_Compiled &&
          loop.storage.allocations == 1 && loop.storage.updates == 1);
    check("cached loop reuses its JitScript",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_Compiled &&
          loop.storage.allocations == 1 && loop.storage.updates == 1);
  }
  RunState straight;
  straight.storage.warmup = 10;
  check("straight-line script still skips at the original threshold",
        CanEnterPortableBaselineInterpreter(&context, straight) == MethodStatus::Method_Skipped &&
        straight.storage.allocations == 0);
  for (const auto& variant : variants) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.debuggee = variant.debuggee;
    loop.storage.counts = variant.counts;
    context.currentRealm.collecting = variant.collecting;
    check("cold loop observation guards precede early admission",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_CantCompile &&
          loop.storage.allocations == 0 && !loop.storage.disabled);
  }
  context.currentRealm.collecting = false;
  for (unsigned exclusion = 0; exclusion < 5; ++exclusion) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.async = exclusion == 0;
    loop.storage.generator = exclusion == 1;
    context.storage.profiler.active = exclusion == 2;
    loop.storage.disabled = exclusion == 3;
    JitOptions.portableBaselineInterpreter = exclusion != 4;
    check("cold loop preserves existing tier eligibility exclusions",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_CantCompile &&
          loop.storage.allocations == 0);
  }
  context.storage.profiler.active = false;
  JitOptions.portableBaselineInterpreter = true;
  for (auto kind : {TryNoteKind::Catch, TryNoteKind::Finally}) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.notes.push_back({kind});
    check("cold loop retains catch/finally fallback before JitScript allocation",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_CantCompile &&
          loop.storage.disabled && loop.storage.allocations == 0);
  }
  for (auto op : {JSOp::Throw, JSOp::ThrowWithStack}) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.bytes[0] = uint8_t(op);
    check("cold loop retains PBLIC-disabled throw policy",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_CantCompile &&
          loop.storage.disabled && loop.storage.allocations == 0);
  }
  pblic::enabled = true;
  RunState throwingLoop;
  throwingLoop.storage.loops = true;
  throwingLoop.storage.bytes[0] = uint8_t(JSOp::Throw);
  check("cold loop preserves PBLIC-enabled cold throw path eligibility",
        CanEnterPortableBaselineInterpreter(&context, throwingLoop) == MethodStatus::Method_Compiled &&
        !throwingLoop.storage.disabled && throwingLoop.storage.allocations == 1);
  for (bool zoneAvailable : {false, true}) {
    RunState loop;
    loop.storage.loops = true;
    loop.storage.allocationSucceeds = false;
    context.compartment.available = zoneAvailable;
    check("cold loop propagates allocation failure without publishing JIT code",
          CanEnterPortableBaselineInterpreter(&context, loop) == MethodStatus::Method_Error &&
          !loop.storage.cached && loop.storage.updates == 0 &&
          loop.storage.allocations == unsigned(zoneAvailable));
  }
  std::printf("checks=%d failures=%d\\n", checks, failures);
  return failures ? 1 : 0;
}
`;
  const input = path.join(directory, 'admission.cpp'), output = path.join(directory, 'admission');
  writeFileSync(input, program);
  execFileSync('c++', ['-std=c++17', '-O2', '-g0', input, '-o', output], { timeout: 15000 });
  try {
    const result = execFileSync(output, [], { timeout: 5000, encoding: 'utf8' });
    assert.match(result, /checks=58 failures=0/);
  } catch (error) {
    assert.fail(`Actual portable admission regression: ${error.stdout || error.message}`);
  }
});
