#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const desktop = join(root, 'web/desktop');
const port = Number(process.env.LINUX_WEB_PORT || 4173);
const reloadClients = new Set();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function headers(type) {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
}
function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const mapped = decoded === '/' ? '/web/desktop/index.html' :
    decoded.startsWith('/desktop/') ? `/web/desktop/${decoded.slice('/desktop/'.length)}` :
    decoded.startsWith('/upstream/xvfb/') ? `/web/desktop/artifacts/xvfb/${decoded.slice('/upstream/xvfb/'.length)}` :
    decoded.startsWith('/upstream/aurora/') ? `/web/desktop/artifacts/aurora/${decoded.slice('/upstream/aurora/'.length)}` :
    decoded === '/upstream/browser-posix-websocket.js' ? '/web/desktop/browser-posix-websocket.js' :
    decoded === '/upstream/aurora-runner.js' ? '/web/desktop/aurora-runner.js' :
    decoded === '/upstream/xvfb-runner.js' ? '/web/desktop/xvfb-runner.js' : null;
  if (!mapped) return null;
  const target = normalize(join(root, mapped));
  return target.startsWith(root + '/') ? target : null;
}
const server = createServer(async (request, response) => {
  if (request.url?.split('?')[0] === '/__reload') {
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
server.listen(port, '127.0.0.1', () => console.log(`linuxonweb desktop http://127.0.0.1:${port}/desktop/index.html?wm=1&firefox=1`));

function changed(filename) {
  const path = String(filename || '');
  return path.includes('web/desktop') || path.includes('vendor/aurorawm');
}
for (const directory of [join(root, 'web/desktop'), join(root, 'vendor/aurorawm')]) {
  try {
    watch(directory, { recursive: true }, (_, filename) => {
      if (!changed(join(directory, filename || ''))) return;
      for (const client of reloadClients) client.write(`data: ${JSON.stringify(String(filename || 'change'))}\n\n`);
    });
  } catch (error) { console.warn(`watch unavailable for ${directory}: ${error.message}`); }
}
process.on('SIGTERM', () => server.close(() => process.exit(0)));
