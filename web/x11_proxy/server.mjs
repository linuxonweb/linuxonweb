#!/usr/bin/env node
/*
 * Narrow browser-to-X11 relay.  The relay deliberately has no arbitrary
 * destination parameter: it connects to one configured loopback display only.
 * A bearer token and an exact Origin check are required before a WebSocket is
 * upgraded.  Frames carry raw X11 bytes; no protocol emulation occurs here.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const listenHost = process.env.X11_PROXY_HOST || '127.0.0.1';
const listenPort = Number(process.env.X11_PROXY_PORT || 8788);
const targetHost = process.env.X11_PROXY_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.X11_PROXY_TARGET_PORT || 6000);
const token = process.env.X11_PROXY_TOKEN;
const allowedOrigin = process.env.X11_PROXY_ORIGIN || `http://127.0.0.1:${process.env.X11_UI_PORT || 8787}`;

if (!token || token.length < 16) throw new Error('X11_PROXY_TOKEN must be a random token of at least 16 characters');
if (!['127.0.0.1', '::1', 'localhost'].includes(listenHost)) throw new Error('X11_PROXY_HOST must be loopback');
if (!['127.0.0.1', '::1', 'localhost'].includes(targetHost)) {
  throw new Error('X11_PROXY_TARGET_HOST must be loopback; remote X displays are disabled');
}
if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('invalid X11_PROXY_TARGET_PORT');

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: ${text.length}\r\n\r\n${text}`);
  socket.destroy();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
}

function allowedFetchURL(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  return url;
}

async function fetchAllowlisted(req, res, url, suppliedToken) {
  cors(res);
  const a = Buffer.from(suppliedToken || ''), b = Buffer.from(token);
  if (token && (a.length !== b.length || !crypto.timingSafeEqual(a, b))) { res.writeHead(401); return res.end('token required\n'); }
  const target = allowedFetchURL(url);
  if (!target) { res.writeHead(400); return res.end('only absolute http(s) URLs without credentials are accepted\n'); }
  try {
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { accept: '*/*' } });
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 1024 * 1024) { res.writeHead(502); return res.end('response too large\n'); }
    res.writeHead(response.status, { 'Access-Control-Allow-Origin': '*', 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(502); res.end('allowlisted fetch failed\n'); }
}

function frame(payload) {
  const bytes = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let head;
  if (bytes.length < 126) head = Buffer.from([0x82, 0x80 | bytes.length]);
  else if (bytes.length < 65536) { head = Buffer.alloc(4); head[0] = 0x82; head[1] = 0xfe; head.writeUInt16BE(bytes.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x82; head[1] = 0xff; head.writeBigUInt64BE(BigInt(bytes.length), 2); }
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, bytes]);
}

function readFrames(socket, onData, onClose) {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const first = buffer[0], second = buffer[1];
      const opcode = first & 0x0f, masked = !!(second & 0x80);
      let length = second & 0x7f, header = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); header = 4; }
      else if (length === 127) { if (buffer.length < 10) return; const n = buffer.readBigUInt64BE(2); if (n > 0x7fffffffn) return onClose(); length = Number(n); header = 10; }
      if (!masked || buffer.length < header + 4 + length) return onClose();
      const key = buffer.subarray(header, header + 4);
      const body = Buffer.from(buffer.subarray(header + 4, header + 4 + length));
      for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
      buffer = buffer.subarray(header + 4 + length);
      if (opcode === 8) return onClose();
      if (opcode === 9) { socket.write(Buffer.from([0x8a, body.length])); continue; }
      if (opcode !== 2) return onClose();
      onData(body);
    }
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS' && req.url === '/fetch') {
    cors(res); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-x11-proxy-token'); res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && req.url === '/fetch') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413); return res.end('request too large\n'); } chunks.push(chunk); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400); return res.end('invalid JSON\n'); }
    return fetchAllowlisted(req, res, body.url, req.headers['x-x11-proxy-token']);
  }
  res.writeHead(404); res.end('WebSocket or allowlisted fetch endpoint only\n');
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.headers.origin !== allowedOrigin) return reject(socket, 403, 'origin denied\n');
  if (url.pathname !== '/x11') return reject(socket, 404, 'unknown endpoint\n');
  const supplied = url.searchParams.get('token') || '';
  const a = Buffer.from(supplied), b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reject(socket, 401, 'token required\n');
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) return reject(socket, 400, 'websocket required\n');
  const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const x = net.createConnection({ host: targetHost, port: targetPort });
  let open = true;
  const close = () => { if (!open) return; open = false; x.destroy(); socket.destroy(); };
  x.on('connect', () => readFrames(socket, data => x.write(data), close));
  x.on('data', data => { if (open) socket.write(frame(data)); });
  x.on('error', close); x.on('close', close); socket.on('error', close); socket.on('close', close);
});
server.listen(listenPort, listenHost, () => console.log(`X11 relay listening ws://${listenHost}:${listenPort}/x11 -> ${targetHost}:${targetPort}`));
