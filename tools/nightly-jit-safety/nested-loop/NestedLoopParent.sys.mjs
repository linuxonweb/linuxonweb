import {plan} from './plan.sys.mjs';
Components.utils.importGlobalProperties(['IOUtils']);
let owned;
export function ownTarget(main,tab) {
  if (owned || !main?.gBrowser?.tabs.includes(tab)) throw Error('fresh owned tab required');
  owned = {main,tab};
}
export function dropTarget(tab) { if (owned?.tab === tab) owned = undefined; }
export class PblNestedLoopProbeParent extends JSWindowActorParent {
  async receiveMessage(message) {
    const g = this.manager, state = owned;
    const alive = () => state && owned === state && state.main.gBrowser.tabs.includes(state.tab) &&
      state.tab.linkedBrowser.browsingContext.currentWindowGlobal === g && g.isCurrentGlobal && !g.isClosed;
    if (!alive() || g.documentURI.spec !== plan.documentURI || !/^[A-Za-z0-9_-]{1,64}$/.test(plan.label)) throw Error('unowned actor target');
    const guard = () => { if (!alive()) throw Error('owned target replaced during capture'); };
    const base = `/home/admin/nightly-jit-safety/${plan.label}/`;
    if (message.name === 'NestedLoop:Boundary') {
      const phase = message.data.phase;
      if (phase !== (this.boundaryState ? 'after' : 'before') || this.boundaryState === 'reading' || this.completed) throw Error('out-of-order native boundary');
      this.boundaryState = 'reading'; // Reserve before awaiting parent-only IO.
      const env = Cc['@mozilla.org/process/environment;1'].getService(Ci.nsIEnvironment);
      const observerEnabled = env.get('PBLJIT_OBSERVE'), logBudget = env.get('PBLJIT_LOG');
      if (observerEnabled !== '1' || logBudget !== '0') throw Error('reviewed capture environment differs');
      const bytes = await IOUtils.read(base + 'observer.stderr',{maxBytes:plan.observerLogCapBytes + 1}); guard();
      if (bytes.length >= plan.observerLogCapBytes || (bytes.length && bytes[bytes.length-1] !== 10)) throw Error('native boundary is incomplete or capped');
      if (this.beforeBytes && (bytes.length < this.beforeBytes.length || this.beforeBytes.some((b,i)=>bytes[i] !== b))) throw Error('native capture changed/rotated');
      await IOUtils.write(base + `observer.${phase}.stderr`,bytes); guard();
      if (phase === 'before') this.beforeBytes = bytes; else this.completed = true;
      this.boundaryState = phase;
      return {phase,bytes:bytes.length,file:`observer.${phase}.stderr`,observerEnabled,logBudget};
    }
    if (message.name === 'NestedLoop:Recorded') {
      const packet = message.data.packet;
      if (this.recorded || packet?.kind !== 'actual-firefox-nested-loop-result-v1' || packet.label !== plan.label || !['recorded','failed'].includes(packet.status) || JSON.stringify(packet).length > 65536 || (packet.status === 'recorded' && !this.completed)) throw Error('invalid nested result packet');
      this.recorded = true;
      if (packet.status === 'recorded') {
        const pid = Services.appinfo.processID;
        const match = packet.processType === 0
          ? g.isInProcess === true && g.osPid === -1 && g.childActor?.innerWindowId === g.innerWindowId && pid === packet.processID
          : packet.processType === 2 && g.isInProcess === false && g.osPid === packet.processID;
        if (!match || packet.windowId !== String(g.innerWindowId) || packet.documentURI !== plan.documentURI || packet.sourceURI !== plan.sourceURI) throw Error('parent-observed process/window differs');
        packet.parentObservedProcessID = pid;
        packet.parentObservedOSPid = g.osPid;
        packet.parentObservedInProcess = g.isInProcess;
      }
      await IOUtils.writeJSON(base + 'result.json',packet); guard();
      Services.obs.notifyObservers(null,'pbl-nested-probe:' + plan.label,JSON.stringify({status:packet.status,windowId:String(g.innerWindowId)}));
      return {recorded:true};
    }
    throw Error('unrecognized nested actor message');
  }
}
