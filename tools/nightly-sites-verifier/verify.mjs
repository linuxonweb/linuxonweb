import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { checkRelease, checkExpectations, loadEvidence, sha } from './contract.mjs';
import { verifyPublicRoutes } from './public-routes.mjs';

const [mode, expectationsPath, expectedHash, inputPath, reportPath] = process.argv.slice(2);
assert.ok(['review', 'routes'].includes(mode) && expectationsPath && expectedHash && inputPath && reportPath, 'usage: node verify.mjs review|routes REVIEWED_EXPECTATIONS REVIEWED_SHA256 EVIDENCE_DIR|DIST NEW_REPORT_JSON');
const task = '/mnt/p6/build/firefox-nightly-sites-verifier-20261002';
const out = resolve(reportPath); assert.ok(!relative(task, out).startsWith('..') && out !== task, 'report must stay in owned task packet');
const parent = await realpath(resolve(out, '..')); assert.ok(!relative(task, parent).startsWith('..'), 'symlinked output parent');
const bytes = await readFile(expectationsPath); assert.equal(sha(bytes), expectedHash, 'independently frozen expectations');
const expected = JSON.parse(bytes); checkExpectations(expected);
let report;
try { assert.notEqual(expected.synthetic, true, 'CLI never runs synthetic expectations as release inputs'); report = mode === 'review' ? checkRelease(expected, await loadEvidence(expected, inputPath)) : await verifyPublicRoutes({ expected, dist: inputPath }); }
catch (error) { report = { schema: 1, releaseAcceptance: false, failures: [{ name: error.name, message: error.message }] }; }
report.expectationsSHA256 = expectedHash; report.mode = mode; report.finishedAt = new Date().toISOString();
await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
if (report.releaseAcceptance !== true && report.complete !== true) process.exitCode = 1;
