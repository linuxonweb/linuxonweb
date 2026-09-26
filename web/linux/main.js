// Demo boot: canvas framebuffer + virtio console/input/net + smoke/GUI rootfs.
import {
  spawnMachine,
  consoleDevice,
  entropyDevice,
  blockDevice,
  fileSystemDevice,
  inputDevice,
  Key,
  createNetwork,
  attach_guest,
  wsTcpProxyNetwork,
} from "./dist/index.js";
import { createTouchGestureAdapter } from "./touch-gesture.mjs";
import { compositionEvents, mapKeyboardEvent } from "./keyboard.mjs";
import { createLogViewer } from "./log-viewer.mjs";
import { createMobileKeyboard } from "./mobile-keyboard.mjs";
import { openPersistentHome, acquireHomeLock, deletePersistentHome } from './persistent-home.mjs';
import { systemAsset, updateSystem, clearSystemCache, systemUsage, onAssetNotice, restorePreviousSystem, confirmSystemBoot } from './boot-assets.mjs';
import { createStoragePanel } from './storage-panel.mjs';

/** Same-origin demo proxy by default; override with ?proxy=wss://worker... */
function proxyBaseUrl() {
  const params = new URLSearchParams(location.search);
  const override = params.get("proxy");
  if (override) return override.replace(/\/$/, "");
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${location.host}`;
}

const status = document.getElementById("status");
const launchButtons = [...document.querySelectorAll(".launch")];
const canvas = document.getElementById("fb");
const mobileKeyboard = createMobileKeyboard({
  toggle: document.getElementById("keyboard-toggle"),
  panel: document.getElementById("mobile-keyboard"),
  input: document.getElementById("mobile-keyboard-input"),
  canvas,
});
export const guestLogs = createLogViewer({
  toggle: document.getElementById("logs-toggle"),
  parent: document.querySelector(".workspace"),
});
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const resolutionSelect = document.getElementById("resolution");
const cpuInput = document.getElementById("cpu-cores");
const cpuValue = document.getElementById("cpu-value");
const ramSelect = document.getElementById("ram");
const graphicsSelect = document.getElementById('graphics-backend');
canvas.addEventListener('framebuffer-backend', event => {
  const detail = event.detail;
  document.getElementById('graphics-status').textContent = `${detail.backend}${detail.fallbackReason ? ` · fallback: ${detail.fallbackReason}` : ''}`;
});
const settingsNote = document.getElementById("settings-note");
const settingsApply = document.getElementById("settings-apply");
const restartDialog = document.getElementById("restart-dialog");
const restartContinue = document.getElementById("restart-continue");
const displayStage = document.querySelector(".stage");
const displayPan = document.getElementById("display-pan");
let panDisplay = false;
let cancelGuestGesture = () => {};
function updateDisplayPan() {
  const overflow = displayStage.scrollWidth > displayStage.clientWidth || displayStage.scrollHeight > displayStage.clientHeight;
  displayPan.hidden = !overflow;
  if (!overflow) panDisplay = false;
  canvas.style.touchAction = panDisplay ? "pan-x pan-y" : "none";
  displayPan.setAttribute("aria-pressed", String(panDisplay));
}
displayPan.addEventListener("click", () => {
  cancelGuestGesture();
  panDisplay = !panDisplay;
  updateDisplayPan();
});
new ResizeObserver(updateDisplayPan).observe(displayStage);
const firefoxMode = new URLSearchParams(location.search).get("firefox") === "1";
const settingsKey = "linuxonweb.machine-settings.v1";
const resumeKey = "linuxonweb.restart-mode.v1";
const modes = ["guest", "console", "startx", "firefox"];
const minimumFirefoxMemory = 2048;
let activeMachine = null;
let persistentHome = null;
let releaseHomeLock = null;
export function guestHome() { return persistentHome; }
const storagePanel = createStoragePanel({
  parent: document.querySelector('main'),
  async usage() {
    let home;
    if (persistentHome) home = await persistentHome.usage();
    else {
      const release = await acquireHomeLock();
      try { const store = await openPersistentHome(); try { home = await store.usage(); } finally { await store.destroy(); } }
      finally { release(); }
    }
    return { home, system: await systemUsage(), estimate: await navigator.storage?.estimate?.(), persistent: await navigator.storage?.persisted?.() };
  },
  persist: () => navigator.storage?.persist?.(),
  clearCache: clearSystemCache,
  async update(progress) { await updateSystem(progress); },
  rollback: restorePreviousSystem,
  async restart() {
    if (currentMode) sessionStorage.setItem(resumeKey, currentMode);
    await persistentHome?.flush();
    restarting = true;
    activeMachine?.close();
    await activeMachine?.closed.catch(() => {});
    location.reload();
  },
  async deleteHome() {
    // Confirmation happens in the panel. Keep the exclusive lease through
    // shutdown and deletion so another tab cannot open the old home halfway.
    const release = releaseHomeLock || await acquireHomeLock();
    lockConfiguration(true);
    releaseHomeLock = null;
    restarting = true;
    try {
      activeMachine?.close();
      await activeMachine?.closed.catch(() => {});
      await persistentHome?.destroy(); persistentHome = null;
      await deletePersistentHome();
      sessionStorage.removeItem(resumeKey);
      const url = new URL(location.href); url.searchParams.delete('firefox');
      location.replace(url);
    } catch (error) {
      activeMachine = null;
      restarting = false;
      lockConfiguration(false);
      setStatus('guest stopped', 'idle');
      throw error;
    } finally { release(); }
  },
});
onAssetNotice((message, error) => {
  storagePanel.message(message, error);
  if (error) storagePanel.cacheWarning(message);
});
export function guestAudioStats() { return activeMachine?.audioStats ?? null; }
let currentMode = null;
let configurationLocked = false;
let restarting = false;
let pendingConfiguration = null;
let resumeMode = null;
try {
  const savedMode = sessionStorage.getItem(resumeKey);
  if (modes.includes(savedMode)) resumeMode = savedMode;
  sessionStorage.removeItem(resumeKey);
} catch { /* Storage may be unavailable; ordinary boot remains usable. */ }

let FB_W = 1280;
let FB_H = 720;
let consoleInputWriter = null;

// Only an explicit console boot creates an interactive terminal. GUI boot logs
// use a lazy, bounded plain-text viewer and never instantiate xterm.
let terminal = null;
function openConsole() {
  if (terminal) return;
  const card = document.createElement("section");
  card.className = "terminal-card";
  card.setAttribute("aria-label", "Interactive guest console");
  const header = document.createElement("div");
  header.className = "terminal-head";
  header.textContent = "hvc0 · interactive console · click below to type";
  const terminalEl = document.createElement("div");
  terminalEl.id = "terminal";
  card.append(header, terminalEl);
  document.querySelector(".workspace").append(card);
  terminal = new globalThis.Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.18,
    scrollback: 100,
    theme: {
      background: "#050a0a",
      foreground: "#d8e6e3",
      cursor: "#4ce0c2",
      cursorAccent: "#05211c",
      selectionBackground: "#24584e",
      black: "#07100f",
      brightBlack: "#61726e",
      green: "#4ce0c2",
      brightGreen: "#79f3da",
      cyan: "#56bfc8",
      brightCyan: "#80e6ee",
    },
  });
  const fitAddon = new globalThis.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalEl);
  const fitTerminal = () => { try { fitAddon.fit(); } catch { /* layout pending */ } };
  new ResizeObserver(fitTerminal).observe(terminalEl);
  queueMicrotask(fitTerminal);
  terminal.onData((data) => {
    if (!consoleInputWriter) return;
    void consoleInputWriter.write(new TextEncoder().encode(data)).catch((err) => {
      hostLog(`console input failed: ${err}`, "error");
    });
  });
}

function writeConsole(value, source = "guest") {
  guestLogs.write(value, source);
  terminal?.write(value);
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
  homeLogTail = (homeLogTail + text).slice(-512);
  if (homeLogTail.includes('home: persistent storage mounted')) {
    homeLogTail = '';
    storagePanel.message('Home mounted · saved files persist across refresh and system updates.');
    void confirmSystemBoot().catch(error => hostLog(`cache cleanup: ${error.message}`, 'error'));
    void storagePanel.refresh().catch(() => {});
  } else if (homeLogTail.includes('home: FAILED')) {
    homeLogTail = '';
    storagePanel.message('Persistent home could not be mounted. Desktop startup stopped; see guest logs.', true);
  }
}
let homeLogTail = '';

function hostLog(line, kind = "host") {
  writeConsole(`[host${kind === "error" ? " error" : ""}] ${line}\r\n`, "host");
}

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

// The staged kernel supports at most CONFIG_NR_CPUS=64.
const hostCores = Math.min(64, Math.max(1, navigator.hardwareConcurrency || 2));
cpuInput.max = String(hostCores);
cpuInput.value = String(Math.min(2, hostCores));
const defaults = { resolution: "1280x720", cpus: Math.min(2, hostCores), ram: firefoxMode || resumeMode === "firefox" ? 4096 : 1024, backend: 'canvas2d' };
function validConfiguration(value) {
  return value && [...resolutionSelect.options].some(option => option.value === value.resolution)
    && Number.isInteger(value.cpus) && value.cpus >= 1 && value.cpus <= hostCores
    && [...ramSelect.options].some(option => Number(option.value) === value.ram);
}
let activeConfiguration = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  if (saved?.ram === 256) saved.ram = 512;
  if (validConfiguration(saved)) activeConfiguration = { ...saved, backend: ['canvas2d', 'auto', 'webgl'].includes(saved.backend) ? saved.backend : 'canvas2d' };
} catch { /* Ignore missing or malformed saved settings. */ }
// Firefox's larger boot image needs extra headroom. Wasm32 cannot advertise
// more than 4 GiB; console/X modes also expose smaller memory configurations.
if ((resumeMode || (firefoxMode ? "firefox" : null)) === "firefox") activeConfiguration.ram = Math.max(minimumFirefoxMemory, activeConfiguration.ram);
function readConfiguration() {
  return { resolution: resolutionSelect.value, cpus: Number(cpuInput.value), ram: Number(ramSelect.value), backend: graphicsSelect.value };
}
function showConfiguration(value) {
  resolutionSelect.value = value.resolution;
  cpuInput.value = String(value.cpus);
  ramSelect.value = String(value.ram);
  graphicsSelect.value = value.backend || 'canvas2d';
  updateCpuLabel();
  updateSettingsState();
}
function updateSettingsState() {
  const value = readConfiguration();
  settingsApply.disabled = configurationLocked || !validConfiguration(value)
    || (currentMode === "firefox" && value.ram < minimumFirefoxMemory)
    || (value.resolution === activeConfiguration.resolution && value.cpus === activeConfiguration.cpus && value.ram === activeConfiguration.ram && value.backend === activeConfiguration.backend);
  for (const option of ramSelect.options) option.disabled = currentMode === "firefox" && Number(option.value) < minimumFirefoxMemory;
  settingsNote.textContent = configurationLocked ? "Please wait while the machine starts or restarts."
    : currentMode === "firefox" ? "Applying changes restarts the guest. Firefox requires at least 2 GB. Its default is 4 GB."
      : activeMachine ? "Applying changes restarts the guest. You can review or cancel before anything changes."
        : "Choose settings, then apply your changes.";
}

function updateCpuLabel() {
  const cores = Number(cpuInput.value);
  cpuValue.value = `${cores} ${cores === 1 ? "core" : "cores"}`;
  cpuValue.textContent = cpuValue.value;
}

function updateResolution() {
  [FB_W, FB_H] = activeConfiguration.resolution.split("x").map(Number);
  canvas.width = FB_W;
  canvas.height = FB_H;
  canvas.style.width = `${FB_W}px`;
  canvas.style.height = `${FB_H}px`;
  document.documentElement.style.setProperty("--guest-display-width", `${FB_W}px`);
  updateDisplayPan();
}

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
}

settingsToggle.addEventListener("click", (ev) => {
  ev.stopPropagation();
  setSettingsOpen(settingsPanel.hidden);
});
settingsPanel.addEventListener("click", (ev) => ev.stopPropagation());
document.addEventListener("click", () => setSettingsOpen(false));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !restartDialog.open) setSettingsOpen(false);
});
restartDialog.addEventListener("click", (ev) => ev.stopPropagation());
resolutionSelect.addEventListener("change", updateSettingsState);
ramSelect.addEventListener("change", updateSettingsState);
graphicsSelect.addEventListener('change', updateSettingsState);
cpuInput.addEventListener("input", () => { updateCpuLabel(); updateSettingsState(); });
showConfiguration(activeConfiguration);
updateResolution();
updateCpuLabel();

function cancelConfiguration() {
  pendingConfiguration = null;
  restartDialog.close();
  showConfiguration(activeConfiguration);
  settingsToggle.focus();
}
document.getElementById("restart-cancel").addEventListener("click", cancelConfiguration);
restartDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelConfiguration(); });
settingsApply.addEventListener("click", () => {
  const next = readConfiguration();
  if (settingsApply.disabled || !validConfiguration(next)) return;
  pendingConfiguration = { ...next };
  document.getElementById("restart-error").hidden = true;
  document.getElementById("restart-title").textContent = activeMachine ? "Restart the guest?" : "Apply machine settings?";
  document.getElementById("restart-summary").textContent = `${next.resolution.replace("x", " × ")} · ${next.cpus} ${next.cpus === 1 ? "core" : "cores"} · ${next.ram === 4096 ? "4 GB" : `${next.ram} MB`} · ${graphicsSelect.selectedOptions[0].text}. ${activeMachine ? "Continue saves these settings and restarts the guest in the same mode." : "Continue saves these settings for the next boot."}`;
  document.getElementById("restart-warning").hidden = !activeMachine;
  restartDialog.showModal();
});
restartContinue.addEventListener("click", async () => {
  if (!pendingConfiguration || restarting) return;
  const next = pendingConfiguration;
  let previous;
  try {
    previous = localStorage.getItem(settingsKey);
    localStorage.setItem(settingsKey, JSON.stringify(next));
    if (activeMachine) sessionStorage.setItem(resumeKey, currentMode);
  } catch {
    try { if (previous === null) localStorage.removeItem(settingsKey); else if (previous !== undefined) localStorage.setItem(settingsKey, previous); } catch { /* Storage is unavailable. */ }
    const error = document.getElementById("restart-error");
    error.textContent = "Could not save settings in this browser. Your current session has not changed. Cancel to keep it running.";
    error.hidden = false;
    return;
  }
  pendingConfiguration = null;
  restartDialog.close();
  activeConfiguration = { ...next };
  if (!activeMachine) {
    showConfiguration(activeConfiguration);
    updateResolution();
    return;
  }
  restarting = true;
  lockConfiguration(true);
  setStatus("restarting…", "booting");
  await persistentHome?.flush();
  activeMachine.close();
  await activeMachine.closed.catch(() => {});
  // Reload releases the old guest's canvas listeners, streams, workers and
  // network. Keep every existing query parameter (proxy, Firefox, diagnostics).
  location.reload();
});

function mapButton(button) {
  if (button === 0) return Key.BTN_LEFT;
  if (button === 1) return Key.BTN_MIDDLE;
  if (button === 2) return Key.BTN_RIGHT;
  return null;
}

function canvasCoords(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * FB_W;
  const y = ((ev.clientY - rect.top) / rect.height) * FB_H;
  return {
    x: Math.max(0, Math.min(FB_W - 1, Math.round(x))),
    y: Math.max(0, Math.min(FB_H - 1, Math.round(y))),
  };
}

function lockConfiguration(locked) {
  configurationLocked = locked;
  for (const button of launchButtons) button.disabled = locked;
  resolutionSelect.disabled = locked;
  cpuInput.disabled = locked;
  ramSelect.disabled = locked;
  graphicsSelect.disabled = locked;
  updateSettingsState();
}

function ramBytes(mebibytes) {
  // wasm32 leaves its final 64 KiB page unused so the byte size fits in u32.
  return mebibytes === 4096 ? 0xffff0000 : mebibytes * 1024 * 1024;
}

async function boot(mode) {
  if (configurationLocked || activeMachine) return;
  currentMode = mode;
  displayStage.hidden = mode === 'console';
  if (mode === "firefox") activeConfiguration.ram = Math.max(minimumFirefoxMemory, activeConfiguration.ram);
  // Only confirmed configuration reaches the guest, never uncommitted drafts.
  showConfiguration(activeConfiguration);
  updateResolution();
  lockConfiguration(true);
  setSettingsOpen(false);
  setStatus(`booting ${mode}…`, "booting");
  guestLogs.clear();
  if (mode === "console") openConsole();
  terminal?.clear();
  hostLog(
    `boot mode=${mode}, display=${FB_W}x${FB_H}, cpus=${cpuInput.value}, ram=${ramSelect.selectedOptions[0].text}`,
  );
  let initramfs;
  const rootfs = null;
  try {
    releaseHomeLock = await acquireHomeLock();
    persistentHome = await openPersistentHome({ onError: error => storagePanel.message(`Home storage error: ${error.message}`, true) });
    const image = await systemAsset(mode === 'firefox' ? 'firefox' : 'plain');
    const body = mode === 'firefox' ? image.body.pipeThrough(new DecompressionStream('gzip')) : image.body;
    initramfs = new Uint8Array(await new Response(body).arrayBuffer());
    storagePanel.message('Home ready · waiting for guest mount');
  } catch (error) {
    await persistentHome?.destroy().catch(() => {}); persistentHome = null;
    releaseHomeLock?.(); releaseHomeLock = null;
    setStatus('boot failed', 'error'); lockConfiguration(false);
    storagePanel.message(error.message, true); hostLog(error.message, 'error'); return;
  }

  const input = new TransformStream();
  const output = new TransformStream();
  consoleInputWriter = input.writable.getWriter();
  const pointer = inputDevice({
    name: "wasm keyboard/mouse",
    absXMax: FB_W - 1,
    absYMax: FB_H - 1,
  });

  canvas.tabIndex = 0;
  canvas.style.outline = "none";
  canvas.style.touchAction = panDisplay ? "pan-x pan-y" : "none";
  const inputEvents = new AbortController();
  // Capture phase keeps AudioContext.resume inside the native user activation,
  // including the mobile keyboard controls and composition input.
  const resumeGuestAudio = ev => {
    if (ev.isTrusted && (ev.target === canvas || ev.target.closest?.('#mobile-keyboard, #keyboard-toggle'))) activeMachine?.resumeAudio();
  };
  for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, resumeGuestAudio, { capture: true, signal: inputEvents.signal });
  const onCanvas = (event, listener, options = {}) => canvas.addEventListener(event, (ev) => {
    if (panDisplay && /^(pointer|wheel|contextmenu)/.test(event)) return;
    listener(ev);
  }, { ...options, signal: inputEvents.signal });
  let composing = false;

  onCanvas("keydown", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    const code = mapKeyboardEvent(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, true);
  });
  onCanvas("keyup", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    const code = mapKeyboardEvent(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, false);
  });
  onCanvas("compositionstart", () => { composing = true; });
  onCanvas("compositionend", (ev) => {
    composing = false;
    for (const [code, down] of compositionEvents(ev.data)) pointer.key(code, down);
    ev.preventDefault();
  });

  // Coalesce pointermove to animation frames so high-rate mouse samples do not
  // flood virtio-input / the main thread while the framebuffer is painting.
  let pointerRaf = 0;
  let pendingPointer = null;
  const flushPointer = () => {
    pointerRaf = 0;
    if (!pendingPointer) return;
    const { x, y } = pendingPointer;
    pendingPointer = null;
    pointer.abs(x, y);
  };
  const queuePointer = (x, y) => {
    pendingPointer = { x, y };
    if (!pointerRaf) {
      pointerRaf = requestAnimationFrame(flushPointer);
    }
  };

  // Touch contacts use a short/long press gesture while mouse and pen retain
  // their native pointerdown/up semantics below. Touch movement is delivered
  // immediately so the guest sees the contact before a click or long press.
  const touchGesture = createTouchGestureAdapter({
    move: (x, y) => pointer.abs(x, y),
    press: (down) => pointer.button(Key.BTN_LEFT, down),
  });
  cancelGuestGesture = () => {
    if (pointerRaf) cancelAnimationFrame(pointerRaf);
    pointerRaf = 0;
    pendingPointer = null;
    if (touchGesture.activePointerId !== null) touchGesture.cancel(touchGesture.activePointerId);
  };

  onCanvas("pointermove", (ev) => {
    const { x, y } = canvasCoords(ev);
    if (ev.pointerType === "touch") {
      touchGesture.move(ev.pointerId, x, y);
      ev.preventDefault();
      return;
    }
    queuePointer(x, y);
  });
  onCanvas("pointerdown", (ev) => {
    if (!mobileKeyboard.focusDisplay()) canvas.focus();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const { x, y } = canvasCoords(ev);
    if (ev.pointerType === "touch") {
      touchGesture.start(ev.pointerId, x, y);
      ev.preventDefault();
      return;
    }
    // Buttons flush immediately so clicks are not delayed by rAF.
    if (pointerRaf) {
      cancelAnimationFrame(pointerRaf);
      pointerRaf = 0;
    }
    pendingPointer = null;
    pointer.abs(x, y);
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, true);
    ev.preventDefault();
  });
  onCanvas("pointerup", (ev) => {
    const { x, y } = canvasCoords(ev);
    if (ev.pointerType === "touch") {
      touchGesture.end(ev.pointerId, x, y);
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      ev.preventDefault();
      return;
    }
    if (pointerRaf) {
      cancelAnimationFrame(pointerRaf);
      pointerRaf = 0;
    }
    pendingPointer = null;
    pointer.abs(x, y);
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, false);
    ev.preventDefault();
  });
  onCanvas("pointercancel", (ev) => {
    if (ev.pointerType === "touch") {
      touchGesture.cancel(ev.pointerId);
      ev.preventDefault();
      return;
    }
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, false);
  });
  onCanvas(
    "wheel",
    (ev) => {
      // Linux REL_WHEEL: positive = up. Browser deltaY: positive = down.
      const steps = Math.max(1, Math.round(Math.abs(ev.deltaY) / 100));
      pointer.wheel(ev.deltaY < 0 ? steps : -steps);
      ev.preventDefault();
    },
    { passive: false },
  );
  onCanvas("contextmenu", (ev) => ev.preventDefault());

  const proxyUrl = proxyBaseUrl();
  const network = createNetwork(wsTcpProxyNetwork({ proxyUrl }));
  const attached = attach_guest(network);
  hostLog(
    `network proxy ${proxyUrl} (guest ${attached.attachment.address} via ${network.gateway})`,
  );

  const devices = [
    consoleDevice(input.readable, output.writable),
    entropyDevice(),
    pointer,
    attached.attachment.device,
    fileSystemDevice(persistentHome, { tag: 'home', cache: true }),
  ];
  if (rootfs) {
    devices.push(
      blockDevice({
        capacity: rootfs.byteLength,
        read: (offset, length) => rootfs.subarray(offset, offset + length),
        write: (offset, data) => {
          rootfs.set(data, offset);
        },
      }),
    );
  }

  const reader = output.readable.getReader();
  const inputWriter = consoleInputWriter;
  let bootReader = null;
  let bootClosed = false;
  const cleanupBoot = () => {
    if (bootClosed) return;
    bootClosed = true;
    inputEvents.abort();
    mobileKeyboard.setKeyHandler(null);
    cancelGuestGesture();
    cancelGuestGesture = () => {};
    attached.attachment.close();
    network.close();
    void reader.cancel().catch(() => {});
    void bootReader?.cancel().catch(() => {});
    void inputWriter.abort().catch(() => {});
    if (consoleInputWriter === inputWriter) consoleInputWriter = null;
    // virtio-fs awaits in-flight operations, releases handles and awaits
    // filesystem.destroy before spawnMachine resolves machine.closed.
    releaseHomeLock?.(); releaseHomeLock = null;
  };
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      writeConsole(new Uint8Array(value));
    }
  })().catch((err) => { if (!restarting && !bootClosed) hostLog(`guest console closed: ${err}`, "error"); });

  try {
    const consoleMode = mode === "console";
    const rootCommand = rootfs
      ? `root=/dev/vda rootfstype=ext4 rw rootwait init=${consoleMode ? "/bin/sh" : "/init"}`
      : 'rdinit=/init';
    const modeFlags = [
      `demo.mode=${mode}`,
      'home.persistent=1',
      mode === "firefox" ? "firefox=1" : "",
      new URLSearchParams(location.search).get("firefox_trace") === "1" ? "firefox_trace=1" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const memory = ramBytes(Number(ramSelect.value));
    const machine = await spawnMachine({
      cpus: Number(cpuInput.value),
      cmdline: `${rootCommand} ${modeFlags}`,
      initcpio: initramfs ?? undefined,
      devices,
      devicetree: { memory: { reg: [0, memory] } },
      audio: true,
      framebuffer: { canvas, width: FB_W, height: FB_H, bpp: 32, backend: activeConfiguration.backend },
    });
    activeMachine = machine;
    mobileKeyboard.setKeyHandler((code, down) => pointer.key(code, down));
    void machine.closed
      .finally(cleanupBoot)
      .catch(() => {});
    setStatus(
      initramfs
        ? `running · ${mode} · initramfs`
        : rootfs
          ? `running · ${mode} · ext4`
          : "running · no userspace image",
      "running",
    );
    lockConfiguration(false);
    for (const button of launchButtons) button.disabled = true;
    if (consoleMode) terminal?.focus();
    else canvas.focus();
    hostLog("machine started (framebuffer + virtio input/console/net)");
    bootReader = machine.bootConsole.getReader();
    (async () => {
      for (;;) {
        const { value, done } = await bootReader.read();
        if (done) break;
        writeConsole(new Uint8Array(value), "kernel");
      }
    })().catch((err) => { if (!restarting && !bootClosed) hostLog(`boot console closed: ${err}`, "error"); });
    machine.closed.catch((err) => {
      if (restarting) return;
      setStatus(`stopped: ${err}`, "error");
      hostLog(String(err), "error");
    });
  } catch (err) {
    cleanupBoot();
    await persistentHome?.destroy().catch(() => {});
    persistentHome = null;
    activeMachine = null;
    setStatus("boot failed", "error");
    storagePanel.message(`Boot failed: ${err.message || err}`, true);
    hostLog(String(err?.stack || err), "error");
    consoleInputWriter = null;
    lockConfiguration(false);
  }
}

for (const button of launchButtons) {
  button.addEventListener("click", () => void boot(button.dataset.mode));
}

// Firefox mode is intended for unattended Chromium testing. Boot immediately;
// guest init waits 10 seconds after X is ready before launching /bin/firefox.
if (resumeMode || firefoxMode) {
  // Resume the confirmed launch mode after a clean restart. Defaults are
  // 4 GiB for Firefox and 1 GiB otherwise; validated preferences take priority.
  const mode = resumeMode || "firefox";
  setStatus(`${mode}: auto-booting…`, "booting");
  hostLog(`auto-boot enabled for ${mode}`);
  queueMicrotask(() => void boot(mode));
}
