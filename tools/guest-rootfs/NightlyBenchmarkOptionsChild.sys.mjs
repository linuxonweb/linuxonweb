import { acquire } from './benchmark-content-options.sys.mjs';
if (typeof Services === 'undefined') throw new Error('Built-in Services global unavailable');
export class NightlyBenchmarkOptionsChild extends JSWindowActorChild {
  handleEvent(event) {
    if (this.recorded) throw Error('duplicate benchmark identity acquisition');
    this.recorded = true;
    let packet;
    try {
      packet = acquire(this.contentWindow, event, { Cu:Components.utils, Services });
      const window = this.contentWindow, document = window.document;
      const output = document.getElementById('result');
      if (!output || output.ownerDocument !== document) throw Error('original result element missing');
      const inspect = () => {
        try {
          // Original emit() replaces this text after a case, outside batch timing.
          // Do no packet parsing or IPC until the terminal suffix appears.
          const tail = output.lastChild?.textContent?.slice(-512) || '';
          if (!/\nPBLBENCH \{"event":"(?:done|error)",/.test(tail)) return;
          this.observer.disconnect(); this.observer = null;
          if (this.contentWindow !== window || window.document !== document ||
              document.documentURI !== packet.documentURI || !window.windowGlobalChild.isCurrentGlobal ||
              window.windowGlobalChild.isClosed || String(window.windowGlobalChild.innerWindowId) !== packet.windowId ||
              document.getElementById('result') !== output) throw Error('completion target changed');
          const text = output.textContent;
          if (text.length > 2097152) throw Error('completion output exceeds bound');
          this.sendAsyncMessage('NightlyBenchmarkOptions:Complete', {
            label:packet.label,documentURI:packet.documentURI,windowId:packet.windowId,
            processID:packet.processID,processType:packet.processType,text });
        } catch(error) { this.fail(error); }
      };
      this.observer = new window.MutationObserver(inspect);
      this.observer.observe(output,{childList:true,characterData:true,subtree:true});
    } catch(error) {
      packet = {kind:'actual-firefox-benchmark-content-options-v1',status:'failed',error:String(error),documentURI:this.contentWindow.document.documentURI};
      this.observer?.disconnect();this.observer=null;
    }
    this.sendAsyncMessage('NightlyBenchmarkOptions:Recorded', packet);
  }
  fail(error) {
    this.observer?.disconnect();this.observer=null;
    this.sendAsyncMessage('NightlyBenchmarkOptions:Failed',{error:String(error)});
  }
  didDestroy() { this.observer?.disconnect();this.observer=null; }
}
