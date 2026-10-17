import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('actual LoopHook preserves loop compilation eligibility across incremental GC', () => {
  const source = readFileSync(new URL('./PblMethod.inc', import.meta.url), 'utf8');
  const hook = source.match(/int64_t LoopHook\(int64_t frameA,[\s\S]*?\n\}(?=\n\n\}  \/\/ namespace pblbc)/)?.[0];
  const constants = source.match(/constexpr uint32_t kLoopSkip = [^;]+;/)?.[0];
  assert.ok(hook, 'extract the complete production LoopHook definition');
  assert.ok(constants, 'extract the production skip budget');
  const scratch = process.env.TMPDIR;
  assert.ok(scratch?.startsWith('/mnt/'), 'use explicit disk-backed test scratch');
  const directory = mkdtempSync(path.join(scratch, 'method-loop-gc-'));
  const program = `#include <cstdint>
#include <cstdio>
#include <stdexcept>
enum class JSOp : uint8_t { LoopHead, JumpTarget, Other };
struct MockGC {
  bool incremental = false;
  bool isIncrementalGCInProgress() const { return incremental; }
};
struct MockRuntime { MockGC gc; };
struct JSContext {
  MockRuntime storage;
  MockRuntime* runtime() { return &storage; }
};
struct JSScript {
  uint8_t bytes[2] = {uint8_t(JSOp::LoopHead), uint8_t(JSOp::Other)};
  bool counted = false;
  bool hasScriptCounts() const { return counted; }
  uint8_t* code() { return bytes; }
  uint32_t length() const { return 2; }
};
struct BaselineFrame {
  JSScript storage;
  bool debuggee = false;
  JSScript* script() { return &storage; }
  bool isDebuggee() const { return debuggee; }
};
struct Entry {
  uint32_t loopState[2] = {0, 0};
  uint32_t opAt[2] = {0, 1};
  uint32_t icIdx[2] = {0, 0};
};
${constants}
uint32_t gLoopRuns = 0;
uint32_t mockCalls = 0;
uint32_t mockReadyAfter = 0;
bool mockReject = false;
int32_t mockDelta = 1;
uint32_t mockIcIndex = 0;
#define MOZ_CRASH(message) throw std::runtime_error(message)
namespace js { namespace pbljit {
struct Exit { uint64_t* sp; int32_t pcDelta; uint32_t icIndex; };
bool OnLoopHead(JSScript*, BaselineFrame*, uint64_t* stack, uint8_t*, JSContext* context, Exit* output) {
  ++mockCalls;
  if (context->runtime()->gc.isIncrementalGCInProgress() || mockReject || mockCalls < mockReadyAfter) return false;
  *output = {stack, mockDelta, mockIcIndex};
  return true;
}
} }
${hook}
int main() {
  BaselineFrame frame;
  JSContext context;
  Entry entry;
  uint64_t stack[2]{};
  int failures = 0;
  auto check = [&](const char* name, bool accepted) {
    std::printf("%s: %s\\n", name, accepted ? "pass" : "FAIL");
    failures += !accepted;
  };
  auto call = [&]() {
    return LoopHook(int64_t(uintptr_t(&frame)), int64_t(uintptr_t(stack)), 0,
                    int64_t(uintptr_t(&context)), int64_t(uintptr_t(&entry)));
  };
  auto offer = [&]() { return (entry.loopState[0] & kLoopSkip) ? int64_t(0) : call(); };
  entry.loopState[0] = kLoopSkipMisses - 1;
  context.storage.gc.incremental = true;
  check("GC refusal returns to method interpreter", offer() == 0);
  check("GC refusal does not consume the final miss", entry.loopState[0] == kLoopSkipMisses - 1);
  check("GC refusal bypasses loop compiler", mockCalls == 0 && gLoopRuns == 0);
  entry.loopState[0] = 0;
  mockCalls = 0;
  for (uint32_t visit = 0; visit < 2 * kLoopSkipMisses; ++visit) offer();
  check("long incremental collection cannot permanently skip a hot loop", entry.loopState[0] == 0 && mockCalls == 0);
  context.storage.gc.incremental = false;
  mockCalls = 0;
  mockReadyAfter = 1000;
  int64_t resumed = 0;
  for (uint32_t visit = 0; visit < 1000; ++visit) resumed = offer();
  check("loop warms up and runs after incremental collection", resumed != 0 && mockCalls == 1000 && gLoopRuns == 1);
  check("successful run clears consecutive misses", entry.loopState[0] == 0);
  check("successful run preserves encoded exit op and stack", uint64_t(resumed) == ((uint64_t(2) << 32) | uint32_t(uintptr_t(stack))));
  entry.loopState[0] = 0;
  mockCalls = 0;
  mockReject = true;
  for (uint32_t visit = 0; visit < kLoopSkipMisses + 10; ++visit) offer();
  check("genuine rejection still stops exactly at the miss budget", mockCalls == kLoopSkipMisses && entry.loopState[0] == (kLoopSkip | kLoopSkipMisses));
  entry.loopState[0] = 13;
  mockCalls = 0;
  mockReject = false;
  mockReadyAfter = 0;
  frame.debuggee = true;
  check("debuggee does not consume misses or enter native loop", offer() == 0 && entry.loopState[0] == 13 && mockCalls == 0);
  frame.debuggee = false;
  frame.storage.counted = true;
  check("script counts do not consume misses or enter native loop", offer() == 0 && entry.loopState[0] == 13 && mockCalls == 0);
  frame.storage.counted = false;
  mockIcIndex = 1;
  bool rejectedCursor = false;
  try { call(); } catch (const std::runtime_error&) { rejectedCursor = true; }
  check("real loop exit cursor mismatch remains fatal", rejectedCursor);
  mockIcIndex = 0;
  entry.opAt[1] = 0xffff;
  bool rejectedExit = false;
  try { call(); } catch (const std::runtime_error&) { rejectedExit = true; }
  check("non-op loop exit remains fatal", rejectedExit);
  return failures ? 1 : 0;
}
`;
  const input = path.join(directory, 'loop-hook.cpp');
  const output = path.join(directory, 'loop-hook');
  writeFileSync(input, program);
  execFileSync('c++', ['-std=c++17', '-O2', '-g0', input, '-o', output], { timeout: 15000 });
  try {
    const result = execFileSync(output, [], { timeout: 5000, encoding: 'utf8' });
    assert.equal(result.split(': pass').length - 1, 12);
  } catch (error) {
    assert.fail(`Actual LoopHook regression: ${error.stdout || error.message}`);
  }
});
