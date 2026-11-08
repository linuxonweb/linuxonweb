// Preparation and independent semantic oracles. This module never reports JIT acceptance.
export const CASES = ['depth2', 'depth3', 'innerBreak', 'outerContinue', 'earlyReturn', 'typeChange', 'finallyFallback', 'throwFallback'];
export const SCENARIOS = ['zeroOuter', 'zeroInner', 'one', 'many'];
export const HOT_OUTER = 1056; // Existing PBLJIT threshold is 1000 loop heads.
const need = (ok, message) => { if (!ok) throw Error(message); };
export function inputs(caseId, scenario, seed, step) {
  need(CASES.includes(caseId) && SCENARIOS.includes(scenario), 'unknown nested probe case/scenario');
  need(Number.isInteger(seed) && seed >= 1 && seed <= 97 && Number.isInteger(step) && step >= 1 && step <= 31, 'bounded runtime operands required');
  const [outer, inner, deep] = {zeroOuter:[0,2,2], zeroInner:[3,0,2], one:[1,1,1], many:[HOT_OUTER,2,2]}[scenario];
  return [outer, inner, deep, seed, step, scenario === 'many' ? HOT_OUTER - 16 : Math.floor(outer / 2)];
}
export function source(caseId) {
  need(CASES.includes(caseId), 'unknown nested probe case');
  const lines = ['function pblNestedProbe(outerInput, innerInput, deepInput, seedInput, stepInput, limitInput) {',
    '  var outer = outerInput, inner = innerInput, deep = deepInput, seed = seedInput, step = stepInput, limit = limitInput;',
    '  var checksum = seed, outerVisits = 0, innerVisits = 0, deepVisits = 0, x = step;',
    ...(caseId === 'finallyFallback' ? ['  try {'] : []),
    '  outerLoop: for (var i = 0; i < outer; i = i + 1) { // probe-head:outer',
    '    outerVisits = outerVisits + 1;',
    '    checksum = checksum + seed + i;',
    '    for (var j = 0; j < inner; j = j + 1) { // probe-head:inner'];
  if (caseId === 'innerBreak') lines.push('      if (i == limit && j == 1) break;');
  if (caseId === 'outerContinue') lines.push('      if (i == limit && j == 1) continue outerLoop;');
  if (caseId === 'earlyReturn') lines.push('      if (i == limit && j == 1) return [checksum, outerVisits, innerVisits, deepVisits];');
  if (caseId === 'typeChange') lines.push('      if (i == limit && j == 1) x = x + 2147483647;');
  lines.push('      innerVisits = innerVisits + 1;',
    `      checksum = checksum + ${caseId === 'typeChange' ? 'x' : 'step'} + i * 3 + j;`);
  if (caseId === 'depth3') lines.push(
    '      for (var k = 0; k < deep; k = k + 1) { // probe-head:deep',
    '        deepVisits = deepVisits + 1;',
    '        checksum = checksum + seed * 2 + i + j * 3 + k;',
    '      }');
  lines.push('    }', '    checksum = checksum + step * 5;', '  }');
  if (caseId === 'finallyFallback') lines.push('  } finally { checksum = checksum + step; }');
  if (caseId === 'throwFallback') lines.push('  throw seed + step;');
  else lines.push('  return [checksum, outerVisits, innerVisits, deepVisits];');
  lines.push('}');
  return lines.join('\n') + '\n';
}
export function sourceHeads(caseId) {
  const lines = source(caseId).split('\n');
  return lines.flatMap((line, i) => {
    const match = /probe-head:(outer|inner|deep)/.exec(line);
    if (!match) return [];
    let balance = 0, end = i;
    do { balance += (lines[end].match(/\{/g) || []).length - (lines[end].match(/\}/g) || []).length; end++; } while (balance && end < lines.length);
    return [{name:match[1], depth:{outer:1,inner:2,deep:3}[match[1]],
      sourceLine:i + 1, sourceColumn:line.indexOf('for ('), endSourceLine:end,
      workCounter:{outer:'outerVisits',inner:'innerVisits',deep:'deepVisits'}[match[1]],
      bytecodeOffset:null, endBytecodeOffset:null, icIndex:null}];
  });
}
// BigInt closed-form sums are independent of the loop implementation above.
// They also preserve exact checksums for the deliberate int32 -> double transition.
export function expected(caseId, args) {
  const [outer, inner, deep, seed, step, limit] = args.map(BigInt);
  const triangle = n => n * (n - 1n) / 2n;
  if (caseId === 'throwFallback') return {threw:true, value:Number(seed + step)};
  let rows = outer, columns = inner;
  let innerVisits = rows * columns, outerVisits = rows;
  let checksum = seed + rows * seed + triangle(rows) + rows * columns * step + 3n * columns * triangle(rows) + rows * triangle(columns) + rows * step * 5n;
  let deepVisits = 0n;
  if (caseId === 'depth3') {
    deepVisits = outer * inner * deep;
    checksum += deepVisits * seed * 2n + inner * deep * triangle(outer) + outer * deep * 3n * triangle(inner) + outer * inner * triangle(deep);
  }
  if (['innerBreak','outerContinue'].includes(caseId) && inner > 1n && limit < outer) {
    // Both exits skip the remaining columns of one row. Only continue also
    // skips the contribution after that row's inner loop.
    const skipped = inner - 1n;
    checksum -= skipped * (step + 3n * limit) + triangle(inner);
    innerVisits -= skipped;
    if (caseId === 'outerContinue') checksum -= step * 5n;
  }
  if (caseId === 'earlyReturn' && inner > 1n && limit < outer) {
    // Completed rows 0..limit-1, then current outer contribution and column 0.
    rows = limit;
    checksum = seed + rows * seed + triangle(rows) + rows * inner * step + 3n * inner * triangle(rows) + rows * triangle(inner) + rows * step * 5n;
    checksum += seed + limit + step + 3n * limit;
    outerVisits = limit + 1n; innerVisits = limit * inner + 1n;
  }
  if (caseId === 'typeChange' && inner > 1n && limit < outer) {
    const changedVisits = outer * inner - (limit * inner + 1n);
    checksum += changedVisits * 2147483647n;
  }
  if (caseId === 'finallyFallback') checksum += step;
  const value = [checksum, outerVisits, innerVisits, deepVisits].map(n => {
    const number = Number(n); need(Number.isSafeInteger(number), 'oracle exceeds exact Number range'); return number;
  });
  return {threw:false, value};
}
export function disposition(caseId) {
  if (caseId === 'finallyFallback') return 'policy-finally';
  if (caseId === 'throwFallback') return 'policy-throw';
  return caseId === 'earlyReturn' ? 'unsupported-nested-return-allocation-fallback' : caseId === 'typeChange' ? 'nested-type-change-may-bail' : 'nested-outer-candidate';
}
