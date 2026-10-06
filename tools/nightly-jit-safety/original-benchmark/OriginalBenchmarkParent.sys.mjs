import { acquireProcessDiagnostics,currentEnvironment } from './benchmark-diagnostics.sys.mjs';
import {sha256} from './original-hash.sys.mjs';
import {targetURL,FIXTURE_SHA256} from './original-content.sys.mjs';
Components.utils.importGlobalProperties(['IOUtils']);
const {setTimeout,clearTimeout}=ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const owned=new Map();
export function ownTarget(contract,main,tab,resolve) {if(owned.has(contract.documentURI)) throw Error('duplicate original owner');owned.set(contract.documentURI,{contract,main,tab,resolve});}
export function dropTarget(url){owned.delete(url);}
export async function readRaw(state){const bytes=await IOUtils.read(state.contract.base+'observer.stderr',{maxBytes:2097153});if(bytes.length>2097152||bytes.length&&bytes.at(-1)!==10) throw Error('complete bounded native log lines required');if(state.last&&(bytes.length<state.last.length||state.last.some((b,i)=>bytes[i]!==b))) throw Error('native stderr rotated or changed');state.last=bytes;return {bytes:bytes.length,sha256:sha256(bytes)};}
function diagnosticOn(row){return row.boundedComplete===true&&row.startup.PBLJIT_OBSERVE.exists&&row.startup.PBLJIT_OBSERVE.value==='1'&&row.startup.PBLJIT_LOG.exists&&row.startup.PBLJIT_LOG.value==='0'&&(!row.startup.PBLJIT.exists||row.startup.PBLJIT.value==='1')&&row.commandLine.diagnosticArguments.length===0;}
export class OriginalBenchmarkParent extends JSWindowActorParent {
 async receiveMessage(message) {
  const g=this.manager,url=g.documentURI.spec,state=owned.get(url);
  if(!state||targetURL(state.contract.label)!==url||state.tab.linkedBrowser.browsingContext.currentWindowGlobal!==g||!g.isCurrentGlobal||g.isClosed) throw Error('exact owned current original target required');
  const c=state.contract,alive=()=>g.isCurrentGlobal&&!g.isClosed&&state.tab.linkedBrowser.browsingContext.currentWindowGlobal===g;
  if(message.name==='OriginalBenchmark:Contract') return {sourceBodies:c.sourceBodies};
  if(message.name==='OriginalBenchmark:Boundary') {
   const {phase,index}=message.data,expected=[['before',0],['after',0],['before',5],['after',5],['before',6],['after',6]][state.boundaryCount||0];
   if(!expected||phase!==expected[0]||index!==expected[1]) throw Error('duplicate/reordered original raw boundary');
   state.boundaryCount=(state.boundaryCount||0)+1;return readRaw(state);
  }
  if(message.name!=='OriginalBenchmark:Recorded'||state.recorded) throw Error('unknown/duplicate original response');state.recorded=true;
  const p=message.data;
  try {
   const pid=Services.appinfo.processID;
   const match=p.processType===0?g.isInProcess===true&&g.osPid===-1&&g.childActor?.innerWindowId===g.innerWindowId&&pid===p.processID:p.processType===2&&g.isInProcess===false&&g.osPid===p.processID;
   if(p.status!=='recorded'||p.label!==c.label||p.documentURI!==url||p.windowId!==String(g.innerWindowId)||!match||state.boundaryCount!==6||p.buildID!==c.buildID||p.platformBuildID!==c.buildID||p.portableBaselineOption!==c.option||p.contentHardwareConcurrency!==c.cpus) throw Error('original child identity/semantic acquisition failed');
   const parent=await acquireProcessDiagnostics(pid,currentEnvironment(Services),IOUtils,sha256),target=await acquireProcessDiagnostics(p.processID,p.diagnosticEnvironment,IOUtils,sha256);
   if(!diagnosticOn(parent)||!diagnosticOn(target)||!alive()) throw Error('actual observer-on startup/current identity required');
   p.processDiagnostics={parent,target};p.parentObservedProcessID=pid;p.parentObservedOSPid=g.osPid;p.parentObservedInProcess=g.isInProcess;
   p.fixtureSHA256=FIXTURE_SHA256;p.targetAgeBeforeCloseMs=Date.now()-p.targetTimeOrigin;
   if(!Number.isFinite(p.targetAgeBeforeCloseMs)||p.targetAgeBeforeCloseMs<p.targetPerformanceAfterMs||p.targetAgeBeforeCloseMs>=15000) throw Error('actual original target close deadline missed');
   // Closing an owned dedicated tab destroys its document; the original timer
   // remains untouched. Natural current WindowGlobal destruction is mandatory.
   state.main.gBrowser.removeTab(state.tab,{animate:false,skipPermitUnload:true});
   const deadline=Date.now()+1000;
   while(!g.isClosed&&Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
   p.targetAgeClosedMs=Date.now()-p.targetTimeOrigin;p.exactTabRemoved=!state.main.gBrowser.tabs.includes(state.tab);p.exactWindowGlobalClosed=g.isClosed===true;p.currentGlobalGone=state.tab.linkedBrowser?.browsingContext?.currentWindowGlobal!==g;
   if(!p.exactTabRemoved||!p.exactWindowGlobalClosed||!p.currentGlobalGone||p.targetAgeClosedMs>=15000) throw Error('original document not destroyed before timed callback deadline');
   p.afterCloseRaw=await readRaw(state);await IOUtils.write(c.base+'observer-after-close.bin',state.last);p.acquiredBeforeTimedStart=true;
  } catch(error){p.status='failed';p.error=String(error);}
  await IOUtils.writeJSON(c.base+'acquisition.json',p);console.log('PBLORIGINAL '+JSON.stringify(p));state.resolve(p);
 }
}
