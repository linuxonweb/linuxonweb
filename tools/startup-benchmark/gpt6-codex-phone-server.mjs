import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { routePath } from './gpt6-codex-contract.mjs';

export async function serveFrozenRoutes(input, observe = () => {}) {
  const routes = structuredClone(input);
  for (const entry of Object.values(routes)) {
    const hash = crypto.createHash('sha256');
    for await (const bytes of fs.createReadStream(entry.snapshot)) hash.update(bytes);
    if (hash.digest('hex') !== entry.sha256 || fs.statSync(entry.snapshot).size !== entry.bytes) {
      throw Error(`Frozen input mismatch: ${entry.snapshot}`);
    }
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' };
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let route;
    try { route = routePath(request.url); }
    catch { response.writeHead(400, headers); response.end(); return; }
    if (route === '/owner-setup') {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><title>Private Firefox phone test</title>');
      return;
    }
    const entry = Object.hasOwn(routes, route) ? routes[route] : null;
    observe({ route, status: entry ? 200 : 404, at: Date.now(), bytes: entry?.bytes });
    if (!entry) { response.writeHead(404, headers); response.end(); return; }
    response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(route)] || 'application/octet-stream', 'Content-Length': entry.bytes });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(entry.snapshot);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return server;
}
