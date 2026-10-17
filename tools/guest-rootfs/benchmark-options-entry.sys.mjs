import { registerCompletion } from './NightlyBenchmarkOptionsParent.sys.mjs';
import { targetURL } from './benchmark-content-options.sys.mjs';
if (typeof Services === 'undefined') throw new Error('Built-in Services global unavailable');
export function install(label) {
  const url = targetURL(label), main = Services.wm.getMostRecentWindow('navigator:browser');
  if (!main?.gBrowser || main.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal?.documentURI.spec === url) throw Error('bridge must register before actual target navigation');
  const completion=registerCompletion(label,main.gBrowser.selectedBrowser);
  ChromeUtils.registerWindowActor('NightlyBenchmarkOptions', {
    child:{ esModuleURI:import.meta.url.replace(/[^/]+$/, 'NightlyBenchmarkOptionsChild.sys.mjs'), events:{ DOMContentLoaded:{ capture:true, createActor:true } } },
    parent:{ esModuleURI:import.meta.url.replace(/[^/]+$/, 'NightlyBenchmarkOptionsParent.sys.mjs') }, matches:[url], allFrames:false,
  });
  console.log('PBLCONTENTBRIDGEREADY ' + JSON.stringify({ label, documentURI:url, registeredBeforeNavigation:true }));
  return completion;
}
