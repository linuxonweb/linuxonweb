const limit = 2097152;
const profilePath = 'admin/.mozilla/firefox/http1-profile/user.js';

function validPath(path, profile = false) {
  if (profile && path === profilePath) return true;
  if (typeof path !== 'string' || !path.startsWith('admin/nightly-jit-safety/')) return false;
  return path.length <= 512 && path.split('/').every(part =>
    /^[A-Za-z0-9_.-]{1,128}$/.test(part) && part !== '.' && part !== '..');
}

export async function seedFullSafety(home, files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw Error('Invalid safety seed');
  const entries = Object.entries(files);
  if (!entries.length || entries.length > 128) throw Error('Safety seed file count exceeds bound');
  let total = 0;
  for (const [name, data] of entries) {
    if (!validPath(name, true) || !(data instanceof Uint8Array) || data.length > limit) {
      throw Error('Invalid safety seed file');
    }
    if (entries.some(([other]) => other.startsWith(name + '/'))) throw Error('Conflicting safety seed paths');
    total += data.length;
  }
  if (total > 2 * limit) throw Error('Safety seed total exceeds bound');
  const pending = [];
  for (const [path, data] of entries) {
    const parts = path.split('/'), name = parts.pop();
    let parent = home.root;
    for (const part of parts) {
      parent = await home.lookup(parent, part) || await home.mkdir(parent, part, { mode: 0o755, uid: 1000, gid: 1000 });
    }
    if (await home.lookup(parent, name)) throw Error('Refusing to overwrite existing safety/profile data');
    pending.push({ parent, name, data });
  }
  for (const { parent, name, data } of pending) {
    const file = await home.create(parent, name, 2, { mode: 0o644, uid: 1000, gid: 1000 });
    try {
      if (await home.write(file.node, file.handle, 0n, data) !== data.length) throw Error('Incomplete safety seed write');
    } finally { await home.release(file.node, file.handle); }
  }
}

export async function readFullSafetyArtifact(openHome, filename) {
  if (!validPath(filename)) throw Error('Invalid safety artifact path');
  const home = await openHome({ readOnly: true });
  try {
    let node = home.root;
    for (const part of filename.split('/')) {
      node = await home.lookup(node, part);
      if (!node) return null;
    }
    const attributes = await home.getattr(node);
    const size = Number(attributes.size);
    if (!['bigint', 'number'].includes(typeof attributes.size) || !Number.isSafeInteger(size) ||
        size < 0 || size >= limit || (attributes.mode & 0o170000) !== 0o100000) {
      throw Error('Invalid or oversized safety artifact');
    }
    const handle = await home.open(node, 0);
    try {
      const data = await home.read(node, handle, 0n, size);
      if (!(data instanceof Uint8Array) || data.length !== size) throw Error('Incomplete safety artifact read');
      return data;
    } finally { await home.release(node, handle); }
  } finally { await home.destroy(); }
}
