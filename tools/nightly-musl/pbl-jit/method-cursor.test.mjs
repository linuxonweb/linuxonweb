import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('the actual method-hook cursor guard accepts both zero-IC entry paths and rejects real mismatches', () => {
  const source = readFileSync(new URL('./PblMethod.inc', import.meta.url), 'utf8');
  const condition = source.match(/if \((jop != JSOp::JumpTarget[\s\S]*?)\) \{\s*if \(gMismatch\+\+/)?.[1];
  assert.ok(condition, 'actual method-hook cursor guard must be found');
  const scratch = process.env.TMPDIR;
  assert.ok(scratch?.startsWith('/mnt/'), 'use explicit disk-backed test scratch');
  const directory = mkdtempSync(path.join(scratch, 'method-cursor-'));
  const program = `#include <cstdint>
#include <cstdio>
enum class JSOp { GetArg, JumpTarget, LoopHead };
struct ICEntry { uintptr_t value; };
struct ICScript { uint32_t count; uint32_t numICEntries() const { return count; } };
struct Frame { ICScript script; const ICScript* icScript() const { return &script; } };
struct Entry { uint32_t icIdx[1]; };
bool rejected(JSOp jop, ICEntry* icEntry, ICEntry* icEntries, uint32_t count, uint32_t expected) {
  const Frame frameStorage{{count}};
  const Frame* frame = &frameStorage;
  const Entry entryStorage{{expected}};
  const Entry* e = &entryStorage;
  const uint32_t j = 0;
  return ${condition};
}
int main() {
  ICEntry entries[3]{};
  int failures = 0;
  auto check = [&](const char* name, bool actual, bool expected) {
    std::printf("%s: %s\\n", name, actual == expected ? "pass" : "FAIL");
    failures += actual != expected;
  };
  check("zero-IC frame prologue null cursor", rejected(JSOp::GetArg, nullptr, entries, 0, 0), false);
  check("zero-IC direct entry base cursor", rejected(JSOp::GetArg, entries, entries, 0, 0), false);
  check("nonempty matching cursor", rejected(JSOp::GetArg, entries + 1, entries, 2, 1), false);
  check("nonempty wrong cursor", rejected(JSOp::GetArg, entries, entries, 2, 1), true);
  check("nonempty null cursor stays rejected", rejected(JSOp::GetArg, nullptr, entries, 2, 0), true);
  check("jump target resets cursor", rejected(JSOp::JumpTarget, nullptr, entries, 2, 1), false);
  check("loop head resets cursor", rejected(JSOp::LoopHead, nullptr, entries, 2, 1), false);
  return failures ? 1 : 0;
}
`;
  const input = path.join(directory, 'guard.cpp'), output = path.join(directory, 'guard');
  writeFileSync(input, program);
  execFileSync('c++', ['-std=c++17', '-O2', '-g0', input, '-o', output], { timeout: 15000 });
  try {
    const result = execFileSync(output, [], { timeout: 5000, encoding: 'utf8' });
    assert.equal(result.split(': pass').length - 1, 7);
  } catch (error) {
    assert.fail(`Actual cursor guard regression: ${error.stdout || error.message}`);
  }
});
