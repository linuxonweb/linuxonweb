import { acquire } from './benchmark-content-options.sys.mjs';
const { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
export class NightlyBenchmarkOptionsChild extends JSWindowActorChild {
  handleEvent(event) {
    // allFrames:false plus exact URI matches, and original trusted DOM event.
    if (this.recorded) throw Error('duplicate benchmark identity acquisition');
    this.recorded = true;
    let packet;
    try { packet = acquire(this.contentWindow, event, { Cu:Components.utils, Services }); }
    catch (error) { packet = { kind:'actual-firefox-benchmark-content-options-v1', status:'failed', error:String(error), documentURI:this.contentWindow.document.documentURI }; }
    this.sendAsyncMessage('NightlyBenchmarkOptions:Recorded', packet);
  }
}
