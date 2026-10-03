const fs=require('node:fs');
(async()=>{
 const dir=process.argv[2];
 const labels={0:'inbound all scalar widths and signed zero',1:'outbound all scalar widths and signed zero',2:'getter implicit context first',3:'method context before retval',4:'context and optional argc before retval',5:'zero arguments',8:'reference methods and vtable headers',9:'last valid stub slot 249',10:'all 22 explicit argument slots',11:'reject argument overflow before proxy escapes',12:'reject method overflow before proxy escapes',13:'outbound indirect scalar storage',14:'invalid arguments and outbound capacity',15:'inbound and outbound NaN payload preservation'};
 const raw=(await WebAssembly.instantiate(fs.readFileSync(dir+'/probe-raw.wasm'))).instance;
 let trapped=false;
 try { raw.exports.run_case(0); } catch(e) { if(!(e instanceof WebAssembly.RuntimeError))throw e; trapped=true; }
 if(!trapped)throw Error('raw signature mismatch did not trap');
 const wasm=(await WebAssembly.instantiate(fs.readFileSync(dir+'/probe-fpcast.wasm'))).instance;
 const cases=Object.entries(labels).map(([id,label])=>{
   const failures=wasm.exports.run_case(Number(id));if(failures)throw Error(label+': '+failures+' failures');
   return {id:Number(id),label,failures};
 });
 console.log(JSON.stringify({pass:true,rawWrongSignatureTraps:trapped,cases}));
})().catch(e=>{console.error(e.stack);process.exit(1)});
