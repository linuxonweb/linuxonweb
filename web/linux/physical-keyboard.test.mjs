import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalKeyboard } from './physical-keyboard.mjs';
import { Key } from './dist/virtio/input.js';
const key=(code,repeat=false)=>({code,repeat});
test('host repeats are explicit and a tap is never multiplied',()=>{
 const sent=[],k=createPhysicalKeyboard((...e)=>sent.push(e),{hostRepeat:true});
 k.down(key('KeyA'));k.down(key('KeyA'));k.down(key('KeyA',true));k.down(key('KeyA',true));k.up(key('KeyA'));k.up(key('KeyA'));
 assert.deepEqual(sent,[[Key.A,true,false],[Key.A,true,true],[Key.A,true,true],[Key.A,false,false]]);assert.equal(k.pressedCount,0);
});
test('blur/Stop releases every held key, clears modifiers and ignores stale repeats',()=>{
 const sent=[],k=createPhysicalKeyboard((...e)=>sent.push(e),{hostRepeat:true});
 k.down(key('ControlLeft'));k.down(key('KeyA'));k.releaseAll();k.releaseAll();k.down(key('KeyA',true));k.up(key('ControlLeft'));
 assert.deepEqual(sent,[[Key.LEFTCTRL,true,false],[Key.A,true,false],[Key.LEFTCTRL,false,false],[Key.A,false,false]]);assert.equal(k.pressedCount,0);
 k.down(key('KeyA'));k.up(key('KeyA'));assert.equal(sent.length,6);
});
test('legacy guest repeat remains default and unknown keys are not consumed',()=>{
 const sent=[],k=createPhysicalKeyboard((...e)=>sent.push(e));
 assert.equal(k.down(key('Unmapped')),false);k.down(key('KeyB'));k.down(key('KeyB',true));k.up(key('KeyB'));
 assert.deepEqual(sent,[[Key.B,true,false],[Key.B,true,false],[Key.B,false,false]]);
});
