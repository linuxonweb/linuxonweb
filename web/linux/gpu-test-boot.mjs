// One VM boots the normal Xfbdev/Aurora desktop and a Vulkan readback window.
// The separate candidate reuses the accepted Rust host without changing it.
import { appendDesktopExtras } from './desktop-extras.mjs';
import { nonSharedBytes } from './console-bytes.mjs';
const runtimeConfigUrl = new URL('./gpu-test-runtime.json', import.meta.url);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');

async function packageResponse(url) {
  let response;
  try { response = await fetch(url, { cache: 'no-store' }); }
  catch (error) { throw new Error(`The Vulkan test package request failed: ${url.href} (${error.message}).`); }
  if (!response.ok) throw new Error(`The Vulkan test package is unavailable: HTTP ${response.status} at ${url.href}.`);
  return response;
}

export async function bootWgpuTest({ backend, canvas, log, onStatus, configuration = {} }) {
  if (!crossOriginIsolated || !['webgpu', 'webgl'].includes(backend)) throw new Error('An isolated page and a supported wgpu backend are required.');
  const cpus = configuration.cpus ?? navigator.hardwareConcurrency;
  const memoryBytes = configuration.memoryBytes ?? 1073741824;
  const displayBackend = configuration.displayBackend ?? 'canvas2d';
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > Math.min(64, navigator.hardwareConcurrency)) throw new Error('The test needs a supported CPU allocation.');
  if (!Number.isInteger(memoryBytes) || memoryBytes < 512 * 1024 ** 2 || memoryBytes > 0xffff0000 || !['canvas2d', 'auto', 'webgl'].includes(displayBackend)) throw new Error('The test needs supported machine settings.');
  // A preview may isolate the entire accepted runtime under one same-origin
  // prefix while serving a newer runtime for ordinary Firefox boots.
  const configResponse = await fetch(runtimeConfigUrl, { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('The Vulkan test runtime is unavailable.');
  const config = await configResponse.json();
  if (config.schema !== 1 || !['./', './accepted-vulkan/'].includes(config.runtimeRoot)) throw new Error('The Vulkan test runtime configuration is invalid.');
  const runtimeRoot = new URL(config.runtimeRoot, import.meta.url);
  const { spawnMachine, consoleDevice, entropyDevice, inputDevice, vsockDevice } = await import(new URL('dist/index.js', runtimeRoot).href);
  const packageUrl = new URL('./tests/wgpu-desktop/candidate/package.json', import.meta.url);
  const archiveUrl = new URL('./tests/wgpu-desktop/candidate/initramfs.cpio', import.meta.url);
  const metadataResponse = await packageResponse(packageUrl);
  let metadata;
  try { metadata = await metadataResponse.json(); }
  catch { throw new Error(`The Vulkan test package manifest is invalid JSON: ${packageUrl.href}.`); }
  if (!metadata?.passPackage || !metadata.testOnly || !metadata.desktopBoot || metadata.mode !== 'wgpu-desktop-readback') throw new Error(`The Vulkan desktop test package manifest is invalid: ${packageUrl.href}.`);
  const archiveResponse = await packageResponse(archiveUrl);
  let archive;
  try { archive = new Uint8Array(await archiveResponse.arrayBuffer()); }
  catch (error) { throw new Error(`The Vulkan test package download failed: ${archiveUrl.href} (${error.message}).`); }
  if (metadata.bytes !== archive.length) throw new Error(`The Vulkan desktop test package is incomplete: expected ${metadata.bytes} bytes, received ${archive.length} from ${archiveUrl.href}.`);
  if (metadata.archiveSha256 !== await digest(archive)) throw new Error(`The Vulkan desktop test package checksum does not match its manifest: ${archiveUrl.href}.`);

  const report = { backend, runtimeRoot: runtimeRoot.href, package: metadata, cpus, memoryBytes, framebuffer: { width: canvas.width, height: canvas.height, backend: displayBackend }, desktop: { ready: false, managedWindow: false, pixelsVerified: false, renderStartedAfterDesktop: false, presentation: 'GPU readback copied through guest XPutImage' }, done: false, pass: false, errors: [] };
  const decoder = new TextDecoder();
  let pending = '', deadline, machine, bootReader, closed = false;
  const finish = (pass, error) => {
    if (report.done) return;
    report.done = true; report.pass = pass;
    if (error) report.errors.push(error);
    clearTimeout(deadline);
    onStatus(pass ? `wgpu (${backend === 'webgpu' ? 'WebGPU' : 'WebGL'}) test passed · desktop running` : 'wgpu test failed · see logs', pass ? 'running' : 'error');
  };
  const output = new WritableStream({ write(bytes) {
    bytes = nonSharedBytes(bytes);
    log(bytes);
    const lines = (pending + decoder.decode(bytes, { stream: true })).split('\n');
    pending = lines.pop().slice(-8192);
    for (const raw of lines) {
      const line = raw.replaceAll('\r', '');
      const exit = /^GUEST_WGPU_EXIT status=(\d+)/.exec(line);
      if (/^GUEST_WGPU_.*FAIL/.test(line)) report.errors.push(line);
      if (/^GUEST_WGPU_DESKTOP_READY .*wm=Aurora /.test(line)) { report.desktop.ready = true; report.desktop.readyLine = line; onStatus('desktop ready · starting Vulkan test', 'running'); }
      if (/^GUEST_WGPU_DESKTOP_WINDOW .*mapped=1 managed=1$/.test(line)) { report.desktop.managedWindow = true; report.desktop.windowLine = line; }
      if (/^GUEST_WGPU_CONFIG /.test(line)) report.desktop.renderStartedAfterDesktop = report.desktop.ready && report.desktop.managedWindow;
      if (/^GUEST_WGPU_DESKTOP_PIXELS checks=65536 failures=0 transport=XPutImage$/.test(line)) report.desktop.pixelsVerified = true;
      if (/^GUEST_WGPU_DESKTOP_HOLD /.test(line)) report.desktop.windowHeld = true;
      if (/^GUEST_WGPU_DESKTOP_EXIT /.test(line)) report.desktop.appExited = true;
      if (exit) {
        report.exitStatus = Number(exit[1]);
        const desktopPass = report.desktop.ready && report.desktop.managedWindow && report.desktop.pixelsVerified && report.desktop.renderStartedAfterDesktop;
        if (!desktopPass) report.errors.push('Desktop readiness, managed window, pixels, or auto-start order was not verified.');
        finish(report.exitStatus === 0 && report.errors.length === 0 && desktopPass);
      }
    }
  } });
  archive = await appendDesktopExtras(archive);
  const clipboardVsock = vsockDevice();
  const pointer = inputDevice({ name: 'wasm keyboard/mouse', absXMax: canvas.width - 1, absYMax: canvas.height - 1 });
  try { machine = await spawnMachine({
    cpus,
    devicetree: { memory: { reg: [0, report.memoryBytes] } },
    initcpio: archive,
    cmdline: 'console=hvc0 rdinit=/init',
    devices: [consoleDevice(null, output), entropyDevice(), pointer, clipboardVsock],
    framebuffer: { canvas, ...report.framebuffer },
    gpuHostcall: { stallMs: 30000, ownerConfig: { vk: { backend: 'wgpu', wgpuBackend: backend, forceFallbackAdapter: false } } },
  });
  } catch (error) { clipboardVsock.close(); throw error; }
  machine.clipboardVsock = clipboardVsock;
  machine.gpuTestReport = report;
  machine.gpuTestInput = pointer;
  report.gpuEvents = machine.gpuHostcall?.events ?? [];
  if (!report.done) deadline = setTimeout(() => { finish(false, 'Test deadline exceeded.'); machine.close(); }, 480000);
  bootReader = machine.bootConsole.getReader();
  void (async () => {
    try {
      for (;;) { const { value, done } = await bootReader.read(); if (done) break; log(nonSharedBytes(value), 'kernel'); }
    } catch (error) { if (!closed) report.errors.push(String(error)); }
    finally { bootReader.releaseLock(); }
  })();
  void machine.closed.catch(error => { if (!report.done && !report.stopped) finish(false, String(error)); }).finally(() => {
    closed = true;
    clipboardVsock.close();
    clearTimeout(deadline);
    void bootReader.cancel().catch(() => {});
  });
  if (!report.done) onStatus(`booting desktop · wgpu (${backend === 'webgpu' ? 'WebGPU' : 'WebGL'})`, 'booting');
  return machine;
}
