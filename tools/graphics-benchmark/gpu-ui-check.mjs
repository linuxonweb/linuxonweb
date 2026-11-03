// Functional checks against the real desktop page, without starting a guest.
export async function run({send,result,url}) {
 const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function evaluate(expression){const x=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw Error(x.exceptionDetails.exception?.description??x.exceptionDetails.text);return x.result?.value;}
 async function ready(){for(let i=0;i<100;i++){if(await evaluate(`document.readyState==='complete' && document.querySelector('#guest-graphics-backend')?.value && new URL(location.href).searchParams.has('gpubackend')`))return;await sleep(50);}throw Error('desktop page initialization deadline');}
 async function check(name,expression){const got=await evaluate(expression);checks.push({name,pass:got===true,actual:got});if(got!==true)throw Error(name+': '+JSON.stringify(got));}
 const change=async(backend,resolution=null)=>evaluate(`(()=>{document.getElementById('settings-toggle').click();const s=document.getElementById('guest-graphics-backend');s.value=${JSON.stringify(backend)};s.dispatchEvent(new Event('change',{bubbles:true}));${resolution?`const r=document.getElementById('resolution');r.value=${JSON.stringify(resolution)};r.dispatchEvent(new Event('change',{bubbles:true}));`:''}document.getElementById('settings-apply').click();return true;})()`);
 try {
  await ready();
  await check('initial guest WebGPU choice is explicit',`document.getElementById('guest-graphics-backend').value==='webgpu' && new URL(location.href).searchParams.get('gpubackend')==='webgpu'`);
  await check('portrait resolution is offered',`[...document.getElementById('resolution').options].some(o=>o.value==='900x1200')`);
  await check('guest APIs have separate status labels',`!!document.getElementById('guest-gl-status').textContent && !!document.getElementById('guest-vulkan-status').textContent && document.getElementById('guest-gl-status')!==document.getElementById('graphics-status')`);
  await change('webgl');
  await check('guest backend requires review before saving',`document.getElementById('restart-dialog').open && document.getElementById('restart-summary').textContent.includes('guest Vulkan WebGL') && localStorage.getItem('linuxonweb.machine-settings.v1')===null`);
  await evaluate(`document.getElementById('restart-cancel').click()`);
  await check('cancel restores choice without writing',`!document.getElementById('restart-dialog').open && document.getElementById('guest-graphics-backend').value==='webgpu' && new URL(location.href).searchParams.get('gpubackend')==='webgpu' && localStorage.getItem('linuxonweb.machine-settings.v1')===null`);
  await change('webgl','900x1200');await evaluate(`document.getElementById('restart-continue').click()`);await sleep(50);
  await check('explicit WebGL and resolution are saved together',`(()=>{const s=JSON.parse(localStorage.getItem('linuxonweb.machine-settings.v1'));return s.guestBackend==='webgl'&&s.resolution==='900x1200'&&!document.getElementById('restart-dialog').open&&new URL(location.href).searchParams.get('gpubackend')==='webgl';})()`);
  await send('Page.reload');await ready();
  await check('reload restores saved graphics and resolution',`document.getElementById('guest-graphics-backend').value==='webgl'&&document.getElementById('resolution').value==='900x1200'`);
  const clean=new URL(url);clean.search='';await send('Page.navigate',{url:clean.href});await ready();
  await check('saved choice survives a URL without backend',`document.getElementById('guest-graphics-backend').value==='webgl'&&new URL(location.href).searchParams.get('gpubackend')==='webgl'`);
  clean.searchParams.set('gpubackend','webgpu');await send('Page.navigate',{url:clean.href});await ready();
  await check('explicit WebGPU URL overrides saved fallback for this load',`document.getElementById('guest-graphics-backend').value==='webgpu'&&JSON.parse(localStorage.getItem('linuxonweb.machine-settings.v1')).guestBackend==='webgl'`);
  await evaluate(`document.getElementById('settings-toggle').click()`);
  await check('no VM is started by settings review',`document.getElementById('status').textContent==='idle'`);
  await evaluate(`window.graphicsResults=${JSON.stringify({done:true,pass:true,kind:'real desktop UI functional acceptance',checks})}`);
 }catch(error){result.uiChecks=checks;throw error;}
}
