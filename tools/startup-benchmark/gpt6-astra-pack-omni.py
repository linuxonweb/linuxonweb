#!/usr/bin/env python3
"""Build an isolated canonical OmniJar candidate; preserve native/init/APK bytes."""
import argparse, gzip, hashlib, importlib.util, json, os, pathlib, shutil, stat, time, zipfile

BASE_SHA = '60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa'
NATIVE_SHA = '26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998'
INIT_SHA = '55d55013be46cb13541320943ef03c50a43580bf69dd5d4c425963a41a5d8803'

def digest(path):
    with pathlib.Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def exact(stream, length):
    data = stream.read(length)
    if len(data) != length:
        raise ValueError('Truncated CPIO record')
    return data

def extract(base, flat):
    regular, links, init = {}, {}, None
    flat.mkdir()
    with gzip.open(base, 'rb') as stream:
        while True:
            header = exact(stream, 110)
            if header[:6] != b'070701':
                raise ValueError('Expected newc')
            fields = [int(header[i:i+8], 16) for i in range(6,110,8)]
            size, namesize = fields[6], fields[11]
            name = exact(stream, namesize).rstrip(b'\0').decode().removeprefix('./')
            exact(stream, -(110+namesize) % 4)
            if name == 'TRAILER!!!':
                break
            if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts:
                raise ValueError('Unsafe record path')
            target = None
            relative = name.removeprefix('opt/firefox/')
            if name.startswith('opt/firefox/') and stat.S_ISREG(fields[1]):
                if fields[4] != 1:
                    raise ValueError('Resource hardlinks require separate handling')
                target = flat / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                output = target.open('xb')
            else:
                output = None
            value = bytearray() if name == 'init' or (name.startswith('opt/firefox/') and stat.S_ISLNK(fields[1])) else None
            h = hashlib.sha256()
            left = size
            try:
                while left:
                    data = exact(stream, min(left, 1024*1024)); left -= len(data); h.update(data)
                    if output: output.write(data)
                    if value is not None: value.extend(data)
            finally:
                if output: output.close()
            exact(stream, -size % 4)
            if target:
                os.chmod(target, fields[1] & 0o777)
                regular[relative] = {'bytes': size, 'sha256': h.hexdigest(), 'mode': fields[1]}
            if name.startswith('opt/firefox/') and stat.S_ISLNK(fields[1]):
                links[relative] = bytes(value).decode()
            if name == 'init': init = h.hexdigest()
    if init != INIT_SHA or regular.get('firefox', {}).get('sha256') != NATIVE_SHA:
        raise ValueError('Original native/init identity differs')
    return regular, links

def pack(args):
    base, work = args.base.resolve(), args.work.resolve()
    if digest(base) != BASE_SHA:
        raise ValueError('Original archive identity differs')
    work.mkdir(exist_ok=False, parents=True)
    before, links = extract(base, work/'flat')
    packer = module('gpt6_omni_packer', 'tools/guest-rootfs/package-firefox-omni.py')
    rewriter = module('gpt6_archive_rewriter', 'tools/guest-rootfs/rewrite-firefox-archive.py')
    result = packer.pack_resources(work/'flat', work/'packed', args.source)
    packed = work/'packed'
    after = {p.relative_to(packed).as_posix(): p for p in packed.rglob('*') if p.is_file()}
    if digest(after['firefox']) != NATIVE_SHA:
        raise ValueError('Formatter changed native executable')
    archives = {}; members = {}
    try:
        for name, path in after.items():
            if name.endswith('omni.ja'):
                archives[name] = zipfile.ZipFile(path); members[name] = set(archives[name].namelist())
        preserved, manifests = [], []
        for name, metadata in before.items():
            if name.endswith('.manifest'):
                manifests.append(name); continue
            candidates = []
            if name in after: candidates.append(digest(after[name]))
            for archive_name, archive in archives.items():
                prefix = archive_name.removesuffix('omni.ja')
                if name.startswith(prefix):
                    entry = name[len(prefix):]
                    if entry in members[archive_name]:
                        with archive.open(entry) as f:
                            candidates.append(hashlib.file_digest(f, 'sha256').hexdigest())
            if metadata['sha256'] not in candidates:
                raise ValueError('Resource payload missing or changed: '+name)
            preserved.append(name)
        for name, target in links.items():
            if target.startswith('/'):
                if not target.startswith('/opt/firefox/'): continue
                resolved = target.removeprefix('/opt/firefox/')
            else:
                resolved = os.path.normpath(str(pathlib.PurePosixPath(name).parent / target))
            if resolved not in after and resolved not in links:
                raise ValueError('Symlink target would be packed away: '+name+' -> '+target)
    finally:
        for archive in archives.values(): archive.close()
    replacements = {}
    for name, metadata in before.items():
        if name not in after: replacements['opt/firefox/'+name] = None
        elif digest(after[name]) != metadata['sha256']:
            replacements['opt/firefox/'+name] = after[name]
    for name, path in after.items():
        if name not in before: replacements['opt/firefox/'+name] = path
    rewritten = rewriter.replace_firefox_files(base, work/'resource-base.cpio.gz', replacements)
    result.update({'nativeSha256': NATIVE_SHA, 'initSha256': INIT_SHA, 'sourceArchiveSha256': BASE_SHA,
                   'sourceTree': str(args.source.resolve()), 'nonManifestPayloadsVerified': len(preserved),
                   'canonicalManifestPaths': manifests, 'unchangedSymlinks': links,
                   'resourceRewrite': rewritten, 'finishedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    (work/'resource-build.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['sourceFiles','outputFiles','sourcePageBytes','outputPageBytes','nonManifestPayloadsVerified','runtimeAcceptance']}), flush=True)

def combine(args):
    work, package, apk = args.work.resolve(), args.output.resolve(), args.apk.resolve()
    report = json.loads((work/'resource-build.json').read_text())
    if digest(args.base) != BASE_SHA or digest(work/'resource-base.cpio.gz') != report['resourceRewrite']['archiveSHA256']:
        raise ValueError('Packed base or original archive changed')
    apk_manifest = json.loads((apk/'boot-manifest.json').read_text()); source_apk_sha = apk_manifest['assets']['firefox']['sha256']
    source = apk/'initramfs-firefox.cpio.gz'
    if digest(source) != apk_manifest['assets']['firefox']['sha256']:
        raise ValueError('APK candidate archive mismatch')
    # Verify the entire original decoded prefix, then preserve the APK suffix byte for byte.
    suffix = work/'apk-suffix.cpio'
    with gzip.open(args.base,'rb') as base, gzip.open(source,'rb') as candidate, suffix.open('wb') as output:
        prefix_bytes = 0
        while chunk := base.read(1024*1024):
            if exact(candidate,len(chunk)) != chunk:
                raise ValueError('APK candidate changed original CPIO prefix')
            prefix_bytes += len(chunk)
        shutil.copyfileobj(candidate,output,1024*1024)
    if suffix.stat().st_size < 1:
        raise ValueError('APK suffix absent')
    package.mkdir(exist_ok=False,parents=True)
    archive = package/'initramfs-firefox.cpio.gz'
    raw_hash = hashlib.sha256(); raw_bytes = 0
    with archive.open('xb') as target, gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0,compresslevel=6) as gz:
        for stream in [gzip.open(work/'resource-base.cpio.gz','rb'), suffix.open('rb')]:
            with stream:
                while chunk := stream.read(1024*1024):
                    gz.write(chunk); raw_hash.update(chunk); raw_bytes += len(chunk)
    archive_sha = digest(archive)
    manifest = apk_manifest
    manifest['version'] = hashlib.sha256(('canonical-omni-'+archive_sha).encode()).hexdigest()[:12]
    manifest['assets']['firefox'].update({'bytes':archive.stat().st_size,'sha256':archive_sha,
        'label':'Firefox system with canonical OmniJar resources and signed APK packages'})
    for asset in ['kernel','plain']:
        name = pathlib.Path(manifest['assets'][asset]['url']).name
        source_asset = apk/name
        if not source_asset.is_file(): source_asset = pathlib.Path('web/linux')/name
        if digest(source_asset) != manifest['assets'][asset]['sha256']:
            raise ValueError('Stable kernel/plain asset identity differs')
        shutil.copyfile(source_asset, package/name)
    (package/'boot-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    meta = json.loads((apk/'package.json').read_text())
    meta.update({'passPackage':True,'candidateOnly':True,'runtimeAccepted':False,'packageRuntimeAccepted':False,
                 'version':manifest['version'],'archiveSha256':archive_sha,'bytes':archive.stat().st_size,
                 'sourceCandidateArchiveSha256':source_apk_sha,
                 'nativeSha256':NATIVE_SHA,'initSha256':INIT_SHA,'gzipMembers':1,
                 'decodedRootfsBytes':raw_bytes,'decodedRootfsSha256':raw_hash.hexdigest(),
                 'originalCpioPrefixPreserved':False,'decodedRootfsUnchanged':False,
                 'omniResources':report,'apkSuffixBytes':suffix.stat().st_size,'apkSuffixSha256':digest(suffix),
                 'originalDecodedPrefixBytes':prefix_bytes,
                 'releaseGatesPending':['exact production browser decode/composition/boot',
                                      'resource correctness with fresh and previously used profile',
                                      'normal desktop signed package commands']})
    (package/'package.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({'package':str(package),'version':manifest['version'],'archiveSha256':archive_sha,
                      'bytes':archive.stat().st_size,'decodedBytes':raw_bytes,'runtimeAccepted':False}),flush=True)

parser=argparse.ArgumentParser()
parser.add_argument('stage',choices=['pack','combine']);parser.add_argument('--base',type=pathlib.Path,required=True)
parser.add_argument('--work',type=pathlib.Path,required=True);parser.add_argument('--source',type=pathlib.Path)
parser.add_argument('--apk',type=pathlib.Path);parser.add_argument('--output',type=pathlib.Path)
args=parser.parse_args()
if args.stage=='pack': pack(args)
else: combine(args)
