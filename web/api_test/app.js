const $ = (id) => document.getElementById(id);
const logEl = $("log");
let checks = 0;
function log(message, state = "ok") {
  checks++;
  const item = document.createElement("li");
  item.className = state;
  item.innerHTML = `<span class="time">${new Date().toLocaleTimeString()}</span>${escapeHtml(message)}`;
  logEl.prepend(item);
  $("summary").textContent = `${checks} check${checks === 1 ? "" : "s"}`;
}
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value); return node.innerHTML; }
function available(name) { return name in window || name in navigator; }
async function run(name, fn) { try { await fn(); log(`${name}: passed`); } catch (error) { log(`${name}: ${error?.message || error}`, "fail"); } }
function timeout(promise, ms, label) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]); }
async function stream(kind, constraints) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia is unavailable (use HTTPS or localhost)");
  const media = await navigator.mediaDevices.getUserMedia(constraints);
  const video = $("preview"); const audio = $("audio-preview");
  if (kind === "camera") { video.srcObject = media; video.hidden = false; } else { audio.srcObject = media; audio.hidden = false; }
  log(`${kind}: received ${media.getTracks().map((track) => track.kind).join(" + ")} stream`);
  return media;
}
const tests = {
  camera: () => stream("camera", { video: true }),
  microphone: () => stream("microphone", { audio: true }),
  record: async () => {
    if (!window.MediaRecorder) throw new Error("MediaRecorder is unavailable");
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = []; const recorder = new MediaRecorder(media);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(); setTimeout(() => recorder.stop(), 3000); await done; media.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    $("audio-preview").src = URL.createObjectURL(blob); $("audio-preview").hidden = false;
    log(`record: captured ${Math.round(blob.size / 1024)} KiB as ${blob.type}`);
  },
  screen: async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("getDisplayMedia is unavailable");
    const media = await navigator.mediaDevices.getDisplayMedia({ video: true }); $("preview").srcObject = media; $("preview").hidden = false;
    media.getTracks().forEach((track) => track.addEventListener("ended", () => log("screen: sharing ended", "warn")));
  },
  clipboard: async () => {
    if (!navigator.clipboard) throw new Error("Clipboard API is unavailable");
    const value = `linux-on-web clipboard test ${Date.now()}`; await navigator.clipboard.writeText(value); const read = await navigator.clipboard.readText();
    if (read !== value) throw new Error(`read back ${JSON.stringify(read)}`); log(`clipboard: wrote and read ${JSON.stringify(value)}`);
  },
  file: async () => {
    if (!window.showOpenFilePicker) throw new Error("File System Access picker is unavailable");
    const [handle] = await showOpenFilePicker({ multiple: false }); const file = await handle.getFile(); $("file-output").textContent = `${file.name} (${file.size} bytes, ${file.type || "unknown type"})`;
  },
  geolocation: () => new Promise((resolve, reject) => navigator.geolocation?.getCurrentPosition((position) => { log(`geolocation: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`); resolve(); }, reject) || reject(new Error("Geolocation is unavailable"))),
  notifications: async () => { if (!window.Notification) throw new Error("Notifications are unavailable"); const result = await Notification.requestPermission(); log(`notifications: permission ${result}`, result === "granted" ? "ok" : "warn"); },
  vibrate: () => { if (!navigator.vibrate) throw new Error("Vibration is unavailable"); navigator.vibrate(120); },
  share: async () => { if (!navigator.share) throw new Error("Web Share is unavailable"); await navigator.share({ title: "Linux on Web", text: "HTML5 API test" }); },
  graphics: async () => { const canvas = $("canvas"); canvas.hidden = false; const gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); if (!gl) throw new Error("WebGL is unavailable"); const gpu = navigator.gpu ? "WebGPU present" : "WebGPU unavailable"; log(`graphics: ${gl.getParameter(gl.RENDERER)}; ${gpu}`); },
  audio: async () => { const context = new AudioContext(); const oscillator = context.createOscillator(); oscillator.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.03); await context.close(); },
  storage: async () => { localStorage.setItem("linux-on-web-test", "ok"); if (localStorage.getItem("linux-on-web-test") !== "ok") throw new Error("localStorage readback failed"); const db = await timeout(new Promise((resolve, reject) => { const request = indexedDB.open("linux-on-web-test", 1); request.onupgradeneeded = () => request.result.createObjectStore("checks"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }), 2000, "IndexedDB"); db.close(); },
  worker: async () => { const worker = new Worker("worker.js"); const result = await timeout(new Promise((resolve, reject) => { worker.onmessage = (event) => resolve(event.data); worker.onerror = reject; worker.postMessage(21); }), 2000, "worker"); worker.terminate(); if (result.value !== 42) throw new Error("worker result mismatch"); },
  websocket: async () => { const socket = new WebSocket("wss://echo.websocket.events"); await new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket timeout")); }, 5000); socket.onopen = () => { socket.send("linux-on-web"); }; socket.onmessage = (event) => { clearTimeout(timer); socket.close(); event.data === "linux-on-web" ? resolve() : reject(new Error("echo mismatch")); }; socket.onerror = () => { clearTimeout(timer); reject(new Error("connection failed or blocked")); }; }); },
  runtime: async () => { if (!window.isSecureContext) throw new Error("secure context required for full runtime APIs"); const wasm = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0])); if (!wasm.instance) throw new Error("Wasm instantiate failed"); await Promise.resolve(); log(`runtime: ${navigator.userAgent}`); },
  all: async () => { for (const name of Object.keys(tests).filter((name) => name !== "all")) await run(name, tests[name]); },
};
$("secure-context").textContent = window.isSecureContext ? "secure context" : "insecure context (use localhost/HTTPS)";
document.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { await run(button.textContent, tests[button.dataset.action]); } finally { button.disabled = false; } }));
$("run-safe").addEventListener("click", async () => { for (const name of ["graphics", "storage", "worker", "runtime"]) await run(name, tests[name]); });
$("clear-log").addEventListener("click", () => { logEl.replaceChildren(); checks = 0; $("summary").textContent = "0 checks"; });
if (new URLSearchParams(location.search).has("safe")) $("run-safe").click();
