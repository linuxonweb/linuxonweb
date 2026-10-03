// Finite, private NSS/TLS guest diagnostic. Never implies release acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { runIsolatedNightlyGuest, consolePayloads } from '../guest-rootfs/test-firefox-nightly-baseline.mjs';
import { fixtureProxyOverlay } from './proxy-overlay.mjs';
import { selectNssHostCpus, saveNssBootEvidence } from './cpu-contract.mjs';

const TASK = '/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUEST = '/home/admin/nightly-nss';
const PROFILE = 'admin/.mozilla/firefox/http1-profile';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = s => /^[a-f0-9]{64}$/.test(s || '');
const dbFiles = ['cert9.db', 'key4.db', 'pkcs11.txt', 'cert_override.txt'];
export const profileEvidenceFiles = dbFiles.flatMap(name => name.endsWith('.db') ? ['', '-wal', '-shm', '-journal'].map(suffix => name + suffix) : [name]);

export function freshProfileContract(absent) {
  check(JSON.stringify(Object.keys(absent).sort()) === JSON.stringify([...profileEvidenceFiles].sort()) && Object.values(absent).every(value => value === false), 'fresh profile already has NSS/exception files or incomplete absence evidence');
}

export function freshComparisonContract(previous, current, firstState) {
  check(previous.pass === true && previous.nssMode === 'cold-warm' && previous.tlsFixtureDiagnosticPassed === true, 'accepted prior fresh diagnostic required');
  check(previous.ownedGroupEmpty === true && previous.serverClosed === true && previous.browserExit?.code === 0 && previous.fixtureServiceCleanup?.pass === true, 'prior fresh diagnostic cleanup incomplete');
  for (const report of [previous, current]) {
    check(report.phases?.length === 2 && report.phases[0].label === 'cold' && report.phases[1].label === 'warm' && report.phases.every(phase => phase.pass === true), 'complete fresh cold/warm phases required');
    check(report.prebootNssAbsence?.seedDatabaseCopied === false, 'fresh no-seed evidence required');
    freshProfileContract(report.prebootNssAbsence.absence);
    check(typeof report.hostProfilePath === 'string' && report.hostProfilePath.endsWith('/profile'), 'owned host profile evidence required');
  }
  check(previous.hostProfilePath !== current.hostProfilePath, 'two distinct fresh host profiles required');
  check(previous.identity.finalBinarySHA256 === current.identity.finalBinarySHA256 && previous.fixtureManifestSHA256 === current.fixtureManifestSHA256, 'fresh profiles must use identical browser/fixture inputs');
  const a = previous.phases[0].stoppedDatabase.audit.databases['key4.db'], b = current.phases[0].stoppedDatabase.audit.databases['key4.db'];
  check(digest(a.logicalSHA256) && digest(b.logicalSHA256) && a.logicalSHA256 !== b.logicalSHA256 && typeof previous.savedTargetState.cipher === 'string' && typeof firstState.cipher === 'string' && previous.savedTargetState.cipher !== firstState.cipher, 'fresh profiles shared SDR/key state');
}

export function guestEntry({ inventoryOptions, persistenceOptions, missingCert, donePath }) {
  // importESModule evaluates synchronously and does not support top-level await.
  return `import * as gate from './browser-probe.sys.mjs';\nconst { setTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');\nvoid (async()=>{\ntry {\nawait new Promise(r=>setTimeout(r,4000));\nawait gate.run(${JSON.stringify(inventoryOptions)});\nawait gate.${missingCert ? 'checkSDR' : 'runPersistence'}(${JSON.stringify(persistenceOptions)});\nawait IOUtils.writeJSON(${JSON.stringify(donePath)},{pass:true});\n} catch(error) {await IOUtils.writeJSON(${JSON.stringify(donePath)},{pass:false,error:String(error),stack:error.stack});}\nfinally { Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); }\n})();\n`;
}

export function guestConsoleExpression(label) {
  check(['cold', 'baseline', 'update', 'warm'].includes(label), 'unknown private module phase');
  // Current system module admission accepts resource:, not file: directly.
  // The substitution exists only in this owned guest Firefox process.
  return 'Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution("nightlynss",Services.io.newURI("file:///home/admin/nightly-nss/"));ChromeUtils.importESModule("resource://nightlynss/entry-'+label+'.sys.mjs")';
}

export function parseOptions(argv) {
  const own = {}, baseline = [];
  const keys = ['fixtures', 'fixtures-sha256', 'expected', 'expected-sha256', 'trust-report', 'trust-report-sha256', 'mode', 'baseline-firefox-version', 'compare-fresh'];
  for (let i = 0; i < argv.length; i += 2) {
    check(argv[i]?.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--'), 'expected --key VALUE');
    const key = argv[i].slice(2);
    if (keys.includes(key)) { check(!own[key], 'duplicate NSS option'); own[key] = argv[i + 1]; }
    else baseline.push(argv[i], argv[i + 1]);
  }
  for (const key of ['fixtures', 'fixtures-sha256', 'expected', 'expected-sha256', 'trust-report', 'trust-report-sha256', 'mode']) check(own[key], 'missing --' + key);
  for (const key of ['fixtures-sha256', 'expected-sha256', 'trust-report-sha256']) check(digest(own[key]), 'invalid --' + key);
  check(['cold-warm', 'update-warm', 'missing-module', 'missing-cert'].includes(own.mode), 'unknown NSS mode');
  const hasBaseline = baseline.includes('--baseline');
  check(hasBaseline === (own.mode === 'update-warm'), 'baseline requires update-warm mode');
  check(!hasBaseline || /^128\.\d+\.\d+$/.test(own['baseline-firefox-version'] || ''), 'pinned baseline Firefox128 version required');
  check(!own['compare-fresh'] || own.mode === 'cold-warm', 'fresh comparison requires two complete fresh cold/warm runs');
  return { own, baseline };
}

export function trustChainContract(trust, full) {
  check(trust.passPackage === true && trust.runtimeAcceptance === false && trust.browserRuntimeChanged === false && trust.mustNotRunStandalone === true, 'audited init-only trust adapter required');
  for (const key of ['sourceArchiveSHA256', 'sourceManifestSHA256', 'sourceInitSHA256', 'outputInitSHA256', 'archiveSHA256']) check(digest(trust[key]), 'missing trust-adapter hash ' + key);
  check(trust.archiveSHA256 === full.sourceSha256 && trust.archiveSHA256 === (full.sourceArchiveSHA256 || full.sourceSha256), 'trust adapter/full package chain mismatch');
  check(trust.sourceArchiveSHA256 === 'ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745', 'trust adapter must derive from retained v10');
  check(trust.sourceInitSHA256 === '413549e4d0156d3016ad9f39a2dd83f6aebaa44b05e40d3e296361be577422c0' && trust.outputInitSHA256 === '55d55013be46cb13541320943ef03c50a43580bf69dd5d4c425963a41a5d8803', 'exact audited init transformation required');
}

export function fixtureContract(fixture, manifestHash, endpoints) {
  check(fixture.purpose === 'dedicated-profile-only' && fixture.hostname === 'nightly-nss-fixture.test' && digest(fixture.rootSHA256), 'private fixture scope differs');
  const errors = { valid: 0, wronghost: -12276, expired: -8181, untrusted: -8179, badchain: -8182 };
  check(JSON.stringify(fixture.cases.map(c => c.name).sort()) === JSON.stringify(Object.keys(errors).sort()), 'exact five TLS cases required');
  for (const row of fixture.cases) {
    check(row.expectedPRError === errors[row.name] && sha(Buffer.from(row.derBase64, 'base64')) === row.sha256 && row.nonce === 'nightly-nss-' + row.name + '-' + row.sha256.slice(0, 24), 'fixture certificate/error/nonce differs');
  }
  check(sha(Buffer.from(fixture.rootBase64, 'base64')) === fixture.rootSHA256, 'fixture CA hash differs');
  if (endpoints) {
    check(endpoints.fixtureManifestSHA256 === manifestHash && endpoints.expiresAt > Date.now() / 1000 + 60, 'stale or unrelated fixture service');
    fixtureProxyOverlay('const addresses = await dns.resolve4(name);\nconst remote = net.connect({ host, port: targetPort });', endpoints);
  }
}

async function homePut(ev, rel, bytes, preboot = false) {
  check(rel.startsWith('admin/nightly-nss/') || rel === PROFILE + '/nightly-nss-owned-profile', 'private guest write required');
  return ev(`(async()=>{const h=${preboot ? "await(await import('/linux/persistent-home.mjs')).openPersistentHome()" : "(await import('./main.js')).guestHome()"};let n=h.root;const parts=${JSON.stringify(rel)}.split('/'),name=parts.pop();for(const p of parts)n=await h.lookup(n,p)||await h.mkdir(n,p,{mode:0o700,uid:1000,gid:1000});let f=await h.lookup(n,name),handle;if(f){await h.setattr(f,{size:0n});handle=await h.open(f,2);}else{const made=await h.create(n,name,2,{mode:0o600,uid:1000,gid:1000});f=made.node;handle=made.handle;}const b=Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0));await h.write(f,handle,0n,b);await h.release(f,handle);${preboot ? 'await h.destroy();' : ''}return true;})()`);
}

async function homeBytes(ev, rel) {
  check(rel.startsWith(PROFILE + '/') || rel.startsWith('admin/nightly-nss/'), 'private guest read required');
  const encoded = await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const p of ${JSON.stringify(rel)}.split('/')){n=n&&await h.lookup(n,p);}if(!n)return null;const a=await h.getattr(n);if(Number(a.size)>67108864)throw Error('NSS export exceeds64MiB');const b=await h.read(n,{},0n,Number(a.size));let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()`);
  return encoded === null ? null : Buffer.from(encoded, 'base64');
}

async function consoleCommand(context, expression) {
  const { call, ev, key } = context;
  await ev("document.querySelector('#fb').focus()");
  await key('ControlLeft', 'Control', true, 2); await key('ShiftLeft', 'Shift', true, 10);
  await key('KeyJ', 'J', true, 10); await key('KeyJ', 'J', false, 10);
  await key('ShiftLeft', 'Shift', false, 2); await key('ControlLeft', 'Control', false);
  await sleep(2000);
  const symbols = { ' ': ['Space',32,false], '.': ['Period',190,false], ':': ['Semicolon',186,true], ';': ['Semicolon',186,false], ',': ['Comma',188,false], '/': ['Slash',191,false], '-': ['Minus',189,false], '"': ['Quote',222,true], '(': ['Digit9',57,true], ')': ['Digit0',48,true] };
  for (const c of expression) {
    const [code, value, shifted] = /[a-z]/i.test(c) ? ['Key'+c.toUpperCase(),c.toUpperCase().charCodeAt(0),/[A-Z]/.test(c)] : /[0-9]/.test(c) ? ['Digit'+c,c.charCodeAt(0),false] : symbols[c] || [];
    check(code, 'unsupported Browser Console key');
    if (shifted) await key('ShiftLeft','Shift',true,8);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:c,code,windowsVirtualKeyCode:value,nativeVirtualKeyCode:value,text:c,modifiers:shifted?8:0});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:c,code,windowsVirtualKeyCode:value,nativeVirtualKeyCode:value,modifiers:shifted?8:0});
    if (shifted) await key('ShiftLeft','Shift',false);
    await sleep(80);
  }
  await key('Enter','Enter',true); await key('Enter','Enter',false);
  // The driver starts with a delay, so close the console before it navigates
  // and requests a framebuffer capture of the actual Firefox page.
  await sleep(1000);
  await key('ControlLeft','Control',true,2); await key('ShiftLeft','Shift',true,10);
  await key('KeyJ','J',true,10); await key('KeyJ','J',false,10);
  await key('ShiftLeft','Shift',false,2); await key('ControlLeft','Control',false);
}

async function exportDatabases(context, previous, mode) {
  const { out, label, ev } = context, directory = out + '/' + label + '-stopped-profile';
  await fs.mkdir(directory);
  const exports = {};
  for (const name of dbFiles) for (const suffix of name.endsWith('.db') ? ['', '-wal', '-shm', '-journal'] : ['']) {
    const bytes = await homeBytes(ev, PROFILE + '/' + name + suffix);
    if (bytes !== null) { await fs.writeFile(directory + '/' + name + suffix, bytes, { mode: 0o600 }); exports[name + suffix] = { bytes: bytes.length, sha256: sha(bytes) }; }
  }
  const auditPath = out + '/' + label + '-sqlite.json';
  const args = [HERE + '/sqlite-audit.py', '--directory', directory, '--out', auditPath];
  if (previous) args.push('--before', previous, ...(mode === 'missing-cert' ? ['--missing-cert'] : mode === 'missing-module' ? ['--missing-module'] : []));
  execFileSync('python3', args, { timeout: 30000, maxBuffer: 1024 ** 2 });
  return { directory, exports, auditPath, audit: JSON.parse(await fs.readFile(auditPath, 'utf8')) };
}

export async function run(argv) {
  const { own, baseline } = parseOptions(argv);
  const taskIndex = baseline.indexOf('--task-root');
  const task = taskIndex === -1 ? TASK : baseline[taskIndex + 1];
  let report, fixtureProcess, fixtureExit, fixtureSpawnError, endpoints, fixture, fixtureHash, customRoot, firstDatabase, firstState;
  const extraPins = {}, pin = async (read, filename) => { const bytes = await read(filename); extraPins[filename] = sha(bytes); return bytes; };
  try {
    report = await runIsolatedNightlyGuest(baseline, {
      task, scope: 'nightly-nss-' + own.mode,
      preferences: 'user_pref("devtools.chrome.enabled",true);\nuser_pref("devtools.console.stdout.chrome",true);\n',
      selectCpus: selectNssHostCpus, saveBootEvidence: saveNssBootEvidence,
      async admit({ opt, out, full, read }) {
        const trustPath = path.resolve(own['trust-report']);
        const trustBytes = await pin(read, trustPath);
        check(sha(trustBytes) === own['trust-report-sha256'], 'reviewed trust report changed');
        trustChainContract(JSON.parse(trustBytes), full);
        const directory = await fs.realpath(own.fixtures);
        check(directory.startsWith(task + '/'), 'fixtures outside owned task');
        const fixtureBytes = await pin(read, directory + '/fixtures.json'); fixtureHash = sha(fixtureBytes);
        check(fixtureHash === own['fixtures-sha256'], 'reviewed fixture manifest changed'); fixture = JSON.parse(fixtureBytes);
        fixtureContract(fixture, fixtureHash);
        for (const [name, hash] of Object.entries(fixture.files)) {
          check(path.basename(name) === name && digest(hash), 'unsafe fixture manifest filename');
          check(sha(await pin(read, directory + '/' + name)) === hash, 'fixture file changed: ' + name);
        }
        const expectedPath = path.resolve(own.expected), expected = await pin(read, expectedPath);
        check(sha(expected) === own['expected-sha256'], 'reviewed expected inventory changed');
        for (const [name, hash] of Object.entries(JSON.parse(expected).sourceFiles)) check(sha(await pin(read, name)) === hash, 'selected source inventory file changed');
        for (const filename of [fileURLToPath(import.meta.url), HERE + '/browser-probe.sys.mjs', HERE + '/cpu-contract.mjs', HERE + '/proxy-overlay.mjs', HERE + '/serve.py', HERE + '/sqlite-audit.py']) await pin(read, filename);
        customRoot = execFileSync('openssl', ['x509','-in',directory+'/unknown-root.pem','-outform','DER'], { timeout:10000 }).toString('base64');
        // Startup happens only after shared full-build/package/asset admission.
        // A finite service and the wrapper's finally both bound socket lifetime.
        const endpointPath = out + '-fixture-endpoints.json';
        check(!(await fs.lstat(endpointPath).then(()=>true, error=>{if(error.code==='ENOENT')return false;throw error;})), 'stale fixture endpoint file');
        fixtureProcess = spawn('python3', [HERE+'/serve.py','--fixtures',directory,'--out',endpointPath,'--seconds','1800'], { stdio:['ignore','pipe','pipe'] });
        const output = [], errors = [];
        fixtureProcess.savedLogs = { output, errors, endpointPath };
        fixtureProcess.stdout.on('data', b => output.push(b)); fixtureProcess.stderr.on('data', b => errors.push(b));
        fixtureProcess.once('error', error => { fixtureSpawnError=String(error); });
        fixtureProcess.once('exit', (code,signal)=>{fixtureExit={code,signal};});
        const deadline = Date.now()+10000;
        for (;;) {
          check(!fixtureExit && !fixtureSpawnError, 'fixture service startup failed');
          try { endpoints=JSON.parse(await fs.readFile(endpointPath,'utf8')); break; } catch(error) { if(error.code!=='ENOENT')throw error; }
          check(Date.now()<deadline,'fixture endpoint deadline'); await sleep(100);
        }
        fixtureContract(fixture, fixtureHash, endpoints);
        // opt is used by shared admission; NSS options never bypass that parser.
        check(opt.out === out || path.resolve(opt.out) === out, 'output path changed');
      },
      serverOverlay: source => fixtureProxyOverlay(source, endpoints),
      async seed({ ev, out, report }) {
        await fs.writeFile(out + '/nss-inputs.json', JSON.stringify(extraPins,null,2)+'\n');
        await fs.writeFile(out + '/fixture-endpoints.json', JSON.stringify(endpoints,null,2)+'\n');
        await homePut(ev,'admin/nightly-nss/browser-probe.sys.mjs',await fs.readFile(HERE+'/browser-probe.sys.mjs'),true);
        await homePut(ev,'admin/nightly-nss/expected-inventory.json',await fs.readFile(own.expected),true);
        await homePut(ev,'admin/nightly-nss/fixtures.json',JSON.stringify(fixture),true);
        await homePut(ev,'admin/nightly-nss/endpoints.json',JSON.stringify(endpoints),true);
        await homePut(ev,PROFILE+'/nightly-nss-owned-profile',fixture.rootSHA256+'\n',true);
        const absent = await ev(`(async()=>{const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();let n=h.root;for(const p of ${JSON.stringify(PROFILE)}.split('/'))n=await h.lookup(n,p);const r={};for(const p of ${JSON.stringify(profileEvidenceFiles)})r[p]=Boolean(await h.lookup(n,p));await h.destroy();return r;})()`);
        report.prebootNssAbsence={absence:absent,seedDatabaseCopied:false};report.hostProfilePath=out+'/profile';
        await fs.writeFile(out+'/before-first-firefox-profile.json',JSON.stringify(report.prebootNssAbsence,null,2)+'\n');
        freshProfileContract(absent);
      },
      async phase(context) {
        const { label, out, full, ev, until, logs, shot, phaseReport } = context;
        check(!fixtureExit && !fixtureSpawnError, 'finite fixture service exited');
        const initial = label === 'cold' || label === 'baseline';
        const expectedVersion = label === 'baseline' ? own['baseline-firefox-version'] : full.identity.version;
        await until(async()=>/GPUCHECK |NIGHTLYBASELINE /.test(await logs()),420000,'Firefox UI ready for NSS console');
        const common = {fixturePath:GUEST+'/fixtures.json',endpointsPath:GUEST+'/endpoints.json',expectedPath:GUEST+'/expected-inventory.json',expectedVersion,screenshotAckPath:GUEST+'/screenshot-ack-'+label+'.json'};
        const inventoryOptions = {...common,outputPath:GUEST+'/'+label+'-tls.json',installFixtures:true,requireInventory:label!=='baseline'};
        const persistenceOptions = {...common,statePath:GUEST+'/saved-state.json',outputPath:GUEST+'/'+label+'-persistence.json',createState:initial,customRootBase64:customRoot};
        // Missing cert9 deliberately discards certificate records, while key4
        // and the saved ciphertext must continue working. Do not hide that loss.
        const missingCert = own.mode==='missing-cert' && label==='warm';
        const entry = guestEntry({inventoryOptions:initial ? inventoryOptions : {...inventoryOptions,installFixtures:false},persistenceOptions,missingCert,donePath:GUEST+'/'+label+'-done.json'});
        await fs.writeFile(out+'/'+label+'-entry.sys.mjs',entry);
        await homePut(ev,'admin/nightly-nss/entry-'+label+'.sys.mjs',entry);
        const screenshotNames = new Set();
        await consoleCommand(context, guestConsoleExpression(label));
        let done;
        await until(async()=>{
          check(!fixtureExit && !fixtureSpawnError,'fixture service ended during gate');
          for(const text of consolePayloads(await logs(),'NIGHTLYNSSVISIBLE ')) {
            const visible=JSON.parse(text), tag=label+'-'+visible.name;
            if(visible.screenshotAckPath!==common.screenshotAckPath)continue;
            if(screenshotNames.has(tag))continue;
            check(/^(?:persistent-)?(?:valid|wronghost|expired|untrusted|badchain)$/.test(visible.name),'unknown screenshot case');
            await shot(tag); const screenshotSHA256=sha(await fs.readFile(out+'/'+tag+'.png'));
            phaseReport.screenshots ||= []; phaseReport.screenshots.push({...visible,path:out+'/'+tag+'.png',screenshotSHA256});
            await homePut(ev,'admin/nightly-nss/screenshot-ack-'+label+'.json',JSON.stringify({name:visible.name,nonce:visible.nonce,screenshotSHA256}));
            screenshotNames.add(tag);
          }
          const bytes=await homeBytes(ev,'admin/nightly-nss/'+label+'-done.json');
          if(!bytes)return false; done=JSON.parse(bytes); return true;
        },900000,label+' actual guest NSS results');
        phaseReport.driver=done; check(done.pass===true,'actual NSS driver failed: '+JSON.stringify(done));
        await until(async()=>/firefox exited with status 0\b/.test(await logs()),60000,'graceful guest Firefox shutdown');
        for(const name of [label+'-tls.json',label+'-persistence.json','saved-state.json']) {
          const bytes=await homeBytes(ev,'admin/nightly-nss/'+name);
          if(bytes){await fs.writeFile(out+'/'+name,bytes,{mode:0o600});phaseReport[name]=JSON.parse(bytes);}
        }
        const result=phaseReport[label+'-persistence.json'];
        check(result?.version===expectedVersion && result.appBuildID === (label==='baseline'?result.appBuildID:full.identity.localBuildID),'privileged app identity mismatch');
        check(result.profile === '/home/'+PROFILE,'actual profile path differs');
        check(result.targetSDRRoundTrip===true,'actual target SDR evidence missing');
        if(!initial) check(JSON.stringify(result.saved)===JSON.stringify(firstState),'saved target SDR/trust state changed across restart');
        const db=await exportDatabases(context,firstDatabase,own.mode); phaseReport.stoppedDatabase=db;
        if(initial) {firstDatabase=db.auditPath;firstState=result.saved;}
        if(initial && ['missing-module','missing-cert'].includes(own.mode)) {
          const remove=own.mode==='missing-module'?'pkcs11.txt':'cert9.db';
          if(remove==='cert9.db') for(const suffix of ['-wal','-shm','-journal']) check(await homeBytes(ev,PROFILE+'/'+remove+suffix)===null,'cannot isolate missing cert9 with remaining database sidecar');
          const before=await homeBytes(ev,PROFILE+'/'+remove);check(before!==null,'partly missing file must first be NSS-created');
          await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const p of ${JSON.stringify(PROFILE)}.split('/'))n=await h.lookup(n,p);await h.unlink(n,${JSON.stringify(remove)});return true;})()`);
          check(await homeBytes(ev,PROFILE+'/'+remove)===null,'private missing-file injection failed');
          await fs.writeFile(out+'/partly-missing-before-restart.json',JSON.stringify({removed:remove,removedSHA256:sha(before),remaining:db.exports,seedCopied:false},null,2)+'\n');
        }
      },
      async finish({report,out,inputs}) {
        report.tlsFixtureDiagnosticPassed=true; report.tlsAcceptance=false; report.releaseAcceptance=false;
        report.nssRequiredPending=['Actual guest raw PKCS#11 inventory linked to final selected trust-anchor objects and loaded browser token','Current default-root/public HTTPS behavioral chains and distrust-after policy fixtures','Independent pixel review of retained Firefox framebuffer screenshots','Required cold/warm, update/warm, partly missing profiles and two fresh key states must all be reviewed together'];
        report.priorDownloadsPreserved=null; // Guest download preservation belongs to the separate baseline gate.
        report.nssMode=own.mode; report.fixtureManifestSHA256=fixtureHash; report.savedTargetState=firstState;
        if(own['compare-fresh']) {
          const previousPath=path.resolve(own['compare-fresh']);const bytes=await fs.readFile(previousPath);inputs[previousPath]=sha(bytes);
          const previous=JSON.parse(bytes);freshComparisonContract(previous,report,firstState);
          report.independentFreshKeys={previousReport:previousPath,previousReportSHA256:sha(bytes),differentLogicalKeyRecords:true,differentCiphertext:true};
        }
      },
    });
    return report;
  } finally {
    if(fixtureProcess) {
      if(!fixtureExit&&!fixtureSpawnError)fixtureProcess.kill('SIGTERM');
      const deadline=Date.now()+5000;while(!fixtureExit&&!fixtureSpawnError&&Date.now()<deadline)await sleep(100);
      let forced=false;if(!fixtureExit&&!fixtureSpawnError){fixtureProcess.kill('SIGKILL');forced=true;await sleep(1000);}
      const outIndex=baseline.indexOf('--out'),out=outIndex>=0?path.resolve(baseline[outIndex+1]):null;
      if(out) {
        const cleanup={pid:fixtureProcess.pid,exit:fixtureExit,spawnError:fixtureSpawnError,forced,ports:endpoints?.ports,closed:[]};
        for(const port of endpoints?.ports||[]) {
          try{await fetch('https://127.0.0.1:'+port+'/',{signal:AbortSignal.timeout(500)});cleanup.closed.push(false);}catch(error){cleanup.closed.push(String(error.cause?.code||'').includes('ECONNREFUSED'));}
        }
        cleanup.pass=cleanup.closed.every(Boolean)&&fixtureExit?.code===0&&!forced&&!fixtureSpawnError;
        if(report) report.fixtureServiceCleanup=cleanup;
        const exists=await fs.stat(out).then(s=>s.isDirectory(),()=>false),prefix=exists?out+'/':out+'-';
        await fs.writeFile(prefix+'fixture-service-cleanup.json',JSON.stringify(cleanup,null,2)+'\n');
        await fs.writeFile(prefix+'fixture-service-stdout.txt',Buffer.concat(fixtureProcess.savedLogs?.output||[]));
        await fs.writeFile(prefix+'fixture-service-stderr.txt',Buffer.concat(fixtureProcess.savedLogs?.errors||[]));
        if(exists) {
          const resultPath=out+'/result.json';
          const result=await fs.readFile(resultPath,'utf8').then(JSON.parse,()=>null);
          if(result){result.fixtureServiceCleanup=cleanup;if(!cleanup.pass){result.pass=false;result.fixtureServiceCleanupFailed=true;process.exitCode=1;}await fs.writeFile(resultPath,JSON.stringify(result,null,2)+'\n');}
        }
        check(cleanup.pass,'fixture service cleanup failed');
      }
    }
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--help')console.log('NSS guest diagnostic: shared baseline options plus --mode cold-warm|update-warm|missing-module|missing-cert --fixtures DIR --fixtures-sha256 SHA --expected FILE --expected-sha256 SHA --trust-report FILE --trust-report-sha256 SHA. Update also requires --baseline-firefox-version 128.14.0 and shared baseline pins. Optional --compare-fresh PRIOR_RESULT checks independent fresh key states. TMPDIR/TMP/TEMP must be disk-backed inside '+TASK+'. Real runs require build completion. All release/TLS acceptance remains false until independent gates pass.');
  else await run(process.argv.slice(2));
}
