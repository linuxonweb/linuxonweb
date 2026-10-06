import { acquireProcessDiagnostics, currentEnvironment } from './benchmark-diagnostics.sys.mjs';
Components.utils.importGlobalProperties(['IOUtils', 'TextDecoder']);
const { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
function sha256(bytes) {
  const hash = Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
  hash.init(hash.SHA256); hash.update(bytes,bytes.length);
  return Array.from(hash.finish(false),char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
}
export class NightlyBenchmarkOptionsParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name !== 'NightlyBenchmarkOptions:Recorded') throw Error('unknown benchmark option message');
    const packet = message.data, global = this.manager;
    if (this.recorded) throw Error('duplicate benchmark identity response');
    this.recorded = true;
    const parentPID = Services.appinfo.processID;
    const processMatches = packet.processType === 0 ? global.isInProcess === true && global.osPid === -1 &&
      global.childActor?.innerWindowId === global.innerWindowId && parentPID === packet.processID :
      packet.processType === 2 && global.isInProcess === false && global.osPid === packet.processID;
    if (packet.status !== 'recorded' || !/^[ab]-[1-6]$/.test(packet.label || '') ||
        packet.documentURI !== 'file:///home/admin/pblbench/pblbench-' + packet.label + '.html' ||
        global.documentURI?.spec !== packet.documentURI || !global.isCurrentGlobal || global.isClosed ||
        this.browsingContext.currentWindowGlobal !== global || String(global.innerWindowId) !== packet.windowId ||
        !processMatches) {
      console.log('PBLCONTENTFAIL ' + JSON.stringify({ status:'failed', error:'actual current parent/child target identity mismatch', child:packet }));
      return;
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
      console.log('PBLCONTENTFAIL ' + JSON.stringify({ status:'failed', error:String(error) }));
      return;
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
    console.log('PBLCONTENTIDENTITY ' + JSON.stringify(packet));
  }
}
