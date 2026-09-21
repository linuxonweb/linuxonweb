/* Minimal real X11 client: setup, create/map window, GC, PolyFillRectangle,
 * ImageText8 and GetImage. It is intentionally wire-level, so the pixels on
 * the canvas come from the configured X server rather than a canvas emulator. */
const status = document.querySelector('#status');
const network = document.querySelector('#network');
const canvas = document.querySelector('#screen'), ctx = canvas.getContext('2d');
const token = new URLSearchParams(location.search).get('token') || '';
const wsURL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8788/x11?token=${encodeURIComponent(token)}`;
const socket = new WebSocket(wsURL); socket.binaryType = 'arraybuffer';
let rx = new Uint8Array(0), seq = 0, root = 0, visual = 0, wid = 0x200001, gc = 0x200002;
let setupDone = false, pendingImage = false;
const u16 = (a, o) => a[o] | (a[o + 1] << 8), u32 = (a, o) => (a[o] | a[o+1] << 8 | a[o+2] << 16 | a[o+3] << 24) >>> 0;
function put16(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255} function put32(a,o,v){a[o]=v&255;a[o+1]=v>>>8;a[o+2]=v>>>16;a[o+3]=v>>>24}
function send(a){if(socket.readyState===1){socket.send(a);seq=(seq+1)&65535}}
function requestSetup(){const a=new Uint8Array(12);a[0]=0x6c;put16(a,2,11);put16(a,4,0);put16(a,6,0);put16(a,8,0);put16(a,10,0);send(a)}
function setup(a){if(a[0]!==1)throw Error(`X setup failed (${a[1]})`);const bodyLen=u16(a,6)*4; if(a.length<8+bodyLen)return false; const vendor=u16(a,24), roots=a[28], formats=a[29]; let o=8+32+((vendor+3)&~3)+formats*8; if(!roots)return false; root=u32(a,o); visual=u32(a,o+32); setupDone=true; drawWindow(); return true}
function drawWindow(){const create=new Uint8Array(32);create[0]=1;create[1]=0;put16(create,2,8);put32(create,4,wid);put32(create,8,root);put16(create,12,30);put16(create,14,30);put16(create,16,740);put16(create,18,500);put16(create,20,0);put16(create,22,1);put32(create,24,visual);put32(create,28,0);send(create);const map=new Uint8Array(8);map[0]=8;put16(map,2,2);put32(map,4,wid);send(map);const createGc=new Uint8Array(16);createGc[0]=55;put16(createGc,2,4);put32(createGc,4,gc);put32(createGc,8,wid);put32(createGc,12,0);send(createGc);text('linux-on-web: real X11 protocol',20,40);text('press a key to send an ImageText8 request',20,65);fill(10,80,500,30);capture()}
function fill(x,y,w,h){const a=new Uint8Array(24);a[0]=70;put16(a,2,6);put32(a,4,gc);put32(a,8,wid);put16(a,12,x);put16(a,14,y);put16(a,16,w);put16(a,18,h);send(a)}
function text(s,x,y){const bytes=new TextEncoder().encode(s);const n=new Uint8Array(16+((bytes.length+3)&~3));n[0]=76;put16(n,2,n.length/4);put32(n,4,wid);put32(n,8,gc);put16(n,12,x);put16(n,14,y);n[16]=bytes.length;n.set(bytes,17);send(n)}
function capture(){const a=new Uint8Array(24);a[0]=73;a[1]=2;put16(a,2,5);put32(a,4,wid);put16(a,8,0);put16(a,10,0);put16(a,12,740);put16(a,14,500);put32(a,16,0xffffffff);send(a);pendingImage=true}
function consume(){while(rx.length>=32){if(!setupDone){if(!setup(rx))return;rx=rx.slice(8+u16(rx,6)*4);continue}const len=u32(rx,4)*4,total=32+len;if(rx.length<total)return;if(rx[0]===1&&pendingImage){const w=740,h=500,src=rx.slice(32,total),img=ctx.createImageData(w,h);for(let i=0;i<w*h;i++){img.data[i*4]=src[i*4+2]||0;img.data[i*4+1]=src[i*4+1]||0;img.data[i*4+2]=src[i*4]||0;img.data[i*4+3]=255}ctx.putImageData(img,30,30);pendingImage=false}rx=rx.slice(total)}}
socket.onopen=requestSetup; socket.onmessage=e=>{const n=new Uint8Array(e.data),next=new Uint8Array(rx.length+n.length);next.set(rx);next.set(n,rx.length);rx=next;try{consume();status.textContent='Connected to real X11; setup and drawing requests sent.'}catch(err){status.textContent=`X11 protocol error: ${err.message}`}};socket.onerror=()=>status.textContent='Relay connection failed (start server with a token).';
addEventListener('keydown',e=>{if(!setupDone)return;text(e.key.length===1?e.key:'[ '+e.key+' ]',20,130);capture()});
document.querySelector('#fetch-bing').onclick = async () => {
  network.textContent = 'Requesting allowlisted https://www.bing.com through loopback bridge…';
  try { const target = document.querySelector('#network-url').value; const r = await fetch('http://127.0.0.1:8788/fetch', { method:'POST', headers:{'content-type':'application/json','x-x11-proxy-token':token}, body:JSON.stringify({url:target}) }); network.textContent = `Bridge response: HTTP ${r.status} (${(await r.text()).length} bytes)`; }
  catch (e) { network.textContent = `Bridge unavailable: ${e.message}`; }
};
