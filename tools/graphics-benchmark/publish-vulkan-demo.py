#!/usr/bin/env python3
"""Assemble only allowlisted public WSI demo artifacts; never copy private state."""
import argparse, pathlib, shutil, hashlib, json, tarfile, gzip, datetime
p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[2];scratch=root/'../../../codex-build/g3g';build=scratch/'vulkan-wsi-build3';repo=root/'out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/repo';out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);src=out/'source';src.mkdir()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def copy(source,target):target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
binary=build/'vkgears-wsi.wasm';apk=repo/'wasm32/linuxonweb-vkgears-20261103-r0.apk';key=repo/'linuxonweb-dev.rsa.pub'
assert sha(binary)=='cc4a4c6c26d6469f3973af424b9f7cf3e6056127ee8f11e4920de368c90b8add'
assert sha(apk)=='7735f57fab46d9467e262e496610be7f597dd900c3c6a77f75c8b7b1e5588ccb'
assert 'PRIVATE KEY' not in key.read_text() and 'PUBLIC KEY' in key.read_text()
for f in (binary,apk,key):copy(f,out/f.name)
for f in sorted((build/'frozen').rglob('*')):
 if f.is_file():copy(f,src/'project/web/linux/tests'/f.relative_to(build/'frozen'))
for name in ('build-vulkan-wsi.py','fetch-vulkan-sdk.py','package-vulkan-wsi.py'):
 copy(root/'tools/graphics-benchmark'/name,src/'project/tools/graphics-benchmark'/name)
for name in ('web/linux/tests/guest-gpu/host.mjs','web/linux/tests/guest-vulkan-webgl/renderer.mjs','web/linux/guest-gpu-config.mjs'):
 copy(root/name,src/'project'/name)
for f in sorted((scratch/'vulkan-sdk-source1').rglob('*')):
 if f.is_file():copy(f,src/'upstream'/f.relative_to(scratch/'vulkan-sdk-source1'))
for name in ('build.json','steps.json','static-loader-port.patch'):copy(build/name,src/'receipts'/name)
for name in ('gpt6-astra-vulkan-wsi-20261103.json','gpt6-astra-firefox-clockcube-20261103.json','gpt6-astra-jit-cache-20261103.json','gpt6-astra-dispatch-20261103.json'):
 copy(root/'tools/graphics-benchmark/evidence'/name,out/'evidence'/name)
for name in ('gpt6-astra-rubywebterm-graphics-jit-matrix-20261103.md','gpt6-astra-rubywebterm-vulkan-wsi-20261103.md','gpt6-astra-rubywebterm-firefox-jit-build-audit-20261103.md'):
 copy(root/'docs'/name,out/name)
copy(root/'tools/graphics-benchmark/evidence/gpt6-astra-vulkan-wsi-accepted-20261103.png',out/'vulkan-wsi.png');copy(root/'tools/graphics-benchmark/evidence/gpt6-astra-firefox-clockcube-20261103.png',out/'firefox-clockcube.png')
readme='''# Native Vulkan WSI demo — GPT-6 Astra Pro / built-in graphics_jit / rubywebterm

This is a real native wasm32 Linux executable for the existing linuxonweb desktop.
It uses a pinned Khronos static Vulkan loader and the project's bounded experimental
ICD. It is not a host executable, a full Vulkan implementation, or a Firefox speed fix.

## Run in the Linux desktop

Use the current linuxonweb desktop with the accepted host WSI changes (commit 21fd2c6
or later). In Settings choose **Guest Vulkan: WebGL** explicitly on the tested MX110.
The screen presenter is a separate setting. Start the desktop and its terminal.
Download the included signed APK and public key into the guest Downloads directory.
With the package-enabled image, its existing developer key is already configured.
For a separately prepared image, install this supplied public key into /etc/apk/keys
before installation. Do not disable signature verification.

```sh
cd ~/Downloads
sudo apk add ./linuxonweb-vkgears-20261103-r0.apk
DISPLAY=:0 vkgears-wsi -wsi -info -size 128x128 -seconds 10
```

Alternative: copy vkgears-wsi.wasm into the guest, mark it executable and run the
same arguments. It requires X11 and the current guest GPU host service. A normal
host Linux kernel cannot execute this wasm32 Linux ABI binary directly.

## What was accepted

The identical native binary opened a real guest X11 window, rendered 170 frames and
510 draws during the bounded fixture, and closed with CLOSE=0 and zero guest
swapchain/surface/resource handles. The renderer passed 32 real-GPU pixel, asymmetric
orientation, resize, state, stale-handle, queued-close, throwing-sink and context-loss
checks. Present uses GPU blit and ImageBitmap/bitmaprenderer transfer, with no CPU
pixel readback in this path. The APK is signed and contains this accepted binary;
installation and launch of that APK in the normal desktop remain a separate gate.
No claim is made that the normal-desktop APK gate has already passed.

The native fixture's reported 28.26 fps is a functional run, potentially contended,
not a fair host-performance benchmark. Full Firefox on the same cube reached
2.40575 fps versus 59.84828 fps in host Chromium, about 4.02%. The long 17.3 s interval
is retained. See the matrix and JSON for settings, clocks and observer limitations.

## Known limits

The Vulkan device is deliberately nonconformant. Full Vulkan/OpenGL, shader push
constants and complete WSI waiting/presentation semantics are not established.
WebGPU canvas export loses the device on this tested NVIDIA host; the application
requires the user to choose WebGL explicitly and does not silently downgrade.
The original simplified GL fences remain because a proposed replacement failed a
real native regression and was excluded. Firefox 30 s and 50% host targets are unmet.

## Build source and provenance

The source/ directory contains the exact frozen project inputs used for this
binary, 53 hash-pinned upstream loader/header files, current host protocol changes,
and compile/link receipts. Upstream notices in those files are preserved. No new
license is asserted for project files that had no explicit notice.

The original build uses LLVM 22.1.8 wasm32-unknown-linux-musl, matching X11/XCB/Xau
static inputs, glslangValidator, spirv-val, wasm-validate and LLVM utilities. The
script records exact Nix inputs and SHA256 values in receipts/build.json. In a
matching authorized environment, from source/project run:

```sh
python3 tools/graphics-benchmark/build-vulkan-wsi.py --source-audit ../upstream --output ../fresh-build
```

The script requires a new disk-backed output directory and 20 GiB free reserve.
No protected Firefox build tree is needed. The source archive is not a complete
self-contained LLVM/X11 toolchain. Original build and runtime receipts are separate.

This bundle is allowlisted: no private signing key, browser profile, authentication
capability token or user home database is included. SHA256SUMS covers public files.
'''
(out/'README.md').write_text(readme)
(src/'README.md').write_text(readme)
archive=out/'gpt-6-astra-pro_builtin-graphics-rubywebterm-vulkan-demo.tar.gz'
with archive.open('wb') as raw:
 with gzip.GzipFile(fileobj=raw,mode='wb',compresslevel=6,mtime=0) as gz:
  with tarfile.open(fileobj=gz,mode='w') as tar:
   for f in sorted(src.rglob('*'))+[out/binary.name,out/apk.name,out/key.name,out/'README.md']:
    if f.is_file():
     info=tar.gettarinfo(str(f),arcname=str(f.relative_to(out)));info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0
     with f.open('rb') as stream:tar.addfile(info,stream)
shutil.rmtree(src)
(out/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Linuxonweb · native Vulkan demo and graphics evidence</title><style>body{font:16px/1.55 system-ui,sans-serif;background:#edf6ff;color:#152638;margin:0}main{max-width:1020px;margin:0 auto;padding:36px 22px 90px}h1{font-size:clamp(27px,5vw,42px);line-height:1.15}h2{margin-top:32px}a{color:#0956a3}section{background:white;border:1px solid #d1e3ef;border-radius:16px;padding:22px;margin:24px 0}pre{white-space:pre-wrap;background:#102638;color:#f4f9ff;padding:17px;border-radius:9px;overflow:auto}img{max-width:100%;height:auto;border-radius:9px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #dbe6ef}footer{position:fixed;bottom:0;right:0;background:#000;color:white;padding:9px 16px;font-size:15px}small{display:block;color:#456175}.links{display:flex;gap:16px;flex-wrap:wrap}</style><main><small>GPT-6 Astra Pro · built-in graphics_jit · rubywebterm · 2026-11-03</small><h1>A native Vulkan window inside Linux in the browser</h1><p>The accepted bounded Vulkan demo renders in a real guest X11 window. The graphics bridge is faster, while complete Firefox remains far below the requested desktop performance target.</p><div class="links"><a href="linuxonweb-vkgears-20261103-r0.apk">Signed optional demo APK</a><a href="gpt-6-astra-pro_builtin-graphics-rubywebterm-vulkan-demo.tar.gz">Source and build recipe</a><a href="vkgears-wsi.wasm">Native Wasm executable</a><a href="linuxonweb-dev.rsa.pub">Public verification key</a><a href="SHA256SUMS">SHA256 checksums</a></div><section><h2>Run the demo</h2><p>Use a package-enabled current linuxonweb desktop. In Settings explicitly choose <strong>Guest Vulkan: WebGL</strong> on the tested NVIDIA MX110. Download the APK into the guest Downloads folder, then use its terminal:</p><pre>cd ~/Downloads
sudo apk add ./linuxonweb-vkgears-20261103-r0.apk
DISPLAY=:0 vkgears-wsi -wsi -info -size 128x128 -seconds 10</pre><p>The native binary passed the bounded real-guest fixture. Normal-desktop installation and launch of this signed APK are a separate pending gate. Signature checking stays enabled. <a href="README.md">Complete requirements and build instructions</a>.</p><img src="vulkan-wsi.png" alt="Actual guest X11 Vulkan gears window and accepted close status"><small>Actual captured test image; no generated artwork.</small></section><section><h2>Measured results</h2><table><thead><tr><th>Workload</th><th>Result</th><th>Meaning</th></tr></thead><tbody><tr><td>100-draw bridge workload</td><td>25.5% higher throughput</td><td>43.2% of its direct-host comparator; balanced samples</td></tr><tr><td>Native Vulkan WSI</td><td>170 frames; clean close</td><td>Functional demonstration, not a host-speed comparison</td></tr><tr><td>Same cube in full Firefox</td><td>2.40575 vs 59.84828 fps</td><td>4.02% of host Chromium callback rate</td></tr></tbody></table><p>The full Firefox sample retains its 17.3-second interval and uses matching monotonic/wall time. Profile writes and some observer work overlap it; no causal performance attribution is asserted.</p><img src="firefox-clockcube.png" alt="Actual Firefox 159 result showing 82 frames in 34085 ms, glError0 and colored cube"></section><section><h2>Capabilities and limits</h2><p>This is a bounded, nonconformant Vulkan implementation. Full Vulkan, full desktop OpenGL, complete native JIT safety acceptance, Firefox within 30 seconds and 50% of host performance have not been established. WebGPU canvas export loses the device on the tested host, so WebGL remains an explicit user choice. The screen presenter, guest GLES and guest Vulkan are separate paths.</p><p><a href="gpt6-astra-rubywebterm-graphics-jit-matrix-20261103.md">Full graphics and JIT acceptance matrix</a> · <a href="gpt6-astra-rubywebterm-vulkan-wsi-20261103.md">Vulkan implementation and test report</a> · <a href="evidence/gpt6-astra-firefox-clockcube-20261103.json">Clock-correlated Firefox evidence</a></p></section></main><footer>Graphics/JIT scope 34/100 · evidence checkpoint 70</footer></html>''')
files=[]
for f in sorted(out.rglob('*')):
 if f.is_file():
  rel=str(f.relative_to(out));assert not any(part in rel.lower() for part in ('private','profile/','capability','token'));files.append({'path':rel,'bytes':f.stat().st_size,'sha256':sha(f)})
(out/'SHA256SUMS').write_text(''.join(x['sha256']+'  '+x['path']+'\n' for x in files));(out/'manifest.json').write_text(json.dumps({'model':'GPT-6 Astra Pro','agent':'built-in graphics_jit','tool':'rubywebterm','createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'nativeBinaryAccepted':True,'normalDesktopApkAcceptance':False,'files':files},indent=2)+'\n');print(json.dumps({'output':str(out),'files':len(files)+2,'bytes':sum(f.stat().st_size for f in out.rglob('*') if f.is_file()),'archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size}))
