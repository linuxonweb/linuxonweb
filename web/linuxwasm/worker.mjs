// linuxwasm Cloudflare Worker.
// Small web files (the dev server's /desktop and /linux trees) are bundled as
// Worker static assets. The large guest packages are not: they are streamed
// from the latest GitHub release of RELEASE_REPO on every request, so
// publishing a new release updates the site without redeploying the Worker.
// /dns and /tcp are the same guest network proxy as web/cloudflare/worker.mjs.
import { connect } from 'cloudflare:sockets';
import { RELEASE_FILES } from './release-files.mjs';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15000;


const mime = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json', wasm: 'application/wasm',
  svg: 'image/svg+xml', png: 'image/png', txt: 'text/plain; charset=utf-8',
};
export function contentType(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return mime[ext] || 'application/octet-stream';
}

function reply(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...isolation, ...headers } });
}

function json(body, status = 200, headers = {}) {
  return reply(JSON.stringify(body), status, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers,
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return origin === new URL(request.url).origin || allowed.includes(origin) ? origin : false;
}

// The guest currently uses AF_INET. Reject alternative numeric spellings and
// reserved networks before connect(), then pin DNS names to the checked A record.
export function publicIPv4(host) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)) return false;
  const [a, b, c, d] = host.split('.').map(Number);
  if ([a, b, c, d].some(value => value > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function validHostname(host) {
  return host.length <= 253 && host.includes('.') && !/^[\d.]+$/.test(host) &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
    !/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|onion)$/i.test(host);
}

async function resolvePublic(host) {
  if (publicIPv4(host)) return [host];
  if (!validHostname(host)) throw new Error('Invalid or non-public destination');
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', host);
  url.searchParams.set('type', 'A');
  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('DNS resolver unavailable');
  const result = await response.json();
  if (result.Status !== 0) return [];
  return [...new Set((result.Answer || [])
    .filter(answer => answer.type === 1 && publicIPv4(answer.data)).map(answer => answer.data))];
}

async function handleDns(request, env) {
  const origin = allowedOrigin(request, env);
  if (origin === false) return json({ error: 'Origin denied', addresses: [] }, 403);
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const name = (new URL(request.url).searchParams.get('name') || '').trim().replace(/\.$/, '');
  if (!publicIPv4(name) && !validHostname(name)) return json({ error: 'Invalid name', addresses: [] }, 400, cors);
  try {
    const addresses = await resolvePublic(name);
    return json({ addresses }, addresses.length ? 200 : 404, cors);
  } catch {
    return json({ error: 'DNS lookup failed', addresses: [] }, 502, cors);
  }
}

async function handleTcp(request, env) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return reply('WebSocket upgrade required', 426, { Upgrade: 'websocket' });
  }
  // Browser guest connections always carry an Origin. This is deliberately not
  // a general cross-site proxy; explicit additional app origins can be configured.
  if (!allowedOrigin(request, env)) return reply('Origin denied', 403);
  const url = new URL(request.url);
  const host = (url.searchParams.get('host') || '').trim().replace(/\.$/, '');
  const portText = url.searchParams.get('port') || '';
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535 || port === 25 ||
      (!publicIPv4(host) && !validHostname(host))) return reply('Invalid or non-public destination', 400);
  let addresses;
  try { addresses = await resolvePublic(host); }
  catch { return reply('DNS lookup failed', 502); }
  if (!addresses.length) return reply('No public IPv4 destination', 403);

  const [client, server] = Object.values(new WebSocketPair());
  server.binaryType = 'arraybuffer';
  // TLS is performed by Firefox inside the guest. Turning on socket TLS here
  // would wrap its TLS records a second time and break HTTPS.
  let socket;
  try { socket = connect({ hostname: addresses[0], port }, { secureTransport: 'off' }); }
  catch { return reply('TCP connection failed', 502); }
  let stopped = false;
  let pendingBytes = 0;
  let writer;
  let reader;
  let connectTimer;
  const stop = (code = 1000, reason = 'TCP closed') => {
    if (stopped) return;
    stopped = true;
    clearTimeout(connectTimer);
    try { server.close(code, reason); } catch { /* already closed */ }
    void socket.close().catch(() => {});
  };
  const opened = Promise.race([
    socket.opened,
    new Promise((_, reject) => {
      connectTimer = setTimeout(() => reject(new Error('TCP connection timeout')), CONNECT_TIMEOUT_MS);
    }),
  ]).then(() => { clearTimeout(connectTimer); });
  // Register the entire write queue before accepting, so early TLS ClientHello
  // frames wait for connection establishment and retain their original order.
  let writes = opened;
  server.addEventListener('message', event => {
    if (stopped) return;
    const data = event.data;
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
      stop(1003, 'Binary frames required'); return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) :
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (pendingBytes + bytes.byteLength > MAX_PENDING_BYTES) {
      stop(1009, 'TCP write queue full'); return;
    }
    pendingBytes += bytes.byteLength;
    writes = writes.then(async () => {
      if (stopped) return;
      writer ||= socket.writable.getWriter();
      await writer.write(bytes);
    }).catch(() => stop(1011, 'TCP write failed')).finally(() => { pendingBytes -= bytes.byteLength; });
  });
  server.addEventListener('close', () => stop());
  server.addEventListener('error', () => stop(1011, 'WebSocket error'));
  server.accept();
  void socket.closed.catch(() => stop(1011, 'TCP connection failed'));
  void (async () => {
    try {
      await opened;
      if (stopped) return;
      reader = socket.readable.getReader();
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (server.readyState !== 1) break;
        server.send(value);
      }
      stop();
    } catch { stop(1011, 'TCP connection failed'); }
    finally { reader?.releaseLock(); }
  })();
  // Keep rejection handled even when the client never sends a frame.
  void writes.catch(() => stop(1011, 'TCP connection failed'));
  return new Response(null, { status: 101, webSocket: client, headers: isolation });
}

export function releaseUrl(env, name) {
  const repo = env.RELEASE_REPO || 'linuxonweb/linuxonweb';
  return `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(name)}`;
}

// Stream one package from the latest release. GitHub answers with a redirect to
// its asset CDN, which honors Range. HEAD is served from a one-byte ranged GET
// because the signed CDN URL is not guaranteed to accept HEAD.
async function handleRelease(request, env, path, name) {
  const range = request.headers.get('Range');
  const head = request.method === 'HEAD';
  const upstreamHeaders = { 'User-Agent': 'linuxwasm-worker' };
  if (head) upstreamHeaders.Range = 'bytes=0-0';
  else if (range) upstreamHeaders.Range = range;
  const upstream = await fetch(releaseUrl(env, name), { headers: upstreamHeaders, redirect: 'follow' });
  if (upstream.status === 404) return reply('Package not in latest release', 404, { 'Cache-Control': 'no-store' });
  if (upstream.status === 416) {
    return reply(null, 416, { 'Content-Range': upstream.headers.get('Content-Range') || 'bytes */*' });
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    return reply('Package download failed', 502, { 'Cache-Control': 'no-store' });
  }
  const headers = {
    ...isolation, 'Content-Type': contentType(path), 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
  };
  for (const name of ['Last-Modified', 'ETag']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  const contentRange = upstream.headers.get('Content-Range');
  if (head) {
    void upstream.body?.cancel();
    const total = /\/(\d+)$/.exec(contentRange || '')?.[1] ?? upstream.headers.get('Content-Length');
    if (total) headers['Content-Length'] = total;
    return new Response(null, { status: 200, headers });
  }
  const length = upstream.headers.get('Content-Length');
  if (length) headers['Content-Length'] = length;
  if (upstream.status === 206 && contentRange) headers['Content-Range'] = contentRange;
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Same path mapping as web/desktop/serve.mjs, onto the bundled asset tree.
export function assetPath(pathname) {
  if (pathname === '/linux' || pathname === '/linux/') return '/linux/index.html';
  if (pathname === '/desktop' || pathname === '/desktop/') return '/desktop/index.html';
  if (pathname.startsWith('/upstream/xvfb/')) return `/desktop/artifacts/xvfb/${pathname.slice('/upstream/xvfb/'.length)}`;
  if (pathname.startsWith('/upstream/aurora/')) return `/desktop/artifacts/aurora/${pathname.slice('/upstream/aurora/'.length)}`;
  if (pathname === '/upstream/browser-posix-websocket.js') return '/desktop/browser-posix-websocket.js';
  if (pathname === '/upstream/aurora-runner.js') return '/desktop/aurora-runner.js';
  if (pathname === '/upstream/xvfb-runner.js') return '/desktop/xvfb-runner.js';
  if (pathname.startsWith('/linux/') || pathname.startsWith('/desktop/')) return pathname;
  return null;
}

async function handleAsset(request, env, pathname) {
  const path = assetPath(pathname);
  if (!path || path.includes('/../')) return reply('Not found', 404);
  const target = new URL(request.url);
  target.pathname = path;
  target.search = '';
  const response = await env.ASSETS.fetch(new Request(target, {
    method: request.method,
    headers: request.headers,
  }));
  if (response.status === 404 || response.status === 307 || response.status === 308) return reply('Not found', 404);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(isolation)) headers.set(name, value);
  headers.set('Content-Type', contentType(path));
  headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === '/') {
        return reply(null, 302, { Location: '/linux/index.html?firefox=1', 'Cache-Control': 'no-store' });
      }
      // The dev server's live-reload stream; 204 tells EventSource not to reconnect.
      if (path === '/__reload') return reply(null, 204);
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply('Method not allowed', 405, { Allow: 'GET, HEAD' });
      if (path === '/tcp') return await handleTcp(request, env);
      if (path === '/dns') return await handleDns(request, env);
      if (Object.hasOwn(RELEASE_FILES, path)) return await handleRelease(request, env, path, RELEASE_FILES[path]);
      return await handleAsset(request, env, path);
    } catch (error) {
      console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
      return reply('Request failed', 500);
    }
  },
};
