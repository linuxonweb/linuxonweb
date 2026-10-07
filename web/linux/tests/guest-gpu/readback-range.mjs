// Private range telemetry only: actual bytes; no runtime GPU acceptance.
export const COLOR_RANGE_LIMITS = Object.freeze({ dimension:512,totalBytes:1048576,fragmentBytes:65516,payloadBytes:65536,replyWorkingBytes:131084,traceEntries:64,traceWorkingBytes:65536 });
export const SAMPLED_RANGE_TRACE_LIMITS=Object.freeze({traceEntries:256,traceWorkingBytes:262144});
const bad = message => { throw Object.assign(new Error(message),{status:-22}); };
const u32=(v,label)=>{if(!Number.isSafeInteger(v)||v<0||v>0xffffffff)bad(label);return v;};
// Adler32 telemetry is observational, not cryptographic or pixel acceptance.
export function rangeChecksum(bytes,initial=1){let a=initial&65535,b=initial>>>16;for(const byte of bytes){a=(a+byte)%65521;b=(b+a)%65521;}return ((b<<16)|a)>>>0;}
export function colorReadbackBudget(allocation,staging,total,traceCapacity=64) {
  if(![64,256].includes(traceCapacity))return false;
  if([allocation,staging,total].some(v=>!Number.isSafeInteger(v)||v<0)||allocation>16*1024*1024||!total||total>COLOR_RANGE_LIMITS.totalBytes||staging>COLOR_RANGE_LIMITS.totalBytes)return false;
  // Logical GPU + staging + captured/copy snapshot + reply/frame working bytes
  // + bounded telemetry (including serialized/clone working allowance). General
  // JS/Wasm heaps remain separately bounded by the runtime owner.
  return allocation+staging+2*total+COLOR_RANGE_LIMITS.replyWorkingBytes+(traceCapacity===64?COLOR_RANGE_LIMITS.traceWorkingBytes:SAMPLED_RANGE_TRACE_LIMITS.traceWorkingBytes)<=16*1024*1024;
}
export class ColorReadbackRanges {
  #snapshot=null; #serial=0; #fragments=0; #snapshots=0; #epoch=0; #trace=[]; #exhausted=false; #traceCapacity;
  constructor({traceCapacity=64}={}){if(![64,256].includes(traceCapacity))bad('explicit bounded trace capacity');this.#traceCapacity=traceCapacity;}
  get active(){return this.#snapshot!==null;}
  stats(){return {snapshotBytes:this.#snapshot?.pixels.length??0,snapshots:this.#snapshots,fragments:this.#fragments,traceVersion:1,checksumAlgorithm:'adler32',traceCapacity:this.#traceCapacity,traceExhausted:this.#exhausted,trace:this.#trace.map(row=>({...row}))};}
  close(){this.#snapshot=null;this.#epoch++;}
  async read({id,total,offset,count,token},capture){
    for(const [key,v] of Object.entries({id,total,offset,count,token}))u32(v,key);
    if(!id||!total||total>COLOR_RANGE_LIMITS.totalBytes||total%4||!count||count>COLOR_RANGE_LIMITS.fragmentBytes||count%4||offset%4||offset>total||count>total-offset)bad('colour readback bounds');
    let s=this.#snapshot;
    if(!s){if(offset!==0||token!==0||this.#serial===0xffffffff)bad('new snapshot must begin at zero');}
    else if(id!==s.id||total!==s.total||offset!==s.next||token!==s.token)bad('foreign, stale or unordered snapshot');
    // Fail before capture/allocation/progress, preserving prior successful trace.
    // Telemetry is a rolling window: dropping the oldest row must never fail an actual readback.
    if(this.#trace.length>=this.#traceCapacity){this.#exhausted=true;this.#trace.shift();}
    if(!s){
      const epoch=this.#epoch,pixels=await capture();
      if(epoch!==this.#epoch)bad('snapshot cancelled during actual readback');
      if(!(pixels instanceof Uint8Array)||pixels.length!==total)bad('actual readback byte count');
      s={id,total,next:0,token:++this.#serial,pixels:pixels.slice(),snapshotChecksum:rangeChecksum(pixels),rollingChecksum:1};this.#snapshot=s;this.#snapshots++;
    }
    const reply=new Uint8Array(16+count),v=new DataView(reply.buffer);
    [id,offset,total,s.token].forEach((n,i)=>v.setUint32(i*4,n,true));
    reply.set(s.pixels.subarray(offset,offset+count),16);
    const rolling=rangeChecksum(reply.subarray(16),s.rollingChecksum),completed=offset+count===total;
    const entry={sequence:this.#fragments,id,offset,count,total,requestToken:token,replyId:v.getUint32(0,true),replyOffset:v.getUint32(4,true),replyTotal:v.getUint32(8,true),replyToken:v.getUint32(12,true),replyBytes:reply.length,snapshotChecksum:s.snapshotChecksum,fragmentChecksum:rangeChecksum(reply.subarray(16)),rollingChecksum:rolling,completed};
    this.#trace.push(entry);s.rollingChecksum=rolling;s.next+=count;this.#fragments++;
    if(completed)this.close();
    return reply;
  }
}
