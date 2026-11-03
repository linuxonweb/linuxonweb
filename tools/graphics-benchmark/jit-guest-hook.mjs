export async function run({send,cpus}) {
 for(let i=0;i<100;i++){
  const r=await send('Runtime.evaluate',{expression:`(()=>{if(!window.guestJitResults)return false;window.guestJitHostCpus={hostNproc:${cpus},requestedGuestCpus:${cpus}};document.getElementById('boot').click();return true;})()`,returnByValue:true});
  if(r.result?.value)return;
  await new Promise(r=>setTimeout(r,50));
 }
 throw Error('native JIT fixture initialization deadline');
}
