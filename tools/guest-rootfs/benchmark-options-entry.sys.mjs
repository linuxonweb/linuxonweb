import { targetURL } from './benchmark-content-options.sys.mjs';
const { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
export function install(label) {
  const url = targetURL(label), main = Services.wm.getMostRecentWindow('navigator:browser');
  if (!main?.gBrowser || main.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal?.documentURI.spec === url) throw Error('bridge must register before actual target navigation');
  ChromeUtils.registerWindowActor('NightlyBenchmarkOptions', {
    child:{ esModuleURI:'file:///home/admin/pblbench/NightlyBenchmarkOptionsChild.sys.mjs', events:{ DOMContentLoaded:{ capture:true, createActor:true } } },
    parent:{ esModuleURI:'file:///home/admin/pblbench/NightlyBenchmarkOptionsParent.sys.mjs' }, matches:[url], allFrames:false,
  });
  console.log('PBLCONTENTBRIDGEREADY ' + JSON.stringify({ label, documentURI:url, registeredBeforeNavigation:true }));
}
