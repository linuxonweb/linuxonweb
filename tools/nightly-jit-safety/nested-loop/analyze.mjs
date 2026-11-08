#!/usr/bin/env node
// Diagnostic reduction only. Synthetic inputs and host tests never grant native acceptance.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {bindingContract} from '../guest-runner/contracts.mjs';
import {source, sourceHeads, inputs, expected, disposition} from './cases.mjs';
const need = (ok, message) => { if (!ok) throw Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const observation = /^PBLJIT_OBS event=(\S+) file=(\S+) line=(\d+) off=(\d+) tid=(\d+) pthread=(\d+) tls=(0x[0-9a-fA-F]+) epoch=(\d+) fn=(\d+) kind=(-?\d+) sp=(\d+) pcDelta=(-?\d+) ic=(\d+)$/;
const exits = {run:1,bail:2,interrupt:3,noentry:0};
const passive = new Set(['reject','skip-incremental','skip-debuggee','skip-coverage','policy-catch','policy-finally','policy-throw','policy-throw-stack','interrupt-callback-continue','interrupt-callback-abort']);
export function parseObservations(raw) {
  need(Buffer.isBuffer(raw) && raw.length < 2097152, 'direct raw log cap reached');
  need(!raw.length || raw.at(-1) === 10, 'complete raw log lines required');
  const text = raw.toString('utf8');
  need(Buffer.from(text).equals(raw), 'native log must be intact UTF-8');
  need(!/PBL[A-Z_]*EXHAUSTED/.test(text), 'native observer budget/emission exhausted');
  const lines = text.split('\n').filter(line=>line.includes('PBLJIT_OBS'));
  need(lines.length < 4096, 'native observer emission boundary reached');
  return lines.map(line=>{
    const match = observation.exec(line); need(match, 'malformed native observation');
    const [event,file] = match.slice(1,3);
    const row = {event,file,line:Number(match[3]),off:Number(match[4]),tid:Number(match[5]),pthread:Number(match[6]),tls:match[7],epoch:Number(match[8]),fn:Number(match[9]),kind:Number(match[10]),sp:Number(match[11]),pcDelta:Number(match[12]),ic:Number(match[13])};
    need(Object.values(row).filter(v=>typeof v === 'number').every(Number.isSafeInteger), 'unsafe numeric native field');
    need(['line','off','fn','sp','ic'].every(key=>row[key] <= 0xffffffff) && row.pcDelta >= -2147483648 && row.pcDelta <= 2147483647, 'native field outside protocol range');
    need(row.line > 0 && row.tid > 0 && row.pthread > 0 && !/^0x0+$/.test(row.tls), 'native source/thread/TLS identity missing');
    need(Object.hasOwn(exits,event) || passive.has(event) || event === 'install' || event === 'gc-evict', 'unknown native observation event');
    if (Object.hasOwn(exits,event)) need(row.kind === exits[event] && row.fn > 0, 'native exit name/kind/function mismatch');
    else {
      need(row.kind === -1 && row.sp === 0 && row.pcDelta === 0 && row.ic === 0, 'non-exit observation output differs');
      need(passive.has(event) ? row.fn === 0 : row.fn > 0, 'native observation function identity differs');
    }
    if (event === 'noentry') need(row.sp === 0 && row.pcDelta === 0 && row.ic === 0, 'NoEntry unexpectedly contains exit output');
    return row;
  });
}
export function analyze(session, result, before, after) {
  need(session?.kind === 'nested-loop-guest-preparation-v1', 'exact nested preparation required');
  bindingContract(session.buildBinding);
  need(session.buildIdentityBound === true && session.runtimeAcceptance === false && session.fullJITAcceptance === false && session.buildFilesVerified === false && session.nativeLoopMap === null, 'preparation identity/acceptance differs');
  need(/^[a-f0-9]{64}$/.test(session.buildBindingSHA256), 'reviewed binding digest missing');
  need(session.expectedDisposition === disposition(session.caseId), 'fixture disposition differs');
  const src = source(session.caseId);
  need(sha(src) === session.sourceSHA256 && equal(sourceHeads(session.caseId),session.sourceHeads), 'exact source/heads differ');
  const base = `file:///home/admin/nightly-jit-safety/${session.label}/`;
  need(/^[A-Za-z0-9_-]{1,64}$/.test(session.label) && session.sourceURI === base+'case.js' && session.documentURI === base+'probe.html' && session.sourceLine === 1, 'exact source URI differs');
  need(['disabled','enabled'].includes(session.arm) && session.portableBaseline === (session.arm === 'enabled'), 'preparation arm differs');
  need(session.invocations === 1 && session.guestDeadlineSeconds === 150 && session.queryDeadlineMs === 12000 && session.observerLogCapBytes === 2097152, 'bounded invocation contract differs');
  need(result?.kind === 'actual-firefox-nested-loop-result-v1' && result.status === 'recorded', 'native result missing/failed; no invocation established');
  for (const key of ['label','caseId','scenario','sourceURI','sourceLine','documentURI']) need(result[key] === session[key], 'result '+key+' differs');
  need(result.sourceText === src.trimEnd() && result.version === '159.0a1' && result.applicationBuildID === session.buildBinding.localBuildID && result.platformBuildID === session.buildBinding.localBuildID, 'actual source/build identity differs');
  need(Number.isSafeInteger(result.processID) && result.processID > 0 && [0,2].includes(result.processType) && /^[1-9]\d*$/.test(result.windowId), 'content process/window identity missing');
  need(Number.isSafeInteger(result.parentObservedProcessID) && result.parentObservedProcessID > 0 && (result.processType === 0
    ? result.parentObservedInProcess === true && result.parentObservedOSPid === -1 && result.parentObservedProcessID === result.processID
    : result.parentObservedInProcess === false && result.parentObservedOSPid === result.processID), 'parent-observed process identity differs');
  need(result.startupPref === session.portableBaseline && result.actualJitOptions?.['pbl.enable'] === Number(session.portableBaseline) && result.actualJitOptions?.['pbl.warmup.threshold'] === 10, 'restart-only options differ');
  need(result.observerEnabled === '1' && result.logBudget === '0' && result.acquisitionEvent === 'DOMContentLoaded' && result.acquisitionEventTrusted === true && result.liveCurrentGlobal === true && result.functionGlobalMatches === true && result.referenceStable === true && result.debuggerAttachedByProbe === false, 'trusted source acquisition differs');
  need(result.invocations === 1 && result.runtimeAcceptance === false && result.fullJITAcceptance === false, 'invocation evidence differs');
  need(Number.isFinite(result.targetPerformanceBeforeMs) && result.targetPerformanceBeforeMs >= 0 && Number.isFinite(result.targetPerformanceAfterMs) && result.targetPerformanceAfterMs >= result.targetPerformanceBeforeMs && result.targetPerformanceAfterMs-result.targetPerformanceBeforeMs < session.queryDeadlineMs, 'target query deadline violated');
  need(Array.isArray(result.args) && result.args.length === 6 && equal(result.args,inputs(session.caseId,session.scenario,result.args[3],result.args[4])), 'bounded runtime operands differ');
  if (session.baseline === null) {
    need(result.runtimeOperandSource === 'native-process-id/date/performance' && result.baselineResultSHA256 === null, 'native runtime operand provenance differs');
  } else {
    const baseline = session.baseline;
    need(session.arm === 'enabled' && baseline?.kind === 'disabled-guest-operands-v1' && /^[A-Za-z0-9_-]{1,64}$/.test(baseline.label) && baseline.label !== session.label &&
      ['sessionSHA256','resultSHA256','beforeSHA256','afterSHA256'].every(key=>/^[a-f0-9]{64}$/.test(baseline[key])) && equal(baseline.args,result.args), 'disabled baseline binding differs');
    need(result.runtimeOperandSource === 'recorded-disabled-guest-operands' && result.baselineResultSHA256 === baseline.resultSHA256, 'paired operand provenance differs');
  }
  const [outer,inner,deep,,,limit] = result.args;
  need(equal(session.loopBounds,{outer,inner,deep,limit}), 'preparation loop bounds differ');
  const wanted = expected(session.caseId,result.args);
  need(result.threw === wanted.threw && equal(result.value,wanted.value), 'runtime-dependent semantic checksum/counts differ');
  const prior = parseObservations(before), total = parseObservations(after);
  need(after.length >= before.length && after.subarray(0,before.length).equals(before), 'native raw capture rotated/truncated/changed');
  for (const [phase,bytes] of [['before',before],['after',after]]) {
    const record = result[phase];
    need(record?.phase === phase && record.bytes === bytes.length && record.file === `observer.${phase}.stderr` && record.observerEnabled === '1' && record.logBudget === '0', 'direct native boundary record differs');
  }
  need(!total.some(row=>row.file === session.sourceURI && row.line !== session.sourceLine), 'target script start line differs');
  const scoped = row=>row.file === session.sourceURI && row.line === session.sourceLine;
  need(!prior.some(scoped), 'target was already exercised before the owned invocation');
  const events = total.slice(prior.length).filter(scoped);
  need(session.portableBaseline || events.length === 0, 'disabled arm unexpectedly observed PBLJIT activity');
  const groups = new Map(), installed = new Set();
  const identity = row=>[row.file,row.line,row.off,row.tid,row.pthread,row.tls,row.epoch,row.fn].join('|');
  let targetThread;
  const cachedIdentity = row=>[row.file,row.line,row.off,row.tid,row.pthread,row.tls,row.fn].join('|');
  const installedRows = new Map();
  for (const row of events) {
    const thread = [row.tid,row.pthread,row.tls].join('|');
    need(row.tid === result.processID && (!targetThread || targetThread === thread), 'observation does not belong to the owned main thread');
    targetThread = thread;
    if (row.event === 'gc-evict') {
      for (const [key,old] of installedRows) if (cachedIdentity(old) === cachedIdentity(row)) { installed.delete(key); installedRows.delete(key); }
    }
    if (row.event === 'install') installedRows.set(identity(row),row);
    if (row.event === 'install') installed.add(identity(row));
    if (['run','bail','interrupt','noentry'].includes(row.event)) need(installed.has(identity(row)), 'native exit has no matching source/thread/TLS/epoch/function install');
    const key = String(row.off);
    if (!groups.has(key)) groups.set(key,{bytecodeOffset:row.off,loopName:null,events:[],installs:0,normalExits:0,bails:0,interrupts:0,noEntries:0,rejections:0,policyFallbacks:0});
    const group = groups.get(key); group.events.push(row);
    const field = {install:'installs',run:'normalExits',bail:'bails',interrupt:'interrupts',noentry:'noEntries',reject:'rejections'}[row.event];
    if (field) group[field]++;
    if (row.event.startsWith('policy-')) group.policyFallbacks++;
  }
  const count = event=>events.filter(row=>row.event === event).length;
  return {kind:'nested-loop-diagnostic-v1',label:session.label,caseId:session.caseId,scenario:session.scenario,arm:session.arm,
    packetAndRawConsistent:true,semanticResultMatches:true,expectedResult:wanted,
    expectedDisposition:session.expectedDisposition,sourceHeads:session.sourceHeads,
    pairedOperandsRecorded:session.baseline !== null,disabledBaselineVerified:false,
    compileSuccessInferredFromInstall:count('install') > 0,installs:count('install'),normalExitEvents:count('run'),bailExitEvents:count('bail'),interruptExitEvents:count('interrupt'),noEntryEvents:count('noentry'),rejectionEvents:count('reject'),
    policyFallbackEvents:events.filter(row=>row.event.startsWith('policy-')).map(row=>row.event),
    entryInferredFromExit:events.some(row=>['run','bail','interrupt'].includes(row.event)),
    observationState:events.length ? 'source-attributed-unmapped-offsets' : 'no-source-observation',
    offsets:[...groups.values()],outerLoopIdentified:false,outerNormalExitProven:false,usefulOuterAndInnerCompiledWorkProven:false,
    nativeExecutionVerified:false,runtimeAcceptance:false,fullJITAcceptance:false,
    pending:['Reviewed exact launch/source/binary pins, common CPU ancestor and sampler, and terminal/reap evidence must pass the existing outer gates.',
      'Independently map actual bytecode offsets to outer/inner/deep LoopHead sites for this exact built script. Script lineno is not a loop line.',
      'Current lifecycle observers do not count useful compiled outer and inner iterations; a normal exit cannot establish that work.',
      'Reject de-duplication is per script/reason/epoch, so a missing outer reject in depth3 does not prove admission.']};
}
export async function readBoundedFile(filename, maximumBytes = 65536) {
  need(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes < 2097152, 'invalid file read cap');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const initial = await handle.stat();
    need(initial.isFile(), 'regular exported file required');
    need(initial.size <= maximumBytes, 'exported file read cap exceeded');
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    need(length <= maximumBytes, 'exported file read cap exceeded');
    const final = await handle.stat();
    need(initial.size === final.size && final.size === length && initial.mtimeMs === final.mtimeMs && initial.ctimeMs === final.ctimeMs, 'exported file changed while reading');
    return bytes.subarray(0,length);
  } finally { await handle.close(); }
}
export async function readRun(directory) {
  const read = name=>readBoundedFile(path.join(directory,name), name.endsWith('.stderr') ? 2097151 : 65536);
  const [s,r,b,a,bindingBytes] = await Promise.all([read('session.json'),read('result.json'),read('observer.before.stderr'),read('observer.after.stderr'),read('build-binding.json')]);
  const session = JSON.parse(s), result = JSON.parse(r);
  need(sha(bindingBytes) === session.buildBindingSHA256 && equal(JSON.parse(bindingBytes),session.buildBinding), 'exported binding bytes differ');
  return {session,result,before:b,after:a,hashes:{sessionSHA256:sha(s),resultSHA256:sha(r),beforeSHA256:sha(b),afterSHA256:sha(a)},diagnostic:analyze(session,result,b,a)};
}
export function compareRuns(disabled,enabled) {
  const d = disabled.session, e = enabled.session;
  need(d.arm === 'disabled' && d.baseline === null && e.arm === 'enabled' && e.baseline?.kind === 'disabled-guest-operands-v1', 'disabled/enabled paired runs required');
  need(d.label !== e.label && e.baseline.label === d.label && ['caseId','scenario','sourceSHA256','buildBindingSHA256'].every(key=>d[key] === e[key]) && equal(d.buildBinding,e.buildBinding), 'paired case/build identity differs');
  need(Object.entries(disabled.hashes).every(([key,value])=>e.baseline[key] === value), 'paired disabled artifact digest differs');
  const checks = [disabled,enabled].map(run=>analyze(run.session,run.result,run.before,run.after));
  need(equal(disabled.result.args,enabled.result.args) && disabled.result.threw === enabled.result.threw && equal(disabled.result.value,enabled.result.value), 'disabled/enabled operands or semantics differ');
  return {kind:'nested-loop-paired-diagnostic-v1',caseId:d.caseId,scenario:d.scenario,
    pairedOperandsEqual:true,disabledBaselineVerified:true,semanticResultsEqual:true,arms:checks,
    nativeExecutionVerified:false,runtimeAcceptance:false,fullJITAcceptance:false};
}
async function main() {
  const [directory,paired] = process.argv.slice(2);
  need(directory && process.argv.length <= 4, 'usage: analyze.mjs EXPORTED_RUN_DIRECTORY [EXPORTED_ENABLED_DIRECTORY]');
  const first = await readRun(directory);
  console.log(JSON.stringify(paired ? compareRuns(first,await readRun(paired)) : first.diagnostic,null,2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
