import test from 'node:test';
import assert from 'node:assert/strict';
import { createPackageRecoveryWatch } from './package-recovery.mjs';
import { guestRunAgent } from './test-commands.mjs';
test('native split restore failure opens recovery once and host messages do not',()=>{
 let calls=0;const watch=createPackageRecoveryWatch(()=>calls++);watch.start();
 watch.write('apk-persist: RESTORE FAILED; desktop startup stopped','host');assert.equal(calls,0);
 watch.write('apk-persist: RESTORE FAILED; desktop ','guest');watch.write('startup stopped\n','guest');assert.equal(calls,1);
 watch.write('apk-persist: RESTORE FAILED; desktop startup stopped','guest');assert.equal(calls,1);
});
test('ordinary desktop start and Stop end the bounded recovery watcher',()=>{
 let calls=0;const watch=createPackageRecoveryWatch(()=>calls++);watch.start();watch.write('display: starting Xfbdev','guest');watch.write('apk-persist: RESTORE FAILED; desktop startup stopped','guest');assert.equal(calls,0);
 watch.start();watch.stop();watch.write('apk-persist: RESTORE FAILED; desktop startup stopped','guest');assert.equal(calls,0);
});
test('desktop command agent has no pre-X external-process polling loop',()=>{
 const prefix=guestRunAgent().split('exec 3</dev/hvc0')[0];assert.ok(!prefix.includes('while [ ! -e /tmp/.X11-unix/X0 ]'));
});

test('failure marker survives a large native output chunk', () => { let called=0; const watch=createPackageRecoveryWatch(()=>called++); watch.start(); watch.write('apk-persist: RESTORE FAILED; desktop startup stopped\n'+'x'.repeat(2048), 'guest'); assert.equal(called, 1); });
