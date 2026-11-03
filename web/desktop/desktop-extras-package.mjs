// Validate the optional desktop extras bundle before any files are published.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

export const desktopExtrasFiles = ['desktop-extras.cpio', 'desktop-extras.cpio.gz', 'desktop-extras.cpio.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isSize = value => Number.isSafeInteger(value) && value >= 0;
const decodeName = new TextDecoder('utf-8', { fatal: true });

async function regularBytes(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw new Error('Invalid or oversized extras file: ' + path);
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('Extras file changed while reading: ' + path);
  return bytes;
}

function verifyMembers(raw, declared) {
  if (!Array.isArray(declared)) throw new Error('Extras manifest lacks its member inventory');
  const expected = new Map();
  for (const row of declared) {
    if (!row || typeof row.path !== 'string' || expected.has(row.path) || !isSize(row.bytes) || !isHash(row.sha256)) {
      throw new Error('Invalid or duplicate extras member declaration');
    }
    expected.set(row.path, row);
  }
  const seen = new Set();
  let offset = 0;
  while (offset + 110 <= raw.length) {
    const header = raw.subarray(offset, offset + 110).toString('ascii');
    if (!/^070701[0-9a-fA-F]{104}$/.test(header)) throw new Error('Invalid extras newc header');
    const mode = parseInt(header.slice(14, 22), 16);
    const size = parseInt(header.slice(54, 62), 16);
    const nameSize = parseInt(header.slice(94, 102), 16);
    const nameEnd = offset + 110 + nameSize;
    if (nameSize < 1 || nameSize > 4096 || nameEnd > raw.length) throw new Error('Invalid extras name size');
    const nameBytes = raw.subarray(offset + 110, nameEnd);
    if (nameBytes[nameSize - 1] !== 0 || nameBytes.subarray(0, -1).includes(0)) throw new Error('Invalid extras name');
    let name = decodeName.decode(nameBytes.subarray(0, -1));
    if (name.startsWith('./')) name = name.slice(2);
    if (!name || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) {
      throw new Error('Unsafe or duplicate extras member name');
    }
    seen.add(name);
    const start = Math.ceil(nameEnd / 4) * 4;
    const end = start + size;
    offset = Math.ceil(end / 4) * 4;
    if (offset > raw.length) throw new Error('Truncated extras member');
    if (name === 'TRAILER!!!') {
      if (size || raw.subarray(offset).some(value => value !== 0) || expected.size) {
        throw new Error('Extras trailer or member inventory mismatch');
      }
      return;
    }
    if ((mode & 0o170000) !== 0o040000) {
      const member = expected.get('/' + name);
      if (!member || member.bytes !== size || member.sha256 !== digest(raw.subarray(start, end))) {
        throw new Error('Extras member hash/size mismatch: ' + name);
      }
      expected.delete('/' + name);
    }
  }
  throw new Error('Extras archive lacks its trailer');
}

export async function validateDesktopExtras(directory, priorFiles = null) {
  const metadataBytes = await regularBytes(join(directory, desktopExtrasFiles[2]), 2 * 1024 * 1024);
  const manifest = JSON.parse(metadataBytes.toString('utf8'));
  if (manifest.schema !== 1 || !isSize(manifest.bytes) || manifest.bytes < 1 ||
      manifest.bytes > 64 * 1024 * 1024 || !isHash(manifest.sha256) ||
      !manifest.gzip || !isSize(manifest.gzip.bytes) || manifest.gzip.bytes < 18 ||
      manifest.gzip.bytes > manifest.bytes + 65536 || !isHash(manifest.gzip.sha256)) {
    throw new Error('Invalid extras raw/gzip manifest bindings');
  }
  const raw = await regularBytes(join(directory, desktopExtrasFiles[0]), manifest.bytes);
  const compressed = await regularBytes(join(directory, desktopExtrasFiles[1]), manifest.gzip.bytes);
  if (raw.length !== manifest.bytes || digest(raw) !== manifest.sha256 ||
      compressed.length !== manifest.gzip.bytes || digest(compressed) !== manifest.gzip.sha256) {
    throw new Error('Extras raw/gzip hash or size mismatch');
  }
  verifyMembers(raw, manifest.members);
  const expanded = await promisify(gunzip)(compressed, { maxOutputLength: manifest.bytes });
  if (!expanded.equals(raw)) throw new Error('Extras gzip does not preserve the raw archive');
  const payloads = [raw, compressed, metadataBytes];
  const files = Object.fromEntries(desktopExtrasFiles.map((name, index) =>
    [name, { bytes: payloads[index].length, sha256: digest(payloads[index]) }]));
  if (priorFiles) {
    for (const name of desktopExtrasFiles) {
      if (priorFiles[name]?.bytes !== files[name].bytes || priorFiles[name]?.sha256 !== files[name].sha256) {
        throw new Error('Previously published extras changed: ' + name);
      }
    }
  }
  return { files, manifest };
}
