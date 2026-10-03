import { cases, source, encode } from './cases.mjs';
let checks=0;
for(const c of cases){
  (0,eval)(source(c));
  for(let round=0;round<16;round++){
    let got,threw=false;
    try{got=globalThis['njs_'+c.id](...(c.args||[]));}catch(e){got=e;threw=true;}
    if(!Object.is(encode(got),c.expected)||threw!==!!c.throws)throw Error(c.id+' got '+String(got)+' expected '+String(c.expected));
    checks++;
  }
}
console.log(JSON.stringify({kind:'Node-semantic-preparation',pass:true,checks,cases:cases.length,guestAcceptance:false}));
