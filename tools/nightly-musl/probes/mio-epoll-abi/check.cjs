const fs=require('fs');
const moduleObject=new WebAssembly.Module(fs.readFileSync('mio-epoll-abi/probe.wasm'));
const memory=new WebAssembly.Memory({initial:128,maximum:65536,shared:true});
const x=new WebAssembly.Instance(moduleObject,{env:{memory}}).exports;
const rows=['size','align','data','in','out','edge'].map(name=>({name,c:x['c_'+name]()>>>0,rust:x['r_'+name]()>>>0}));
const result={scope:'Native Wasm Linux musl C/Rust epoll_event declarations and flags used by Mio; host-instantiated Wasm, no guest poll execution',pass:rows.every(r=>r.c===r.rust),rows};
fs.writeFileSync('mio-epoll-abi/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.pass)process.exit(1);
