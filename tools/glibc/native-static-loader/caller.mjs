import fs from 'node:fs';
const task=process.argv[2],m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/caller.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('unexpected imports');
const e=new WebAssembly.Instance(m).exports;
const align=e.__tls_align.value,size=e.__tls_size.value;
const tls=Math.ceil(e.__heap_base.value/align)*align;
e.__tls_base.value=tls;e.__wasm_init_tls(tls);
let checks=0;const rows=[];
for(let pass=0;pass<16;++pass)for(const [mode,expected] of [[0,0],[1,1],[2,2],[3,0],[4,2],[5,11]]){
 const actual=e.caller_entry(mode);checks++;if(actual!==expected)throw Error(`caller mode ${mode}: ${actual} != ${expected}`);rows.push({pass,mode,actual});
}
let unseeded=false;try{e.unseeded_entry();}catch(x){unseeded=x instanceof WebAssembly.RuntimeError;}
checks++;if(!unseeded)throw Error('unseeded external entry accepted stale caller');
let trapped=false;try{e.caller_entry(6);}catch(x){trapped=x instanceof WebAssembly.RuntimeError;}
checks++;if(!trapped)throw Error('unknown indirect target did not reject');
checks++;if(e.uncovered_entered()!==0)throw Error('uncovered non-NULL body was entered');
const report={pass:true,checks,cases:rows.length,rows,unknownNonNullIndirectRejected:trapped,uncoveredBodyEntered:e.uncovered_entered(),unseededEntryRejected:unseeded,tls,align,size,scope:'Finite native post-O2 caller identity gate only; no GNU loader runtime acceptance'};
fs.writeFileSync(`${task}/logs/caller-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,checks,cases:rows.length}));
