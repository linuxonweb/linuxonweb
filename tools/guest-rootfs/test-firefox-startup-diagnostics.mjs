// Finite mocked CDP protocol controls; no browser, guest or remote execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createStartupDiagnostics, STARTUP_DIAGNOSTIC_LIMITS as limits, startupRuntimeEvent, ownedStartupWorker, routeOwnedCdpResponse } from './firefox-startup-diagnostics.mjs';
import { fatalStartupLines, CURRENT_TASK, runIsolatedNightlyGuest } from './test-firefox-nightly-baseline.mjs';

const out = path.resolve(process.argv[2] || CURRENT_TASK + '/startup-diagnostic-host-controls');
if (!out.startsWith(CURRENT_TASK + '/')) throw Error('host controls output outside current task');
await fs.mkdir(out);
const checks = [], origin = 'http://127.0.0.1:12345';
function check(name, ok) { if (!ok) throw Error(name); checks.push({ name, pass: true }); }
function rejects(fn) { try { fn(); return false; } catch { return true; } }
const worker = (targetId = 'worker-1', url = origin + '/linux/dist/worker.js?firefox_abort_trace=1') => ({ targetId, type: 'worker', url });
const attached = (sessionId, targetInfo = worker(), parent, waitingForDebugger = true) => ({ method: 'Target.attachedToTarget', ...(parent ? { sessionId: parent } : {}), params: { sessionId, targetInfo, waitingForDebugger } });
const consoleEvent = (value, sessionId) => ({ method: 'Runtime.consoleAPICalled', ...(sessionId ? { sessionId } : {}), params: { type: 'error', timestamp: 1, args: [{ type: 'string', value }] } });
const rows = async name => (await fs.readFile(out + '/' + name + '.jsonl', 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
function recorder(name, { call: override, alive: live = () => true } = {}) {
  const calls = []; let tick = 100;
  const capture = createStartupDiagnostics({ filename: out + '/' + name + '.jsonl', origin, pageTargetId: 'owned-page', now: () => tick, alive: live, call: async (method, params, sessionId) => { calls.push({ method, params, sessionId }); return override?.(method, params, sessionId); } });
  return { capture, calls, advance: ms => { tick += ms; } };
}

const normal = recorder('recursive');
await normal.capture.start();
check('page Runtime enabled before root autoattach resolves', normal.calls[0].method === 'Runtime.enable' && normal.calls[1].method === 'Target.setAutoAttach');
check('root autoattach waits and flattens only worker descendants', normal.calls[1].params.waitForDebuggerOnStart && normal.calls[1].params.flatten && normal.calls[1].params.filter[0].type === 'worker' && normal.calls[1].params.filter.at(-1).exclude);
normal.capture.handle(consoleEvent('[FIREFOX_ABORT_TRACE] RuntimeError.stack\nRuntimeError: unreachable\n    at wasm-function[123]:0xabc'));
check('page trace string synchronously persisted before any await', (await rows('recursive')).at(-1).params.args[0].value.includes('wasm-function[123]:0xabc'));
normal.capture.handle(attached('session-1'));
await normal.capture.settle();
check('worker enabled then recursively attached then resumed', normal.calls.filter(c => c.sessionId === 'session-1').map(c => c.method).join(',') === 'Runtime.enable,Target.setAutoAttach,Runtime.runIfWaitingForDebugger');
normal.capture.handle(attached('session-2', worker('worker-2'), 'session-1'));
await normal.capture.settle();
normal.capture.handle(consoleEvent('nested trap stack', 'session-2'));
normal.capture.handle({ method: 'Runtime.exceptionThrown', sessionId: 'session-2', params: { timestamp: 2, exceptionDetails: { text: 'Uncaught', exception: { type: 'object', description: 'RuntimeError: unreachable', objectId: 'do-not-record' }, stackTrace: { callFrames: [{ functionName: 'wasm-function[123]', url: 'wasm://wasm/hash', lineNumber: 0, columnNumber: 42 }] } } } });
const recursiveRows = await rows('recursive'), nestedConsole = recursiveRows.find(r => r.method === 'Runtime.consoleAPICalled' && r.sessionId === 'session-2');
check('nested Runtime console routed with exact session target', nestedConsole.targetId === 'worker-2' && nestedConsole.params.args[0].value === 'nested trap stack');
check('nested worker parent provenance retained', normal.capture.summary().sessions.find(s => s.sessionId === 'session-2').parentSessionId === 'session-1');
check('nested protocol exception stack retained', recursiveRows.find(r => r.method === 'Runtime.exceptionThrown').params.exceptionDetails.stackTrace.callFrames[0].columnNumber === 42);
normal.capture.handle({ method: 'Target.detachedFromTarget', sessionId: 'session-1', params: { sessionId: 'session-2' } });
check('owned nested detachment recorded', normal.capture.summary().sessions.find(s => s.sessionId === 'session-2').detached);
normal.capture.check(); normal.capture.close(); const afterClose = (await fs.stat(out + '/recursive.jsonl')).size;
normal.capture.handle(consoleEvent('must not persist')); normal.capture.close();
check('close is idempotent and suppresses subsequent events', (await fs.stat(out + '/recursive.jsonl')).size === afterClose);

const setupFailure = recorder('setup-failure', { call: async (method, params, sessionId) => { if (sessionId && method === 'Target.setAutoAttach') throw Error('mock recursive setup failed'); } });
await setupFailure.capture.start(); setupFailure.capture.handle(attached('session-failed')); await setupFailure.capture.settle();
check('failed setup still resumes waiting owned worker', setupFailure.calls.at(-1).method === 'Runtime.runIfWaitingForDebugger');
check('setup failure aborts with retained reason', rejects(() => setupFailure.capture.check()) && setupFailure.capture.summary().failure === 'mock recursive setup failed'); setupFailure.capture.close();
const early = recorder('already-running'); await early.capture.start(); early.capture.handle(attached('session-early', worker(), undefined, false)); await early.capture.settle();
check('worker already executed fails instrumentation admission', rejects(() => early.capture.check()) && !early.calls.some(c => c.sessionId === 'session-early')); early.capture.close();
const foreign = recorder('foreign'); await foreign.capture.start(); foreign.capture.handle(attached('session-foreign', worker('foreign', 'https://foreign.invalid/linux/dist/worker.js'))); await foreign.capture.settle();
check('foreign worker never Runtime enabled', !foreign.calls.some(c => c.sessionId === 'session-foreign' && c.method === 'Runtime.enable'));
check('owned attachment foreign URL released and detached', foreign.calls.at(-2).method === 'Runtime.runIfWaitingForDebugger' && foreign.calls.at(-1).method === 'Target.detachFromTarget' && foreign.calls.at(-1).params.sessionId === 'session-foreign');
check('foreign target aborts admission', rejects(() => foreign.capture.check())); foreign.capture.close();
const unknown = recorder('unknown-parent'); await unknown.capture.start(); const beforeUnknown = unknown.calls.length;
unknown.capture.handle(attached('unowned-child', worker(), 'unknown-parent'));
check('unknown parent triggers no target interaction', unknown.calls.length === beforeUnknown && unknown.capture.summary().sessions.length === 0 && rejects(() => unknown.capture.check())); unknown.capture.close();
const dead = recorder('dead-owner', { alive: () => false }); await dead.capture.start(); dead.capture.handle(consoleEvent('unowned live event'));
check('events require live exact browser owner', rejects(() => dead.capture.check()) && !(await rows('dead-owner')).some(r => r.method === 'Runtime.consoleAPICalled')); dead.capture.close();
for (const [name, info] of [['wrong type', { ...worker(), type: 'shared_worker' }], ['wrong path', worker('id', origin + '/unowned/worker.js')], ['credentials', worker('id', 'http://user:pw@127.0.0.1:12345/linux/dist/worker.js')], ['wrong port', worker('id', 'http://127.0.0.1:12346/linux/dist/worker.js')], ['invalid ID', worker('bad id')], ['fragment', worker('id', origin + '/linux/dist/worker.js#unowned')]]) check('worker admission rejects ' + name, !ownedStartupWorker(info, origin));
check('actual module worker path admitted', ownedStartupWorker(worker(), origin));

const sanitized = startupRuntimeEvent('Runtime.consoleAPICalled', { args: [{ type: 'object', objectId: 'secret-id', preview: { properties: ['getter'] }, value: { secret: 'must not capture' }, description: 'Object' }, { type: 'string', value: 'x'.repeat(limits.string + 1) }, { type: 'number', value: 7 }, { type: 'boolean', value: true }, { type: 'object', value: null }], stackTrace: { callFrames: Array.from({ length: limits.frames + 1 }, () => ({ functionName: 'f', url: 'wasm://stack', lineNumber: 1, columnNumber: 2, unrelated: 'omit' })), parent: { callFrames: [], parent: { callFrames: [], parent: { callFrames: [], parent: { description: 'too deep' } } } } } });
check('remote object IDs/previews/object values never retained', !JSON.stringify(sanitized).includes('secret') && !JSON.stringify(sanitized).includes('getter') && sanitized.args[0].value === undefined);
check('primitive numbers bool null retained', sanitized.args[2].value === 7 && sanitized.args[3].value === true && sanitized.args[4].value === null);
check('string bounded at8192 characters', sanitized.args[1].value.length === limits.string);
check('protocol stack bounded64frames/four levels', sanitized.stackTrace.callFrames.length === limits.frames && sanitized.stackTrace.parent.parent.parent.parent === undefined);
check('console argument count bounded16', startupRuntimeEvent('Runtime.consoleAPICalled', { args: Array(40).fill({ type: 'string', value: 'arg' }) }).args.length === limits.args);
check('irrelevant protocol method ignored', startupRuntimeEvent('Runtime.executionContextCreated', {}) === null);
check('null protocol args and frames remain safe bounded data', startupRuntimeEvent('Runtime.consoleAPICalled', { args: [null], stackTrace: { callFrames: [null] } }).args.length === 1);
const oversized = recorder('oversized-record'); await oversized.capture.start(); oversized.capture.handle({ method: 'Runtime.consoleAPICalled', params: { args: Array(limits.args).fill({ type: 'string', value: '界'.repeat(limits.string) }) } });
check('oversized unicode record persisted bounded with truncation flag', (await rows('oversized-record')).at(-1).truncated && Math.max(...(await fs.readFile(out + '/oversized-record.jsonl', 'utf8')).split('\n').map(s => Buffer.byteLength(s))) <= limits.recordBytes); oversized.capture.close();
const eventCap = recorder('event-cap'); await eventCap.capture.start(); for (let i = 0; i < limits.events + 2; i++) eventCap.capture.handle(consoleEvent('event' + i));
check('event cap bounds file count and signals capture failure', eventCap.capture.summary().events === limits.events && eventCap.capture.summary().dropped > 0 && rejects(() => eventCap.capture.check())); eventCap.capture.close();
const byteCap = recorder('byte-cap'); await byteCap.capture.start(); for (let i = 0; i < 400; i++) byteCap.capture.handle(consoleEvent('界'.repeat(limits.string)));
check('total byte cap independently bounds output before event cap', byteCap.capture.summary().bytes <= limits.bytes && byteCap.capture.summary().events < limits.events && rejects(() => byteCap.capture.check())); byteCap.capture.close();
const sessionCap = recorder('session-cap'); await sessionCap.capture.start(); for (let i = 0; i <= limits.sessions; i++) sessionCap.capture.handle(attached('s-' + i, worker('w-' + i))); await sessionCap.capture.settle();
check('lifetime session cap rejects additional worker', sessionCap.capture.summary().sessions.length === limits.sessions && rejects(() => sessionCap.capture.check()));
check('capped extra waiting worker resumed and detached', sessionCap.calls.some(c => c.method === 'Runtime.runIfWaitingForDebugger' && c.sessionId === 's-' + limits.sessions) && sessionCap.calls.some(c => c.method === 'Target.detachFromTarget' && c.params.sessionId === 's-' + limits.sessions)); sessionCap.capture.close();
const deadline = recorder('deadline'); await deadline.capture.start(); deadline.advance(limits.durationMs - 1); deadline.capture.check(); deadline.advance(1);
check('global duration bound rejects at180seconds', rejects(() => deadline.capture.check())); deadline.capture.close();

function response(message, sessionId) {
  const value = { resolved: null, rejected: null }, pending = new Map([[1, { sessionId, resolve: result => { value.resolved = result; }, reject: error => { value.rejected = String(error); } }]]);
  routeOwnedCdpResponse(message, pending); return { ...value, remaining: pending.size };
}
check('page CDP response routes to page pending request', response({ id: 1, result: { pass: true } }).resolved.pass);
check('worker CDP response routes matching session', response({ id: 1, sessionId: 'owned-worker', result: { pass: true } }, 'owned-worker').resolved.pass);
check('foreign worker CDP response rejected', response({ id: 1, sessionId: 'foreign', result: {} }, 'owned-worker').rejected.includes('session mismatch'));
check('worker response cannot satisfy page request', response({ id: 1, sessionId: 'worker', result: {} }).rejected.includes('session mismatch'));
check('page response cannot satisfy worker request', response({ id: 1, result: {} }, 'worker').rejected.includes('session mismatch'));
check('CDP protocol error rejects and removes request', response({ id: 1, error: { message: 'failed' } }).rejected.includes('failed') && response({ id: 1, error: {} }).remaining === 0);
check('unknown response ID does not complete pending call', response({ id: 2, result: {} }).remaining === 1);
const retained = await fs.readFile(CURRENT_TASK + '/cold-warm-real-run55-retry2/observer-startup-guest-logs.txt');
check('retained real139 failure stays recognized', fatalStartupLines(retained.toString()).includes('firefox exited with status 139'));
const baseArgs = ['--out', out + '/unlaunched', '--candidate', '/absent-candidate', '--nightly-package', '/absent-full', '--overlay-report-sha256', 'a'.repeat(64), '--nightly-report-sha256', 'b'.repeat(64)];
for (const [name, extra] of [
  ['invalid value', ['--startup-diagnostics', '2', '--task-root', CURRENT_TASK]],
  ['missing current task', ['--startup-diagnostics', '1']],
  ['baseline comparison', ['--startup-diagnostics', '1', '--task-root', CURRENT_TASK, '--baseline', '/absent-baseline', '--baseline-archive-sha256', 'c'.repeat(64), '--baseline-manifest-sha256', 'd'.repeat(64)]]
]) {
  let rejected = false; try { await runIsolatedNightlyGuest([...baseArgs, ...extra]); } catch (error) { rejected = String(error).includes('startup diagnostics require'); }
  check('diagnostic mode rejects ' + name + ' before any runtime input/read/launch', rejected);
}
const inputs = {};
for (const filename of [fileURLToPath(import.meta.url), new URL('./firefox-startup-diagnostics.mjs', import.meta.url), new URL('./test-firefox-nightly-baseline.mjs', import.meta.url)]) inputs[String(filename)] = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
const report = { schema: 1, pass: true, count: checks.length, checks, limits, inputs, browserStarted: false, guestStarted: false, baselineAcceptance: false, jitAcceptance: false, gpuAcceptance: false, tlsAcceptance: false, releaseAcceptance: false };
await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, count: checks.length, out }));
