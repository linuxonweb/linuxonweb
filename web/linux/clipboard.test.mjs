import assert from 'node:assert/strict';
import test from 'node:test';
import { installClipboardButton, clipboardPreviewText, readHostClipboard, writeHostClipboard } from './clipboard.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class Control {
  handlers = new Map(); attrs = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
  setAttribute(k,v) { this.attrs.set(k,v); } removeAttribute(k) { this.attrs.delete(k); }
  getBoundingClientRect() { return {left:10,bottom:50}; }
  send(type) { for(const fn of this.handlers.get(type)||[])void fn({}); }
}
globalThis.window={addEventListener(){},dispatchEvent(){}};globalThis.innerWidth=800;
globalThis.document={createTextNode:text=>({textContent:text}),createElement:()=>({})};
function fixture(options) {
  const button=new Control(),notice={hidden:true,style:{},textContent:'',classList:{toggle(name,value){notice.failed=value;}},replaceChildren(node){notice.textContent=node.textContent;notice.children=[];},append(node){notice.children.push(node);},getBoundingClientRect(){return {left:10,right:300,width:290};}};
  installClipboardButton({button,notice,...options});return {button,notice};
}
test('Paste is click-only and Copy is a separate accessible click action',async()=>{
  const calls=[],p=fixture({paste:async()=>{calls.push('paste');return 'pasted';}}),c=fixture({copy:async()=>{calls.push('copy');return {message:'copied',item:{kind:1,bytes:new TextEncoder().encode('<b>safe</b>')}};}});
  p.button.send('pointerdown');p.button.send('pointerup');assert.deepEqual(calls,[]);
  p.button.send('click');c.button.send('click');await sleep(1);assert.deepEqual(calls,['paste','copy']);assert.equal(c.notice.children[0].textContent,'<b>safe</b>');assert.equal(c.notice.hidden,false);
});
test('preview keeps short text once and first/last100 Unicode characters for long text',()=>{
  assert.equal(clipboardPreviewText('hello'),'hello');assert.equal(clipboardPreviewText('a'.repeat(200)),'a'.repeat(200));
  const content='🐧'.repeat(100)+'middle'+'界'.repeat(100);assert.equal(clipboardPreviewText(content),'🐧'.repeat(100)+'\n…\n'+'界'.repeat(100));
});
test('busy clicks cannot duplicate clipboard action; permission denial is truthful',async()=>{
  let release,calls=0;const f=fixture({copy:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});f.button.send('click');f.button.send('click');assert.equal(calls,1);release('copied');await sleep(1);assert.equal(f.button.attrs.has('aria-busy'),false);
  const denied=fixture({paste:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}});denied.button.send('click');await sleep(1);assert.equal(denied.notice.failed,true);assert.match(denied.notice.textContent,/permission denied/);
});
test('host PNG preferred; unsupported clipboard/image APIs stay explicit',async()=>{
  const png=new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
  assert.equal((await readHostClipboard({read:async()=>[{types:['text/plain','image/png'],getType:async()=>png}]})).kind,2);
  await assert.rejects(()=>readHostClipboard(null),/does not expose/);
  await assert.rejects(()=>writeHostClipboard({kind:2,bytes:new Uint8Array()},{}),/cannot copy PNG/);
});
