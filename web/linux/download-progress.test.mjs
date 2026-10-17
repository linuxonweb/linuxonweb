import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadFile, SEGMENT_MIN_BYTES } from './download-progress.mjs';

const payload = size => Uint8Array.from({ length: size }, (_, index) => (index * 31 + 7) & 255);

// A fake server. honorRange=false answers every request with the whole file (200).
function server(bytes, { honorRange = true, status = 200 } = {}) {
  const requests = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push(options.headers?.Range ?? null);
    if (status !== 200) return new Response('nope', { status });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.Range || '');
    if (!honorRange || !range) return new Response(bytes.slice(), { status: 200 });
    const [start, end] = [Number(range[1]), Number(range[2])];
    return new Response(bytes.slice(start, end + 1), { status: 206 });
  };
  return { fetchImpl, requests, peak: () => maxInFlight };
}

test('a small file is fetched in one request', async () => {
  const bytes = payload(1000);
  const s = server(bytes);
  const { bytes: got } = await downloadFile('http://x/a', { id: 'a', label: 'A', total: bytes.length, fetchImpl: s.fetchImpl });
  assert.deepEqual(got, bytes);
  assert.deepEqual(s.requests, [null]);
});

test('a large file is split into parallel byte ranges and reassembled exactly', async () => {
  const bytes = payload(SEGMENT_MIN_BYTES * 3 + 12345);
  const s = server(bytes);
  const { bytes: got } = await downloadFile('http://x/big', { id: 'big', label: 'Big', total: bytes.length, fetchImpl: s.fetchImpl });
  assert.deepEqual(got, bytes);
  assert.equal(s.requests.length, 3, 'three ranges: floor(size / 4 MiB)');
  assert.ok(s.peak() > 1, 'ranges run at the same time');
});

test('a server that ignores Range still delivers the whole file', async () => {
  const bytes = payload(SEGMENT_MIN_BYTES * 2);
  const s = server(bytes, { honorRange: false });
  const { bytes: got } = await downloadFile('http://x/big', { id: 'big2', label: 'Big', total: bytes.length, fetchImpl: s.fetchImpl });
  assert.deepEqual(got, bytes);
  assert.equal(s.requests.length, 1, 'the first ranged answer carried the whole file; no further requests');
});

test('an HTTP error reports the failure text and status', async () => {
  const s = server(new Uint8Array(0), { status: 404 });
  await assert.rejects(
    downloadFile('http://x/missing', { id: 'm', label: 'M', total: 100, failure: 'Thing failed', fetchImpl: s.fetchImpl }),
    /Thing failed \(HTTP 404\)/,
  );
});
