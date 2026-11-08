#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CASES, SCENARIOS, source, sourceHeads, disposition, inputs} from './cases.mjs';
import {readRun, readBoundedFile} from './analyze.mjs';
import {bindingContract} from '../guest-runner/contracts.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const argv = process.argv.slice(2), args = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!/^--(out|label|case|scenario|arm|build-binding|baseline)$/.test(argv[i]) || !argv[i + 1] || args[argv[i]]) throw Error('invalid/duplicate preparation option');
  args[argv[i]] = argv[i + 1];
}
const { '--out':out, '--label':label, '--case':caseId, '--scenario':scenario, '--arm':arm } = args;
if (!out || !/^[A-Za-z0-9_-]{1,64}$/.test(label || '') || !CASES.includes(caseId) || !SCENARIOS.includes(scenario) || !['disabled','enabled'].includes(arm)) throw Error('usage: prepare.mjs --out FRESH_DISK_DIR --label LABEL --case CASE --scenario SCENARIO --arm disabled|enabled [--build-binding REVIEWED_JSON] [--baseline EXPORTED_DISABLED_DIR]');
const destination = path.resolve(out), parent = path.dirname(destination);
if (await fs.realpath(parent) !== parent) throw Error('canonical existing parent required');
const statfs = await fs.statfs(parent);
if ([0x01021994, 0x858458f6].includes(statfs.type)) throw Error('disk-backed preparation parent required');
let binding = null, bindingBytes = null;
if (args['--build-binding']) {
  bindingBytes = await readBoundedFile(args['--build-binding']); binding = JSON.parse(bindingBytes); bindingContract(binding);
}
const base = `/home/admin/nightly-jit-safety/${label}/`, src = source(caseId);
const shape = inputs(caseId, scenario, 1, 1);
let baseline = null;
if (args['--baseline']) {
  if (arm !== 'enabled' || !bindingBytes) throw Error('paired preparation requires enabled arm and reviewed binding');
  const prior = await readRun(args['--baseline']);
  if (prior.session.arm !== 'disabled' || prior.session.baseline !== null || prior.session.caseId !== caseId || prior.session.scenario !== scenario || prior.session.label === label || prior.session.sourceSHA256 !== sha(src) || prior.session.buildBindingSHA256 !== sha(bindingBytes)) throw Error('disabled baseline case/source/build differs');
  baseline = {kind:'disabled-guest-operands-v1',label:prior.session.label,...prior.hashes,args:prior.result.args};
}
const session = {kind:'nested-loop-guest-preparation-v1', label, caseId, scenario, arm,
  portableBaseline:arm === 'enabled', baseline, loopBounds:{outer:shape[0],inner:shape[1],deep:shape[2],limit:shape[5]}, sourceURI:`file://${base}case.js`, documentURI:`file://${base}probe.html`,
  sourceLine:1, sourceSHA256:sha(src), sourceHeads:sourceHeads(caseId), expectedDisposition:disposition(caseId),
  buildIdentityBound:!!binding, buildFilesVerified:false, buildBinding:binding, buildBindingSHA256:bindingBytes ? sha(bindingBytes) : null,
  guestDeadlineSeconds:150, queryDeadlineMs:12000, observerLogCapBytes:2097152, invocations:1,
  nativeLoopMap:null, runtimeAcceptance:false, fullJITAcceptance:false,
  limitations:['Preparation is not native execution.', 'The binding schema is checked here; the reviewed outer supervisor must verify every actual binary/archive/kernel/manifest file hash and all launch/sampling/exit gates.', 'Every native loop offset must be mapped from this exact built script by an independent native disassembly review.', 'Existing observers record lifecycle and exits, not useful nested iteration counts.']};
const files = {'case.js':src,
  'console-expression.txt':`await ChromeUtils.importESModule(\"file://${base}entry.sys.mjs\").run()\n`,
  'probe.html':'<!doctype html><meta charset="utf-8"><title>Nested loop diagnostic</title><script src="case.js"></script><p>Awaiting exact-URI native actor.</p>\n',
  'plan.sys.mjs':`export const plan = ${JSON.stringify(session, null, 2)};\nexport const expectedSource = ${JSON.stringify(src.trimEnd())};\n`,
  'session.json':JSON.stringify(session,null,2)+'\n',
  'user.js':`user_pref("javascript.options.portable_baseline", ${session.portableBaseline});\n`};
const here = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['entry.sys.mjs','NestedLoopChild.sys.mjs','NestedLoopParent.sys.mjs']) files[name] = await fs.readFile(path.join(here,name),'utf8');
if (bindingBytes) files['build-binding.json'] = bindingBytes;
const total = Object.values(files).reduce((n,bytes)=>n+Buffer.byteLength(bytes),0);
if (total > 65536) throw Error('preparation exceeds 64KiB cap');
await fs.mkdir(destination); // Fresh only; no overwrite or launch.
for (const [name,bytes] of Object.entries(files)) await fs.writeFile(path.join(destination,name),bytes,{flag:'wx'});
const contract = {...session, files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]))};
await fs.writeFile(path.join(destination,'contract.json'),JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind:'nested-loop-preparation-only',out:destination,files:Object.keys(files).length,totalBytes:total,buildIdentityBound:!!binding,runtimeAcceptance:false}));
