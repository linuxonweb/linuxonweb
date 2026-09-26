import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioWrite, createAudioHost } from './dist/audio.js';

class FakeContext {
  static latest;
  constructor() { FakeContext.latest=this; this.currentTime=0; this.state='suspended'; this.nodes=[]; this.destination={}; }
  resume() { this.resumed=true;this.state='running';return Promise.resolve(); }
  close() { this.state='closed';return Promise.resolve(); }
  createBuffer(channels,frames,rate) { const data=Array.from({length:channels},()=>new Float32Array(frames)); return {data,rate,getChannelData:n=>data[n]}; }
  createBufferSource() { const node={connect(){},disconnect(){this.disconnected=true},start(at){this.at=at},stop(){this.stopped=true}};this.nodes.push(node);return node; }
}
const packet = (extra={}) => ({pid:5,stream:7,frames:2,rate:48000,channels:2,pcm:new Float32Array([0.5,-0.5,2,NaN]).buffer,sentAt:1000,...extra});

test('worker validates format and complete memory bounds, snapshots and transfers PCM',()=>{
  const memory=new WebAssembly.Memory({initial:1});new Float32Array(memory.buffer).set([0.25,-0.25]);
  const messages=[];const write=createAudioWrite(memory,(message,transfer)=>messages.push([message,transfer]),()=>1000);
  assert.equal(write(5,7,0,2,48000,1),0);
  new Float32Array(memory.buffer)[0]=1;
  assert.deepEqual([...new Float32Array(messages[0][0].pcm)],[0.25,-0.25]);
  assert.equal(messages[0][1][0],messages[0][0].pcm);
  for(const args of [[5,7,65532,2,48000,1],[5,7,1,2,48000,1],[5,7,0,2049,48000,1],[5,7,0,2,7999,1],[5,7,0,2,48000,3],[0,7,0,2,48000,1]]) assert.equal(write(...args),-22);
  assert.equal(write(5,7,0,0,0,0),0);assert.equal(messages[1][0].frames,0);
});

test('resume is synchronous; schedules deinterleaved bounded PCM; stop and close cancel sources',async()=>{
  const host=createAudioHost({Context:FakeContext,now:()=>1000});
  host.write(packet());assert.equal(host.stats.dropped,1);
  host.resume();const context=FakeContext.latest;assert.equal(context.state,'running');
  host.write(packet());
  const node=context.nodes[0];assert.deepEqual([...node.buffer.data[0]],[0.5,1]);assert.deepEqual([...node.buffer.data[1]],[-0.5,0]);assert.equal(node.at,0.04);
  host.write(packet({frames:2048,rate:8000,channels:1,pcm:new ArrayBuffer(2048*4)}));
  assert.equal(context.nodes.length,1); // 256ms exceeds entire queue budget
  host.write(packet({sentAt:700}));assert.equal(host.stats.dropped,3);
  host.write(packet({frames:0}));assert.equal(node.stopped,true);assert.equal(node.disconnected,true);
  host.write(packet({sentAt:999}));assert.equal(context.nodes.length,1);
  host.write(packet({sentAt:1001}));assert.equal(context.nodes.length,1);
  host.write(packet({stream:8,sentAt:1001}));assert.equal(context.nodes.length,2);
  await host.close();assert.equal(context.nodes[1].stopped,true);assert.equal(context.state,'closed');
  host.resume();host.write(packet());assert.equal(host.stats.state,'closed');assert.equal(context.nodes.length,2);
});

test('queue cannot grow without bound when browser audio clock is paused',()=>{
  const host=createAudioHost({Context:FakeContext,now:()=>1000});host.resume();
  for(let n=0;n<1000;n++)host.write(packet({frames:512,channels:1,pcm:new ArrayBuffer(512*4)}));
  assert.ok(FakeContext.latest.nodes.length<=23);assert.ok(host.stats.dropped>=977);
});

test('worker caps queued messages while main thread is blocked',()=>{
  const memory=new WebAssembly.Memory({initial:1});let count=0;
  const write=createAudioWrite(memory,()=>count++,()=>1000);
  for(let i=0;i<1000;i++)assert.equal(write(5,7,0,512,48000,1),0);
  assert.ok(count<=23);
});

test('shared guest buffers become an ordinary owned transferable buffer',()=>{
  const memory=new WebAssembly.Memory({initial:1,maximum:2,shared:true});
  let copied;createAudioWrite(memory,m=>copied=m)(5,7,0,1,48000,1);
  assert.ok(copied.pcm instanceof ArrayBuffer);
  assert.equal(copied.pcm instanceof SharedArrayBuffer,false);
});
