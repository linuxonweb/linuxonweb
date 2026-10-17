import { createServer } from 'node:http';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, watch } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const desktop = join(root, 'web/desktop');
const port = Number(process.env.LINUX_WEB_PORT || 4173);
// Built files published by publish-build.mjs; they are served in place of the
// same names under /linux/ (see dev-server.mjs, which restarts this server).
const latest = join(desktop, 'latest-build');
const buildId = await readFile(join(latest, 'latest-build.json'), 'utf8')
  .then(text => String(JSON.parse(text).id), () => 'repo');
const reloadClients = new Set();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.cpio': 'application/octet-stream', '.gz': 'application/octet-stream', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json' };

function headers(type) {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
}
function acceptKey(key) {
  return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}
function wsFrame(payload, opcode = 2) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  if (len < 126) return Buffer.concat([Buffer.from([0x80 | opcode, len]), data]);
  if (len < 65536) {
    const head = Buffer.alloc(4);
    head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2);
    return Buffer.concat([head, data]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x80 | opcode; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6);
  return Buffer.concat([head, data]);
}
function wsParser(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0); let closed = false;
  const finish = () => { if (!closed) { closed = true; onClose(); } };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f; const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f; let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10 || buffer.readUInt32BE(2) !== 0) { socket.destroy(); return; } length = buffer.readUInt32BE(6); offset = 10; }
      const total = offset + (masked ? 4 : 0) + length;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      let payload = buffer.subarray(offset + (masked ? 4 : 0), total);
      buffer = buffer.subarray(total);
      if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      if (opcode === 8) { finish(); return; }
      if (opcode === 9) { socket.write(wsFrame(payload, 10)); continue; }
      if (opcode === 1 || opcode === 2) onMessage(payload);
    }
  });
  socket.on('close', finish); socket.on('error', finish);
}
function upgradeWebSocket(request, socket, head) {
  const key = request.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  if (head?.length) socket.unshift(head);
  return socket;
}
function handleTcpWebSocket(request, socket, head) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const host = (url.searchParams.get('host') || '').trim();
  const targetPort = Number(url.searchParams.get('port') || '');
  const ws = upgradeWebSocket(request, socket, head);
  if (!ws) return;
  if (!host || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    ws.write(wsFrame(Buffer.from('invalid host/port'), 1)); ws.end(); return;
  }
  const remote = net.connect({ host, port: targetPort });
  let closed = false;
  const closeBoth = () => { if (closed) return; closed = true; remote.destroy(); ws.end(); };
  remote.on('connect', () => wsParser(ws, (payload) => { if (!remote.destroyed) remote.write(payload); }, closeBoth));
  remote.on('data', (chunk) => { if (!ws.destroyed) ws.write(wsFrame(chunk)); });
  remote.on('error', closeBoth); remote.on('close', closeBoth); ws.on('error', closeBoth);
}
async function handleDns(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const name = (url.searchParams.get('name') || '').trim();
  if (!name || /[\s/\\]/.test(name)) { response.writeHead(400, headers('application/json')); response.end(JSON.stringify({ error: 'invalid name' })); return; }
  try {
    const addresses = await dns.resolve4(name);
    response.writeHead(200, headers('application/json')); response.end(JSON.stringify({ addresses }));
  } catch (error) {
    response.writeHead(404, headers('application/json')); response.end(JSON.stringify({ error: String(error), addresses: [] }));
  }
}
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const mapped = decoded === '/' ? '/web/desktop/index.html' :
    decoded.startsWith('/desktop/') ? `/web/desktop/${decoded.slice('/desktop/'.length)}` :
    decoded.startsWith('/upstream/xvfb/') ? `/web/desktop/artifacts/xvfb/${decoded.slice('/upstream/xvfb/'.length)}` :
    decoded.startsWith('/upstream/aurora/') ? `/web/desktop/artifacts/aurora/${decoded.slice('/upstream/aurora/'.length)}` :
    decoded === '/upstream/browser-posix-websocket.js' ? '/web/desktop/browser-posix-websocket.js' :
    decoded === '/upstream/aurora-runner.js' ? '/web/desktop/aurora-runner.js' :
    decoded === '/upstream/xvfb-runner.js' ? '/web/desktop/xvfb-runner.js' :
    decoded.startsWith('/linux/') ? `/web/linux/${decoded.slice('/linux/'.length)}` : null;
  if (!mapped) return null;
  const target = normalize(join(root, mapped));
  return target.startsWith(root + '/') ? target : null;
}
// One byte range ("bytes=a-b", "bytes=a-", "bytes=-n"). Returns null when the
// whole file should be sent, 'invalid' when the range cannot be satisfied.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start, end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start >= size || start > end ? 'invalid' : [start, end];
}
// A published build file replaces the repo file with the same /linux/ path.
async function servedPath(urlPath) {
  const target = safePath(urlPath);
  if (!target || !target.startsWith(join(root, 'web/linux') + '/')) return target;
  const published = join(latest, target.slice(join(root, 'web/linux').length + 1));
  return await stat(published).then(info => info.isFile() ? published : target, () => target);
}
const server = createServer(async (request, response) => {
  const requestPath = request.url?.split('?')[0];
  if (requestPath === '/dns') { void handleDns(request, response); return; }
  if (requestPath === '/__reload') {
    response.writeHead(200, { ...headers('text/event-stream; charset=utf-8'), Connection: 'keep-alive' });
    // A page that saw an older build (EventSource reconnects with its last id) reloads now.
    const seen = request.headers['last-event-id'];
    response.write(`id: ${buildId}\n${seen && seen !== buildId ? 'data: "build"\n' : ': connected\n'}\n`);
    reloadClients.add(response);
    request.on('close', () => reloadClients.delete(response));
    return;
  }
  const target = await servedPath(request.url || '/');
  if (!target) { response.writeHead(404); response.end('not found'); return; }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not file');
    const type = mime[extname(target)] || 'application/octet-stream';
    // Byte ranges let the page fetch one large package as parallel segments.
    const range = parseRange(request.headers.range, info.size);
    if (range === 'invalid') {
      response.writeHead(416, { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${info.size}` });
      response.end();
      return;
    }
    let stream;
    if (range) {
      const [start, end] = range;
      response.writeHead(206, {
        ...headers(type),
        'Accept-Ranges': 'bytes',
        'Last-Modified': info.mtime.toUTCString(),
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': String(end - start + 1),
      });
      if (request.method === 'HEAD') { response.end(); return; }
      stream = createReadStream(target, { start, end });
    } else {
      // The file's modified time lets the page tell whether a stored copy is current.
      response.writeHead(200, { ...headers(type), 'Accept-Ranges': 'bytes', 'Last-Modified': info.mtime.toUTCString(), 'Content-Length': String(info.size) });
      // HEAD gets the same headers (including the modified time) without the body.
      if (request.method === 'HEAD') { response.end(); return; }
      stream = createReadStream(target);
    }
    stream.once('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });
    stream.pipe(response);
  } catch { response.writeHead(404); response.end('not found'); }
});
server.on('upgrade', (request, socket, head) => {
  const requestPath = request.url?.split('?')[0];
  if (requestPath === '/tcp') { handleTcpWebSocket(request, socket, head); return; }
  socket.destroy();
});
server.listen(port, '127.0.0.1', () => console.log(`linuxonweb desktop http://127.0.0.1:${port}/desktop/index.html?wm=1&firefox=1 (build ${buildId})`));

function changed(filename) {
  const path = String(filename || '');
  if (path.startsWith(latest + '/')) return false;
  return path.includes('web/desktop') || path.includes('web/linux') || path.includes('vendor/aurorawm');
}
for (const directory of [join(root, 'web/desktop'), join(root, 'web/linux'), join(root, 'vendor/aurorawm')]) {
  try {
    watch(directory, { recursive: true }, (_, filename) => {
      if (!changed(join(directory, filename || ''))) return;
      for (const client of reloadClients) client.write(`data: ${JSON.stringify(String(filename || 'change'))}\n\n`);
    });
  } catch (error) { console.warn(`watch unavailable for ${directory}: ${error.message}`); }
}
process.on('SIGTERM', () => {
  for (const client of reloadClients) client.end();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  // A response still streaming a large archive can hold close() open; the
  // supervisor waits for this exit before starting the next server.
  setTimeout(() => process.exit(0), 2000).unref();
});
