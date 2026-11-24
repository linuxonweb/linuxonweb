import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [native, fpcast, output] = process.argv.slice(2);
const profiles = [
 {ino:0x100000007n,size:0x200000011n,blocks:0x10000002fn,sec:2208988801n,ns:123456789,major:4095,minor:1048575},
 {ino:0x7fffffffffffff03n,size:0x400000001n,blocks:0x20000000fn,sec:-2208988801n,ns:987654321,major:0,minor:0},
];
let checks=0;
function equal(a,b,msg){assert.equal(a,b,msg);checks++;}
function canaries(view,p){
 for(let i=0;i<16;i++){equal(view.getUint8(p-16+i),0xe3,'leading canary');equal(view.getUint8(p+128+i),0x7d,'trailing canary');}
}
function device(major,minor){return (BigInt(major&4095)<<8n)|(BigInt(major>>>12)<<44n)|BigInt(minor&255)|(BigInt(minor>>>8)<<20n);}
const results=[];
for (const file of [native,fpcast]) {
 const bytes=fs.readFileSync(file),module=await WebAssembly.compile(bytes);
 equal(JSON.stringify(WebAssembly.Module.imports(module)),JSON.stringify([{module:'linux',name:'syscall',kind:'function'}]),'only actual Linux import');
 let memory,current,calls=[],failure=0;
 const instance=await WebAssembly.instantiate(module,{linux:{syscall(n,fd,path,flags,mask,tmp,z){
  calls.push({n,fd,flags,mask,z,path});
  if(failure)return -failure;
  const v=new DataView(memory.buffer);new Uint8Array(memory.buffer,tmp,256).fill(0);
  v.setUint32(tmp,2047,true);v.setUint32(tmp+4,4096,true);
  v.setUint32(tmp+16,3,true);v.setUint32(tmp+20,1001,true);v.setUint32(tmp+24,1002,true);v.setUint16(tmp+28,0o100640,true);
  v.setBigUint64(tmp+32,current.ino,true);v.setBigUint64(tmp+40,current.size,true);v.setBigUint64(tmp+48,current.blocks,true);
  for(const offset of [64,96,112]) {v.setBigInt64(tmp+offset,current.sec,true);v.setUint32(tmp+offset+8,current.ns,true);}
  v.setUint32(tmp+128,256,true);v.setUint32(tmp+132,257,true);v.setUint32(tmp+136,current.major,true);v.setUint32(tmp+140,current.minor,true);
  return 0;
 }}});
 const e=instance.exports;memory=e.memory;
 equal(e.__heap_base.value<1048576,true,'TLS outside static/stack range');
 equal(e.__tls_align.value<=4096,true,'TLS alignment');
 e.__wasm_init_tls(1048576);
 const v=new DataView(memory.buffer),p=e.payload(),l=e.layout();
 const layout=Array.from({length:16},(_,i)=>v.getUint32(l+i*4,true));
 equal(JSON.stringify(layout),JSON.stringify([128,128,256,0,8,16,20,24,28,32,48,56,64,72,88,104]),'independent public layout');
 const decodePath=ptr=>{const a=new Uint8Array(memory.buffer);let end=ptr;while(a[end])end++;return new TextDecoder().decode(a.subarray(ptr,end));};
 const start=checks;
 for(let api=0;api<8;api++) {
  for(const profile of profiles){
   current=profile;failure=0;calls=[];equal(e.run(api,67,0x100),0,'public success');equal(e.error(),251,'success preserves errno');canaries(v,p);
   equal(calls.length,1,'one real syscall import');const c=calls[0];equal(c.n,291,'actual statx');equal(c.mask,2047,'basic stats');equal(c.z,0,'unused raw arg');
   const type=api%4;equal(c.fd,type<2?-100:67,'dirfd');equal(decodePath(c.path),type===2?'':'test-file','path');
   equal(c.flags,type===0?0x800:type===1?0x900:type===2?0x1800:0x900,'GNU flags');
   equal(v.getBigUint64(p,true),device(profile.major,profile.minor),'full dev');equal(v.getBigUint64(p+8,true),profile.ino,'inode64');
   equal(v.getUint32(p+16,true),0o100640,'mode');equal(v.getUint32(p+20,true),3,'links');equal(v.getUint32(p+24,true),1001,'uid');equal(v.getUint32(p+28,true),1002,'gid');
   equal(v.getBigUint64(p+32,true),device(256,257),'rdev');equal(v.getBigInt64(p+48,true),profile.size,'size >4GiB');equal(v.getInt32(p+56,true),4096,'blksize');equal(v.getBigInt64(p+64,true),profile.blocks,'blocks64');
   for(const offset of [72,88,104]){equal(v.getBigInt64(p+offset,true),profile.sec,'time beyond2038/before1900');equal(v.getUint32(p+offset+8,true),profile.ns,'nanoseconds');}
  }
  for(const error of [2,22,38]){
   failure=error;calls=[];equal(e.run(api,67,0),-1,'raw error converted');equal(e.error(),error,'genuine errno');equal(calls.length,1,'one error syscall');canaries(v,p);
   for(let i=0;i<128;i++)equal(v.getUint8(p+i),0xa5,'error leaves output unchanged');
  }
  if(api%4===2){failure=0;calls=[];equal(e.run(api,-1,0),-1,'negative fd');equal(e.error(),9,'EBADF');equal(calls.length,0,'GNU rejects negative fd before kernel');canaries(v,p);for(let i=0;i<128;i++)equal(v.getUint8(p+i),0xa5,'negative fd output unchanged');}
 }
 results.push({module:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),checks:checks-start,pass:true});
}
fs.writeFileSync(output,JSON.stringify({pass:true,checks,results,scope:'synthetic Linux statx transport through genuine GNU public APIs/table; independent real guest tests remain required'},null,2)+'\n');
console.log(JSON.stringify({pass:true,checks,results}));
