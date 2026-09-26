import { connect } from 'cloudflare:sockets';
import assets from './generated/asset-manifest.mjs';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15000;

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

export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function chunkStream(env, entry, start, end) {
  let index = 0, offset = 0, reader = null, position = 0, partEnd = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (!reader) {
            if (index === entry.parts.length || offset > end) { controller.close(); return; }
            const part = entry.parts[index++];
            const partStart = offset;
            offset += part.size;
            if (offset <= start) continue;
            const localStart = Math.max(0, start - partStart);
            const localEnd = Math.min(part.size - 1, end - partStart);
            const response = await env.ASSETS.fetch(new Request(`https://assets.local${part.path}`, {
              headers: { Range: `bytes=${localStart}-${localEnd}` },
            }));
            if (cancelled) { await response.body?.cancel(); return; }
            if ((response.status !== 200 && response.status !== 206) || !response.body) throw new Error('Asset chunk unavailable');
            // Honor a partial response, but stream and clip a full response when
            // the asset binding does not implement Range (as in local Miniflare).
            position = response.status === 206 ? partStart + localStart : partStart;
            partEnd = partStart + localEnd;
            reader = response.body.getReader();
          }
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) { reader.releaseLock(); reader = null; continue; }
          const lo = Math.max(0, start - position);
          const hi = Math.min(value.byteLength, partEnd - position + 1);
          position += value.byteLength;
          if (hi > lo) controller.enqueue(value.subarray(lo, hi));
          if (position > partEnd) { await reader.cancel(); reader.releaseLock(); reader = null; }
          if (hi > lo) return;
        }
      } catch (error) {
        await reader?.cancel().catch(() => {});
        controller.error(error);
      }
    },
    async cancel() { cancelled = true; await reader?.cancel(); },
  });
  // Workers derives Content-Length from a fixed-length stream, and detects any
  // truncated chunk instead of returning a silently incomplete initramfs.
  return stream.pipeThrough(new FixedLengthStream(end - start + 1));
}

function completeAssetStream(env, entry) {
  const output = new FixedLengthStream(entry.size);
  // Keep complete downloads in native stream pumps. Reading/enqueueing every
  // 64KiB chunk in JavaScript can exceed the Free plan's CPU budget for an 88MB
  // initramfs even though the response remains below its memory budget.
  void (async () => {
    try {
      for (const part of entry.parts) {
        const response = await env.ASSETS.fetch(`https://assets.local${part.path}`);
        if (response.status !== 200 || !response.body) throw new Error('Asset chunk unavailable');
        await response.body.pipeTo(output.writable, { preventClose: true });
      }
      await output.writable.close();
    } catch (error) {
      await output.writable.abort(error).catch(() => {});
    }
  })();
  return output.readable;
}

async function handleAsset(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/') {
    url.pathname = '/linux/index.html';
    if (!url.searchParams.has('firefox')) url.searchParams.set('firefox', '1');
    return reply(null, 302, { Location: url.pathname + url.search, 'Cache-Control': 'no-store' });
  }
  if (url.pathname === '/linux' || url.pathname === '/linux/' || url.pathname === '/desktop' || url.pathname === '/desktop/') {
    url.pathname = url.pathname.startsWith('/linux') ? '/linux/index.html' : '/desktop/index.html';
  }
  const entry = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
  if (!entry) return reply('Not found', 404);
  const etag = `"${entry.sha256}"`;
  const headers = {
    ...isolation, 'Content-Type': entry.contentType, 'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag, 'Accept-Ranges': 'bytes', 'Content-Length': String(entry.size),
  };
  if (request.headers.get('If-None-Match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
    delete headers['Content-Length'];
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  let range = null;
  if (request.headers.has('Range') && (!request.headers.has('If-Range') || request.headers.get('If-Range') === etag)) {
    range = parseRange(request.headers.get('Range'), entry.size);
    if (!range) return reply(null, 416, { 'Content-Range': `bytes */${entry.size}` });
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${entry.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
  }
  // Route every range through the clipping stream: ASSETS can return the full
  // body with 200 instead of honoring Range (including in the local runtime).
  if (entry.parts.length === 1 && !range) {
    const target = new URL(request.url);
    target.pathname = entry.parts[0].path;
    target.search = '';
    const response = await env.ASSETS.fetch(new Request(target));
    if (response.status !== 200) return reply('Asset unavailable', 502);
    return new Response(response.body, { status: 200, headers });
  }
  const body = range ? chunkStream(env, entry, range.start, range.end) : completeAssetStream(env, entry);
  return new Response(body, {
    status: range ? 206 : 200, headers,
  });
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/__reload') return reply(null, 204);
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply('Method not allowed', 405, { Allow: 'GET, HEAD' });
      if (path === '/tcp') return await handleTcp(request, env);
      if (path === '/dns') return await handleDns(request, env);
      return await handleAsset(request, env);
    } catch (error) {
      console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
      return reply('Request failed', 500);
    }
  },
};
