import { cases, source, encode } from './cases.mjs';
import { broadCases } from './cases-broad.mjs';
const coverage=process.argv[2]||'integer';
if(!['integer','broad'].includes(coverage))throw Error('unknown semantic coverage');
const selected=coverage==='broad'?broadCases:cases;
let checks=0;
for(const c of selected){
  (0,eval)(source(c));
  for(let round=0;round<16;round++){
    let got,threw=false;
    try{got=globalThis['njs_'+c.id](...(c.args||[]));}catch(e){got=e;threw=true;}
    if(!Object.is(encode(got),c.expected)||threw!==!!c.throws)throw Error(c.id+' got '+String(got)+' expected '+String(c.expected));
    checks++;
  }
}
console.log(JSON.stringify({kind:'Node-semantic-preparation',coverage,pass:true,checks,cases:selected.length,guestAcceptance:false}));
