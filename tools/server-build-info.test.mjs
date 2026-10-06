import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServerBuildInfo,firefoxBuildDate} from './server-build-info.mjs';
const task='/mnt/p6/build/build-footer-20261004/unit-fixtures';await mkdir(task,{recursive:true});
test('recorded Firefox dates are validated rather than guessed',()=>{assert.equal(firefoxBuildDate('20261004075010'),'2026-10-04');assert.equal(firefoxBuildDate('20260230075010'),null);assert.equal(firefoxBuildDate('bad'),null);});
test('inventory lists every explicit binary package without opening binaries; revision tracks actual source changes',async()=>{
 const source=task+'/main.js',server=task+'/server.js';await writeFile(source,'source one');await writeFile(server,'server');
 const routes={'/linux/vmlinux.wasm':{path:task+'/nonexistent-kernel',sha256:'a'.repeat(64)},'/linux/initramfs.cpio':{path:task+'/nonexistent-image'},'/linux/initramfs-firefox.cpio.gz':{path:task+'/nonexistent-firefox'},'/linux/extra.data':{path:task+'/nonexistent-extra'}};
 const info=createServerBuildInfo({routes,liveRoutes:{'/linux/main.js':source},serverSources:[server],started:'recorded-start'});
 const args={manifest:{assets:{kernel:{url:'./vmlinux.wasm'},firefox:{url:'./initramfs-firefox.cpio.gz'}}},status:{version:'159.0a1',buildID:'20261004075010'}};
 const first=await info(args);assert.equal(first.packages.length,4);assert.equal(first.packages.find(p=>p.url.endsWith('.gz')).version,'159.0a1');assert.equal(first.packages.find(p=>p.url.endsWith('.gz')).buildDate,'2026-10-04');assert.equal(first.packages.find(p=>p.url.endsWith('.data')).buildDate,null);assert.equal(first.webapp.buildDate,null);assert.equal(first.firefox.jitVerified,false);assert.equal(first.server.started,'recorded-start');
 assert.equal((await info(args)).webapp.version,first.webapp.version);await writeFile(source,'source two changed');assert.notEqual((await info(args)).webapp.version,first.webapp.version);await writeFile(server,'future server source');assert.equal((await info(args)).server.version,first.server.version,'running server version remains its startup source identity');
});
