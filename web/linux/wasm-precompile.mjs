// Opt-in wasm code-cache warmup, loaded by main.js only when the page URL has
// ?wasm-precompile=<same-origin /linux/precompile/<sha256>.wasm>.
// With wasm-precompile-sw=1 a service worker (scope /linux/) serves that URL
// from Cache Storage and the page streaming-compiles the identical module so
// Chromium stores/reuses compiled code; the guest's later compile of the same
// bytes can then hit V8's native-module cache. Boot is never awaited on this.
// ?wasm-precompile-sw=unregister removes the worker and its cache.
const params = new URLSearchParams(location.search);
const raw = params.get('wasm-precompile');
const swMode = params.get('wasm-precompile-sw');
const SW_URL = '/linux/wasm-precompile-sw.js';
const SCOPE = '/linux/';
const CACHE = 'linuxonweb-wasm-precompile-v1';
const ms = () => performance.now().toFixed(0);
const log = (message) => console.log(`wasm-precompile: ${message} at ${ms()}ms`);

async function unregister() {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    if (reg.active?.scriptURL && new URL(reg.active.scriptURL).pathname === SW_URL) await reg.unregister();
  }
  await caches.delete(CACHE);
  log('service worker and cache removed');
  return null;
}

async function run() {
  const target = new URL(raw, location.href);
  if (target.origin !== location.origin) throw new Error('cross-origin URL rejected');
  if (!target.pathname.startsWith('/linux/precompile/') || !target.pathname.endsWith('.wasm')) throw new Error('URL must be /linux/precompile/<sha256>.wasm');
  if (!('serviceWorker' in navigator)) throw new Error('service workers unavailable');
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
  log(`registered scope=${reg.scope} controlled=${!!navigator.serviceWorker.controller}`);
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    log('controlled');
  }
  const started = performance.now();
  const module = await WebAssembly.compileStreaming(fetch(target.href));
  log(`compileStreaming took ${(performance.now() - started).toFixed(0)}ms`);
  return module;
}

if (swMode === 'unregister' && 'serviceWorker' in navigator) {
  globalThis.__wasmPrecompile = unregister().catch((error) => { console.warn(`wasm-precompile: ${error?.message}`); return null; });
} else if (raw && swMode === '1') {
  // Keep the module referenced for the page lifetime so the native module
  // stays alive until the guest has compiled its own copy.
  globalThis.__wasmPrecompile = run().then(
    (module) => { globalThis.__wasmPrecompiledModule = module; return module; },
    (error) => { console.warn(`wasm-precompile: ${error?.name}: ${error?.message}`); return null; });
} else if (raw) {
  console.warn('wasm-precompile: needs wasm-precompile-sw=1 (no-store responses are not code-cached without it)');
}
