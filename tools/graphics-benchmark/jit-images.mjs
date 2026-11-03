export function leb(v){const a=[];do{const b=v&127;v>>>=7;a.push(b|(v?128:0));}while(v);return a;}
function sleb(v){const a=[];for(;;){const b=v&127;v>>=7;const done=(v===0&&!(b&64))||(v===-1&&(b&64));a.push(b|(done?0:128));if(done)return a;}}
export function image(value,padding=0){
 const parts=[Uint8Array.of(0,97,115,109,1,0,0,0)],sec=(id,b)=>parts.push(Uint8Array.of(id),Uint8Array.from(leb(b.length)),Uint8Array.from(b));
 if(padding){const b=new Uint8Array(padding+1);b.fill(value&255,1);sec(0,b);}
 sec(1,[1,96,0,1,127]);sec(3,[1,0]);sec(7,[1,2,102,48,0,0]);const body=[0,65,...sleb(value),11];sec(10,[1,...leb(body.length),...body]);
 const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;
}
