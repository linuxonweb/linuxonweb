// Broad admission is separate from the unchanged integer control cases.
import { cases } from './cases.mjs';

const admitted = new Set(['argument', 'double', 'lexical', 'array', 'property', 'math']);
export const broadCases = [
  ...cases.map(c => ({ ...c, claim: admitted.has(c.id) ? 'compiled' : c.claim })),
  {id:'setarg', claim:'compiled', args:[3], expected:4099, parameters:'v', body:'var i=0;for(i=0;i<4096;i++)v=v+1;return v;'},
  {id:'doublediv', claim:'compiled', args:[1], expected:1024.5, parameters:'v', body:'var i=0,s=0.5;for(i=0;i<4096;i++)s=s+v/4;return s;'},
  {id:'arraywrite', claim:'compiled', expected:4097, body:'var i=0,a=[1];for(i=0;i<4096;i++)a[0]+=1;return a[0];'},
  {id:'arraylength', claim:'compiled', expected:12288, body:'var i=0,s=0,a=[1,2,3];for(i=0;i<4096;i++)s=s+a.length;return s;'},
  {id:'propertywrite', claim:'compiled', expected:4097, body:'var i=0,o={x:1};for(i=0;i<4096;i++)o.x=o.x+1;return o.x;'},
  {id:'mathmax', claim:'compiled', expected:8386563, body:'var i=0,s=0;for(i=0;i<4096;i++)s=s+Math.max(i,2);return s;'},
];
