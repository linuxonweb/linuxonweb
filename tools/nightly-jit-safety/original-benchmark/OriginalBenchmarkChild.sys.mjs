import { acquire } from './original-content.sys.mjs';
import {sourceBodies} from './original-source.sys.mjs';
export class OriginalBenchmarkChild extends JSWindowActorChild {
 async handleEvent(event) {
  if(this.started) throw Error('duplicate original acquisition');this.started=true;
  let packet;
  try {
   packet=await acquire(this.contentWindow,event,{Cu:Components.utils,Services,sourceBodies,boundary:(phase,index)=>this.sendQuery('OriginalBenchmark:Boundary',{phase,index})});
  } catch(error) {packet={kind:'actual-original-body-acquisition-v1',status:'failed',error:String(error),documentURI:this.contentWindow.document.documentURI};}
  this.sendAsyncMessage('OriginalBenchmark:Recorded',packet);
 }
}
