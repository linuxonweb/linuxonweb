#!/usr/bin/env python3
"""Pin one default-JIT Firefox performance fixture; never change native/launcher/init."""
import argparse
import copy
import datetime
import gzip
import hashlib
import importlib.util
import io
import json
import pathlib
import stat
import sys
import time
sys.dont_write_bytecode = True
SCENE_SHA = 'e610e6b07da7622ed0724308dd5867b93330ad2a740c515dea46bfa1b1a929c0'
MANIFEST_SHA = '9da17bf944a4d25d8f4c4811e93a0dc9ca76b7b37f52579544959c7ae18a4bd5'
IMAGE_SHA = '4b20a71713a8229f52f3ac2702d8d94dd5b4779a53ed28f0bb0d5830bf14b06c'
EXTRAS_SHA = '5b624dd8325b4cbc717c114c3eb7592cc3ca67e257b06aa1e41ddb73c7f070d8'
SCENE_PATH = 'opt/firefox/gpu-check/gpu-check.html'
PREF_PATH = 'opt/firefox/defaults/pref/zz-matched-scene-test.js'

def digest(data): return hashlib.sha256(data).hexdigest()

def raw_inventory(raw, helper):
    result = {}; stream = io.BytesIO(raw)
    while True:
        first = stream.read(1)
        while first == b'\0': first = stream.read(1)
        if not first: return result
        header = first + helper.exact(stream, 109)
        if header[:6] != b'070701': raise ValueError('invalid extras archive')
        fields = [int(header[i:i+8], 16) for i in range(6, 110, 8)]
        size, length = fields[6], fields[11]
        if not 1 <= length <= 4096: raise ValueError('invalid extras name length')
        name = helper.exact(stream, length)
        if name[-1:] != b'\0' or b'\0' in name[:-1]: raise ValueError('invalid extras name')
        name = name[:-1].decode().removeprefix('./')
        if name != '.' and (name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/'))): raise ValueError('unsafe extras name')
        helper.exact(stream, -(110 + length) % 4)
        if stream.tell() + size + (-size % 4) > len(raw): raise ValueError('truncated extras body')
        stream.seek(size + (-size % 4), 1)
        if name != 'TRAILER!!!': result[name] = {'mode': fields[1], 'uid': fields[2], 'bytes': size}
        elif size: raise ValueError('nonempty extras trailer')

def main(args):
    started = time.monotonic(); stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if args.output.exists() or args.output.is_symlink(): raise ValueError('fresh private fixture output required')
    spec = importlib.util.spec_from_file_location('cache_inventory', pathlib.Path(__file__).with_name('build-cache-image.py'))
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    manifest_bytes = (args.base_dir / 'boot-manifest.json').read_bytes(); manifest = json.loads(manifest_bytes)
    asset = manifest['assets']['firefox']; archive = args.base_dir / 'initramfs-firefox.cpio.gz'
    if digest(manifest_bytes) != MANIFEST_SHA or asset['sha256'] != IMAGE_SHA or helper.sha(archive) != IMAGE_SHA: raise ValueError('selected persistence image identity differs')
    if asset.get('cacheLifecycle') is not None: raise ValueError('cache candidate must remain off for this sample')
    inventory = helper.records(archive)
    if inventory[helper.NATIVE]['sha256'] != helper.NATIVE_SHA: raise ValueError('native Firefox differs')
    launcher = inventory[helper.LAUNCHER]['body']
    if launcher.count(helper.EXPECTED_EXEC) != 1 or b'PBLBC_HITS' in launcher or b'XUL_APP_FILE' in launcher: raise ValueError('unmodified default launcher required')
    if inventory[helper.MARKER]['uid'] != 0 or inventory[helper.MARKER]['mode'] & 0o022: raise ValueError('protected original purge marker required')
    scene = args.scene.read_bytes()
    if digest(scene) != SCENE_SHA or len(scene) != 36031: raise ValueError('matched scene differs')
    metadata = json.loads((args.extras_dir / 'desktop-extras.cpio.json').read_text()); raw = (args.extras_dir / 'desktop-extras.cpio').read_bytes()
    if metadata['schema'] != 1 or digest(raw) != EXTRAS_SHA or metadata['sha256'] != EXTRAS_SHA or len(raw) != metadata['bytes']: raise ValueError('current production extras identity differs')
    entries = raw_inventory(raw, helper)
    protected = {helper.NATIVE, helper.LAUNCHER, helper.MARKER, 'init', 'init.desktop-original', 'usr/sbin/apk-persist', helper.PROOF.lstrip('/')}
    if protected & entries.keys(): raise ValueError('production extras unexpectedly replace protected base paths')
    pref = b'// Diagnostic result channel only; native JIT/default thresholds unchanged.\npref("devtools.console.stdout.content", true);\n'
    added = []; index = 0x34000000
    for name in ['opt', 'opt/firefox', 'opt/firefox/gpu-check', 'opt/firefox/defaults', 'opt/firefox/defaults/pref']:
        prior = entries.get(name, inventory.get(name))
        if prior and not stat.S_ISDIR(prior['mode']): raise ValueError('scene parent is not a real directory: ' + name)
        if not prior: added.append(helper.entry(name, b'', stat.S_IFDIR | 0o755, index)); index += 1
    for name, body in [(SCENE_PATH, scene), (PREF_PATH, pref)]:
        added.append(helper.entry(name, body, stat.S_IFREG | 0o644, index)); index += 1
    added.append(helper.entry('TRAILER!!!', b'', 0, index)); overlay = b''.join(added); overlay += bytes(-len(overlay) % 512)
    combined = raw + bytes(-len(raw) % 4) + overlay
    if len(combined) > 64 * 1024**2 or not combined.startswith(raw): raise ValueError('bounded prefix-preserving extras required')
    compressed = gzip.compress(combined, compresslevel=1, mtime=0)
    if gzip.decompress(compressed) != combined: raise ValueError('single-member compressed extras differ')
    updated = copy.deepcopy(metadata); updated.update(bytes=len(combined), sha256=digest(combined), gzip={'bytes':len(compressed),'sha256':digest(compressed)})
    updated['members'] = [row for row in updated.get('members',[]) if row['path'].lstrip('/') not in {SCENE_PATH,PREF_PATH}]
    updated['members'] += [{'path':'/'+name,'bytes':len(body),'sha256':digest(body)} for name,body in [(SCENE_PATH,scene),(PREF_PATH,pref)]]
    args.output.mkdir(parents=True)
    for name, data in [('desktop-extras.cpio',combined),('desktop-extras.cpio.gz',compressed)]: (args.output/name).write_bytes(data)
    (args.output/'desktop-extras.cpio.json').write_text(json.dumps(updated,indent=2)+'\n')
    report = {'schema':1,'testOnly':True,'startedUtc':stamp,'finishedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'durationSeconds':round(time.monotonic()-started,3),'manifestSha256':MANIFEST_SHA,'manifestVersion':manifest['version'],
              'systemArchiveSha256':IMAGE_SHA,'nativeFirefoxSha256':helper.NATIVE_SHA,'baseInitSha256':inventory['init']['sha256'],
              'baseLauncherSha256':digest(launcher),'productionExtrasSha256':EXTRAS_SHA,'matchedSceneSha256':SCENE_SHA,
              'diagnosticPrefSha256':digest(pref),'nativeChanged':False,'launcherChanged':False,'initChanged':False,'cacheLifecycleEnabled':False,
              'thresholdOverridden':False,'expectedDefaultMethodThreshold':50,'extrasSha256':updated['sha256'],'gzipSha256':updated['gzip']['sha256'],
              'productionExtrasPrefixUnchanged':True,'onlyAddedRegularFiles':[SCENE_PATH,PREF_PATH],
              'instrumentation':'Only result stdout preference and sparse log-row timestamps; no HomeFS/input/worker rewrites; one external resource monitor per browser',
              'sample':{'width':320,'height':240,'warmupMs':10000,'sampleMs':20000,'metric':'page requestAnimationFrame callback intervals, every stall and overrun included'},
              'arms':[{'threshold':50,'directory':str(args.output.resolve()),'extrasSha256':updated['sha256'],'gzipSha256':updated['gzip']['sha256'],'launcherSha256':digest(launcher),'nativeChanged':False}],
              'matchedExtrasSha256':EXTRAS_SHA,'performanceAccepted':False,'physicalPresentationRateMeasured':False,'publicDefaultChanged':False}
    (args.output/'matched-current-experiment.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'durationSeconds':report['durationSeconds'],'manifestVersion':manifest['version'],'nativeChanged':False,'thresholdOverridden':False,'extrasSha256':updated['sha256']}))

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-dir',type=pathlib.Path,required=True);parser.add_argument('--extras-dir',type=pathlib.Path,required=True)
    parser.add_argument('--scene',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,required=True)
    main(parser.parse_args())
