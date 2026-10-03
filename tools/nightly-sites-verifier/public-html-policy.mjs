import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Exact script observed in three saved public responses. Only the ray and
// canonical base64 encoding of a ten-digit Unix timestamp vary.
export const challengeTemplate = `<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'__RAY__',t:'__TIME__'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const challengeTemplateSHA256 = sha(challengeTemplate);
const [prefix, remaining] = challengeTemplate.split('__RAY__');
const [middle, suffix] = remaining.split('__TIME__');
export function parseChallenge(script) {
  const text = script.toString('utf8');
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix), 'Unknown platform script template');
  const dynamic = text.slice(prefix.length, text.length - suffix.length);
  const separator = dynamic.indexOf(middle);
  assert.ok(separator >= 0, 'Missing exact parameter separator');
  const ray = dynamic.slice(0, separator), timestampBase64 = dynamic.slice(separator + middle.length);
  assert.match(ray, /^[a-f0-9]{16}$/, 'Ray must be exactly 16 lowercase hex digits');
  assert.match(timestampBase64, /^[A-Za-z0-9+/]{14}==$/, 'Timestamp must be canonical base64 of ten digits');
  const timestamp = Buffer.from(timestampBase64, 'base64').toString('ascii');
  assert.match(timestamp, /^\d{10}$/, 'Decoded timestamp must be ten decimal digits');
  assert.equal(Buffer.from(timestamp, 'ascii').toString('base64'), timestampBase64, 'Timestamp base64 must round-trip exactly');
  assert.equal(text, prefix + ray + middle + timestampBase64 + suffix, 'No other script bytes may vary');
  return { ray, timestampBase64, unixTimestamp: timestamp };
}
export function verifyPublicHTML(path, actual, expected) {
  assert.ok(['/desktop/index.html', '/linux/index.html', '/'].includes(path), 'No HTML exception for this route');
  if (actual.equals(expected)) return { transformed: false, actualSize: actual.length, actualSHA256: sha(actual), normalizedSize: expected.length, normalizedSHA256: sha(expected), deltaBytes: 0 };
  const position = path === '/linux/index.html' ? expected.lastIndexOf(Buffer.from('</body>')) : expected.length;
  assert.ok(position >= 0, 'Expected Linux body close is absent');
  const tail = expected.length - position, scriptEnd = actual.length - tail;
  assert.ok(scriptEnd > position, 'No added script at required position');
  assert.deepEqual(actual.subarray(0, position), expected.subarray(0, position), 'Application bytes before insertion changed');
  assert.deepEqual(actual.subarray(scriptEnd), expected.subarray(position), 'Application bytes after insertion changed');
  const script = actual.subarray(position, scriptEnd), dynamicParameters = parseChallenge(script);
  const normalized = Buffer.concat([actual.subarray(0, position), actual.subarray(scriptEnd)]);
  assert.deepEqual(normalized, expected, 'Application bytes differ after exact script removal');
  return { transformed: true, actualSize: actual.length, actualSHA256: sha(actual), normalizedSize: normalized.length, normalizedSHA256: sha(normalized),
    deltaBytes: script.length, templateSHA256: challengeTemplateSHA256, dynamicParameters,
    insertion: path === '/linux/index.html' ? 'immediately before expected </body>' : 'after complete expected document' };
}
