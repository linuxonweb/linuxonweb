import {ownTarget,dropTarget} from './OriginalBenchmarkParent.sys.mjs';
import {targetURL,FIXTURE_SHA256} from './original-content.sys.mjs';
import {sha256} from './original-hash.sys.mjs';
Components.utils.importGlobalProperties(['IOUtils']);
const {setTimeout,clearTimeout}=ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
// Caller supplies the reviewed actual build contract. Never infer acceptance
// from requested option/environment. This module does not start/quit Firefox.
export async function run(label){
 const url=targetURL(label),base=url.slice(7,url.lastIndexOf('/')+1),c=await IOUtils.readJSON(base+'contract.json');
 if(c.kind!=='original-body-diagnostic-contract-v1'||c.label!==label||c.base!==base||c.documentURI!==url||c.fixtureSHA256!==FIXTURE_SHA256||![0,1].includes(c.option)||!Number.isSafeInteger(c.cpus)||c.cpus<1||!/^\d{14}$/.test(c.buildID)) throw Error('reviewed original build contract required');
 const fixture=await IOUtils.read(base+'pblbench-'+label+'.html',{maxBytes:3176});
 if(fixture.length!==3175||sha256(fixture)!==FIXTURE_SHA256) throw Error('actual byte-identical original fixture required');
 const main=Services.wm.getMostRecentWindow('navigator:browser');if(!main?.gBrowser) throw Error('actual browser window required');
 const actor='OriginalBenchmark';let tab,timer,registered=false;
 const result=new Promise(resolve=>{c.resolve=resolve;});
 try {
  ChromeUtils.registerWindowActor(actor,{child:{esModuleURI:import.meta.url.replace(/[^/]+$/, 'OriginalBenchmarkChild.sys.mjs'),events:{DOMContentLoaded:{capture:true,createActor:true}}},parent:{esModuleURI:import.meta.url.replace(/[^/]+$/, 'OriginalBenchmarkParent.sys.mjs')},matches:[url],allFrames:false});registered=true;
  tab=main.gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
  ownTarget(c,main,tab,c.resolve);
  tab.linkedBrowser.loadURI(Services.io.newURI(url),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
  const p=await Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('original diagnostic acquisition deadline; failure')),12000);})]);
  if(p.status!=='recorded') throw Error('original diagnostic failed: '+p.error);
  return p;
 }catch(error){await IOUtils.writeJSON(base+'entry-failure.json',{status:'failed',error:String(error),runtimeAcceptance:false});throw error;}
 finally {clearTimeout(timer);if(tab&&main.gBrowser.tabs.includes(tab)) main.gBrowser.removeTab(tab,{animate:false,skipPermitUnload:true});dropTarget(url);if(registered) ChromeUtils.unregisterWindowActor(actor);}
}
