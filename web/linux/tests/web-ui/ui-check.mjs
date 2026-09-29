// Finite layout check for web/linux/index.html: one static server + one Chromium.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const root = '/mnt/p6/project/linux/linuxonweb/web/linux', out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const HTTP = 4199, CDP = 9409;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  if (/initramfs|vmlinux/.test(f)) { r.writeHead(404); return r.end(); } // layout only, never boot
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(HTTP, '127.0.0.1');
const log = fs.openSync(path.join(out, 'chromium.log'), 'w');
const chrome = spawn('/home/a/.local/archpkg/pacman/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(out, 'profile')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { env: { ...process.env, XDG_CACHE_HOME: path.join(out, 'xdg') }, stdio: ['ignore', log, log] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target; for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const results = []; let failures = 0;
const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failures++; };
const app = `http://127.0.0.1:${HTTP}/index.html`;
await call('Page.enable');
async function load(w, h, resolution, mobile = false) {
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await call('Page.navigate', { url: app }); await sleep(300);
  await ev(`localStorage.setItem('linuxonweb.machine-settings.v1', JSON.stringify({resolution:'${resolution}',cpus:1,ram:1024,backend:'canvas2d'}))`);
  await call('Page.navigate', { url: app }); await sleep(1200);
}
const measure = () => ev(`(()=>{const r=e=>{const b=document.querySelector(e).getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height}};
 const st=document.querySelector('.stage');return {vw:document.documentElement.clientWidth,vh:innerHeight,scrollW:document.documentElement.scrollWidth,
 stage:r('.stage'),canvas:r('#fb'),toolbar:r('.toolbar'),settings:r('#settings-toggle'),boot:r('#boot'),logs:r('#logs-toggle'),
 stageScrolls:st.scrollWidth>st.clientWidth||st.scrollHeight>st.clientHeight,stageOverflow:getComputedStyle(st).overflow,
 panHidden:document.querySelector('#display-pan').hidden,res:document.querySelector('#resolution').value,
 options:[...document.querySelectorAll('#resolution option')].map(o=>o.value)}})()`);
const cases = [[1920, 1080, '1280x720'], [1000, 700, '1280x720'], [1920, 1080, '400x300'], [1280, 900, '800x600'], [390, 844, '400x800', true], [1280, 900, '400x800'], [700, 600, '800x600']];
for (const [w, h, res, mobile] of cases) {
  await load(w, h, res, mobile);
  const m = await measure(); const tag = `${w}x${h}@${res}`;
  const [fw, fh] = res.split('x').map(Number);
  check(`${tag} resolution applied`, m.res === res && m.canvas.width === fw && m.canvas.height === fh, m.canvas);
  check(`${tag} stage auto-sizes to canvas`, Math.abs(m.stage.width - (fw + 2)) < 0.5 && Math.abs(m.stage.height - (fh + 2)) < 0.5 && !m.stageScrolls, { stage: m.stage, overflow: m.stageOverflow });
  if (m.vw <= fw + 2) check(`${tag} display at left 0`, m.stage.left === 0, m.stage);
  else check(`${tag} display centred`, Math.abs(m.stage.left - (m.vw - m.stage.width) / 2) <= 1, { left: m.stage.left, vw: m.vw });
  check(`${tag} settings on toolbar row`, Math.abs(m.settings.top - m.boot.top) < 1 && m.settings.left < m.boot.left, { settings: m.settings, boot: m.boot });
  check(`${tag} toolbar left matches display`, Math.abs(m.toolbar.left - m.stage.left) < 1, { toolbar: m.toolbar.left, stage: m.stage.left });
  check(`${tag} icon buttons 42px`, m.boot.width === 42 && m.logs.width === 42, m.boot);
  check(`${tag} pan offered only when display exceeds window`, m.panHidden === !(fw + 2 > m.vw || fh + 2 > m.vh), { panHidden: m.panHidden, vw: m.vw, vh: m.vh });
  fs.writeFileSync(path.join(out, `${tag}.png`), Buffer.from((await call('Page.captureScreenshot', { captureBeyondViewport: false })).data, 'base64'));
  if (w === 1920 && res === '1280x720') check('resolution options include new sizes', ['400x800', '800x600', '400x300'].every(v => m.options.includes(v)), m.options);
}
// Hover label, click label, and scroll-to-top on display click (1280x900 @ 800x600).
await load(1280, 700, '1280x720');
const b = await measure();
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.boot.left + 20, y: b.boot.top + 20 }); await sleep(250);
check('hover shows label', await ev(`getComputedStyle(document.querySelector('#boot .label')).opacity`) === '1');
fs.writeFileSync(path.join(out, 'hover.png'), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'));
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 650 }); await sleep(250);
check('label hidden without hover', await ev(`getComputedStyle(document.querySelector('#boot .label')).opacity`) === '0');
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.logs.left + 20, y: b.logs.top + 20, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.logs.left + 20, y: b.logs.top + 20, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 650 }); await sleep(250);
check('click shows label and toggle text updates', await ev(`document.querySelector('#logs-toggle').classList.contains('show-label') && document.querySelector('#logs-toggle .label').textContent==='Hide logs' && !!document.querySelector('#logs-toggle svg')`));
await sleep(1500);
check('click label hides again', await ev(`!document.querySelector('#logs-toggle').classList.contains('show-label')`));
const before = await ev(`document.querySelector('.stage').getBoundingClientRect().top`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: before + 200, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: before + 200, button: 'left', clickCount: 1 }); await sleep(200);
const after = await ev(`document.querySelector('.stage').getBoundingClientRect().top`);
check('display click scrolls display top to 0', before > 1 && Math.abs(after) < 1, { before, after });
await ev(`window.scrollTo(0, scrollY + 150)`); await sleep(100);
const above = await ev(`document.querySelector('.stage').getBoundingClientRect().top`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 400, y: 300, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 400, y: 300, button: 'left', clickCount: 1 }); await sleep(200);
const after2 = await ev(`document.querySelector('.stage').getBoundingClientRect().top`);
check('display click scrolls back up when top is above viewport', above < -1 && Math.abs(after2) < 1, { above, after2 });
// Settings panel opens below the button, inside the window.
await ev(`scrollTo(0,0)`); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.settings.left + 20, y: b.settings.top + 20, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.settings.left + 20, y: b.settings.top + 20, button: 'left', clickCount: 1 }); await sleep(250);
const panel = await ev(`(()=>{const p=document.querySelector('#settings-panel');const r=p.getBoundingClientRect();return {hidden:p.hidden,left:r.left,right:r.right,top:r.top}})()`);
check('settings panel opens left-aligned under button', !panel.hidden && Math.abs(panel.left - b.settings.left) < 1 && panel.right <= 1280, panel);
fs.writeFileSync(path.join(out, 'settings.png'), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'));
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ pass: failures === 0, failures, results }, null, 1));
console.log(JSON.stringify({ pass: failures === 0, failures, failed: results.filter(r => !r.ok) }, null, 1));
await call('Browser.close').catch(() => {}); ws.close(); server.close();
await new Promise(r => chrome.once('exit', r)); process.exit(0);
