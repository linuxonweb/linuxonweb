import { FSError } from './dist/virtio/fs.js';

export const HOME_DATABASE = 'linuxonweb.home.v1';
export const CHUNK_SIZE = 65536;
// Files created (or truncated to empty) by this version keep data in 4 KiB
// blocks, so a small write such as one SQLite page rewrites 4 KiB instead of a
// 64 KiB chunk. Files written before keep their 64 KiB chunks.
export const BLOCK_SIZE = 4096;
// Version 2 marks homes that may hold 4 KiB-block files; an older page asks
// for version 1 and fails to open instead of misreading them.
const HOME_VERSION = 2;
const WRITE_BATCH_BLOCKS = 32;
const DIRECTORY = 0o040000, FILE = 0o100000, SYMLINK = 0o120000;
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const timestamp = () => ({ seconds: BigInt(Math.floor(Date.now() / 1000)), nanoseconds: (Date.now() % 1000) * 1e6 });
const type = node => node.mode & 0o170000;
function nameCheck(name) {
  if (!name || name === '.' || name === '..' || /[\0/]/.test(name)) throw new FSError('EINVAL');
  if (new TextEncoder().encode(name).length > 255) throw new FSError('ENAMETOOLONG');
}
function offsetNumber(value) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new FSError('EINVAL');
  return Number(value);
}

/** Atomic metadata and sparse chunks (node.block bytes each, else 64 KiB). Every write resolves after commit;
 * no beforeunload flush is needed, and a quota failure cannot leave half a write.
 * The guest uses its normal page cache; the transport does not enable writeback.
 */
export async function openPersistentHome({ indexedDB = globalThis.indexedDB, name = HOME_DATABASE, onError = () => {}, readOnly = false } = {}) {
  if (!indexedDB) throw new Error('This browser does not provide IndexedDB storage.');
  const opening = indexedDB.open(name, HOME_VERSION);
  opening.onupgradeneeded = event => {
    // Observers must never create storage or reclaim a running guest's files.
    if (readOnly) { opening.transaction.abort(); return; }
    // Version 1 -> 2 changes no stores: chunk size is per node.
    if (event.oldVersion >= 1) return;
    const db = opening.result;
    const nodes = db.createObjectStore('nodes', { keyPath: 'id', autoIncrement: true });
    nodes.createIndex('entry', ['parent', 'name'], { unique: true });
    nodes.createIndex('parent', 'parent');
    const chunks = db.createObjectStore('chunks', { keyPath: ['inode', 'index'] });
    chunks.createIndex('inode', 'inode');
    const now = timestamp();
    nodes.put({ id: 1, parent: 0, name: '', mode: DIRECTORY | 0o755, uid: 0, gid: 0, size: 0, atime: now, mtime: now, ctime: now });
  };
  const db = await request(opening);
  const refs = new Map(), opens = new Map();
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const ref = id => {
    if (!refs.has(id)) refs.set(id, Object.freeze({ id }));
    return refs.get(id);
  };
  async function transaction(write, operation) {
    if (closed) throw new FSError('EIO', 'Home storage is closed');
    if (write && readOnly) throw new FSError('EROFS', 'Home observer is read-only');
    let tx;
    try {
      // strict requests a stable-storage commit on engines which implement it.
      try { tx = db.transaction(['nodes', 'chunks'], write ? 'readwrite' : 'readonly', write ? { durability: 'strict' } : {}); }
      catch { tx = db.transaction(['nodes', 'chunks'], write ? 'readwrite' : 'readonly'); }
      const completed = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || new FSError('EIO', 'Home transaction aborted'));
        tx.onerror = () => {}; // abort reports the transaction's original error
      });
      // Observe rejection immediately, including explicit abort after an FS error.
      completed.catch(() => {});
      let result;
      try { result = await operation(tx.objectStore('nodes'), tx.objectStore('chunks')); }
      catch (error) { try { tx.abort(); } catch {} await completed.catch(() => {}); throw error; }
      await completed;
      return result;
    } catch (error) {
      if (error instanceof FSError) throw error;
      onError(error);
      throw new FSError(error?.name === 'QuotaExceededError' ? 'ENOSPC' : 'EIO', error?.message || 'Browser storage failed');
    }
  }
  const get = async (store, node) => {
    const value = await request(store.get(node.id));
    if (!value) throw new FSError('ENOENT');
    return value;
  };
  const directory = async (store, node) => {
    const value = await get(store, node);
    if (type(value) !== DIRECTORY) throw new FSError('ENOTDIR');
    return value;
  };
  const entry = (store, parent, name) => request(store.index('entry').get([parent.id, name]));
  const blockOf = node => node.block || CHUNK_SIZE;
  const attrs = node => ({ ...node, size: BigInt(node.size), blocks: BigInt(Math.ceil(node.size / 512)), nlink: node.parent === null ? 0 : type(node) === DIRECTORY ? 2 : 1, blockSize: blockOf(node) });
  async function removeChunks(chunks, id, from = 0) {
    const range = IDBKeyRange.bound([id, from], [id, Number.MAX_SAFE_INTEGER]);
    await request(chunks.delete(range));
  }
  async function removeNode(nodes, chunks, node) {
    if (opens.get(node.id)) { node.parent = null; node.name = ''; await request(nodes.put(node)); }
    else { await removeChunks(chunks, node.id); await request(nodes.delete(node.id)); }
  }
  async function create(parent, name, context, kind, target) {
    nameCheck(name);
    const id = await transaction(true, async (nodes) => {
      const dir = await directory(nodes, parent);
      if (await entry(nodes, parent, name)) throw new FSError('EEXIST');
      const now = timestamp();
      const value = { parent: parent.id, name, mode: kind | (context.mode & 0o7777), uid: context.uid, gid: context.gid, size: target ? new TextEncoder().encode(target).length : 0, target, atime: now, mtime: now, ctime: now };
      if (kind === FILE) value.block = BLOCK_SIZE;
      const id = await request(nodes.add(value));
      dir.mtime = dir.ctime = now; await request(nodes.put(dir));
      return id;
    });
    return ref(id);
  }
  const api = {
    root: ref(1),
    async lookup(parent, name) {
      return transaction(false, async nodes => { await directory(nodes, parent); const node = await entry(nodes, parent, name); return node ? ref(node.id) : undefined; });
    },
    getattr(node) { return transaction(false, async nodes => attrs(await get(nodes, node))); },
    setattr(node, attributes) {
      return transaction(true, async (nodes, chunks) => {
        const value = await get(nodes, node);
        if (attributes.size !== undefined) {
          if (type(value) !== FILE) throw new FSError('EINVAL');
          const size = offsetNumber(attributes.size);
          if (size === 0) { await removeChunks(chunks, node.id); value.block = BLOCK_SIZE; }
          else if (size < value.size) {
            const block = blockOf(value), index = Math.floor(size / block), tail = size % block;
            await removeChunks(chunks, node.id, index + (tail ? 1 : 0));
            if (tail) {
              const chunk = await request(chunks.get([node.id, index]));
              if (chunk) { chunk.data.fill(0, tail); await request(chunks.put(chunk)); }
            }
          }
          value.size = size;
        }
        if (attributes.mode !== undefined) value.mode = type(value) | (attributes.mode & 0o7777);
        for (const key of ['uid', 'gid']) if (attributes[key] !== undefined) value[key] = attributes[key];
        for (const key of ['atime', 'mtime']) if (attributes[key] !== undefined) value[key] = attributes[key] === 'now' ? timestamp() : attributes[key];
        value.ctime = attributes.ctime || timestamp();
        await request(nodes.put(value));
        return attrs(value);
      });
    },
    mkdir(parent, name, context) { return create(parent, name, context, DIRECTORY); },
    symlink(parent, name, target, context) { return create(parent, name, { ...context, mode: 0o777 }, SYMLINK, target); },
    readlink(node) { return transaction(false, async nodes => { const value = await get(nodes, node); if (type(value) !== SYMLINK) throw new FSError('EINVAL'); return value.target; }); },
    async create(parent, name, flags, context) {
      const node = await create(parent, name, context, FILE);
      // Creation has already committed an empty regular file. Reopening it via
      // getattr (and a second truncate transaction for O_TRUNC) repeats work and
      // introduces a window in which a concurrent unlink can delete the inode.
      opens.set(node.id, (opens.get(node.id) || 0) + 1);
      return { node, handle: { flags } };
    },
    async open(node, flags) {
      if (readOnly && ((flags & 3) || (flags & 0x200))) throw new FSError('EROFS', 'Home observer is read-only');
      const value = await api.getattr(node);
      if (type(value) !== FILE) throw new FSError('EISDIR');
      if ((flags & 0x200) && (flags & 3)) await api.setattr(node, { size: 0n });
      opens.set(node.id, (opens.get(node.id) || 0) + 1);
      return { flags };
    },
    read(node, handle, offset, length) {
      return transaction(false, async (nodes, chunks) => {
        const value = await get(nodes, node), start = offsetNumber(offset), block = blockOf(value);
        const bytes = new Uint8Array(Math.max(0, Math.min(length, value.size - start)));
        if (!bytes.length) return bytes;
        // One request for every stored chunk in the range; missing ones are holes.
        const first = Math.floor(start / block), last = Math.floor((start + bytes.length - 1) / block);
        const found = first === last ? [await request(chunks.get([node.id, first]))]
          : await request(chunks.getAll(IDBKeyRange.bound([node.id, first], [node.id, last])));
        for (const chunk of found) {
          if (!chunk) continue;
          const from = Math.max(start, chunk.index * block), to = Math.min(start + bytes.length, (chunk.index + 1) * block);
          bytes.set(chunk.data.subarray(from - chunk.index * block, to - chunk.index * block), from - start);
        }
        return bytes;
      });
    },
    write(node, handle, offset, data) {
      // The virtqueue buffer may be reused after this call returns.
      const bytes = data.slice();
      return transaction(true, async (nodes, chunks) => {
        const value = await get(nodes, node);
        if (type(value) !== FILE) throw new FSError('EISDIR');
        // Linux has already selected the offset for O_APPEND under inode lock.
        const start = offsetNumber(offset), block = blockOf(value);
        if (!Number.isSafeInteger(start + bytes.length)) throw new FSError('EINVAL');
        const first = Math.floor(start / block), end = start + bytes.length;
        const last = Math.ceil(end / block);
        for (let batch = first; bytes.length && batch < last; batch += WRITE_BATCH_BLOCKS) {
          const writes = [];
          for (let index = batch; index < Math.min(last, batch + WRITE_BATCH_BLOCKS); index++) {
            writes.push((async () => {
              const from = Math.max(start, index * block), to = Math.min(end, (index + 1) * block);
              const chunk = (to - from < block && await request(chunks.get([node.id, index]))) || { inode: node.id, index, data: new Uint8Array(block) };
              chunk.data.set(bytes.subarray(from - start, to - start), from - index * block);
              await request(chunks.put(chunk));
            })());
          }
          await Promise.all(writes);
        }
        value.size = Math.max(value.size, start + bytes.length);
        value.mtime = value.ctime = timestamp(); await request(nodes.put(value));
        return bytes.length;
      });
    },
    // Every write has committed before it returns, so the guest's flush and
    // fsync have nothing left to wait for; they cost no browser transaction.
    flush() {},
    fsync() {},
    /** Resolves after every transaction started before it has finished. */
    settle() { return transaction(false, () => {}); },
    async release(node) {
      const count = (opens.get(node.id) || 1) - 1;
      if (count) opens.set(node.id, count);
      else {
        opens.delete(node.id);
        if (!readOnly) {
          const orphaned = await transaction(false, async nodes => (await request(nodes.get(node.id)))?.parent === null);
          if (orphaned) await transaction(true, async (nodes, chunks) => { const value = await request(nodes.get(node.id)); if (value && value.parent === null) await removeNode(nodes, chunks, value); });
        }
      }
    },
    opendir(node) { return transaction(false, async nodes => { await directory(nodes, node); return {}; }); },
    readdir(node) { return transaction(false, async nodes => { await directory(nodes, node); return (await request(nodes.index('parent').getAll(node.id))).map(value => ({ name: value.name, node: ref(value.id) })); }); },
    releasedir() {},
    unlink(parent, name) { return remove(parent, name, false); },
    rmdir(parent, name) { return remove(parent, name, true); },
    rename(oldParent, oldName, newParent, newName) {
      nameCheck(oldName); nameCheck(newName);
      return transaction(true, async (nodes, chunks) => {
        await directory(nodes, oldParent); await directory(nodes, newParent);
        const value = await entry(nodes, oldParent, oldName);
        if (!value) throw new FSError('ENOENT');
        if (oldParent.id === newParent.id && oldName === newName) return;
        if (type(value) === DIRECTORY) {
          let ancestor = await get(nodes, newParent);
          while (ancestor) {
            if (ancestor.id === value.id) throw new FSError('EINVAL');
            ancestor = ancestor.parent ? await request(nodes.get(ancestor.parent)) : null;
          }
        }
        const destination = await entry(nodes, newParent, newName);
        if (destination) {
          if (type(value) === DIRECTORY && type(destination) !== DIRECTORY) throw new FSError('ENOTDIR');
          if (type(value) !== DIRECTORY && type(destination) === DIRECTORY) throw new FSError('EISDIR');
          if (type(destination) === DIRECTORY && await request(nodes.index('parent').count(destination.id))) throw new FSError('ENOTEMPTY');
          await removeNode(nodes, chunks, destination);
        }
        value.parent = newParent.id; value.name = newName; value.ctime = timestamp();
        await request(nodes.put(value));
        for (const parent of [oldParent, newParent]) {
          const dir = await get(nodes, parent); dir.mtime = dir.ctime = value.ctime; await request(nodes.put(dir));
        }
      });
    },
    access(node) { return transaction(false, nodes => get(nodes, node).then(() => {})); },
    async statfs() {
      const estimate = await globalThis.navigator?.storage?.estimate?.() || {};
      const quota = estimate.quota || 1024 ** 3, free = Math.max(0, quota - (estimate.usage || 0));
      return { blocks: BigInt(Math.floor(quota / CHUNK_SIZE)), blocksFree: BigInt(Math.floor(free / CHUNK_SIZE)), blocksAvailable: BigInt(Math.floor(free / CHUNK_SIZE)), blockSize: CHUNK_SIZE, nameLength: 255 };
    },
    usage() {
      return transaction(false, async (nodes, chunks) => {
        const block = new Map((await request(nodes.getAll())).map(value => [value.id, blockOf(value)]));
        const inodes = (await request(chunks.getAllKeys())).map(key => key[0]);
        return { files: block.size, bytes: inodes.reduce((sum, id) => sum + (block.get(id) || CHUNK_SIZE), 0) };
      });
    },
    async destroy() { if (!closed) { await api.settle(); closed = true; db.close(); } },
  };
  async function remove(parent, name, isDirectory) {
    nameCheck(name);
    return transaction(true, async (nodes, chunks) => {
      await directory(nodes, parent);
      const value = await entry(nodes, parent, name);
      if (!value) throw new FSError('ENOENT');
      if (isDirectory && type(value) !== DIRECTORY) throw new FSError('ENOTDIR');
      if (!isDirectory && type(value) === DIRECTORY) throw new FSError('EISDIR');
      if (isDirectory && await request(nodes.index('parent').count(value.id))) throw new FSError('ENOTEMPTY');
      await removeNode(nodes, chunks, value);
      const dir = await get(nodes, parent); dir.mtime = dir.ctime = timestamp(); await request(nodes.put(dir));
    });
  }
  // Unlinked open files from a crashed/closed guest are unreachable on next boot.
  if (!readOnly) await transaction(true, async (nodes, chunks) => {
    for (const value of await request(nodes.getAll())) if (value.parent === null) await removeNode(nodes, chunks, value);
  });
  return api;
}

/** Prevent independent kernels from caching conflicting views of the same home. */
export async function acquireHomeLock(locks = globalThis.navigator?.locks) {
  if (!locks) throw new Error('Persistent home requires browser Web Locks support.');
  let release, requestDone;
  const held = new Promise(resolve => { release = resolve; });
  await new Promise((resolve, reject) => {
    requestDone = locks.request(HOME_DATABASE, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('Your Linux home is open in another tab. Close that guest, then retry.')); return; }
      resolve(); await held;
    }).catch(reject);
  });
  // Callers which immediately open another lease can await its actual release.
  return () => { release(); return requestDone; };
}

export async function deletePersistentHome(indexedDB = globalThis.indexedDB) {
  const deletion = indexedDB.deleteDatabase(HOME_DATABASE);
  await new Promise((resolve, reject) => {
    deletion.onsuccess = resolve; deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error('Close other Linux tabs before deleting your home.'));
  });
}
