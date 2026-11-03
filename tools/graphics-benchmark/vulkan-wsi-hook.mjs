import fs from 'node:fs';
export async function run({send,result}) {
 const start=performance.now();while(performance.now()-start<65000){
  const r=await send('Runtime.evaluate',{expression:`({ready:/VKGEARS_FPS /.test(window.graphicsResults?.logs??''),done:!!window.graphicsResults?.done})`,returnByValue:true});
  if(r.result?.value?.ready){const shot=await send('Page.captureScreenshot',{format:'png'});const file=result.run+'/wsi-active.png';fs.writeFileSync(file,Buffer.from(shot.data,'base64'));result.activePresentationScreenshot=file;return;}
  if(r.result?.value?.done)return;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('WSI intermediate screenshot deadline');
}
