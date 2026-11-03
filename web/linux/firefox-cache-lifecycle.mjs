// Firefox's native per-profile compatibility remains authoritative. This contract
// binds the content-addressed app directory to the exact final desktop extras.
const SHA = /^[a-f0-9]{64}$/;
const hash = value => typeof value === 'string' && SHA.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
export function validateFirefoxCacheLifecycle(value) {
  if (value === undefined) return null;
  if (!object(value) || value.schema !== 1 || !hash(value.generation) || !object(value.desktopExtras)) throw new Error('Invalid Firefox cache lifecycle manifest.');
  if (Object.keys(value).some(key => !['schema', 'generation', 'desktopExtras'].includes(key))) throw new Error('Unsupported Firefox cache lifecycle field.');
  const extra = value.desktopExtras;
  if (!bytes(extra.bytes, 1, 64 * 1024 ** 2) || !hash(extra.sha256) || Object.keys(extra).some(key => !['bytes', 'sha256', 'gzip'].includes(key))) throw new Error('Invalid Firefox desktop extras identity.');
  let gzip;
  if (own(extra, 'gzip')) {
    const compressed = extra.gzip;
    if (!object(compressed) || !bytes(compressed.bytes, 18, extra.bytes + 65536) || !hash(compressed.sha256) || Object.keys(compressed).some(key => !['bytes', 'sha256'].includes(key))) throw new Error('Invalid Firefox compressed extras identity.');
    gzip = Object.freeze({ bytes: compressed.bytes, sha256: compressed.sha256 });
  }
  return Object.freeze({ schema: 1, generation: value.generation, desktopExtras: Object.freeze({ bytes: extra.bytes, sha256: extra.sha256, ...(gzip ? { gzip } : {}) }) });
}
export function assertFirefoxDesktopExtras(policy, actual) {
  const wanted = policy.desktopExtras;
  if (actual.bytes !== wanted.bytes || actual.sha256 !== wanted.sha256 || Boolean(actual.gzip) !== Boolean(wanted.gzip) || (wanted.gzip && (actual.gzip.bytes !== wanted.gzip.bytes || actual.gzip.sha256 !== wanted.gzip.sha256))) throw new Error('Firefox cache generation requires its exact desktop extras. Update the system image and extras together.');
}
export function firefoxCacheProof(policy) {
  return policy ? `v1 ${policy.generation} ${policy.desktopExtras.sha256} ${policy.desktopExtras.gzip?.sha256 ?? '-'}\n` : '';
}
