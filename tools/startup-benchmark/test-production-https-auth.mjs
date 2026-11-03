import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {authenticateOwnedHttps,readHttpsAuthInputs} from './production-https-auth.mjs';

const origin='https://9209ec251514cc05.5x7aqstuceku.opentunnel.xyz';
const fakeSecret='fixture-only-not-a-real-access-grant';
const hash='a'.repeat(64);
function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lw-auth-'));
  const grantFile=path.join(directory,'grant.json');
  fs.writeFileSync(grantFile,JSON.stringify({path:'/access/'+fakeSecret}),{mode:0o600});
  return {directory,grantFile,productionBase:origin,targetWebSocketUrl:'ws://127.0.0.1:23456/devtools/page/owned-fixture',expectedManifestSha256:hash,expectedVersion:'fixture-version'};
}
class FakeSocket extends EventTarget {
  static instances=[];
  static actualHash=hash;
  constructor() { super();this.readyState=0;this.href='about:blank';this.methods=[];FakeSocket.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));}); }
  send(text) {
    const m=JSON.parse(text);this.methods.push(m.method);
    let result=m.method==='Target.getTargets'?{targetInfos:[{type:'page',url:this.href}]}:{};
    if(m.method==='Page.navigate') {
      this.href=m.params.url.startsWith(origin+'/access/')?origin+'/':m.params.url;
      result={frameId:'owned-fixture'};
      queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({method:'Runtime.consoleAPICalled',params:{privateFixture:fakeSecret}})})));
    }
    if(m.method==='Runtime.evaluate') {
      const expression=m.params.expression;
      const value=expression==='location.href'?this.href:expression.startsWith('(async()=>')?
        {ok:true,sha:FakeSocket.actualHash,version:'fixture-version',schema:1}:
        {origin:new URL(this.href).origin,isAccess:false,ready:'complete'};
      result={result:{value}};
    }
    queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:m.id,result})})));
  }
  close() {this.readyState=3;this.dispatchEvent(new Event('close'));}
}
test('private grant inputs require exact origin, local owned page and restrictive regular file',()=>{
  const f=fixture();try {
    assert.equal(readHttpsAuthInputs(f).grantUrl,origin+'/access/'+fakeSecret);
    assert.throws(()=>readHttpsAuthInputs({...f,productionBase:'https://example.com'}),/unapproved production origin/);
    assert.throws(()=>readHttpsAuthInputs({...f,targetWebSocketUrl:'ws://example.com:123/devtools/page/x'}),/local owned page/);
    fs.chmodSync(f.grantFile,0o644);
    assert.throws(()=>readHttpsAuthInputs(f),/ownership or permissions/);
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('symlink and malformed grant errors never include the private value',()=>{
  const f=fixture();try {
    const link=path.join(f.directory,'link');fs.symlinkSync(f.grantFile,link);
    assert.throws(()=>readHttpsAuthInputs({...f,grantFile:link}),/ownership or permissions|unavailable/);
    fs.writeFileSync(f.grantFile,'invalid '+fakeSecret);
    assert.throws(()=>readHttpsAuthInputs(f),error=>!String(error).includes(fakeSecret)&&/malformed/.test(String(error)));
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('grant path cannot redirect to a different origin or outside the access endpoint',()=>{
  const f=fixture();try {
    for(const value of ['https://example.com/access/x','//example.com/access/x','/access/../private','/access/#'+fakeSecret]) {
      fs.writeFileSync(f.grantFile,JSON.stringify({path:value}));
      assert.throws(()=>readHttpsAuthInputs(f));
    }
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('normal navigation verifies the manifest and returns blank without private event serialization',async()=>{
  const f=fixture();try {
    FakeSocket.actualHash=hash;
    const result=await authenticateOwnedHttps({...f,WebSocketClass:FakeSocket});
    const socket=FakeSocket.instances.at(-1);
    assert.equal(result.authenticated,true);assert.equal(result.returnedToBlank,true);
    assert.equal(result.privateConsoleCacheDiscarded,true);assert.equal(result.authenticationWorkerTargetsRemaining,0);assert.equal(socket.href,'about:blank');assert.equal(socket.readyState,3);
    assert(socket.methods.includes('Runtime.discardConsoleEntries'));
    assert(!JSON.stringify(result).includes(fakeSecret));assert(!JSON.stringify(result).includes('/access/'));
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('wrong published manifest fails closed and closes the private connection',async()=>{
  const f=fixture();try {
    FakeSocket.actualHash='b'.repeat(64);
    await assert.rejects(authenticateOwnedHttps({...f,WebSocketClass:FakeSocket}),error=>/manifest identity/.test(String(error))&&!String(error).includes(fakeSecret));
    assert.equal(FakeSocket.instances.at(-1).readyState,3);
  }finally{FakeSocket.actualHash=hash;fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('owner cancellation remains a safe failure without grant disclosure',async()=>{
  const f=fixture();try {
    await assert.rejects(authenticateOwnedHttps({...f,WebSocketClass:FakeSocket,shouldAbort:()=>true}),error=>/cancelled/.test(String(error))&&!String(error).includes(fakeSecret));
  }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
