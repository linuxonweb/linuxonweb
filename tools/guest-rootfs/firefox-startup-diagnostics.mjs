// Host-only CDP recorder. Never inspect remote objects or invoke guest getters.
import { openSync, appendFileSync, closeSync } from 'node:fs';

export const STARTUP_DIAGNOSTIC_LIMITS = Object.freeze({ durationMs: 180000, commandMs: 10000, sessions: 512, events: 2048, bytes: 8 * 1024 ** 2, recordBytes: 65536, string: 8192, args: 16, frames: 64, stackDepth: 4 });
const assert = (ok, message) => { if (!ok) throw Error(message); };
const text = value => typeof value === 'string' ? value.slice(0, STARTUP_DIAGNOSTIC_LIMITS.string) : undefined;
const number = value => Number.isFinite(value) ? value : undefined;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function remote(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const result = { type: text(value.type), subtype: text(value.subtype), description: text(value.description), unserializableValue: text(value.unserializableValue) };
  if (value.value === null || ['string', 'number', 'boolean'].includes(typeof value.value)) result.value = typeof value.value === 'string' ? text(value.value) : typeof value.value === 'number' ? number(value.value) : value.value;
  // objectId, previews and object-valued .value are intentionally omitted.
  return result;
}
function stack(value, depth = 0) {
  if (!value || depth >= STARTUP_DIAGNOSTIC_LIMITS.stackDepth) return undefined;
  return { description: text(value.description), callFrames: Array.isArray(value.callFrames) ? value.callFrames.slice(0, STARTUP_DIAGNOSTIC_LIMITS.frames).map(frame => ({ functionName: text(frame?.functionName), scriptId: text(frame?.scriptId), url: text(frame?.url), lineNumber: number(frame?.lineNumber), columnNumber: number(frame?.columnNumber) })) : [], parent: stack(value.parent, depth + 1) };
}
export function startupRuntimeEvent(method, params = {}) {
  if (!params || typeof params !== 'object') params = {};
  if (method === 'Runtime.consoleAPICalled') return { type: text(params.type), executionContextId: number(params.executionContextId), timestamp: number(params.timestamp), args: Array.isArray(params.args) ? params.args.slice(0, STARTUP_DIAGNOSTIC_LIMITS.args).map(remote) : [], stackTrace: stack(params.stackTrace) };
  if (method === 'Runtime.exceptionThrown') {
    const detail = params.exceptionDetails || {};
    return { timestamp: number(params.timestamp), exceptionDetails: { exceptionId: number(detail.exceptionId), text: text(detail.text), lineNumber: number(detail.lineNumber), columnNumber: number(detail.columnNumber), url: text(detail.url), executionContextId: number(detail.executionContextId), exception: remote(detail.exception), stackTrace: stack(detail.stackTrace) } };
  }
  return null;
}
export function ownedStartupWorker(info, origin) {
  if (!info || info.type !== 'worker' || !id(info.targetId) || typeof info.url !== 'string') return false;
  try { const url = new URL(info.url); return url.origin === origin && url.pathname === '/linux/dist/worker.js' && !url.username && !url.password && !url.hash; } catch { return false; }
}
export function routeOwnedCdpResponse(message, pending) {
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id); clearTimeout(entry.timer);
  if ((message.sessionId || undefined) !== entry.sessionId) entry.reject(Error('CDP response worker session mismatch'));
  else if (message.error) entry.reject(Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
}
const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'worker', exclude: false }, { exclude: true }] };

export function createStartupDiagnostics({ filename, origin, pageTargetId, call, alive, now = Date.now }) {
  assert(id(pageTargetId), 'diagnostic page target required');
  const fd = openSync(filename, 'wx', 0o600), sessions = new Map(), tasks = new Set();
  let closed = false, writeFailed = false, startedAt = null, failure = null, count = 0, bytes = 0, dropped = 0;
  const summary = () => ({ enabled: true, filename, limits: STARTUP_DIAGNOSTIC_LIMITS, startedAt, events: count, bytes, dropped, sessions: [...sessions.values()].map(s => ({ ...s })), failure, baselineAcceptance: false, jitAcceptance: false, gpuAcceptance: false, tlsAcceptance: false, releaseAcceptance: false });
  function write(method, params, sessionId = '') {
    if (closed || writeFailed) return;
    let record = { at: now(), method, sessionId, targetId: sessionId ? sessions.get(sessionId)?.targetId : pageTargetId, params };
    let line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > STARTUP_DIAGNOSTIC_LIMITS.recordBytes) { record = { at: record.at, method, sessionId, targetId: record.targetId, truncated: true, excerpt: line.slice(0, 8192) }; line = JSON.stringify(record) + '\n'; }
    const size = Buffer.byteLength(line);
    if (count >= STARTUP_DIAGNOSTIC_LIMITS.events || bytes + size > STARTUP_DIAGNOSTIC_LIMITS.bytes) { dropped++; failure ||= 'startup diagnostic capture bound exhausted'; return; }
    try { appendFileSync(fd, line); bytes += size; count++; }
    catch (error) { writeFailed = true; failure ||= ('startup diagnostic persistence failed: ' + String(error)).slice(0, 8192); }
  }
  function fail(error) { failure ||= String(error?.message || error).slice(0, 8192); write('diagnostic.failure', { message: failure }); }
  function track(task) { const guarded = task.catch(fail); tasks.add(guarded); void guarded.then(() => tasks.delete(guarded)); }
  async function setupWorker(sessionId, waiting) {
    let failed;
    try {
      assert(waiting === true, 'worker executed before diagnostic admission');
      await call('Runtime.enable', {}, sessionId);
      await call('Target.setAutoAttach', autoAttach, sessionId);
      sessions.get(sessionId).enabled = true;
    } catch (error) { failed = error; }
    finally {
      // Resume even if setup fails; normal HALT control throws must never pause.
      if (waiting) try { await call('Runtime.runIfWaitingForDebugger', {}, sessionId); sessions.get(sessionId).resumed = true; } catch (error) { failed ||= error; }
    }
    if (failed) fail(failed);
  }
  function handle(message) {
    if (closed) return;
    const parent = message.sessionId || '';
    if (!alive()) { fail('diagnostic event requires live owned browser'); return; }
    if (parent && !sessions.has(parent)) { fail('diagnostic event has unknown worker session'); return; }
    if (message.method === 'Target.attachedToTarget') {
      const p = message.params || {}, info = p.targetInfo;
      if (!id(p.sessionId) || sessions.has(p.sessionId) || !ownedStartupWorker(info, origin) || sessions.size >= STARTUP_DIAGNOSTIC_LIMITS.sessions) {
        fail('unadmitted diagnostic worker attachment');
        // This attachment came through the owned parent. Release its start wait
        // and detach without enabling Runtime on the unadmitted target.
        if (id(p.sessionId) && !sessions.has(p.sessionId)) track((async () => {
          if (p.waitingForDebugger === true) await call('Runtime.runIfWaitingForDebugger', {}, p.sessionId);
          await call('Target.detachFromTarget', { sessionId: p.sessionId }, parent || undefined);
        })());
        return;
      }
      sessions.set(p.sessionId, { sessionId: p.sessionId, targetId: info.targetId, parentSessionId: parent, url: text(info.url), waitingForDebugger: p.waitingForDebugger === true, enabled: false, resumed: false, detached: false });
      write(message.method, sessions.get(p.sessionId), parent);
      track(setupWorker(p.sessionId, p.waitingForDebugger));
    } else if (message.method === 'Target.detachedFromTarget') {
      const s = sessions.get(message.params?.sessionId);
      if (!s || s.parentSessionId !== parent) { fail('unadmitted diagnostic worker detachment'); return; }
      s.detached = true; write(message.method, { sessionId: s.sessionId, targetId: s.targetId }, parent);
    } else {
      const event = startupRuntimeEvent(message.method, message.params);
      if (event) write(message.method, event, parent);
    }
  }
  return {
    handle, summary,
    check() { assert(!failure, failure); assert(startedAt === null || now() - startedAt < STARTUP_DIAGNOSTIC_LIMITS.durationMs, 'startup diagnostic duration exhausted'); },
    async start() { assert(startedAt === null, 'diagnostic capture already started'); startedAt = now(); write('diagnostic.start', { pageTargetId, origin }); await call('Runtime.enable'); await call('Target.setAutoAttach', autoAttach); },
    async settle() { await Promise.all([...tasks]); },
    close() { if (!closed) { write('diagnostic.end', { failure, dropped }); try { closeSync(fd); } catch (error) { failure ||= ('startup diagnostic close failed: ' + String(error)).slice(0, 8192); } closed = true; } }
  };
}
