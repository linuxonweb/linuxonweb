#!/usr/bin/env node
// Consumes a short-lived upload session obtained through Cloudflare's API.
// Never logs upload/completion credentials.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [sessionPath, completionPath] = process.argv.slice(2);
if (!sessionPath || !completionPath) throw new Error('Usage: node upload-assets.mjs SESSION_FILE COMPLETION_FILE');
const session = JSON.parse(await readFile(sessionPath, 'utf8'));
const manifest = JSON.parse(await readFile(resolve(here, 'generated/upload-manifest.json'), 'utf8'));
const byHash = new Map(Object.entries(manifest).map(([path, value]) => [value.hash, path]));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
let completion = session.buckets.length ? null : session.jwt;
for (const [index, bucket] of session.buckets.entries()) {
  const body = new FormData();
  let bytes = 0;
  for (const hash of bucket) {
    const path = byHash.get(hash);
    if (!path) throw new Error(`Unknown requested asset: ${hash}`);
    const data = await readFile(resolve(here, 'public', '.' + path));
    bytes += data.length;
    body.append(hash, new Blob([data.toString('base64')], { type: mime[extname(path)] || 'application/octet-stream' }), hash);
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${session.accountId}/workers/assets/upload?base64=true`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.jwt}` }, body,
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Asset upload ${index + 1} failed (${response.status}): ${JSON.stringify(result.errors)}`);
  if (result.result?.jwt) completion = result.result.jwt;
  console.log(`Uploaded bucket ${index + 1}/${session.buckets.length}: ${bucket.length} files, ${bytes} bytes`);
}
if (!completion) throw new Error('Cloudflare did not return an asset completion token');
await writeFile(completionPath, JSON.stringify({ jwt: completion }), { mode: 0o600 });
await unlink(sessionPath);
console.log('Asset upload complete; completion credential saved privately.');
