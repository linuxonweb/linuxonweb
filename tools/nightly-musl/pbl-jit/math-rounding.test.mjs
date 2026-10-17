import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('actual portable Math integer cache operations preserve signed zero through fallback', () => {
  assert.ok(process.env.PBL_MATH_SOURCE?.startsWith('/mnt/'), 'retained native source required');
  assert.ok(process.env.TMPDIR?.startsWith('/mnt/'), 'disk scratch required');
  const source = readFileSync(process.env.PBL_MATH_SOURCE, 'utf8');
  const exact = source.match(/static inline bool PblExactInt32\(double d, int32_t\* out\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(exact, 'extract production integer conversion');
  const operations = ['Floor', 'Ceil', 'Trunc'];
  const functions = operations.map(name => {
    const body = source.match(new RegExp(`CACHEOP_CASE\\(Math${name}ToInt32Result\\) \\{([\\s\\S]*?)\\n      \\}`))?.[1];
    assert.ok(body, `extract complete production ${name} CacheOp`);
    return `Result ${name}(double operand) { Reader cacheIRReader; double retValue = 0; ${body} }`;
  });
  const directory = mkdtempSync(path.join(process.env.TMPDIR, 'math-rounding-'));
  const program = `#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
struct Result { bool hit; double value; };
struct NumberOperandId { unsigned id() const { return 0; } };
struct Reader { NumberOperandId numberOperandId() const { return {}; } };
struct Value { double value; double toNumber() const { return value; } double asRawBits() const { return value; } };
Value Int32Value(int32_t value) { return {double(value)}; }
#define READ_VALUE_REG(id) Value{operand}
#define FAIL_IC() return {false, 0}
#define PREDICT_RETURN()
#define DISPATCH_CACHEOP() return {true, retValue}
${exact}
${functions.join('\n')}
int main() {
  const double inputs[] = { -0.0, 0.0, -0.25, -0.5, -0.9999999999999999,
    -std::numeric_limits<double>::denorm_min(), std::numeric_limits<double>::denorm_min(),
    -1.0, -1.25, -1.75, 0.25, 1.25, 42.0,
    -2147483648.0, -2147483648.75, -2147483649.0,
    2147483647.0, 2147483647.75, 2147483648.0,
    std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(),
    std::numeric_limits<double>::quiet_NaN() };
  struct Operation { const char* name; Result (*run)(double); double (*reference)(double); };
  const Operation operations[] = {{"floor", Floor, std::floor}, {"ceil", Ceil, std::ceil}, {"trunc", Trunc, std::trunc}};
  int checks = 0, failures = 0;
  for (const auto& op : operations) for (double input : inputs) {
    const double expected = op.reference(input);
    const bool canBox = std::isfinite(expected) && expected >= -2147483648.0 && expected <= 2147483647.0 && !(expected == 0 && std::signbit(expected));
    const Result actual = op.run(input);
    const bool pass = actual.hit == canBox && (!actual.hit || (actual.value == expected && std::signbit(actual.value) == std::signbit(expected)));
    ++checks;
    if (!pass) { ++failures; std::printf("FAIL %s input=%a expected=%a hit=%d actual=%a\\n", op.name, input, expected, actual.hit, actual.value); }
  }
  std::printf("checks=%d failures=%d\\n", checks, failures);
  return failures ? 1 : 0;
}
`;
  const cpp = path.join(directory, 'rounding.cpp'), binary = path.join(directory, 'rounding');
  writeFileSync(cpp, program);
  execFileSync('c++', ['-std=c++17', '-O2', cpp, '-o', binary], { timeout: 20000, maxBuffer: 65536 });
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /checks=66 failures=0/);
});
