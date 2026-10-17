import { cpioEntry } from '../../web/linux/desktop-extras.mjs';
import { nonSharedBytes } from '../../web/linux/console-bytes.mjs';

export function decodeKernelConsole(decoder, bytes) {
  return decoder.decode(nonSharedBytes(bytes), { stream: true });
}

export function buildKernelExtrasProbe({ archive, manifest, nonce, cpus }) {
  if (!(archive instanceof Uint8Array) || !archive.length) throw Error('Missing probe archive');
  if (!Number.isSafeInteger(cpus) || cpus < 1 || cpus > 64) throw Error('Invalid measured CPU count');
  if (!/^[0-9a-f]{24}$/.test(nonce)) throw Error('Invalid probe nonce');
  if (!Array.isArray(manifest?.members) || !manifest.members.length) throw Error('Missing extras members');
  const expected = new Set();
  const checksums = manifest.members.map(member => {
    if (typeof member.path !== 'string' || !/^\/[a-zA-Z0-9_./+-]+$/.test(member.path) || member.path.includes('\n') || member.path.split('/').some(part => part === '..' || part === '.')) throw Error('Unsafe extras path');
    if (expected.has(member.path) || !/^[0-9a-f]{64}$/.test(member.sha256)) throw Error('Invalid extras member');
    expected.add(member.path);
    return `${member.sha256}  ${member.path}\n`;
  }).join('');
  const script = `#!/bin/busybox sh
echo GPT6_TAIL_BEGIN_${nonce}
/bin/busybox sha256sum -c /gpt6-codex-extras.sha256
if [ "$?" -eq 0 ]; then
  echo GPT6_TAIL_PASS_${nonce}
else
  echo GPT6_TAIL_FAIL_${nonce}
fi
exec /bin/busybox poweroff -f
`;
  const encoder = new TextEncoder();
  const entries = [
    cpioEntry('gpt6-codex-check-tail', encoder.encode(script)),
    cpioEntry('gpt6-codex-extras.sha256', encoder.encode(checksums), 0o100644),
    cpioEntry('TRAILER!!!', new Uint8Array(), 0),
  ];
  let offset = Math.ceil(archive.length / 4) * 4;
  const image = new Uint8Array(offset + entries.reduce((sum, entry) => sum + entry.length, 0));
  image.set(archive);
  for (const entry of entries) { image.set(entry, offset); offset += entry.length; }
  return { image, cmdline: 'rdinit=/gpt6-codex-check-tail', cpus, nonce, expected: [...expected] };
}

export function verifyKernelExtrasOutput(output, { cpus, nonce, expected }) {
  const lines = output.split(/\r?\n/);
  for (const marker of [`Core count: ${cpus}`, `GPT6_TAIL_BEGIN_${nonce}`, `GPT6_TAIL_PASS_${nonce}`]) {
    if (!lines.includes(marker)) throw Error('Missing kernel probe marker: ' + marker);
  }
  if (lines.includes(`GPT6_TAIL_FAIL_${nonce}`)) throw Error('Guest checksum failure');
  const verified = lines.filter(line => line.endsWith(': OK')).map(line => line.slice(0, -4)).sort();
  if (JSON.stringify(verified) !== JSON.stringify([...expected].sort())) throw Error('Guest member verification mismatch');
  return { cpus, verifiedMembers: verified.length };
}
