import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpioEntry, desktopInitOverlay, loadDesktopInitramfs } from './desktop-extras.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const source=readFileSync(new URL('../../tools/guest-packages/overlay-persistence.py',import.meta.url),'utf8');
const hook=source.match(/HOOK = '''([\s\S]*?)'''/)[1];
const anchor='# Give the guest desktop account access to the devices used by TinyX/input.\n';
const agent='/bin/busybox sh /bin/linuxonweb-run-agent &\n';
const init=body=>encoder.encode('#!/bin/busybox sh\n'+body);
function records(bytes){const found=new Map();for(let at=0;at<bytes.length;){const h=decoder.decode(bytes.subarray(at,at+110));const size=parseInt(h.slice(54,62),16),namesize=parseInt(h.slice(94,102),16),start=(at+110+namesize+3)&~3;found.set(decoder.decode(bytes.subarray(at+110,at+110+namesize-1)),bytes.slice(start,start+size));at=(start+size+3)&~3;}return found;}
const overlay=body=>records(desktopInitOverlay(cpioEntry('init',init(body))));
test('legacy init bytes and outer agent launch remain unchanged',()=>{const body='echo legacy\n';const files=overlay(body);assert.deepEqual(files.get('init.desktop-original'),init(body));assert.equal(decoder.decode(files.get('init')).split(agent).length-1,1);});
test('exact package protocol starts agent only after successful restore branch',()=>{const files=overlay(hook+anchor+'echo desktop\n');const original=decoder.decode(files.get('init.desktop-original'));assert.ok(original.includes(hook+agent+anchor));assert.equal(original.split(agent).length-1,1);assert.ok(!decoder.decode(files.get('init')).includes(agent));assert.ok(original.indexOf('exec setsid cttyhack sh')<original.indexOf(agent));});
for(const [name,body]of[
 ['missing anchor',hook],['duplicate anchor',hook+anchor+anchor],['missing protocol','apk-persist: RESTORE FAILED; desktop startup stopped\n'+anchor],['duplicate failure marker',hook+anchor+'echo "apk-persist: RESTORE FAILED; desktop startup stopped"\n'],['duplicate restore command',hook+anchor+'/usr/sbin/apk-persist restore\n'],['changed recovery exec',hook.replace('exec setsid cttyhack sh','echo recovery')+anchor],['intervening command',hook+'echo unexpected\n'+anchor],['anchor before protocol',anchor+hook],
])test('reject unsupported package control flow: '+name,()=>assert.throws(()=>overlay(body),/unsupported or ambiguous agent activation/));

function joined(parts){const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;}
for(const marker of ['usr/sbin/apk-persist','etc/linuxonweb-packages/base-world'])test('helper image with no recognized protocol fails closed: '+marker,()=>{const image=joined([cpioEntry('init',init('echo unknown helper protocol\n')),cpioEntry(marker,encoder.encode('fixture'))]);assert.throws(()=>desktopInitOverlay(image),/unsupported or ambiguous agent activation/);});
test('compressed image scan retains helper identity when init markers changed',async()=>{const {gzipSync}=await import('node:zlib');const image=joined([cpioEntry('init',init('echo unknown helper protocol\n')),cpioEntry('usr/sbin/apk-persist',encoder.encode('fixture'))]);await assert.rejects(()=>loadDesktopInitramfs(new Response(gzipSync(image)),new Uint8Array(),{gzip:true,preserveGzip:true}),/unsupported or ambiguous agent activation/);});
