#!/usr/bin/env python3
"""Small exact-byte supplement for assets omitted by the public source filter."""
import argparse,datetime,gzip,hashlib,io,json,pathlib,subprocess,tarfile
RUNTIME_SHA='fed503455594836a87b131d2e62a62a12bdd0c220c4e9768b0d5c6dd65d1b081'
PINS={
 'web/linux/node_modules/@xterm/xterm/lib/xterm.js':'1f991ac3b4b283ebf96e60ae23a00a52765dd3a2e46fa6fdda9f1aab032f7495',
 'web/linux/node_modules/@xterm/xterm/css/xterm.css':'ba8e6985669488981ccf40c0cefe3aba80722cb6c92de7ad628b0bd717faf2b6',
 'web/linux/node_modules/@xterm/addon-fit/lib/addon-fit.js':'bdaefa370b1bfc42ee88d46fe6072400902a4d4b2d45cd93438dda9b23c97089',
 'web/linux/dist/firefox-webgpu-decoder.wasm':'2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e',
}
def digest(data):return hashlib.sha256(data).hexdigest()
def record(data):return {'bytes':len(data),'sha256':digest(data)}
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--runtime-manifest',type=pathlib.Path,required=True);a=p.parse_args()
if a.out.exists() or a.out.is_symlink():raise ValueError('fresh supplement output required')
if digest(a.runtime_manifest.read_bytes())!=RUNTIME_SHA:raise ValueError('immutable runtime manifest differs')
payload={}
for name,wanted in PINS.items():
 source=pathlib.Path(name)
 if source.is_symlink() or not source.is_file():raise ValueError('regular tracked source required')
 subprocess.run(['git','ls-files','--error-unmatch','--',name],check=True,stdout=subprocess.DEVNULL)
 data=source.read_bytes()
 if digest(data)!=wanted:raise ValueError('pinned vendored bytes differ: '+name)
 payload[name]=data
css=payload['web/linux/node_modules/@xterm/xterm/css/xterm.css'].decode()
notice=css[:css.index('*/')+2]
if 'Permission is hereby granted' not in notice or 'THE SOFTWARE IS PROVIDED' not in notice:raise ValueError('complete embedded MIT notice not found')
payload['web/linux/third-party-notices/xterm-existing-MIT.txt']=(notice+'\n').encode()
provenance='''# Browser dependency supplement\n\nThe three xterm runtime files are unchanged Git-tracked minimal vendored files, with hashes recorded in web/linux/PROVENANCE.md. The complete existing MIT notice is preserved verbatim from the CSS header in xterm-existing-MIT.txt. This is not an npm installation, and no package version or package.json has been invented.\n\nThe unchanged Git-tracked firefox-webgpu-decoder.wasm is also retained because the filtered public source excludes WASM. It is used by an explicit optional route; inclusion does not enable that route or establish WebGPU conformance. Related project source is recovered from the source checkout.\n\nThe original encrypted Git base plus final cumulative increment already contain these tracked payloads. This supplement fills omissions only in the filtered public-source plus exact-runtime recovery path. It contains no private access grant, cookie, signing key or device identifier. Browser dependencies alone are not the Linux rootfs or the complete server deployment.\n'''
payload['web/linux/third-party-notices/browser-dependencies-20261103.md']=provenance.encode()
if sum(map(len,payload.values()))>1024*1024:raise ValueError('small supplement bound exceeded')
a.out.mkdir(parents=True);pub=a.out/'publish';pub.mkdir()
archive='linuxonweb_browser_dependencies_20261103_1322.tar.gz'
with tarfile.open(pub/archive,'w:gz',compresslevel=1) as tar:
 for name,data in sorted(payload.items()):
  info=tarfile.TarInfo(name);info.mode=0o644;info.size=len(data);info.mtime=0;info.uid=info.gid=0;info.uname=info.gname='root';tar.addfile(info,io.BytesIO(data))
rows=[{'restorePath':name,**record(data)} for name,data in sorted(payload.items())]
manifest={'schema':1,'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'runtimeManifestSha256':RUNTIME_SHA,'runtimeVersion':'1a3951f0c48d','archive':{'name':archive,**record((pub/archive).read_bytes())},'files':rows,'scope':'Exact minimal tracked browser dependencies omitted from filtered public source; full encrypted Git history already contains their original payloads','optionalDecoderEnabled':False,'newNativeAcceptance':False}
(pub/'BROWSER-DEPENDENCIES-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
restore=r'''#!/usr/bin/env python3
import argparse,hashlib,json,os,pathlib,tarfile
ROOT=pathlib.Path(__file__).resolve().parent
EXPECTED_RUNTIME=__RUNTIME__
EXPECTED_FILES=__FILES__
EXPECTED_ARCHIVE=__ARCHIVE__
def fail(message):raise ValueError(message)
def sha(path):
 with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def safe(name,leaf=False):
 if not isinstance(name,str) or not name or name.startswith('/') or '\\' in name or ':' in name or '\0' in name or any(x in ('','.','..') for x in name.split('/')) or (leaf and '/' in name):fail('unsafe artifact path')
 return name
def verify(path,identity):
 if path.is_symlink() or not path.is_file() or path.stat().st_size!=identity['bytes'] or sha(path)!=identity['sha256']:fail('file identity mismatch: '+str(path))
parser=argparse.ArgumentParser(description='Verify and restore the exact small browser dependency supplement; differing existing files are never overwritten.')
parser.add_argument('--runtime-manifest',type=pathlib.Path,default=ROOT/'RUNTIME-MANIFEST.json')
parser.add_argument('--destination',type=pathlib.Path,default=ROOT/'restored-browser-dependencies')
args=parser.parse_args()
if args.runtime_manifest.is_symlink() or not args.runtime_manifest.is_file() or sha(args.runtime_manifest)!=EXPECTED_RUNTIME:fail('runtime manifest does not match this supplement')
manifest=json.loads((ROOT/'BROWSER-DEPENDENCIES-MANIFEST.json').read_text())
if manifest.get('schema')!=1 or manifest.get('runtimeManifestSha256')!=EXPECTED_RUNTIME or manifest.get('files')!=EXPECTED_FILES or manifest.get('archive')!=EXPECTED_ARCHIVE:fail('supplement manifest differs from pinned restore contract')
archive=ROOT/safe(EXPECTED_ARCHIVE['name'],leaf=True);verify(archive,EXPECTED_ARCHIVE)
out=args.destination.absolute()
for parent in [out,*out.parents]:
 if parent.is_symlink():fail('symlink in selected destination')
 if parent.exists() and not parent.is_dir():fail('non-directory selected destination ancestor')
if out.exists() and not out.is_dir():fail('destination is not a directory')
expected={safe(row['restorePath']):row for row in EXPECTED_FILES}
def destination(name):
 if not name.startswith('web/linux/'):fail('unexpected destination namespace')
 path=out/name
 for parent in [path,*path.parents]:
  if parent==out.parent:break
  if parent.is_symlink():fail('symlink in restore destination')
  if parent!=path and parent.exists() and not parent.is_dir():fail('non-directory restore ancestor')
 if not path.resolve().is_relative_to(out.resolve()):fail('destination escapes selected root')
 return path
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();names=[safe(row.name) for row in members]
 if len(names)!=len(set(names)) or set(names)!=set(expected):fail('archive member inventory differs')
 for member,name in zip(members,names):
  if not member.isfile() or member.size!=expected[name]['bytes']:fail('archive member type/size differs')
  target=destination(name)
  if target.exists():verify(target,expected[name])
 # Verify every archived body before making any filesystem changes.
 data={}
 for member,name in zip(members,names):
  body=tar.extractfile(member).read()
  if len(body)!=expected[name]['bytes'] or hashlib.sha256(body).hexdigest()!=expected[name]['sha256']:fail('archived body identity differs')
  data[name]=body
out.mkdir(parents=True,exist_ok=True);written=reused=0
for name,body in data.items():
 target=destination(name)
 if target.exists():verify(target,expected[name]);reused+=1;continue
 target.parent.mkdir(parents=True,exist_ok=True)
 with target.open('xb') as stream:
  stream.write(body);stream.flush();os.fsync(stream.fileno())
 target.chmod(0o644);written+=1
for name,identity in expected.items():verify(destination(name),identity)
print(json.dumps({'pass':True,'filesVerified':len(expected),'written':written,'reusedIdentical':reused,'destination':str(out)}))
'''
restore=restore.replace('__RUNTIME__',repr(RUNTIME_SHA)).replace('__FILES__',repr(rows)).replace('__ARCHIVE__',repr(manifest['archive']))
(pub/'restore-browser-dependencies.py').write_text(restore)
(pub/'README.md').write_text('''# Exact browser dependency supplement\n\nKeep the immutable current RUNTIME-MANIFEST.json available. Download this supplement manifest, archive and restore script together. Run:\n\n    python3 -O restore-browser-dependencies.py --runtime-manifest /path/to/RUNTIME-MANIFEST.json --destination /path/to/recovered-source\n\nThe script verifies the bound runtime manifest, exact supplement inventory, compressed archive and every uncompressed file. Existing identical files are verified and reused. Existing differing files or symlinks fail before any new file is written; they are never overwritten. Repeating a successful restore is idempotent. A process interrupted while writing may leave a partial new file, which a subsequent run refuses until the owner reviews/removes that partial file.\n\nThe original encrypted Git base plus final cumulative increment already restore these tracked runtime payloads. This supplement is required only when using the filtered public source export with the exact runtime archive. The rootfs/kernel/runtime archives and appropriate COOP/COEP/CORP and network-proxy server are still required. For the tracked local desktop server, run Node22+ from the recovered checkout with: node web/desktop/serve.mjs . Then open http://127.0.0.1:4173/desktop/index.html?wm=1&firefox=1 or http://127.0.0.1:4173/linux/packages/v1/package-shell.html?cpus=1 . That server uses Node built-in modules only and supplies isolation headers plus the DNS/TCP bridge; it serves the restored latest-build assets. No npm install is required for this local server. Cloudflare/Sites deployment tooling is separate and uses its own package manifest/lock. Existing private live-preview grants are intentionally not part of recovery. No private key or access grant belongs in the recovered public web tree.\n''')
print(json.dumps({'pass':True,'files':len(rows),'payloadBytes':sum(map(len,payload.values())),'archiveBytes':manifest['archive']['bytes'],'runtimeManifestSha256':RUNTIME_SHA,'output':str(pub)}))
