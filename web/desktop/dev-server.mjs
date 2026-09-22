#!/usr/bin/env node
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const desktop = join(root, 'web/desktop');
const port = Number(process.env.LINUX_WEB_PORT || 4173);
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
const server = createServer(async (request, response) => {
  const requestPath = request.url?.split('?')[0];
  if (requestPath === '/dns') { void handleDns(request, response); return; }
  if (requestPath === '/__reload') {
    response.writeHead(200, { ...headers('text/event-stream; charset=utf-8'), Connection: 'keep-alive' });
    response.write(': connected\n\n'); reloadClients.add(response);
    request.on('close', () => reloadClients.delete(response));
    return;
  }
  const target = safePath(request.url || '/');
  if (!target) { response.writeHead(404); response.end('not found'); return; }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not file');
    const body = await readFile(target);
    response.writeHead(200, headers(mime[extname(target)] || 'application/octet-stream'));
    response.end(body);
  } catch { response.writeHead(404); response.end('not found'); }
});
server.on('upgrade', (request, socket, head) => {
  const requestPath = request.url?.split('?')[0];
  if (requestPath === '/tcp') { handleTcpWebSocket(request, socket, head); return; }
  socket.destroy();
});
server.listen(port, '127.0.0.1', () => console.log(`linuxonweb desktop http://127.0.0.1:${port}/desktop/index.html?wm=1&firefox=1`));

function changed(filename) {
  const path = String(filename || '');
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
process.on('SIGTERM', () => server.close(() => process.exit(0)));
