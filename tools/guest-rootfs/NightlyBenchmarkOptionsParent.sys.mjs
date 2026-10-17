import { acquireProcessDiagnostics, currentEnvironment } from './benchmark-diagnostics.sys.mjs';
Components.utils.importGlobalProperties(['IOUtils', 'TextDecoder']);
if (typeof Services === 'undefined') throw new Error('Built-in Services global unavailable');
function sha256(bytes) {
  const hash = Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
  hash.init(hash.SHA256); hash.update(bytes,bytes.length);
  return Array.from(hash.finish(false),char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
}
let pending = null;
export function registerCompletion(label, browser) {
  if (pending || !/^[ab]-[1-6]$/.test(label)) throw Error('one owned benchmark completion required');
  let resolve, reject;
  const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  pending = {label,browser,resolve,reject,promise,actor:null};
  return {promise,cancel(error) { if (pending?.promise === promise) rejectCompletion(error); }};
}
function rejectCompletion(error) {
  const owner=pending;pending=null;
  console.log('PBLCONTENTFAIL '+JSON.stringify({status:'failed',error:String(error)}));
  owner?.reject(error instanceof Error ? error : new Error(String(error)));
}
function owned(actor) {
  return pending && pending.browser === Services.wm.getMostRecentWindow('navigator:browser')?.gBrowser?.selectedBrowser &&
    pending.browser.browsingContext === actor.browsingContext && actor.browsingContext.currentWindowGlobal === actor.manager &&
    actor.manager.isCurrentGlobal && !actor.manager.isClosed;
}
export class NightlyBenchmarkOptionsParent extends JSWindowActorParent {
  async receiveMessage(message) {
    try {
      if (!owned(this)) throw Error('unowned or stale benchmark actor');
      if (message.name === 'NightlyBenchmarkOptions:Failed') throw Error(message.data.error);
      if (message.name === 'NightlyBenchmarkOptions:Complete') {
        if (pending.actor !== this || !this.identity || this.completion) throw Error('unbound or duplicate completion');
        const packet=message.data;
        for (const key of ['label','documentURI','windowId','processID','processType'])
          if (packet[key] !== this.identity[key]) throw Error('completion identity mismatch: '+key);
        if (typeof packet.text !== 'string' || packet.text.length > 2097152) throw Error('completion text bound');
        this.completion=packet.text;this.finish();return;
      }
      if (message.name !== 'NightlyBenchmarkOptions:Recorded') throw Error('unknown benchmark option message');
    const packet = message.data, global = this.manager;
    if (this.recorded) throw Error('duplicate benchmark identity response');
    this.recorded = true;
    if (pending.actor || pending.label !== packet.label) throw Error('foreign benchmark identity');
    pending.actor=this;this.identity=packet;
    const parentPID = Services.appinfo.processID;
    const processMatches = packet.processType === 0 ? global.isInProcess === true && global.osPid === -1 &&
      global.childActor?.innerWindowId === global.innerWindowId && parentPID === packet.processID :
      packet.processType === 2 && global.isInProcess === false && global.osPid === packet.processID;
    if (packet.status !== 'recorded' || !/^[ab]-[1-6]$/.test(packet.label || '') ||
        packet.documentURI !== 'file:///home/admin/pblbench/pblbench-' + packet.label + '.html' ||
        global.documentURI?.spec !== packet.documentURI || !global.isCurrentGlobal || global.isClosed ||
        this.browsingContext.currentWindowGlobal !== global || String(global.innerWindowId) !== packet.windowId ||
        !processMatches) {
      throw Error('actual current parent/child target identity mismatch');
    }
    try {
      const parent = await acquireProcessDiagnostics(parentPID,currentEnvironment(Services),IOUtils,sha256);
      const target = await acquireProcessDiagnostics(packet.processID,packet.diagnosticEnvironment,IOUtils,sha256);
      const targetAgeMs = Date.now()-packet.targetTimeOrigin;
      if (!parent.primaryDiagnosticsOff || !target.primaryDiagnosticsOff || !Number.isFinite(targetAgeMs) ||
          targetAgeMs < packet.targetPerformanceAfterMs || targetAgeMs >= 15000 ||
          !global.isCurrentGlobal || global.isClosed || this.browsingContext.currentWindowGlobal !== global) throw Error('diagnostics unavailable/on, acquisition late, or target changed');
      packet.primaryDiagnostics = { parent, target, acquiredBeforeTimedStart:true, targetAgeMs };
    } catch (error) {
      throw error;
    }
    packet.parentObservedOSPid = global.osPid;
    packet.parentObservedProcessID = parentPID;
    packet.parentObservedInProcess = global.isInProcess;
    packet.parentWindowIdMatches = true;
    packet.parentProcessIDMatches = true;
    packet.parentCurrentGlobalMatches = true;
    const transcript = { kind:'actual-firefox-benchmark-content-bridge-transcript-v1', request:{
      event:'DOMContentLoaded', documentURI:packet.documentURI, actorName:'NightlyBenchmarkOptions',
      windowId:packet.windowId, processID:packet.processID }, response:packet };
    // A single finite owned artifact; primary host packet is this retained log.
    await IOUtils.writeJSON('/home/admin/pblbench/bridge-' + packet.label + '.json', transcript);
    if (!owned(this) || pending.actor !== this) throw Error('target changed during identity persistence');
    console.log('PBLCONTENTIDENTITY ' + JSON.stringify(packet));
    this.identityPersisted=true;this.finish();
    } catch(error) { rejectCompletion(error); }
  }
  finish() {
    if (!this.identityPersisted || !this.completion) return;
    if (!owned(this) || pending.actor !== this || String(this.manager.innerWindowId) !== this.identity.windowId ||
        this.manager.documentURI?.spec !== this.identity.documentURI) throw Error('completion lost original target');
    const lines=this.completion.split('\n');
    if (lines.shift() !== 'Settling' || lines.length !== 26 || lines.some(line=>!line.startsWith('PBLBENCH '))) throw Error('original completion needs exactly26lines');
    const packets=lines.map(line=>JSON.parse(line.slice(9)));
    if (packets.some(packet=>packet.label !== pending.label) || packets[0].event !== 'start' ||
        packets[25].event !== 'done' || packets[25].ok !== true || packets.slice(1,25).some(packet=>packet.event !== 'case')) throw Error('original completion sequence failed');
    const owner=pending;pending=null;
    owner.resolve({packets,originalDOMText:this.completion});
  }
  didDestroy() {
    if (pending && (pending.actor === this || pending.browser.browsingContext === this.browsingContext)) rejectCompletion(Error('owned benchmark actor destroyed before completion'));
  }
}
