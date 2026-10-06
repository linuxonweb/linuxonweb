import { readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Only final, reviewed packages are eligible. An object tree or a partly
// written package must never replace the current dev image. Accept one root
// for existing callers or multiple persistent roots; task names are not gates.
export function latestFirefoxDev(buildRoot, now = Date.now) {
  const buildRoots = [...new Set(Array.isArray(buildRoot) ? buildRoot : [buildRoot])];
  let cached, checkedAt = 0;
  const verified = new Map();
  async function verify(pin) {
    const info = await stat(pin.path);
    if (!info.isFile() || info.size !== pin.bytes) throw Error('Package size differs: ' + pin.path);
    const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (verified.get(pin.path)?.fingerprint === fingerprint && verified.get(pin.path)?.sha256 === pin.sha256) return info;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(pin.path)) hash.update(chunk);
    if (hash.digest('hex') !== pin.sha256) throw Error('Package checksum differs: ' + pin.path);
    verified.set(pin.path, { fingerprint, sha256: pin.sha256 });
    return info;
  }
  return async function resolve() {
    if (cached && now() - checkedAt < 5000) return cached;
    const candidates = [];
    for (const buildRoot of buildRoots) {
      let directories;
      try { directories = await readdir(buildRoot, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const directory of directories) {
        if (!directory.isDirectory()) continue;
        const transform = join(buildRoot, directory.name, 'transform');
        let names;
        try { names = await readdir(transform); }
        catch (error) {
          // Other build tasks may have private transform directories. They are
          // not dev package candidates and must not take the preview offline.
          if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) continue;
          throw error;
        }
        for (const name of names) {
          if (!/^root-.*package-review.*\.json$/.test(name)) continue;
          try {
            const reviewPath = join(transform, name), review = JSON.parse(await readFile(reviewPath, 'utf8'));
            if (review.pass !== true || !review.defaultPagePackage || !review.installed?.firefox || !review.sourceIdentity) continue;
            const source = JSON.parse(await readFile(review.sourceIdentity.path, 'utf8'));
            if (!/^\d{14}$/.test(source.localBuildID)) continue;
            candidates.push({ reviewPath, review, source, mtime: (await stat(reviewPath)).mtimeMs });
          } catch (error) { console.warn('Ignoring incomplete dev package review:', name, error.message); }
        }
      }
    }
    candidates.sort((a, b) => b.source.localBuildID.localeCompare(a.source.localBuildID) || b.mtime - a.mtime);
    for (const candidate of candidates) {
      try {
        const { review, source } = candidate, packageFiles = review.defaultPagePackage;
        await verify(review.sourceIdentity);
        await verify(review.handoff);
        await verify(packageFiles['boot-manifest.json']);
        await verify(packageFiles['initramfs-firefox.cpio.gz']);
        const manifest = JSON.parse(await readFile(packageFiles['boot-manifest.json'].path, 'utf8'));
        const image = packageFiles['initramfs-firefox.cpio.gz'];
        if (manifest.assets.firefox.sha256 !== image.sha256 || manifest.assets.firefox.bytes !== image.bytes) throw Error('Manifest/image mismatch');
        manifest.assets.firefox.url = './initramfs-firefox.cpio.gz';
        manifest.assets.firefox.label = `Firefox Nightly ${source.version} · build ${source.localBuildID} · JIT ${review.jitAcceptance === true ? 'verified' : 'testing'}`;
        cached = {
          manifest, image,
          status: { version: source.version, buildID: source.localBuildID, binarySHA256: review.installed.firefox.sha256,
            archiveSHA256: image.sha256, packageReview: candidate.reviewPath, jitVerified: review.jitAcceptance === true,
            gpuVerified: review.gpuAcceptance === true },
        };
        checkedAt = now();
        return cached;
      } catch (error) { console.warn('Ignoring invalid dev package:', candidate.reviewPath, error.message); }
    }
    if (cached) { await verify(cached.image); checkedAt = now(); return cached; }
    throw Error('No complete reviewed Firefox dev package is available.');
  };
}
