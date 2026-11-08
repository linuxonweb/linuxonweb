// Actual guest Browser Console entry. The reviewed outer supervisor owns Firefox,
// CPU/memory sampling, the 150-second deadline, terminal capture, and reaping.
import {plan} from './plan.sys.mjs';
import {ownTarget, dropTarget} from './NestedLoopParent.sys.mjs';
const {setTimeout,clearTimeout} = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
export async function run() {
  if (!plan.buildIdentityBound || plan.buildBinding?.pass !== true) throw Error('native probe requires reviewed final build binding');
  const main = Services.wm.getMostRecentWindow('navigator:browser');
  if (!main?.gBrowser) throw Error('actual guest Firefox browser required');
  const name = 'PblNestedLoopProbe', topic = 'pbl-nested-probe:' + plan.label;
  let ownedTab, timer, observer, registered = false;
  try {
    const pending = new Promise((resolve,reject) => {
      observer = {observe(subject,observedTopic,data) { if(observedTopic === topic) { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } } }};
      Services.obs.addObserver(observer,topic);
      timer = setTimeout(()=>reject(Error('nested query deadline; outer supervisor must drain owned processes')),plan.queryDeadlineMs);
    });
    ChromeUtils.registerWindowActor(name,{parent:{esModuleURI:import.meta.url.replace(/[^/]+$/,'NestedLoopParent.sys.mjs')},
      child:{esModuleURI:import.meta.url.replace(/[^/]+$/,'NestedLoopChild.sys.mjs'),events:{DOMContentLoaded:{capture:true,createActor:true}}},matches:[plan.documentURI],allFrames:false});
    registered = true;
    ownedTab = main.gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
    ownTarget(main,ownedTab);
    ownedTab.linkedBrowser.loadURI(Services.io.newURI(plan.documentURI),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
    const result = await pending;
    const global = ownedTab.linkedBrowser.browsingContext.currentWindowGlobal;
    if (global.documentURI.spec !== plan.documentURI || String(global.innerWindowId) !== result.windowId) throw Error('owned WindowGlobal replaced');
    return {...result,kind:'nested-loop-guest-entry-result-v1',runtimeAcceptance:false,fullJITAcceptance:false};
  } finally {
    dropTarget(ownedTab);
    if (timer) clearTimeout(timer);
    if (observer) Services.obs.removeObserver(observer,topic);
    if (ownedTab && main.gBrowser.tabs.includes(ownedTab)) main.gBrowser.removeTab(ownedTab,{animate:false,skipPermitUnload:true});
    if (registered) ChromeUtils.unregisterWindowActor(name);
  }
}
