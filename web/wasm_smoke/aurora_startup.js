/* Browser coordinator for source-built Xvfb and Aurora payloads. */
(function () {
  const params = new URLSearchParams(location.search);
  const wantsWm = params.get("wm") === "1";
  const wantsFirefox = params.get("firefox") === "1";
  const base = String(window.LINUX_WEB_ARTIFACT_BASE || "./artifacts").replace(/\/$/, "");
  const started = performance.now();
  performance.mark("aurora-navigation-start");
  let wmReady = false;
  function node(id, tag) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement(tag || "pre"); el.id = id; (document.body || document.documentElement).appendChild(el); }
    return el;
  }
  const status = node("status", "p");
  const log = node("aurora-status", "pre");
  log.style.whiteSpace = "pre-wrap";
  function write(message) {
    const stamp = ((performance.now() - started) / 1000).toFixed(2);
    log.textContent += `[${stamp}s] ${message}\n`;
    status.textContent = message;
  }
  function heartbeat() { write(`heartbeat wm=${wmReady ? "ready" : "pending"} t=${performance.now().toFixed(0)}ms`); }
  async function exists(url) {
    try { return (await fetch(url, { method: "HEAD", cache: "no-store" })).ok; } catch (_) { return false; }
  }
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = url; script.async = false;
      script.onload = resolve; script.onerror = () => reject(new Error(`failed to load ${url}`));
      document.head.appendChild(script);
    });
  }
  async function startXvfb() {
    const js = `${base}/xvfb/Xvfb.js`, wasm = `${base}/xvfb/Xvfb.wasm`, data = `${base}/xvfb/Xvfb.data`;
    if (!(await exists(js)) || !(await exists(wasm)) || !(await exists(data))) throw new Error(`Xvfb artifacts missing (expected ${js}, ${wasm}, and ${data})`);
    performance.mark("xvfb-load-start"); await loadScript(js); performance.mark("xvfb-load-end");
    write("Xvfb artifact loaded; waiting for module readiness");
    const factory = window.Xvfb || window.createXvfb || window.Module;
    if (typeof factory === "function") window.__linuxWebXvfb = await factory({ locateFile: n => n.endsWith(".wasm") ? wasm : n.endsWith(".data") ? data : n });
    else if (!window.Module) throw new Error("Xvfb.js did not expose an Emscripten module");
    write("Xvfb ready on display :11");
  }
  async function startAurora() {
    const js = `${base}/aurora/aurora-wm.js`, wasm = `${base}/aurora/aurora-wm.wasm`;
    if (!(await exists(js)) || !(await exists(wasm))) throw new Error(`Aurora artifacts missing (expected ${js} and ${wasm})`);
    performance.mark("aurora-load-start"); await loadScript(js); performance.mark("aurora-load-end");
    const factory = window.AuroraWm || window.createAuroraWm || window.Aurora;
    if (typeof factory === "function") window.__linuxWebAurora = await factory({ locateFile: n => n.endsWith(".wasm") ? wasm : n });
    else if (!window.__linuxWebAurora) throw new Error("aurora-wm.js did not expose an Emscripten module");
    write("Aurora WM ready on display :11");
  }
  async function startFirefoxAfterWm() {
    if (!wantsFirefox) return;
    if (!wmReady) { write("Firefox requested; waiting for WM readiness"); return; }
    const js = `${base}/firefox/firefox.js`, wasm = `${base}/firefox/firefox.wasm`;
    if (!(await exists(js)) || !(await exists(wasm))) { write(`Firefox artifact unavailable: expected ${js} and ${wasm}`); return; }
    try { await loadScript(js); write("Firefox artifact loaded after WM readiness"); }
    catch (error) { write(`Firefox startup error: ${error.message}`); }
  }
  async function run() {
    if (!wantsWm && !wantsFirefox) return;
    if (!wantsWm && wantsFirefox) { write("Firefox requested but WM was not requested; use ?wm=1&firefox=1"); return; }
    write("Starting Xvfb, then Aurora WM");
    try { await startXvfb(); await startAurora(); wmReady = true; performance.mark("wm-ready");
      const measure = performance.measure("wm-startup", "aurora-navigation-start", "wm-ready");
      write(`WM ready in ${measure.duration.toFixed(1)}ms`); await startFirefoxAfterWm();
    } catch (error) { write(`WM startup error: ${error.message}`); if (wantsFirefox) write("Firefox was not started because WM readiness failed"); }
  }
  if (wantsWm || wantsFirefox) setInterval(heartbeat, 5000);
  run();
})();
