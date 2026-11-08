import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeQuitDialogVisible,samplePngRgb} from './native-quit-visual.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(here,'evidence/continuation-20261103-1322/cache-final-cold1');
const geometry={viewport:{width:1400,height:873},canvas:{left:52,top:0,width:1280,height:720}};

test('does not click when Ctrl+Q dialog has not yet appeared',()=>{
 const screenshot=fs.readFileSync(path.join(fixture,'native-quit-dialog.png'));
 assert.equal(nativeQuitDialogVisible(screenshot,geometry.viewport,geometry.canvas),false);
});
test('recognizes the real delayed Firefox Nightly Quit confirmation',()=>{
 const screenshot=fs.readFileSync(path.join(fixture,'native-close.png'));
 assert.equal(nativeQuitDialogVisible(screenshot,geometry.viewport,geometry.canvas),true);
});
test('fails closed on corrupt screenshots, offscreen samples or unsupported layout',()=>{
 const screenshot=fs.readFileSync(path.join(fixture,'native-close.png'));
 assert.equal(nativeQuitDialogVisible(screenshot.subarray(0,110),geometry.viewport,geometry.canvas),false);
 assert.equal(nativeQuitDialogVisible(Buffer.from('not png'),geometry.viewport,geometry.canvas),false);
 assert.equal(nativeQuitDialogVisible(screenshot,geometry.viewport,{...geometry.canvas,height:650}),false);
 assert.throws(()=>samplePngRgb(screenshot,[{x:-1,y:0}]),/outside/);
});
