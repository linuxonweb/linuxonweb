// Bodies have no arguments; admitted loops use var locals and >1000 heads.
// Results are constants derived independently, not a second execution oracle.
export const cases = [
  {id:'sum', claim:'compiled', expected:8386560, body:'var i=0,s=0; for(i=0;i<4096;i++)s=s+i; return s;'},
  {id:'branch', claim:'compiled', expected:6144, body:'var i=0,s=0; for(i=0;i<4096;i++){if(i&1)s=s+2;else s=s+1;}return s;'},
  {id:'overflow', claim:'bailout', expected:2147485695, body:'var i=0,s=0;for(i=0;i<4096;i++){if(i==2048)s=2147483647;s=s+1;}return s;'},
  {id:'negzero', claim:'bailout', expected:'-0', body:'var i=0,x=1;for(i=0;i<4097;i++){if(i==2048)x=0;x=x*-1;}return x;'},
  {id:'modzero', claim:'bailout', expected:'NaN', body:'var i=0,d=3,x=0;for(i=0;i<4096;i++){if(i==2048)d=0;x=i%d;}return x;'},
  {id:'modnegative', claim:'bailout', expected:'-0', body:'var i=0,x=1;for(i=0;i<4096;i++)x=(-i)%3;return x;'},
  {id:'modoverflow', claim:'bailout', expected:'-0', body:'var i=0,x=1,v=1;for(i=0;i<4096;i++){if(i==2048)v=-2147483648;x=v%-1;}return x;'},
  {id:'typechange', claim:'bailout', expected:4398046513152, body:'var i=0,x=1,s=0;for(i=0;i<4096;i++){if(i==2048)x=x+2147483647;s=s+x;}return s;'},
  {id:'typenonnumeric', claim:'excluded', expected:'changed', body:'var i=0,x=1;for(i=0;i<4096;i++){if(i==2048)x="changed";}return x;'},
  {id:'stackrestore', claim:'bailout', expected:2147495935, body:'var i=0,x=0,s=0;for(i=0;i<4096;i++){if(i==2048)x=2147483647;s=(s+2)+(x+1);x=0;}return s;'},
  {id:'argument', claim:'excluded', args:[3], expected:12288, parameters:'v', body:'var i=0,s=0;for(i=0;i<4096;i++)s=s+v;return s;'},
  {id:'double', claim:'excluded', expected:2048, body:'var i=0,s=0.5;for(i=0;i<4096;i++)s=s+0.5;return s-0.5;'},
  {id:'lexical', claim:'excluded', expected:8386560, body:'let s=0;for(let i=0;i<4096;i++)s=s+i;return s;'},
  {id:'array', claim:'excluded', expected:8192, body:'var i=0,s=0,a=[2];for(i=0;i<4096;i++)s=s+a[0];return s;'},
  {id:'property', claim:'excluded', expected:12288, body:'var i=0,s=0,o={x:3};for(i=0;i<4096;i++)s=s+o.x;return s;'},
  {id:'math', claim:'excluded', expected:4096, body:'var i=0,s=0;for(i=0;i<4096;i++)s=s+Math.abs(-1);return s;'},
  {id:'call', claim:'excluded', expected:4096, body:'var i=0,s=0,f=function(){return 1;};for(i=0;i<4096;i++)s=s+f();return s;'},
  {id:'handler', claim:'policy-excluded', expected:8386560, body:'var i=0,s=0;try{for(i=0;i<4096;i++)s=s+i;}finally{s=s+0;}return s;'},
  {id:'throw', claim:'policy-excluded', expected:19, throws:true, body:'var i=0,s=0;for(i=0;i<4096;i++)s=s+i;throw 19;'},
];
export const encode = value => Object.is(value,-0)?'-0':Number.isNaN(value)?'NaN':value;
export function source(c){return `globalThis.njs_${c.id}=function njs_${c.id}(${c.parameters||''}){${c.body}};\n`;}
