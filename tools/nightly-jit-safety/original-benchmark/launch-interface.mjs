import {ownedTaskRoot,scopedPath} from '../owned-paths.mjs';
// Pure host planning/packaging helper. No browser, guest, subprocess or launch.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const required=['OriginalBenchmarkChild.sys.mjs','OriginalBenchmarkParent.sys.mjs','benchmark-diagnostics.sys.mjs','original-content.sys.mjs','original-entry.sys.mjs','original-hash.sys.mjs','original-source.sys.mjs','contract.json'];
export async function producerInterface(installDirectory,taskRoot) {
 const root=await ownedTaskRoot(taskRoot);
 const dir=await scopedPath(root,installDirectory,{directory:true});
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'install-manifest.json'),'utf8'));
 const contract=JSON.parse(await fs.readFile(path.join(dir,'contract.json'),'utf8'));
 const names=[...required,`pblbench-${contract.label}.html`];
 if(manifest.kind!=='uninstalled-original-body-diagnostic-v1'||manifest.guestDestination!==contract.base||manifest.files.length!==names.length||new Set(manifest.files.map(row=>path.basename(row.path))).size!==names.length) throw Error('complete exact install manifest required');
 const files=[];
 for(const name of names){const pin=manifest.files.find(row=>path.basename(row.path)===name),bytes=await fs.readFile(path.join(dir,name));if(!pin||pin.bytes!==bytes.length||pin.sha256!==sha(bytes)) throw Error('actual package file pin differs '+name);files.push({name,bytes:bytes.length,sha256:sha(bytes),text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});}
 // Existing producer can evaluate this on its already-owned outer linux page
 // before guest boot. It only writes the exact owned guest install directory.
 let installExpression=`(async()=>{const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();try{let node=h.root;for(const part of ${JSON.stringify(contract.base.slice('/home/'.length).split('/').filter(Boolean))})node=await h.lookup(node,part)||await h.mkdir(node,part,{mode:0o755,uid:1000,gid:1000});for(const row of ${JSON.stringify(files.map(({name,text})=>({name,text})))}){if(await h.lookup(node,row.name))throw Error('owned original diagnostic file exists: '+row.name);const f=await h.create(node,row.name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(row.text));await h.release(f.node,f.handle);}return true;}finally{await h.destroy();}})()`;
 const profile=contract.base+'profile';
 const prefs=[['javascript.options.portable_baseline',Boolean(contract.option)],['devtools.chrome.enabled',true],['devtools.console.stdout.content',true],['devtools.console.stdout.chrome',true],['browser.shell.checkDefaultBrowser',false],['browser.aboutwelcome.enabled',false],['datareporting.policy.firstRunURL',''],['browser.startup.homepage','about:blank'],['webgl.disabled',true],['dom.webgpu.enabled',false]].map(([k,v])=>`user_pref(${JSON.stringify(k)},${JSON.stringify(v)});`).join('\n')+'\n';
 installExpression=installExpression.replace('return true;}finally', `if(await h.lookup(node,'profile'))throw Error('owned original diagnostic profile exists');const profileNode=await h.mkdir(node,'profile',{mode:0o755,uid:1000,gid:1000});const profileFile=await h.create(profileNode,'user.js',2,{mode:0o644,uid:1000,gid:1000});await h.write(profileFile.node,profileFile.handle,0n,new TextEncoder().encode(${JSON.stringify(prefs)}));await h.release(profileFile.node,profileFile.handle);return true;}finally`);
 const argv=['/bin/firefox','--no-remote','--new-instance','-profile',profile,'about:blank'];
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 // The admitted task-only guest launcher must run this as admin with existing
 // DISPLAY=:0 and native runtime, instead of also auto-starting default Firefox.
 // Complete stdout+stderr are one append-only file, available to parent IOUtils
 // throughout the acquisition and exported only after actual natural exit.
 const command='exec env PBLJIT=1 PBLJIT_LOG=0 PBLJIT_OBSERVE=1 '+argv.map(quote).join(' ')+' >'+quote(contract.base+'observer.stderr')+' 2>&1';
 const entry=`ChromeUtils.importESModule(${JSON.stringify('file://'+contract.base+'original-entry.sys.mjs')}).run(${JSON.stringify(contract.label)}).catch(error=>console.error('PBLORIGINALFAIL '+String(error)));`;
 return {kind:'original-body-producer-launch-interface-v1',label:contract.label,option:contract.option,cpus:contract.cpus,buildID:contract.buildID,base:contract.base,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),installExpression,profile:{directory:profile,userJS:prefs,userJSBytes:Buffer.byteLength(prefs),userJSSHA256:sha(Buffer.from(prefs))},guest:{runAs:'admin',environment:{PBLJIT:'1',PBLJIT_LOG:'0',PBLJIT_OBSERVE:'1',DISPLAY:':0'},argv,command,independentDefaultFirefoxLaunchForbidden:true},browserConsoleEntry:entry,
 acquisitionPath:contract.base+'acquisition.json',afterCloseRawPath:contract.base+'observer-after-close.bin',completeObserverAndConsolePath:contract.base+'observer.stderr',entryFailurePath:contract.base+'entry-failure.json',runtimeAcceptance:false,
 requiredOuterReceiptKind:'actual-original-diagnostic-outer-receipt-v1',pending:['actual reviewed guest startup integration/package identity','actual actor/eval API and original WindowGlobal deadline','same CPU proofs and natural exact-group terminal/reap/empty','independent actual complete stdout/stderr raw/source review']};
}
