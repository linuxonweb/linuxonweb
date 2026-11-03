export async function run({send}){
 const start=performance.now();while(performance.now()-start<110000){const r=await send('Runtime.evaluate',{expression:'Boolean(window.graphicsResults?.done)',returnByValue:true});if(r.result?.value)return;await new Promise(resolve=>setTimeout(resolve,250));}throw Error('archive browser gate deadline');
}
