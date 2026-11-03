#!/usr/bin/env python3
"""Build an off-public Firefox cache-lifecycle image without changing native code.

Native Firefox owns profile selection, locking, cache invalidation and crash
handling. A stable executable/GRE directory preserves the dedicated-profile
install hash. XUL_APP_FILE gives ordinary launches a content-addressed app dir.
The original app directory and its root-owned purge marker remain a fail-closed
path for direct native launches. No preferences or profile databases are edited.
"""
import argparse
import copy
import datetime
import gzip
import hashlib
import json
import pathlib
import shutil
import stat
import time

SCHEMA = 'linuxonweb-firefox-app-generation-v3'
PROOF = '/etc/linuxonweb-firefox-cache-verified'
LAUNCHER = 'opt/firefox/firefox-gpu-diagnostic'
NATIVE = 'opt/firefox/firefox'
MARKER = 'opt/firefox/browser/.purgecaches'
INI = 'opt/firefox/application.ini'
NATIVE_SHA = '26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998'
EXPECTED_EXEC = b'exec /opt/firefox/firefox "$@"\n'


def sha(path):
    with pathlib.Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def exact(stream, length):
    data = stream.read(length)
    if len(data) != length:
        raise ValueError('Truncated CPIO input')
    return data


def records(path):
    """Inventory final records across every decoded CPIO member, without extract."""
    final = {}
    with gzip.open(path, 'rb') as stream:
        while True:
            first = stream.read(1)
            while first == b'\0':
                first = stream.read(1)
            if not first:
                break
            header = first + exact(stream, 109)
            if header[:6] != b'070701':
                raise ValueError('Expected newc CPIO input')
            fields = [int(header[i:i + 8], 16) for i in range(6, 110, 8)]
            size, namesize = fields[6], fields[11]
            if not 1 <= namesize <= 4096:
                raise ValueError('Invalid CPIO name size')
            namebytes = exact(stream, namesize)
            if namebytes[-1:] != b'\0' or b'\0' in namebytes[:-1]:
                raise ValueError('Invalid CPIO name')
            name = namebytes[:-1].decode().removeprefix('./')
            if name != '.' and (name.startswith('/') or any(x in ('', '.', '..') for x in name.split('/'))):
                raise ValueError('Unsafe CPIO name')
            exact(stream, -(110 + namesize) % 4)
            capture = name in (LAUNCHER, INI) or stat.S_ISLNK(fields[1])
            body = bytearray() if capture else None
            digest = hashlib.sha256()
            remaining = size
            while remaining:
                block = exact(stream, min(remaining, 1024 * 1024))
                remaining -= len(block)
                digest.update(block)
                if body is not None:
                    body.extend(block)
            exact(stream, -size % 4)
            if name == 'TRAILER!!!':
                if size:
                    raise ValueError('Nonempty CPIO trailer')
                continue
            final[name] = {'mode': fields[1], 'uid': fields[2], 'gid': fields[3],
                           'links': fields[4], 'bytes': size, 'sha256': digest.hexdigest()}
            if body is not None:
                final[name]['body'] = bytes(body)
    return final


def entry(name, body, mode, inode):
    encoded = name.encode() + b'\0'
    fields = [inode, mode, 0, 0, 2 if stat.S_ISDIR(mode) else 1,
              0, len(body), 0, 0, 0, 0, len(encoded), 0]
    header = b'070701' + ''.join(f'{x:08x}' for x in fields).encode()
    return header + encoded + bytes(-(110 + len(encoded)) % 4) + body + bytes(-len(body) % 4)


def build(args):
    started = time.monotonic()
    started_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    source = args.base_dir.resolve()
    output = args.output.resolve()
    if output.exists() or output.is_symlink():
        raise ValueError('Output must be a fresh directory')
    if not args.abi_generation or len(args.abi_generation) > 120 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-' for c in args.abi_generation):
        raise ValueError('Invalid explicit ABI-generation identifier')
    manifest = json.loads((source / 'boot-manifest.json').read_text())
    extras_manifest = json.loads(args.desktop_extras_manifest.read_text())
    if extras_manifest.get('schema') != 1:
        raise ValueError('Unsupported desktop-extras manifest')
    extras = {key: extras_manifest[key] for key in ('bytes', 'sha256')}
    if (not isinstance(extras['bytes'], int) or isinstance(extras['bytes'], bool)
            or not 0 < extras['bytes'] <= 64 * 1024**2
            or len(extras['sha256']) != 64
            or any(c not in '0123456789abcdef' for c in extras['sha256'])):
        raise ValueError('Invalid desktop-extras identity')
    extras_file = args.desktop_extras_file or args.desktop_extras_manifest.with_suffix('')
    if extras_file.stat().st_size != extras['bytes'] or sha(extras_file) != extras['sha256']:
        raise ValueError('Actual desktop extras do not match the expected manifest')
    if 'gzip' in extras_manifest:
        encoded = extras_manifest['gzip']
        extras['gzip'] = {key: encoded[key] for key in ('bytes', 'sha256')}
        compressed_file = extras_file.with_name(extras_file.name + '.gz')
        if (not isinstance(encoded['bytes'], int) or isinstance(encoded['bytes'], bool)
                or not 18 <= encoded['bytes'] <= extras['bytes'] + 65536
                or len(encoded['sha256']) != 64
                or any(c not in '0123456789abcdef' for c in encoded['sha256'])
                or compressed_file.stat().st_size != encoded['bytes']
                or sha(compressed_file) != encoded['sha256']):
            raise ValueError('Actual compressed desktop extras identity differs')
        decoded = hashlib.sha256()
        decoded_bytes = 0
        with gzip.open(compressed_file, 'rb') as stream:
            while block := stream.read(1024 * 1024):
                decoded.update(block)
                decoded_bytes += len(block)
                if decoded_bytes > extras['bytes']:
                    raise ValueError('Compressed extras exceed expected decoded size')
        if decoded_bytes != extras['bytes'] or decoded.hexdigest() != extras['sha256']:
            raise ValueError('Compressed extras are not equivalent to pinned raw extras')
    base = source / 'initramfs-firefox.cpio.gz'
    if manifest['assets']['firefox'].get('cacheLifecycle') is not None:
        raise ValueError('Build from a pre-generation image, not an existing cache image')
    base_sha = sha(base)
    if base_sha != manifest['assets']['firefox']['sha256']:
        raise ValueError('Input image does not match its manifest')
    before = records(base)
    for name in (NATIVE, LAUNCHER, INI, MARKER, 'init'):
        if name not in before or not stat.S_ISREG(before[name]['mode']):
            raise ValueError('Expected original Firefox file missing: ' + name)
    if before[NATIVE]['sha256'] != NATIVE_SHA:
        raise ValueError('Review native identity before using another Firefox build')
    if before[MARKER]['uid'] != 0 or before[MARKER]['mode'] & 0o022:
        raise ValueError('Original root-owned purge-marker protection differs')
    if PROOF.lstrip('/') in before:
        raise ValueError('Cache proof must come only from the verified final frontend overlay')
    if any(name.startswith('opt/firefox/app-') for name in before):
        raise ValueError('Build from an original resource image, not another generation overlay')
    launcher = before[LAUNCHER]['body']
    if launcher.count(EXPECTED_EXEC) != 1 or b'XUL_APP_FILE' in launcher:
        raise ValueError('Original Firefox launcher anchor differs')
    appini = before[INI]['body']
    if b'[App]\n' not in appini or b'Name=Firefox\n' not in appini:
        raise ValueError('Expected native Firefox application metadata')
    inventory = []
    for name, value in sorted(before.items()):
        # Keep explicit native/resource identities for review. The complete
        # pre-generation base image and its init are also bound below so any
        # startup or package composition change conservatively invalidates once.
        if (name.startswith('opt/firefox/') and name != MARKER) or name == 'lowland-OpenSans-Regular.ttf':
            inventory.append({'path': name, **{k: value[k] for k in ('mode', 'uid', 'gid', 'links', 'bytes', 'sha256')}})
    identity = {'schema': SCHEMA, 'abiGeneration': args.abi_generation,
                'baseArchiveSha256': base_sha, 'initSha256': before['init']['sha256'],
                'kernelSha256': manifest['assets']['kernel']['sha256'],
                'desktopExtras': extras, 'resources': inventory}
    generation = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    appdir = 'opt/firefox/app-' + generation
    proof = 'v1 ' + generation + ' ' + extras['sha256'] + ' ' + extras.get('gzip', {}).get('sha256', '-')
    children = sorted({name[len('opt/firefox/browser/'):].split('/')[0]
                       for name in before if name.startswith('opt/firefox/browser/')})
    if 'application.ini' in children:
        raise ValueError('Original browser/application.ini already exists; explicit review required')
    added = [entry(appdir, b'', stat.S_IFDIR | 0o755, 0x31000000)]
    overlay_manifest = []
    for index, child in enumerate(children):
        if child == '.purgecaches':
            continue
        target = '/opt/firefox/browser/' + child
        added.append(entry(appdir + '/' + child, target.encode(), stat.S_IFLNK | 0o777, 0x31000001 + index))
        overlay_manifest.append({'path': appdir + '/' + child, 'target': target})
    added.append(entry(appdir + '/application.ini', appini, stat.S_IFREG | 0o644, 0x31001000))
    # Respect explicit custom XUL apps. The unchanged original marker protects
    # direct launches that do not select this reviewed resource directory.
    inject = ('# Native per-profile compatibility owns cache invalidation.\n'
              '# Only the verified final frontend overlay may attest this composition.\n'
              'linuxonweb_cache_verified=\n'
              'if [ -r "' + PROOF + '" ]; then\n'
              '  IFS= read -r linuxonweb_cache_verified < "' + PROOF + '" || linuxonweb_cache_verified=\n'
              'fi\n'
              'if [ "$linuxonweb_cache_verified" = "' + proof + '" ]; then\n'
              '  if [ -z "${XUL_APP_FILE:-}" ]; then\n'
              '    linuxonweb_custom_app=0\n'
              '    for linuxonweb_arg in "$@"; do\n'
              '      case "$linuxonweb_arg" in\n'
              '        -app|--app|-app=*|--app=*) linuxonweb_custom_app=1; break ;;\n'
              '      esac\n'
              '    done\n'
              '    if [ "$linuxonweb_custom_app" = 0 ]; then\n'
              '      export XUL_APP_FILE="/' + appdir + '/application.ini"\n'
              '    fi\n'
              '    unset linuxonweb_custom_app linuxonweb_arg\n'
              '  fi\n'
              'else\n'
              '  echo "Firefox resource cache reuse disabled: verified image/extras composition unavailable; native invalidation remains active." >&2\n'
              'fi\n'
              'unset linuxonweb_cache_verified\n').encode()
    updated_launcher = launcher.replace(EXPECTED_EXEC, inject + EXPECTED_EXEC)
    added.append(entry(LAUNCHER, updated_launcher, before[LAUNCHER]['mode'], 0x31001001))
    added.append(entry('TRAILER!!!', b'', 0, 0x31001002))
    overlay = b''.join(added)
    output.mkdir(parents=True)
    (output / 'cache-overlay.cpio').write_bytes(overlay)
    archive = output / 'initramfs-firefox.cpio.gz'
    raw_digest = hashlib.sha256()
    raw_bytes = 0
    with archive.open('xb') as target, gzip.GzipFile(filename='', fileobj=target, mode='wb', mtime=0, compresslevel=6) as gz:
        with gzip.open(base, 'rb') as stream:
            while block := stream.read(1024 * 1024):
                gz.write(block)
                raw_digest.update(block)
                raw_bytes += len(block)
        padding = bytes(-raw_bytes % 4)
        gz.write(padding + overlay)
        raw_digest.update(padding + overlay)
        raw_bytes += len(padding) + len(overlay)
    after = records(archive)
    changed = []
    for name, value in before.items():
        expected = after.get(name)
        if not expected or any(expected[k] != value[k] for k in ('mode', 'uid', 'gid', 'links', 'bytes', 'sha256')):
            changed.append(name)
    if changed != [LAUNCHER]:
        raise ValueError('Unexpected original-image mutation: ' + repr(changed))
    if after[NATIVE] != before[NATIVE] or after['init'] != before['init'] or after[MARKER] != before[MARKER]:
        raise ValueError('Native/init/fail-closed marker changed')
    digest = sha(archive)
    result_manifest = copy.deepcopy(manifest)
    result_manifest['version'] = hashlib.sha256(('cache-lifecycle-' + digest).encode()).hexdigest()[:12]
    result_manifest['assets']['firefox'].update(bytes=archive.stat().st_size, sha256=digest,
        label='Firefox cache lifecycle testing image; native code unchanged',
        cacheLifecycle={'schema': 1, 'generation': generation, 'desktopExtras': extras})
    for name in ('kernel', 'plain'):
        filename = pathlib.PurePosixPath(manifest['assets'][name]['url']).name
        origin = source / filename
        if not origin.is_file():
            origin = pathlib.Path('web/linux') / filename
        if sha(origin) != manifest['assets'][name]['sha256']:
            raise ValueError('Companion asset identity differs: ' + name)
        shutil.copyfile(origin, output / filename)
    (output / 'boot-manifest.json').write_text(json.dumps(result_manifest, indent=2) + '\n')
    report = {'schema': 1, 'startedUtc': started_utc,
              'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'durationSeconds': round(time.monotonic() - started, 3),
              'sourceArchiveSha256': base_sha, 'sourceInitSha256': before['init']['sha256'],
              'archiveSha256': digest, 'archiveBytes': archive.stat().st_size,
              'uncompressedSha256': raw_digest.hexdigest(), 'uncompressedBytes': raw_bytes,
              'generation': generation, 'generationIdentity': identity, 'appDirectory': '/' + appdir,
              'nativeSha256': after[NATIVE]['sha256'], 'nativeUnchanged': True,
              'originalInitUnchanged': True, 'originalMarkerPreserved': True,
              'stableExecutable': '/opt/firefox/firefox', 'stableGREDirectory': '/opt/firefox',
              'changedOriginalFiles': changed, 'addedResourceLinks': overlay_manifest,
              'applicationIniSha256': before[INI]['sha256'],
              'runtimeAcceptance': False, 'publicationAccepted': False,
              'profileMutationByBuilder': False, 'expectedDesktopExtras': extras,
              'proofPath': PROOF, 'expectedProofLine': proof, 'proofBundledInImage': False,
              'protocol': 'Native per-profile LastAppDir compatibility; native crash/safe-mode/failure invalidation retained'}
    (output / 'cache-lifecycle-build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('generation', 'archiveSha256', 'archiveBytes', 'durationSeconds', 'nativeUnchanged', 'runtimeAcceptance')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-dir', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--abi-generation', default='linuxonweb-wasm32-v1')
    parser.add_argument('--desktop-extras-manifest', type=pathlib.Path, default=pathlib.Path('web/linux/desktop-extras.cpio.json'))
    parser.add_argument('--desktop-extras-file', type=pathlib.Path)
    build(parser.parse_args())
