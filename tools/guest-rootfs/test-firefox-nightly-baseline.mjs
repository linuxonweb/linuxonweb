// Isolated native Linux/Wasm Nightly baseline. No JIT, GPU or TLS acceptance
// follows from this runner. Run --help; --self-test never launches a browser.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { saveHostCpuPhaseEvidence, guestCpuPrebootStateExpression, readHostNproc, selectHostCpus, saveGuestCpuEvidence, guestCpuChecks } from './firefox-host-cpus.mjs';

const TASK = '/mnt/p6/build/firefox-nightly-baseline-gate-20261002';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = 'file:///opt/firefox/gpu-check/gpu-check.html';
const PROBE = 'file:///home/admin/nightly-baseline-probe.html';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (value, message) => { if (!value) throw Error(message); };
const fatal = logs => logs.split('\n').filter(line => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError:|indirect call (?:type mismatch|to null)/i.test(line));

async function ownedBuildProcesses(snapshot) {
  const root = '/mnt/p6/build/firefox-nightly-musl-recovery-20261002', found = [];
  for (const line of snapshot.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match || !/(?:^|[\s/])(?:clang(?:\+\+)?(?:-\d+)?|rustc|cargo|ninja|make|mach)(?:[\s.]|$)|build-full/.test(match[2])) continue;
    let cwd; try { cwd = await fs.realpath('/proc/' + match[1] + '/cwd'); } catch { continue; }
    if (cwd === root || cwd.startsWith(root + '/') || match[2].includes(root)) found.push({ pid: Number(match[1]), cwd, argv: match[2] });
  }
  return found;
}

export function packageContract(full, overlay, fullManifest, candidateManifest, archiveHash, archiveBytes) {
  assert(full.passPackage === true && full.candidateOnly === true && full.guestAcceptance === false, 'complete isolated Nightly package required');
  assert(overlay.passPackage === true && overlay.candidateOnly === true && overlay.pageUrl === PAGE, 'default-page overlay required');
  assert(full.identity?.version === '159.0a1' && /^\d{14}$/.test(full.identity.localBuildID) && /^[a-f0-9]{40}$/.test(full.identity.hgRevision), 'reviewed Nightly identity required');
  for (const key of ['sourceSha256', 'sourceManifestSha256', 'sourceIdentitySHA256', 'buildEvidenceSHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256', 'archiveSha256']) assert(digest(full[key]), 'missing full package digest ' + key);
  for (const name of ['application.ini', 'platform.ini']) {
    const stamp = full.stamps?.[name];
    assert(stamp?.version === full.identity.version && stamp.buildID === full.identity.localBuildID && stamp.sourceStamp === full.identity.hgRevision, 'compiled stamp mismatch ' + name);
  }
  assert(full.allOutsideRuntimeRecordsIdentical === true && full.tailPreserved === true, 'full package preservation proof required');
  assert(overlay.homeAndProfilesUnchanged === true && overlay.initUnchanged === true && overlay.originalOrderPreserved === true && overlay.tailPreserved === true, 'overlay preservation proof required');
  assert(overlay.sourceSha256 === full.archiveSha256 && overlay.sourceVersion === full.version, 'overlay/full package chain mismatch');
  assert(digest(overlay.sourceManifestSha256), 'missing overlay source manifest digest');
  assert(fullManifest.version === full.version && fullManifest.assets?.firefox?.sha256 === full.archiveSha256 && fullManifest.assets.firefox.bytes === full.bytes, 'full manifest mismatch');
  assert(candidateManifest.version === overlay.version && candidateManifest.assets?.firefox?.sha256 === archiveHash && overlay.archiveSha256 === archiveHash && candidateManifest.assets.firefox.bytes === archiveBytes && overlay.bytes === archiveBytes, 'candidate archive/manifest mismatch');
  assert(same(Object.keys(candidateManifest.assets).sort(), Object.keys(fullManifest.assets).sort()), 'overlay changed system asset set');
  for (const key of Object.keys(fullManifest.assets)) if (key !== 'firefox') assert(same(candidateManifest.assets[key], fullManifest.assets[key]), 'overlay changed system asset ' + key);
  return { compiled: full.identity, stamps: full.stamps, sourceIdentitySHA256: full.sourceIdentitySHA256, buildEvidenceSHA256: full.buildEvidenceSHA256, rawBinarySHA256: full.rawBinarySHA256, finalBinarySHA256: full.finalBinarySHA256, fullPackageArchiveSHA256: full.archiveSha256, fullPackageSourceArchiveSHA256: full.sourceSha256, fullPackageSourceManifestSHA256: full.sourceManifestSha256, archiveSHA256: archiveHash, runtimeVersion: overlay.version };
}

export function reportedIdentity(userAgent, buildID, compiled, baseline = false) {
  const version = /Firefox\/([^\s]+)/.exec(userAgent || '')?.[1] || null;
  const major = version && Number(version.split('.')[0]);
  return { userAgent, reportedVersion: version, reportedBuildID: buildID ?? null,
    matchesExpectedMajor: baseline ? Number.isInteger(major) && major > 0 : major === Number(compiled.version.split('.')[0]),
    // navigator.buildID is often privacy-reduced (20181001000000). It cannot
    // authenticate the local build; compiled stamps and hash chain do that.
    reportedBuildIDMatchesLocal: buildID === compiled.localBuildID };
}

export function consolePayloads(logs, prefix) {
  const result = [];
  for (const line of logs.split('\n')) {
    const index = line.indexOf('console.log: ');
    if (index < 0) continue;
    try { const message = JSON.parse(line.slice(index + 'console.log: '.length)); if (typeof message === 'string' && message.startsWith(prefix)) result.push(message.slice(prefix.length)); } catch {}
  }
  return result;
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) { assert(argv[i]?.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--'), 'expected --key VALUE'); assert(!result[argv[i].slice(2)], 'duplicate option'); result[argv[i].slice(2)] = argv[i + 1]; }
  const allowed = ['out', 'candidate', 'overlay-report-sha256', 'nightly-package', 'nightly-report-sha256', 'baseline', 'baseline-archive-sha256', 'baseline-manifest-sha256', 'chromium'];
  for (const key of Object.keys(result)) assert(allowed.includes(key), 'unknown option ' + key);
  for (const key of ['out', 'candidate', 'overlay-report-sha256', 'nightly-package', 'nightly-report-sha256']) assert(result[key], 'missing --' + key);
  for (const key of ['overlay-report-sha256', 'nightly-report-sha256', ...(result.baseline ? ['baseline-archive-sha256', 'baseline-manifest-sha256'] : [])]) assert(digest(result[key]), 'invalid --' + key);
  assert(result.baseline || !(result['baseline-archive-sha256'] || result['baseline-manifest-sha256']), 'baseline hashes require --baseline');
  return result;
}

const probeHTML = `<!doctype html><meta charset="utf-8"><title>Nightly baseline input</title><style>body{font:24px sans-serif;background:#f4f9ff;margin:40px}input{font:inherit;padding:12px}</style><h1>Nightly baseline input</h1><input autofocus><pre>Ready</pre><script>
const field=document.querySelector('input');function evidence(tag,extra={}){const r={schema:1,tag,createdAt:Date.now(),url:location.href,userAgent:navigator.userAgent,buildID:typeof navigator.buildID==='string'?navigator.buildID:null,...extra};console.log('NIGHTLYBASELINE '+JSON.stringify(r));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(r)],{type:'application/json'}));a.download='nightly-baseline-'+tag+'-'+r.createdAt+'.json';a.click();}
field.addEventListener('input',()=>{document.querySelector('pre').textContent=field.value;if(field.value==='wasmperf'){let sum=0;for(let i=0;i<4000;i++)sum=(sum+i)|0;evidence('result',{input:field.value,checksum:sum});}});requestAnimationFrame(()=>{field.focus();evidence('ready');});</script>`;

async function run(argv) {
  const opt = options(argv), out = path.resolve(opt.out), candidate = path.resolve(opt.candidate), fullDir = path.resolve(opt['nightly-package']), baseline = opt.baseline && path.resolve(opt.baseline);
  assert(out.startsWith(TASK + '/'), 'output outside dedicated task');
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
    assert(process.env[key], key + ' required');
    const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
    assert(actual.startsWith(TASK + '/') && ![0x01021994, 0x858458f6].includes(stat.type), 'disk-backed task scratch required');
    assert(stat.bavail * stat.bsize >= 20 * 1024 ** 3, '20 GiB free-space reserve required');
  }
  const processSnapshot = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  const activeBuilds = await ownedBuildProcesses(processSnapshot);
  assert(activeBuilds.length === 0, 'owned full build still active; no guest while build loaded: ' + JSON.stringify(activeBuilds.map(p => ({ pid: p.pid, cwd: p.cwd }))));
  const inputs = {}, read = async p => { const bytes = await fs.readFile(p); inputs[p] = sha(bytes); return bytes; };
  const overlayPath = candidate + '/package.json', fullPath = fullDir + '/package-report.json';
  const overlay = JSON.parse(await read(overlayPath)), full = JSON.parse(await read(fullPath));
  assert(inputs[overlayPath] === opt['overlay-report-sha256'] && inputs[fullPath] === opt['nightly-report-sha256'], 'reviewed report digest differs');
  const fullManifestPath = fullDir + '/boot-manifest.json', candidateManifestPath = candidate + '/boot-manifest.json';
  const fullManifest = JSON.parse(await read(fullManifestPath)), candidateManifest = JSON.parse(await read(candidateManifestPath));
  assert(inputs[fullManifestPath] === overlay.sourceManifestSha256, 'overlay source manifest digest differs');
  const archive = await read(candidate + '/initramfs-firefox.cpio.gz');
  const identity = packageContract(full, overlay, fullManifest, candidateManifest, sha(archive), archive.length);
  assert(sha(await read(fullDir + '/initramfs-firefox.cpio.gz')) === full.archiveSha256, 'full package archive changed');
  let baselineManifest;
  if (baseline) {
    const b = await read(baseline + '/boot-manifest.json'), a = await read(baseline + '/initramfs-firefox.cpio.gz'); baselineManifest = JSON.parse(b);
    assert(sha(b) === opt['baseline-manifest-sha256'] && sha(a) === opt['baseline-archive-sha256'] && baselineManifest.assets.firefox.sha256 === sha(a) && baselineManifest.assets.firefox.bytes === a.length, 'baseline archive/manifest identity mismatch');
    for (const key of Object.keys(candidateManifest.assets)) if (key !== 'firefox') assert(same(baselineManifest.assets[key], candidateManifest.assets[key]), 'baseline changed non-Firefox asset ' + key);
  }
  const liveManifest = JSON.parse(await read(REPO + '/web/linux/boot-manifest.json'));
  for (const key of Object.keys(candidateManifest.assets)) if (key !== 'firefox') assert(same(liveManifest.assets[key], candidateManifest.assets[key]), 'QA server system asset descriptor mismatch ' + key);
  for (const name of ['main.js', 'worker.js', 'persistent-home.mjs', 'boot-assets.mjs', 'storage-panel.mjs', 'vmlinux.wasm', 'initramfs.cpio']) await read(REPO + '/web/linux/' + name);
  for (const [key, name] of [['kernel', 'vmlinux.wasm'], ['plain', 'initramfs.cpio']]) {
    const p = REPO + '/web/linux/' + name;
    assert(inputs[p] === candidateManifest.assets[key].sha256 && (await fs.stat(p)).size === candidateManifest.assets[key].bytes, 'actual QA system asset mismatch ' + key);
  }
  await read(fileURLToPath(import.meta.url)); await read(REPO + '/tools/guest-rootfs/firefox-host-cpus.mjs');
  const serverPath = REPO + '/web/desktop/dev-server.mjs';
  let serverSource = (await read(serverPath)).toString();
  assert(serverSource.includes('server.listen(port,') && serverSource.includes("const target = safePath(request.url || '/');") && serverSource.includes("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));"), 'QA server anchors changed');
  serverSource = serverSource.slice(0, serverSource.indexOf('server.listen(port,'));
  serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(REPO) + ';');
  serverSource = serverSource.replace('const server = createServer', "export const requests=[],sockets=new Set();let variant='candidate';export const setVariant=v=>{variant=v;};\nconst server = createServer");
  serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", "const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath,variant,method:request.method});");
  serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=(variant==='baseline'?${JSON.stringify(baseline)}:${JSON.stringify(candidate)})+'/'+requestPath.split('/').at(-1);`);
  serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
  serverSource += '\nserver.on("connection",s=>{sockets.add(s);s.on("close",()=>sockets.delete(s));});export {server};\n';
  const realParent = await fs.realpath(path.dirname(out)); assert(realParent === TASK || realParent.startsWith(TASK + '/'), 'output parent escapes task');
  assert(Number(execFileSync('du', ['-sb', TASK], { encoding: 'utf8' }).split(/\s/)[0]) < 2 * 1024 ** 3, 'task allowance already exhausted');
  await fs.mkdir(out); await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
  await fs.writeFile(out + '/owned-build-preflight.json', JSON.stringify({ activeBuilds, checkedAt: new Date().toISOString() }, null, 2) + '\n'); await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
  await fs.copyFile(REPO + '/tools/guest-rootfs/firefox-host-cpus.mjs', out + '/firefox-host-cpus.mjs');
  await fs.writeFile(out + '/server.mjs', serverSource);
  const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.shell.checkDefaultBrowser:false', 'devtools.console.stdout.content:true', 'devtools.console.stdout.chrome:true', 'browser.download.alwaysOpenPanel:false', 'browser.download.panel.shown:true', 'browser.download.folderList:2'].map(s => { const i = s.lastIndexOf(':'); return 'user_pref(' + JSON.stringify(s.slice(0, i)) + ',' + s.slice(i + 1) + ');'; }).join('\n') + '\nuser_pref("browser.download.dir","/home/admin/Downloads");\nuser_pref("browser.helperApps.neverAsk.saveToDisk","application/json");\nuser_pref("datareporting.policy.firstRunURL", "");\n' + (baseline ? 'user_pref("browser.startup.page",1);\nuser_pref("browser.startup.homepage",' + JSON.stringify(PROBE) + ');\n' : '');
  const executable = opt.chromium || '/home/a/.local/archpkg/pacman/usr/bin/chromium';
  const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + out + '/profile', '--disk-cache-dir=' + out + '/cache', 'about:blank'];
  const fd = openSync(out + '/browser.log', 'wx');
  const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: out + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
  let exitInfo, spawnError, ws, next = 0;
  const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
  const pending = new Map(), errors = [];
  const report = { schema: 1, pass: false, scope: baseline ? 'saved-homepage-update-warm' : 'default-homepage-cold-warm', identity, origin, browserPid: child.pid, phases: [], gpuAcceptance: false, jitAcceptance: false, tlsAcceptance: false, releaseAcceptance: false, limitations: ['This is baseline browser acceptance only; JIT, GPU rendering, fresh NSS trust and positive/negative TLS remain separate mandatory gates.', 'Guest UA authenticates the expected major only; exact version/source/local BuildID are pinned compiled package stamps. Exposed navigator.buildID may be reduced.', 'Startup observation times are readiness observations, not comparative benchmarks.'] };
  function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, 60000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
  async function ev(expression) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  let lastStorageCheck = 0;
  async function storageCheck() {
    if (Date.now() - lastStorageCheck < 30000) return;
    lastStorageCheck = Date.now();
    const usage = Number(execFileSync('du', ['-sb', TASK], { encoding: 'utf8' }).split(/\s/)[0]), disk = await fs.statfs(TASK);
    assert(usage < 2 * 1024 ** 3, '2 GiB task allowance exhausted'); assert(disk.bavail * disk.bsize >= 20 * 1024 ** 3, '20 GiB free reserve exhausted');
  }
  async function until(fn, ms, label) { const end = Date.now() + ms; for (;;) { assert(!exitInfo && !spawnError, 'owned browser exited: ' + JSON.stringify(exitInfo || spawnError)); await storageCheck(); if (await fn()) return; assert(Date.now() < end, label + ' deadline'); await sleep(400); } }
  const logs = () => ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`);
  const state = () => ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores').value),isolated:crossOriginIsolated,images:performance.getEntriesByType('resource').filter(e=>/vmlinux\\.wasm|initramfs.*(?:gz|cpio)/.test(e.name)).map(e=>({name:e.name,transferSize:e.transferSize}))}))()`);
  async function shot(label) { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(out + '/' + label + '.png', Buffer.from(r.data, 'base64')); }
  async function key(code, key, down, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key, modifiers }); }
  async function chord(code, name) { await key('ControlLeft', 'Control', true, 2); await key(code, name, true, 2); await key(code, name, false, 2); await key('ControlLeft', 'Control', false); }
  async function type(text) { for (const c of text) { const shift = c === ':'; const code = /[a-z]/.test(c) ? 'Key' + c.toUpperCase() : ({ ':': 'Semicolon', '/': 'Slash', '.': 'Period', '-': 'Minus' })[c]; assert(code, 'unsupported probe key'); if (shift) await key('ShiftLeft', 'Shift', true, 8); await key(code, c, true, shift ? 8 : 0); await sleep(100); await key(code, c, false, shift ? 8 : 0); if (shift) await key('ShiftLeft', 'Shift', false); } }
  async function homeRead(rel) { return ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const s of ${JSON.stringify(rel)}.split('/')){n=n&&await h.lookup(n,s);}if(!n)return null;const a=await h.getattr(n);if(Number(a.size)>65536)throw Error('unexpected large probe');return new TextDecoder().decode(await h.read(n,{},0n,Number(a.size)));})()`); }
  async function guestMessage(tag, since) { let result; await until(async () => { for (const text of consolePayloads(await logs(), 'NIGHTLYBASELINE ')) { const r = JSON.parse(text); if (r.tag === tag && r.createdAt >= since && r.url === PROBE) result = r; } return Boolean(result); }, 180000, 'guest probe ' + tag); return result; }
  async function phase(label, action) {
    await saveHostCpuPhaseEvidence(report.cpu, await ev(guestCpuPrebootStateExpression), out, label + '-preboot');
    const epoch = await ev('performance.timeOrigin'), start = Date.now(); await action(); let startupLogs;
    await until(async () => { try { if (await ev('performance.timeOrigin') === epoch) return false; startupLogs = await logs(); return startupLogs.includes('starting /bin/firefox as admin'); } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; return false; } }, 180000, label + ' Firefox launch');
    const cpu = await saveGuestCpuEvidence(report.cpu, startupLogs, await state(), out, label);
    assert(fatal(startupLogs).length === 0, label + ' fatal startup log');
    const phaseReport = { label, pass: false, cpu, launchObservedMs: Date.now() - start }; report.phases.push(phaseReport);
    let pageLogs = startupLogs;
    if (!baseline) {
      let browser, settled;
      await until(async () => { pageLogs = await logs(); const b = consolePayloads(pageLogs, 'GPUCHECK browser=').at(-1); if (b) browser = JSON.parse(b); settled = consolePayloads(pageLogs, 'GPUCHECK ').findLast(l => /^webgl=(?!pending)\S+ webgpu=(?!pending)\S+ \{/.test(l)); return Boolean(browser && settled); }, 420000, 'automatic default GPU page');
      const match = /^webgl=(\S+) webgpu=(\S+) (\{.*\})$/.exec(settled);
      phaseReport.defaultPage = { openedAutomatically: true, browser, webgl: match[1], webgpu: match[2], info: JSON.parse(match[3]), gpuRenderingRequired: false };
      phaseReport.browserIdentity = reportedIdentity(browser.userAgent, browser.buildID, full.identity);
      assert(phaseReport.browserIdentity.matchesExpectedMajor, 'default page guest Firefox major mismatch');
      await fs.writeFile(out + '/' + label + '-default-page-logs.txt', pageLogs); await shot(label + '-default-page');
      // No homepage pref or explicit launch URL was seeded in cold/warm mode.
      await ev("document.querySelector('#fb').focus()"); await chord('KeyL', 'l'); await type(PROBE); await key('Enter', 'Enter', true); await key('Enter', 'Enter', false);
    }
    const ready = await guestMessage('ready', start); phaseReport.ready = ready;
    phaseReport.probeIdentity = reportedIdentity(ready.userAgent, ready.buildID, full.identity, label === 'baseline'); assert(phaseReport.probeIdentity.matchesExpectedMajor, 'probe guest Firefox major mismatch');
    await ev("document.querySelector('#fb').focus()"); await key('Escape', 'Escape', true); await key('Escape', 'Escape', false); await sleep(500); await chord('KeyA', 'a'); await type('wasmperf');
    const result = await guestMessage('result', start); assert(result.input === 'wasmperf' && result.checksum === 7998000, 'guest typed input/checksum mismatch');
    const download = 'admin/Downloads/nightly-baseline-result-' + result.createdAt + '.json'; let downloaded;
    await until(async () => { try { downloaded = JSON.parse(await homeRead(download)); return same(downloaded, result); } catch { return false; } }, 60000, 'guest-generated download');
    assert(await homeRead('admin/nightly-baseline-marker.txt') === 'nightly-baseline-preserved-v1\n', 'home marker changed');
    assert(await homeRead('admin/.mozilla/firefox/http1-profile/user.js') === prefs, 'profile user.js changed');
    assert(await homeRead('admin/nightly-baseline-probe.html') === probeHTML, 'saved homepage probe changed');
    const finalLogs = await logs(), finalState = await state();
    phaseReport.result = result; phaseReport.download = { path: download, text: await homeRead(download) }; phaseReport.state = finalState;
    phaseReport.fatalLines = [...fatal(startupLogs), ...fatal(pageLogs), ...fatal(finalLogs)];
    phaseReport.finalCpu = await saveHostCpuPhaseEvidence(cpu, finalState, out, label + '-final');
    phaseReport.checks = { ...guestCpuChecks(cpu, finalState, phaseReport.finalCpu.hostNprocObserved), kernelHostCpuAgreement: Object.values(cpu.checks).every(Boolean), expectedRuntime: finalState.system.version === (label === 'baseline' ? baselineManifest.version : overlay.version), isolated: finalState.isolated === true, noFatalLines: phaseReport.fatalLines.length === 0, keyboardAndDownload: true, homeProfilePreserved: true };
    if (label === 'warm' || label === 'update') phaseReport.checks.zeroBootSystemImages = finalState.images.length === 0;
    assert(Object.values(phaseReport.checks).every(Boolean), label + ' baseline checks failed ' + JSON.stringify(phaseReport.checks));
    phaseReport.pass = true; phaseReport.observedResultMs = Date.now() - start;
    await fs.writeFile(out + '/' + label + '-guest-logs.txt', finalLogs); await shot(label + '-functional');
    await fs.writeFile(out + '/progress.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ phase: label, pass: true, cpu: cpu.guestBootCpus }));
  }
  try {
    let port;
    await until(async () => { try { [port] = (await fs.readFile(out + '/profile/DevToolsActivePort', 'utf8')).trim().split('\n'); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } }, 20000, 'host browser startup');
    const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page'); ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: origin + '/linux/boot-manifest.json' }); await until(() => ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"), 10000, 'seed document');
    report.cpu = selectHostCpus(readHostNproc(), await ev('navigator.hardwareConcurrency'));
    await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${report.cpu.requestedGuestCpus},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await dir('admin/Downloads');await put('admin/nightly-baseline-marker.txt',${JSON.stringify('nightly-baseline-preserved-v1\n')});await put('admin/nightly-baseline-probe.html',${JSON.stringify(probeHTML)});await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
    const url = origin + '/linux/index.html?firefox=1&renderer=canvas2d';
    if (baseline) { service.setVariant('baseline'); await phase('baseline', () => call('Page.navigate', { url })); service.setVariant('candidate'); await phase('update', () => ev("(()=>{document.querySelector('[data-storage=update]').click();return true;})()")); }
    else await phase('cold', () => call('Page.navigate', { url }));
    await phase('warm', () => call('Page.reload', { ignoreCache: true }));
    for (const p of report.phases) assert(await homeRead(p.download.path) === p.download.text, 'prior download changed ' + p.label);
    report.priorDownloadsPreserved = true;
    for (const [p, expected] of Object.entries(inputs)) assert(sha(await fs.readFile(p)) === expected, 'input changed ' + p);
    report.finalCpu = await saveHostCpuPhaseEvidence(report.phases.at(-1).cpu, await state(), out, 'end');
    assert(errors.length === 0, 'outer browser exceptions'); report.pass = true;
  } catch (error) { report.error = String(error.stack || error); try { await fs.writeFile(out + '/failure-guest-logs.txt', await logs()); await shot('failure'); } catch {} }
  finally {
    if (ws?.readyState === 1) { try { await call('Page.navigate', { url: 'about:blank' }); await call('Browser.close'); } catch {} }
    for (const p of pending.values()) clearTimeout(p.timer); ws?.close(); await Promise.race([exited, sleep(5000)]);
    if (!exitInfo && !spawnError) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await Promise.race([exited, sleep(5000)]); report.pass = false; report.forcedTermination = true; }
    for (const socket of service.sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    report.browserExit = exitInfo; report.spawnError = spawnError; report.serverClosed = !server.listening; report.errors = errors; report.requests = service.requests; report.inputs = inputs;
    report.storageBytes = Number(execFileSync('du', ['-sb', TASK], { encoding: 'utf8' }).split(/\s/)[0]);
    if (exitInfo?.code !== 0 || !report.serverClosed || report.storageBytes > 2 * 1024 ** 3) report.pass = false;
    await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ pass: report.pass, phases: report.phases.map(p => [p.label, p.pass]), error: report.error, out })); if (!report.pass) process.exitCode = 1;
}

async function selfTest(out) {
  assert(path.resolve(out).startsWith(TASK + '/'), 'self-test output outside task'); await fs.mkdir(out);
  const checks = [], check = (name, fn) => { fn(); checks.push({ name, pass: true }); }, reject = fn => { let failed = false; try { fn(); } catch { failed = true; } assert(failed, 'expected rejection'); };
  const h = 'a'.repeat(64), identity = { version: '159.0a1', localBuildID: '20261003042618', hgRevision: 'b'.repeat(40) };
  const full = { passPackage: true, candidateOnly: true, guestAcceptance: false, identity, stamps: Object.fromEntries(['application.ini', 'platform.ini'].map(n => [n, { version: identity.version, buildID: identity.localBuildID, sourceStamp: identity.hgRevision }])), ...Object.fromEntries(['sourceSha256', 'sourceManifestSha256', 'sourceIdentitySHA256', 'buildEvidenceSHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256', 'archiveSha256'].map(k => [k, h])), allOutsideRuntimeRecordsIdentical: true, tailPreserved: true, version: 'full', bytes: 12 };
  const overlay = { passPackage: true, candidateOnly: true, pageUrl: PAGE, homeAndProfilesUnchanged: true, initUnchanged: true, originalOrderPreserved: true, tailPreserved: true, sourceSha256: h, sourceManifestSha256: h, sourceVersion: 'full', archiveSha256: h, version: 'overlay', bytes: 12 };
  const manifest = version => ({ version, assets: { firefox: { sha256: h, bytes: 12 }, kernel: { sha256: h, bytes: 1 }, plain: { sha256: h, bytes: 2 } } });
  const invoke = (f = full, o = overlay, m = manifest('overlay')) => packageContract(f, o, manifest('full'), m, h, 12);
  check('valid full-build/default-page chain', () => assert(invoke().compiled.version === '159.0a1', 'identity'));
  for (const [name, mutate] of [
    ['128 full package', f => { f.identity.version = '128.14.0'; }],
    ['unaccepted package', f => { f.passPackage = false; }],
    ['missing build digest', f => { delete f.buildEvidenceSHA256; }],
    ['missing full input archive digest', f => { delete f.sourceSha256; }],
    ['missing full input manifest digest', f => { delete f.sourceManifestSha256; }],
    ['local build stamp mismatch', f => { f.stamps['application.ini'].buildID = '20261002000000'; }],
    ['source revision mismatch', f => { f.stamps['platform.ini'].sourceStamp = 'c'.repeat(40); }],
    ['outside records not preserved', f => { f.allOutsideRuntimeRecordsIdentical = false; }],
  ]) check('reject ' + name, () => { const f = structuredClone(full); mutate(f); reject(() => invoke(f)); });
  for (const [name, change] of [['wrong source hash', { sourceSha256: 'c'.repeat(64) }], ['missing source manifest hash', { sourceManifestSha256: undefined }], ['wrong source version', { sourceVersion: 'old' }], ['missing default page', { pageUrl: 'about:blank' }], ['changed home', { homeAndProfilesUnchanged: false }], ['wrong archive bytes', { bytes: 13 }], ['wrong archive hash', { archiveSha256: 'd'.repeat(64) }]]) check('reject overlay ' + name, () => reject(() => invoke(full, { ...overlay, ...change })));
  check('reject kernel descriptor change', () => { const m = manifest('overlay'); m.assets.kernel.bytes++; reject(() => invoke(full, overlay, m)); });
  check('reject extra overlay system asset', () => { const m = manifest('overlay'); m.assets.extra = { sha256: h, bytes: 3 }; reject(() => invoke(full, overlay, m)); });
  check('159 UA accepted with privacy-reduced build ID', () => { const r = reportedIdentity('Mozilla/5.0 Firefox/159.0', '20181001000000', identity); assert(r.matchesExpectedMajor && !r.reportedBuildIDMatchesLocal, 'privacy build ID'); });
  check('128 UA refused as candidate', () => assert(!reportedIdentity('Firefox/128.0', null, identity).matchesExpectedMajor, 'wrong major'));
  check('Chromium UA refused as candidate', () => assert(!reportedIdentity('Chrome/159.0', null, identity).matchesExpectedMajor, 'wrong browser'));
  check('baseline Firefox128 recorded separately', () => assert(reportedIdentity('Firefox/128.0', null, identity, true).matchesExpectedMajor, 'baseline'));
  check('console payload decoded from actual quoted guest format', () => assert(same(consolePayloads('console.log: "GPUCHECK browser={\\"userAgent\\":\\"Firefox/159.0\\"}"', 'GPUCHECK browser='), ['{"userAgent":"Firefox/159.0"}']), 'console parser'));
  check('malformed console line ignored', () => assert(consolePayloads('console.log: invalid', 'GPUCHECK ').length === 0, 'console invalid'));
  check('fatal indirect trap recognized', () => assert(fatal('RuntimeError: indirect call type mismatch').length === 1, 'trap'));
  check('GPU unavailability is not a fatal browser trap', () => assert(fatal('FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS\nGPUCHECK webgl=none webgpu=none {}').length === 0, 'GPU honesty'));
  check('actual host selection rejects mismatch', () => reject(() => selectHostCpus(8, 2)));
  check('native host selection requests all8', () => assert(selectHostCpus(8, 8).requestedGuestCpus === 8, 'cpu'));
  const cpu = selectHostCpus(8, 8), cpuState = { browserHardwareConcurrency: 8, selectedGuestCpus: 8 };
  const actual = await saveGuestCpuEvidence(cpu, 'smp: Brought up 1 node, 8 CPUs\nstarting /bin/firefox as admin', cpuState, out, 'fixture-boot', 8);
  check('startup SMP fixture independently saved', () => assert(actual.guestBootCpus === 8 && actual.smpLines.length === 1, 'SMP evidence'));
  check('final host allocation drift refused', () => assert(!guestCpuChecks(actual, { ...cpuState, browserHardwareConcurrency: 2 }, 8).hostCpuSelection, 'final host CPU'));
  check('final UI CPU drift refused', () => assert(!guestCpuChecks(actual, { ...cpuState, selectedGuestCpus: 2 }, 8).hostCpuSelection, 'final UI CPU'));
  check('final state preserves independent startup count', () => assert(Object.values(guestCpuChecks(actual, cpuState, 8)).every(Boolean), 'final CPU agreement'));
  check('final nproc drift refused despite unchanged browser and UI', () => assert(!guestCpuChecks(actual, cpuState, 6).hostAllocationStable, 'final nproc drift'));
  check('pure CPU checks require explicit observed nproc', () => assert(!guestCpuChecks(actual, cpuState).hostAllocationStable, 'missing observed nproc'));
  for (const label of ['cold-preboot', 'update-preboot', 'warm-preboot', 'end']) {
    let driftRejected = false;
    try { await saveHostCpuPhaseEvidence(cpu, cpuState, out, 'fixture-' + label, 6); } catch { driftRejected = true; }
    const evidence = JSON.parse(await fs.readFile(out + '/fixture-' + label + '-cpu-phase.json'));
    check(label + ' nproc drift rejected with retained evidence', () => assert(driftRejected && evidence.hostNprocObserved === 6 && evidence.checks.hostAllocationStable === false, 'phase nproc drift'));
  }
  let startupDriftRejected = false;
  try { await saveGuestCpuEvidence(cpu, 'smp: Brought up 1 node, 8 CPUs', cpuState, out, 'fixture-startup-host-drift', 6); } catch { startupDriftRejected = true; }
  const startupDrift = JSON.parse(await fs.readFile(out + '/fixture-startup-host-drift-cpu.json'));
  check('startup nproc drift rejected while actual kernel count retained', () => assert(startupDriftRejected && startupDrift.guestBootCpus === 8 && startupDrift.hostNprocObserved === 6 && startupDrift.checks.hostAllocationStable === false, 'startup host drift'));
  let missingRejected = false;
  try { await saveGuestCpuEvidence(cpu, 'starting /bin/firefox as admin', cpuState, out, 'fixture-missing', 8); } catch { missingRejected = true; }
  const missing = JSON.parse(await fs.readFile(out + '/fixture-missing-cpu.json'));
  check('missing SMP fails and saves honest null evidence', () => assert(missingRejected && missing.guestBootCpus === null && missing.checks.guestCpuCountMatchesHost === false, 'missing SMP'));
  let twoRejected = false;
  try { await saveGuestCpuEvidence(cpu, 'smp: Brought up 1 node, 2 CPUs', cpuState, out, 'fixture-two', 8); } catch { twoRejected = true; }
  check('historical two-CPU startup refused', () => assert(twoRejected, 'two CPU'));
  const syntheticBuild = await ownedBuildProcesses(process.pid + ' cargo --manifest-path /mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/Cargo.toml');
  check('owned build command preflight detects active PID', () => assert(syntheticBuild.length === 1 && syntheticBuild[0].pid === process.pid, 'build preflight'));
  const syntheticRunner = await ownedBuildProcesses(process.pid + ' node test-firefox-nightly-baseline.mjs --nightly-package /mnt/p6/build/firefox-nightly-musl-recovery-20261002/package');
  check('runner argument mentioning build directory is not a compiler', () => assert(syntheticRunner.length === 0, 'runner preflight'));
  const report = { pass: true, checks, count: checks.length, syntheticOnly: true, realGuestAcceptance: false, browserStarted: false };
  await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ pass: true, checks: checks.length, out }));
}

if (process.argv[2] === '--help') console.log('Run: node test-firefox-nightly-baseline.mjs --out TASK/NEW --candidate GPU_OVERLAY_DIR --overlay-report-sha256 SHA --nightly-package FULL_PACKAGE_DIR --nightly-report-sha256 SHA [--baseline DIR --baseline-archive-sha256 SHA --baseline-manifest-sha256 SHA] [--chromium PATH]\nContract tests only: node test-firefox-nightly-baseline.mjs --self-test TASK/NEW\nTMPDIR/TMP/TEMP must be disk-backed in ' + TASK + '.');
else if (process.argv[2] === '--self-test') { assert(process.argv.length === 4, '--self-test OUT required'); await selfTest(path.resolve(process.argv[3])); }
else await run(process.argv.slice(2));
