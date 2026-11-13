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
  vsockDevice,
} from "./dist/index.js";
import { createTouchGestureAdapter } from "./touch-gesture.mjs";
import { compositionEvents, mapKeyboardEvent } from "./keyboard.mjs";
import { createPhysicalKeyboard } from "./physical-keyboard.mjs";
import { createPackageRecoveryWatch } from "./package-recovery.mjs";
import { createLogViewer } from "./log-viewer.mjs";
import { createPresentOverlay } from "./gpu-present-overlay.mjs";
import { createMobileKeyboard } from "./mobile-keyboard.mjs";
import { openPersistentHome, acquireHomeLock, deletePersistentHome } from './persistent-home.mjs';
import { activeManifest, systemAsset, prepareSystemBoot, updateSystem, clearSystemCache, systemUsage, onAssetNotice, restorePreviousSystem, confirmSystemBoot } from './boot-assets.mjs';
import { createStoragePanel } from './storage-panel.mjs';
import { createMoreMenu } from './more-menu.mjs';
import { installDownloadPanel } from './download-panel.mjs';
import { installTestCommands, testCommandRequest } from './test-commands.mjs';
import { installBuildInfo } from './build-info.mjs';
import { installBrowserInfo } from './browser-info.mjs';
import { bootWgpuTest } from './gpu-test-boot.mjs';
import { guestClipboard, readHostClipboard, writeHostClipboard, installClipboardButton } from './clipboard.mjs';
import { loadDesktopInitramfs, loadDesktopExtras, useCompressedInitramfs, composeCache } from './desktop-extras.mjs';
import { nonSharedBytes } from './console-bytes.mjs';
import { restoreConfiguration, needsFirefoxMemoryChoice, presentationStatus, presentationChoice, withPresentationChoice, displayOnlyChange, settingsRecord, presentationFromUrl, presentationUrl } from './machine-settings.mjs';
import { guestGpuHostcallOptions, guestGpuUrl } from './guest-gpu-config.mjs';
import { newGuestGpuState, observeGuestGpuMessage, guestGpuLabels } from './guest-gpu-status.mjs';
import { firefoxJitFlags } from './firefox-jit-config.mjs';
import { H_STALL_MS, H_STARTUP_MS, H_OWNER_STATE, H_DEAD_REASON, H_HEARTBEAT, H_CALLS } from './dist/guest-gpu-hostcall.js';
import { gputestEnabled, gpuBackendParam, gputestAppParam, gputestCmdlineFlags, loadGputestArchive, appendCpio, startGpuHost, GPUTEST_APPS, GPUTEST_RDINIT } from './gputest.mjs';

/** Same-origin demo proxy by default; override with ?proxy=wss://worker... */
function proxyBaseUrl() {
  const params = new URLSearchParams(location.search);
  const override = params.get("proxy");
  if (override) return override.replace(/\/$/, "");
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${location.host}`;
}

installBuildInfo({ footer: document.getElementById("build-info") });

const status = document.getElementById("status");
const launchButtons = [...document.querySelectorAll(".launch")];
const canvas = document.getElementById("fb");
// Directly presented guest Vulkan frames (swapchain present) shown over the display.
export const presentOverlay = createPresentOverlay({ canvas });
const toolsToggle = document.getElementById('tools-toggle');
const toolsPanel = document.getElementById('tools-panel');
const floatingTools = document.querySelector('.toolbar');
let toolPosition = { x: 8, y: 8 }, dragTools = null, suppressToolsClick = false;
function positionTools() {
  const width = floatingTools.getBoundingClientRect().width;
  const height = floatingTools.getBoundingClientRect().height;
  toolPosition.x = Math.max(0, Math.min(toolPosition.x, Math.max(0, innerWidth - width)));
  toolPosition.y = Math.max(0, Math.min(toolPosition.y, Math.max(0, innerHeight - height)));
  floatingTools.style.left = `${toolPosition.x}px`; floatingTools.style.top = `${toolPosition.y}px`;
}
function expandTools(expanded) {
  if (!expanded && document.querySelector('.clipboard-error:not([hidden])')) return;
  toolsPanel.hidden = !expanded;
  toolsToggle.setAttribute('aria-expanded', String(expanded));
  toolsToggle.setAttribute('aria-label', expanded ? 'Fold tools' : 'Expand tools');
  if (!expanded) {
    for (const menu of toolsPanel.querySelectorAll('.more-menu')) { menu.hidden = true; document.querySelector(`[aria-controls="${menu.id}"]`)?.setAttribute('aria-expanded','false'); }
    setSettingsOpen(false); setStopConfirmOpen(false);
    if (toolsPanel.contains(document.activeElement)) toolsToggle.focus();
  }
  positionTools();
}
toolsToggle.addEventListener('click', event => { if (suppressToolsClick && event.detail !== 0) { suppressToolsClick = false; return; } suppressToolsClick = false; expandTools(toolsPanel.hidden); });
toolsToggle.addEventListener('keydown', event => { if (!['Enter',' '].includes(event.key)) return; event.preventDefault(); if (!event.repeat) toolsToggle.click(); });
toolsToggle.addEventListener('pointerdown', event => { if (!event.isPrimary || event.button !== 0) return; suppressToolsClick = false; dragTools = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...toolPosition }, moved: false }; toolsToggle.setPointerCapture(event.pointerId); });
toolsToggle.addEventListener('pointermove', event => { if (dragTools?.id !== event.pointerId) return; const dx = event.clientX - dragTools.x, dy = event.clientY - dragTools.y; if (Math.hypot(dx,dy) > 6) dragTools.moved = true; if (!dragTools.moved) return; toolPosition = { x: dragTools.origin.x + dx, y: dragTools.origin.y + dy }; positionTools(); });
function endToolsDrag(event) { if (dragTools?.id !== event.pointerId) return; suppressToolsClick = dragTools.moved || event.type === 'pointercancel'; dragTools = null; }
toolsToggle.addEventListener('pointerup', endToolsDrag);
toolsToggle.addEventListener('pointercancel', endToolsDrag);
toolsToggle.addEventListener('lostpointercapture', event => { if (dragTools?.id === event.pointerId) { suppressToolsClick = true; dragTools = null; } });
window.addEventListener('resize', positionTools);
new ResizeObserver(positionTools).observe(floatingTools);
positionTools();
window.addEventListener('clipboard-notice-error', () => expandTools(true));
const mobileKeyboard = createMobileKeyboard({
  toggle: document.getElementById("keyboard-toggle"),
  panel: document.getElementById("mobile-keyboard"),
  input: document.getElementById("mobile-keyboard-input"),
  more: document.getElementById("keyboard-more"),
  menu: document.getElementById("keyboard-combos"),
  canvas,
});
export const guestLogs = createLogViewer({
  toggle: document.getElementById("logs-toggle"),
  parent: document.querySelector(".workspace"),
});
// ?debug=1 shows the guest log panel from page load.
if (new URLSearchParams(location.search).get("debug") === "1") guestLogs.open();
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const resolutionSelect = document.getElementById("resolution");
const cpuInput = document.getElementById("cpu-cores");
const cpuValue = document.getElementById("cpu-value");
const ramSelect = document.getElementById("ram");
const graphicsSelect = document.getElementById('graphics-backend');
const graphicsStatus = document.getElementById('graphics-status');
const guestGraphicsSelect = document.getElementById('guest-graphics-backend');
const guestGlStatus = document.getElementById('guest-gl-status');
const guestVulkanStatus = document.getElementById('guest-vulkan-status');
// The running framebuffer host switches presenter without a guest restart.
let setPresenter = null;
let presentationPromptOpen = false;
canvas.addEventListener('framebuffer-backend', event => {
  const detail = event.detail;
  setPresenter = typeof detail.setBackend === 'function' ? detail.setBackend : null;
  graphicsStatus.textContent = presentationStatus(detail);
  // Auto means WebGPU; when it fails, ask instead of falling back silently.
  if (detail.awaitingChoice) void choosePresentationFallback(detail.failure);
});
const settingsNote = document.getElementById("settings-note");
const settingsApply = document.getElementById("settings-apply");
const restartDialog = document.getElementById("restart-dialog");
const restartContinue = document.getElementById("restart-continue");
const displayStage = document.querySelector(".stage");
// Package download sizes and progress, shown over the bottom of the display.
installDownloadPanel(displayStage);
const displayPan = document.getElementById("display-pan");
let panDisplay = false;
let cancelGuestGesture = () => {};
// The page itself scrolls around a display larger than the window, so panning
// is offered whenever the display does not fit the viewport.
function updateDisplayPan() {
  const viewportWidth = document.documentElement.clientWidth;
  document.documentElement.style.setProperty("--viewport-width", `${viewportWidth}px`);
  const overflow = displayStage.offsetWidth > viewportWidth || displayStage.offsetHeight > window.innerHeight;
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
window.addEventListener("resize", updateDisplayPan);
// Clicks on the display leave the page scroll where the user put it; the
// display is never re-aligned to the top of the viewport.
// Icon buttons show their label on hover or keyboard focus; a click or tap
// shows it briefly, since touch has no hover.
for (const button of document.querySelectorAll(".toolbar .tool")) {
  let timer = 0;
  button.addEventListener("click", () => {
    button.classList.add("show-label");
    clearTimeout(timer);
    timer = setTimeout(() => button.classList.remove("show-label"), 1500);
  });
}
let firefoxMode = new URLSearchParams(location.search).get("firefox") === "1";
// ?gputest=1 serves the guest Vulkan ICD over vsock and appends gpu/gputest.cpio.
let gputestMode = gputestEnabled();
// Guest Vulkan uses WebGPU unless the user explicitly selects WebGL.
let gpuBackend = gpuBackendParam();
let guestGpuState = newGuestGpuState(gpuBackend);
function showGuestGpuStatus() {
  const labels = guestGpuLabels(guestGpuState);
  guestGlStatus.textContent = labels.gl;
  guestVulkanStatus.textContent = labels.vulkan;
}
showGuestGpuStatus();
// ?gpu=1 serves guest GPU sessions (vsock 4050) without the demo archive.
// Firefox mode serves them by default (guest WebGL on Zink); ?gpu=0 opts out.
let gpuParam = new URLSearchParams(location.search).get("gpu");
const guestGpuEnabled = mode => selectedGpuTest !== 'software' && (gputestMode || gpuParam === "1" || (mode === "firefox" && gpuParam !== "0"));
const settingsKey = "linuxonweb.machine-settings.v1";
const resumeKey = "linuxonweb.restart-mode.v1";
const modes = ["guest", "console", "startx", "firefox", "wgpu"];
let selectedGpuTest = gpuTestSelection(new URL(location.href));
let gpuTestReport = null;
export function guestGpuTest() { return gpuTestReport; }
let activeMachine = null;

// Read-only evidence for an explicit common Rust diagnostic. This reads no
// persistent home and exposes bounded copies rather than the running machine.
export function guestGpuDiagnostics() {
  if (new URLSearchParams(location.search).get('gpuruntime') !== 'rust') return null;
  const history = guestLogs.history;
  const events = activeMachine?.gpuHostcall?.events ?? [];
  const hub = activeMachine?.gpuHostcall?.hub;
  const words = hub ? new Int32Array(hub) : null;
  return {
    running: activeMachine !== null,
    configuration: activeConfiguration ? { ...activeConfiguration } : null,
    logs: history.page(history.nextId, 10000).map(row => ({ ...row })),
    logEvidenceDropped: history.firstId > 0,
    logFirstId: history.firstId,
    logNextId: history.nextId,
    gpuEventCapacity: 256,
    gpuEventsMayBeTruncated: events.length >= 256,
    gpuEventsCapacityReached: events.length >= 256,
    gpuEvents: events.slice(0, 256).map(event => ({ ...event })),
    gpuHostcallState: words ? {
      stallMs: Atomics.load(words, H_STALL_MS), startupMs: Atomics.load(words, H_STARTUP_MS),
      ownerState: Atomics.load(words, H_OWNER_STATE), deadReason: Atomics.load(words, H_DEAD_REASON),
      heartbeat: Atomics.load(words, H_HEARTBEAT), calls: Atomics.load(words, H_CALLS),
    } : null,
  };
}
let clipboardVsock = null;
let clipboardInput = null;
installClipboardButton({
  button: document.getElementById('clipboard-paste'),
  notice: document.getElementById('clipboard-notice'),
  async paste() {
    if (!activeMachine) throw new Error('Start Linux before pasting.');
    const item = await readHostClipboard();
    if (currentMode === 'console') {
      if (item.kind !== 1) throw new Error('Console mode accepts text only. Start X to paste an image.');
      if (!consoleInputWriter) throw new Error('Linux console is unavailable.');
      await consoleInputWriter.write(item.bytes);
      return 'Text sent to Linux console.';
    }
    await guestClipboard(clipboardVsock, 1, item);
    if (!clipboardInput) throw new Error('Linux input is unavailable; clipboard was set.');
    canvas.focus({ preventScroll: true });
    clipboardInput.key(Key.LEFTCTRL, true);
    if (item.kind === 1) clipboardInput.key(Key.LEFTSHIFT, true);
    clipboardInput.key(Key.V, true); clipboardInput.key(Key.V, false);
    if (item.kind === 1) clipboardInput.key(Key.LEFTSHIFT, false);
    clipboardInput.key(Key.LEFTCTRL, false);
    return item.kind === 2 ? 'Image ready in Linux clipboard · paste requested.' : 'Text ready in Linux clipboard · paste requested.';
  },
});
installClipboardButton({
  button: document.getElementById('clipboard-copy'),
  notice: document.getElementById('clipboard-copy-notice'),
  async copy() {
    if (!activeMachine) throw new Error('Start Linux before copying.');
    if (currentMode === 'console') throw new Error('Console mode has no X11 clipboard. Start X to copy from Linux.');
    const item = await guestClipboard(clipboardVsock, 3, undefined, 25000);
    await writeHostClipboard(item);
    return { message: item.kind === 2 ? 'Linux image copied to host clipboard.' : 'Linux text copied to host clipboard.', item };
  },
});
// Test commands: the host sends only a known id over hvc0; the guest agent from
// desktop-extras.mjs opens an Aurora terminal that runs the fixed command.
installTestCommands({
  toggle: document.getElementById('tests-toggle'),
  menu: document.getElementById('tests-menu'),
  notice: document.getElementById('tests-notice'),
  async run(command) {
    if (!activeMachine) throw new Error('Start Linux (desktop or Firefox) before running a test.');
    if (!['guest', 'startx', 'firefox'].includes(currentMode)) throw new Error('Test commands need a desktop boot; console and wgpu modes have no Aurora terminal.');
    if (gputestMode || selectedGpuTest === 'software') throw new Error('GPU test-app boots replace the desktop; boot the normal desktop to run tests.');
    if (!consoleInputWriter) throw new Error('Linux console is unavailable.');
    hostLog(`test command: ${command.id} -> ${command.command}`);
    await consoleInputWriter.write(testCommandRequest(command.id));
    canvas.focus({ preventScroll: true });
    // Guest Vulkan (and Zink on it) reaches the host over gpu_hostcall on every boot.
    return `Opening an Aurora terminal for “${command.label}”.`;
  },
});
let persistentHome = null;
let releaseHomeLock = null;
let homeLeaseQueue = Promise.resolve();
function queueHomeLease(operation) {
  const result = homeLeaseQueue.then(operation);
  homeLeaseQueue = result.catch(() => {});
  return result;
}
export function guestHome() { return persistentHome; }
const storagePanel = createStoragePanel({
  parent: document.querySelector('main'),
  async usage() {
    const home = await queueHomeLease(async () => {
      if (persistentHome) return persistentHome.usage();
      const release = await acquireHomeLock();
      try { const store = await openPersistentHome(); try { return await store.usage(); } finally { await store.destroy(); } }
      finally { await release(); }
    });
    return { home, system: await systemUsage(), estimate: await navigator.storage?.estimate?.(), persistent: await navigator.storage?.persisted?.() };
  },
  persist: () => navigator.storage?.persist?.(),
  clearCache: clearSystemCache,
  async update(progress) { await updateSystem(progress); },
  rollback: restorePreviousSystem,
  async restart() {
    if (currentMode) sessionStorage.setItem(resumeKey, currentMode);
    await persistentHome?.settle();
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
      const url = new URL(location.href); url.searchParams.delete('firefox'); url.searchParams.delete('gputest');
      location.replace(url);
    } catch (error) {
      activeMachine = null;
      restarting = false;
      lockConfiguration(false);
      showStopButton(false);
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
let pendingTestUrl = null;
// Settings change only the presenter of a running guest: apply it live.
let pendingDisplayOnly = false;
const openBrowserInfo = installBrowserInfo({ dialog: document.getElementById('browser-info'), content: document.getElementById('browser-info-content'), close: document.getElementById('browser-info-close'), toggle: document.getElementById('more-toggle') });
createMoreMenu({
  action: () => void openBrowserInfo(),
  toggle: document.getElementById('more-toggle'),
  menu: document.getElementById('more-menu'),
  launch: requestGpuTest,
});
let resumeMode = null;
try {
  const savedMode = sessionStorage.getItem(resumeKey);
  if (modes.includes(savedMode)) resumeMode = savedMode;
  sessionStorage.removeItem(resumeKey);
} catch { /* Storage may be unavailable; ordinary boot remains usable. */ }

let FB_W = 1280;
let FB_H = 720;
let consoleInputWriter = null;

// Ordinary GUI boot logs use a bounded plain-text viewer. Explicit console
// boots and blocked package-restore recovery open the native hvc0 terminal.
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

const packageRecovery = createPackageRecoveryWatch(() => {
  setStatus('package restore failed · recovery console', 'error');
  storagePanel.message('Saved packages could not be restored. Desktop startup is blocked. In the recovery console, type apk-persist disable, then use Stop and Start. Saved generations and home files are retained.', true);
  openConsole();
  const previous = guestLogs.history.rows.slice(-100).map(row => row.text).join('\r\n');
  terminal.write(previous + '\r\nPackage restore failed. Type apk-persist disable, then Stop and Start.\r\n');
  document.getElementById('terminal').scrollIntoView({ block: 'center' });
  terminal.focus();
});
let gpuHost = null;
let gpuLogTail = '';
function writeConsole(value, source = "guest") {
  if (typeof value !== 'string') value = nonSharedBytes(value);
  guestLogs.write(value, source);
  terminal?.write(value);
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
  packageRecovery.write(text, source);
  if (gpuHost && source === 'guest') {
    gpuLogTail = (gpuLogTail + text).slice(-64);
    if (gpuLogTail.includes('GUEST_GPU_LISTENING')) { gpuLogTail = ''; gpuHost.wake(); }
  }
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
  const nextGpuState = observeGuestGpuMessage(guestGpuState, line);
  if (nextGpuState !== guestGpuState) { guestGpuState = nextGpuState; showGuestGpuStatus(); }
  writeConsole(`[host${kind === "error" ? " error" : ""}] ${line}\r\n`, "host");
}

function errorDetails(error) {
  const message = String(error?.message || error || 'No error details were provided');
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  return stack && !stack.includes(message) ? `${message}\n${stack}` : stack || message;
}

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
  if (state === 'error') expandTools(true);
}

// The staged kernel supports at most CONFIG_NR_CPUS=64.
const hostCores = Math.min(64, Math.max(1, navigator.hardwareConcurrency || 2));
// Default to four guest CPUs, or every host CPU when the host has fewer.
const defaultCpus = Math.min(4, hostCores);
cpuInput.max = String(hostCores);
cpuInput.value = String(defaultCpus);
// Window-based resolutions are measured when a guest boots. A window narrower
// than 720 px defaults to its width × 500; wider windows keep 1280 × 720.
const defaults = { resolution: window.innerWidth < 720 ? "window-500" : "1280x720", cpus: defaultCpus, ram: 2048, backend: 'auto', guestBackend: 'webgpu' };
function validConfiguration(value) {
  return value && [...resolutionSelect.options].some(option => option.value === value.resolution)
    && Number.isInteger(value.cpus) && value.cpus >= 1 && value.cpus <= hostCores
    && [...ramSelect.options].some(option => Number(option.value) === value.ram)
    && ['webgpu', 'webgl'].includes(value.guestBackend);
}
let activeConfiguration = { ...defaults };
// True once the user has saved a memory size; Firefox then boots without asking.
let ramChosen = false;
try {
  ({ configuration: activeConfiguration, ramChosen } = restoreConfiguration(JSON.parse(localStorage.getItem(settingsKey)), defaults, {
    resolutions: [...resolutionSelect.options].map(option => option.value),
    ramValues: [...ramSelect.options].map(option => Number(option.value)), maxCpus: hostCores }));
} catch { /* Ignore missing or malformed saved settings. */ }
// A renderer= URL parameter chooses the display presentation for this page load.
activeConfiguration.backend = presentationFromUrl(location.search) ?? activeConfiguration.backend;
if (new URLSearchParams(location.search).has('gpubackend')) activeConfiguration.guestBackend = gpuBackendParam();
gpuBackend = activeConfiguration.guestBackend;
function readConfiguration() {
  return { resolution: resolutionSelect.value, cpus: Number(cpuInput.value), ram: Number(ramSelect.value), backend: graphicsSelect.value, guestBackend: guestGraphicsSelect.value };
}
function showConfiguration(value) {
  resolutionSelect.value = value.resolution;
  cpuInput.value = String(value.cpus);
  ramSelect.value = String(value.ram);
  graphicsSelect.value = value.backend || 'auto';
  guestGraphicsSelect.value = value.guestBackend || 'webgpu';
  gpuBackend = guestGraphicsSelect.value;
  guestGpuState = { ...guestGpuState, selectedBackend: gpuBackend };
  showGuestGpuStatus();
  // Only the active configuration is shown here; keep the URL parameter in step with it.
  history.replaceState(history.state, '', guestGpuUrl(presentationUrl(location.href, graphicsSelect.value), gpuBackend));
  updateCpuLabel();
  updateSettingsState();
}
function updateSettingsState() {
  const value = readConfiguration();
  settingsApply.disabled = configurationLocked || !validConfiguration(value)
    || (value.resolution === activeConfiguration.resolution && value.cpus === activeConfiguration.cpus && value.ram === activeConfiguration.ram && value.backend === activeConfiguration.backend && value.guestBackend === activeConfiguration.guestBackend);
  settingsNote.textContent = configurationLocked ? "Please wait while the machine starts or restarts."
    : activeMachine && setPresenter && displayOnlyChange(activeConfiguration, value) ? "Display presentation changes apply without restarting the guest."
    : currentMode === "firefox" ? "Applying changes restarts the guest. Firefox may need more memory; boot checks the selected image before starting."
      : activeMachine ? "Applying changes restarts the guest. You can review or cancel before anything changes."
        : "Choose settings, then apply your changes.";
}

function updateCpuLabel() {
  const cores = Number(cpuInput.value);
  cpuValue.value = `${cores} ${cores === 1 ? "core" : "cores"}`;
  cpuValue.textContent = cpuValue.value;
}

// Turns a resolution option into WxH. "window-500" is the browser window width
// × 500; "window" is the window width × height. Sizes are clamped and rounded to
// even numbers so the guest framebuffer stays a valid size.
function resolveResolution(value) {
  const even = (number, min, max) => Math.min(max, Math.max(min, Math.floor(number / 2) * 2));
  const width = even(window.innerWidth, 320, 3840);
  if (value === "window-500") return `${width}x500`;
  if (value === "window") return `${width}x${even(window.innerHeight, 240, 2160)}`;
  return value;
}
function updateWindowResolutionLabels() {
  const [width, height] = resolveResolution("window").split("x");
  resolutionSelect.querySelector('option[value="window-500"]').textContent = `Browser window width × 500 (${width} × 500)`;
  resolutionSelect.querySelector('option[value="window"]').textContent = `Browser window width × height (${width} × ${height})`;
}
function updateResolution() {
  [FB_W, FB_H] = resolveResolution(activeConfiguration.resolution).split("x").map(Number);
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
  if (open) placeToolsPopup(settingsPanel, settingsToggle);
}
function placeToolsPopup(panel, button) {
  const anchor = button.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 8))}px`;
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
guestGraphicsSelect.addEventListener('change', updateSettingsState);
cpuInput.addEventListener("input", () => { updateCpuLabel(); updateSettingsState(); });
updateWindowResolutionLabels();
window.addEventListener("resize", updateWindowResolutionLabels);
showConfiguration(activeConfiguration);
updateResolution();
updateCpuLabel();

function cancelConfiguration() {
  const cancelledTest = pendingTestUrl !== null;
  pendingTestUrl = null;
  pendingConfiguration = null;
  pendingDisplayOnly = false;
  restartDialog.close();
  showConfiguration(activeConfiguration);
  (cancelledTest ? document.getElementById('more-toggle') : settingsToggle).focus();
}
function requestGpuTest(url) {
  if (configurationLocked || restarting) return;
  if (!activeMachine) { void launchGpuTest(url); return; }
  pendingTestUrl = url;
  pendingConfiguration = null;
  document.getElementById('restart-error').hidden = true;
  document.getElementById('restart-title').textContent = 'Boot a GPU test app?';
  document.getElementById('restart-summary').textContent = 'Continue stops this guest and starts the selected test app.';
  document.getElementById('restart-warning').hidden = false;
  restartDialog.showModal();
}
function gpuTestSelection(url) {
  const params = url.searchParams;
  if (params.get('gputest') === 'wgpu' && ['webgpu', 'webgl'].includes(params.get('wgpubackend'))) return params.get('wgpubackend');
  if (params.get('gputest') === '1' && params.get('gputestapp') === 'glgears' && params.get('gldriver') === 'softpipe') return 'software';
  return null;
}
async function launchGpuTest(url) {
  const selection = gpuTestSelection(url);
  if (!selection) return;
  restarting = true;
  lockConfiguration(true);
  setStatus('starting GPU test…', 'booting');
  try {
    await persistentHome?.settle();
    if (gpuTestReport) gpuTestReport.stopped = true;
    activeMachine?.close();
    await activeMachine?.closed.catch(() => {});
    await persistentHome?.destroy();
    persistentHome = null;
    releaseHomeLock?.(); releaseHomeLock = null;
    activeMachine = null;
    gpuTestReport = null;
    sessionStorage.removeItem(resumeKey);
    // Stay in this app and reuse its canvas, controls and logs for the new VM.
    const next = new URL(location.href);
    for (const key of ['firefox', 'gputest', 'gputestapp', 'gldriver', 'glmode', 'gpubackend', 'wgpubackend', 'displaybackend']) next.searchParams.delete(key);
    for (const [key, value] of url.searchParams) next.searchParams.set(key, value);
    history.replaceState(null, '', next);
    firefoxMode = next.searchParams.get('firefox') === '1';
    gputestMode = gputestEnabled(next.search);
    gpuBackend = gpuBackendParam(next.search);
    activeConfiguration.guestBackend = gpuBackend;
    guestGraphicsSelect.value = gpuBackend;
    gpuParam = next.searchParams.get('gpu');
    selectedGpuTest = selection;
    restarting = false;
    lockConfiguration(false);
    showStopButton(false);
    await boot(selection === 'software' ? 'startx' : 'wgpu');
  } catch (error) {
    restarting = false;
    lockConfiguration(false);
    setStatus(activeMachine ? 'running' : 'idle', activeMachine ? 'running' : 'idle');
    storagePanel.message(`Could not start the GPU test: ${error.message || error}`, true);
  }
}
document.getElementById("restart-cancel").addEventListener("click", cancelConfiguration);
restartDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelConfiguration(); });
settingsApply.addEventListener("click", () => {
  const next = readConfiguration();
  if (settingsApply.disabled || !validConfiguration(next)) return;
  pendingConfiguration = { ...next };
  pendingDisplayOnly = Boolean(activeMachine && setPresenter && displayOnlyChange(activeConfiguration, next));
  document.getElementById("restart-error").hidden = true;
  document.getElementById("restart-title").textContent = pendingDisplayOnly ? "Change display presentation?" : activeMachine ? "Restart the guest?" : "Apply machine settings?";
  document.getElementById("restart-summary").textContent = pendingDisplayOnly
    ? `Display presentation · ${graphicsSelect.selectedOptions[0].text}. Continue saves this setting and switches the display now; the guest keeps running.`
    : `${resolveResolution(next.resolution).replace("x", " × ")} ·${next.cpus} ${next.cpus === 1 ? "core" : "cores"} · ${next.ram === 4096 ? "4 GB" : `${next.ram} MB`} · ${graphicsSelect.selectedOptions[0].text} · guest Vulkan ${guestGraphicsSelect.selectedOptions[0].text}. ${activeMachine ? "Continue saves these settings and restarts the guest in the same mode." : "Continue saves these settings for the next boot."}`;
  document.getElementById("restart-warning").hidden = !activeMachine || pendingDisplayOnly;
  restartDialog.showModal();
});
restartContinue.addEventListener("click", async () => {
  if (pendingTestUrl && !restarting) {
    const url = pendingTestUrl;
    pendingTestUrl = null;
    restartDialog.close();
    await launchGpuTest(url);
    return;
  }
  if (!pendingConfiguration || restarting) return;
  const next = pendingConfiguration;
  const displayOnly = pendingDisplayOnly && activeMachine && setPresenter;
  let previous;
  try {
    previous = localStorage.getItem(settingsKey);
    localStorage.setItem(settingsKey, JSON.stringify(settingsRecord(next)));
    if (activeMachine && !displayOnly) sessionStorage.setItem(resumeKey, currentMode);
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
  ramChosen = true;
  if (displayOnly) {
    showConfiguration(activeConfiguration);
    hostLog(`display presentation switched to ${next.backend} without restarting the guest`);
    await setPresenter(next.backend);
    return;
  }
  if (!activeMachine) {
    showConfiguration(activeConfiguration);
    updateResolution();
    return;
  }
  restarting = true;
  lockConfiguration(true);
  setStatus("restarting…", "booting");
  await persistentHome?.settle();
  activeMachine.close();
  await activeMachine.closed.catch(() => {});
  // Reload releases the old guest's canvas listeners, streams, workers and
  // network. Keep every existing query parameter (proxy, Firefox, diagnostics);
  // renderer= carries the newly applied presentation.
  history.replaceState(history.state, '', guestGpuUrl(presentationUrl(location.href, next.backend), next.guestBackend));
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
  guestGraphicsSelect.disabled = locked;
  updateSettingsState();
}

function ramBytes(mebibytes) {
  // wasm32 leaves its final 64 KiB page unused so the byte size fits in u32.
  return mebibytes === 4096 ? 0xffff0000 : mebibytes * 1024 * 1024;
}

// The normal desktop and More-menu tests share the same guest input behavior.
function bindGuestCanvasInput(pointer) {
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
  const hostRepeat = new URLSearchParams(location.search).get('input-repeat') !== 'guest';
  const physicalKeyboard = createPhysicalKeyboard((code, down, repeat) => pointer.key(code, down, repeat), { hostRepeat });
  const releasePhysicalKeys = () => physicalKeyboard.releaseAll();
  onCanvas('blur', releasePhysicalKeys);
  window.addEventListener('blur', releasePhysicalKeys, { signal: inputEvents.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releasePhysicalKeys(); }, { signal: inputEvents.signal });
  inputEvents.signal.addEventListener('abort', releasePhysicalKeys, { once: true });

  onCanvas("keydown", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    if (!physicalKeyboard.down(ev)) return;
    ev.preventDefault();
  });
  onCanvas("keyup", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    if (!physicalKeyboard.up(ev)) return;
    ev.preventDefault();
  });
  onCanvas("compositionstart", () => { releasePhysicalKeys(); composing = true; });
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
    releasePhysicalKeys();
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
    // Keep the page still: a plain focus() scrolls a tall display to the top.
    if (!mobileKeyboard.focusDisplay(ev.pointerType)) canvas.focus({ preventScroll: true });
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

  return inputEvents;
}

function chooseSystemUpdate({ current, candidate, changed, canContinue }) {
  // ?update=1 accepts every system update without asking (tests, kiosks).
  if (new URLSearchParams(location.search).get('update') === '1') {
    setStatus('updating system…', 'booting');
    return Promise.resolve('update');
  }
  const dialog = document.getElementById('system-update-dialog');
  const names = { kernel: 'Linux kernel', plain: 'Linux desktop', firefox: 'Firefox' };
  document.getElementById('system-update-summary').textContent = `${changed.map(key => names[key]).join(', ')} has an update (${current.version} → ${candidate.version}).`;
  document.getElementById('system-update-cache').textContent = canContinue
    ? 'Update downloads the new packages. Continue uses your cached system. Your home files are preserved.'
    : 'The previous system is not fully cached. Update is needed to start. Your home files are preserved.';
  document.getElementById('system-update-continue').disabled = !canContinue;
  return new Promise(resolve => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'update') setStatus('updating system…', 'booting');
      resolve(dialog.returnValue);
    }, { once: true });
    dialog.showModal();
  });
}

// WebGPU presentation failed: the user picks WebGL or Canvas 2D (saved, so it
// is not asked again) or cancels and the display stays paused.
async function choosePresentationFallback(reason) {
  if (presentationPromptOpen) return;
  presentationPromptOpen = true;
  const dialog = document.getElementById('presentation-dialog');
  document.getElementById('presentation-reason').textContent = `Reason: ${reason || 'unknown'}`;
  hostLog(`WebGPU display presentation is not working: ${reason || 'unknown reason'}`, 'error');
  const choice = await new Promise(resolve => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(presentationChoice(dialog.returnValue)), { once: true });
    dialog.showModal();
  });
  presentationPromptOpen = false;
  if (!choice) {
    graphicsStatus.textContent += ' · choose WebGL or Canvas 2D in Settings';
    return;
  }
  try { localStorage.setItem(settingsKey, JSON.stringify(withPresentationChoice(activeConfiguration, choice, ramChosen))); }
  catch { storagePanel.message('Could not save the display choice in this browser; it applies to this session only.', true); }
  activeConfiguration = { ...activeConfiguration, backend: choice };
  showConfiguration(activeConfiguration);
  hostLog(`display presentation switched to ${choice} by user choice`);
  await setPresenter?.(choice);
}

function chooseFirefoxMemory(currentRam) {
  const dialog = document.getElementById('firefox-memory-dialog');
  document.getElementById('firefox-memory-current').textContent = currentRam === 4096 ? '4 GB' : `${currentRam} MB`;
  return new Promise(resolve => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      const choice = dialog.returnValue;
      resolve(choice === 'current' ? currentRam : ['1024', '2048'].includes(choice) ? Number(choice) : null);
    }, { once: true });
    dialog.showModal();
  });
}

async function boot(mode) {
  if (configurationLocked || activeMachine) return;
  const bootStart = performance.now();
  let updateChecked = '-';
  const bootTime = () => `${((performance.now() - bootStart) / 1000).toFixed(1)}s`;
  if (mode !== 'wgpu') {
    lockConfiguration(true);
    setStatus('checking system updates…', 'booting');
    try {
      if (!await prepareSystemBoot(mode === 'firefox' ? 'firefox' : 'plain', chooseSystemUpdate)) {
        setStatus('ready', 'idle');
        return;
      }
      updateChecked = bootTime();
    } catch (error) {
      setStatus('update check failed', 'error');
      storagePanel.message(error.message, true); hostLog(error.message, 'error'); return;
    } finally { lockConfiguration(false); }
  }
  if (needsFirefoxMemoryChoice(mode, activeConfiguration.ram, ramChosen)) {
    lockConfiguration(true);
    let ram;
    try { ram = await chooseFirefoxMemory(activeConfiguration.ram); }
    finally { lockConfiguration(false); }
    if (ram === null) return;
    activeConfiguration = { ...activeConfiguration, ram };
    // Save the choice like applied settings so later boots and restarts keep it.
    ramChosen = true;
    try { localStorage.setItem(settingsKey, JSON.stringify(settingsRecord(activeConfiguration))); } catch { /* This boot still uses the choice. */ }
  }
  currentMode = mode;
  packageRecovery.start();
  displayStage.hidden = mode === 'console';
  // Only confirmed configuration reaches the guest, never uncommitted drafts.
  showConfiguration(activeConfiguration);
  updateResolution();
  lockConfiguration(true);
  setSettingsOpen(false);
  setStatus(`booting ${mode}…`, "booting");
  guestLogs.clear();
  hostLog(`boot timing: ${mode} boot requested ${(bootStart / 1000).toFixed(1)}s after page load; update check done at ${updateChecked}`);
  if (mode === "console") openConsole();
  terminal?.clear();
  hostLog(
    `boot mode=${mode}, display=${FB_W}x${FB_H}, cpus=${cpuInput.value}, ram=${ramSelect.selectedOptions[0].text}`,
  );
  let initramfs;
  let gputestInit = false;
  // io-blockroot=<same-origin path> (default off, console-only experiment): mount an ext4 image
  // read-only over virtio-blk, reading sectors on demand from a Blob instead of unpacking an initramfs.
  const blockRootUrl = mode === 'console' && new URLSearchParams(location.search).get('io-blockroot');
  const rootfs = blockRootUrl ? await (async () => {
    const url = new URL(blockRootUrl, location.href);
    if (url.origin !== location.origin) throw new Error('io-blockroot must be same-origin');
    const response = await fetch(url); if (!response.ok) throw new Error(`io-blockroot HTTP ${response.status}`);
    const blob = await response.blob();
    hostLog(`boot timing: block root (${(blob.size / 1048576).toFixed(0)} MiB) fetched at ${bootTime()}`);
    return { byteLength: blob.size, readOnly: true, subarray: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) };
  })() : null;
  if (mode === 'wgpu') {
    try {
      activeMachine = await bootWgpuTest({ backend: selectedGpuTest, canvas, log: writeConsole, onStatus: setStatus,
        configuration: { cpus: activeConfiguration.cpus, memoryBytes: ramBytes(activeConfiguration.ram), displayBackend: activeConfiguration.backend } });
      clipboardVsock = activeMachine.clipboardVsock; clipboardInput = activeMachine.gpuTestInput;
      gpuTestReport = activeMachine.gpuTestReport;
      const testInputEvents = bindGuestCanvasInput(activeMachine.gpuTestInput);
      mobileKeyboard.setKeyHandler((code, down) => activeMachine?.gpuTestInput?.key(code, down));
      void activeMachine.closed.finally(() => {
        clipboardVsock = null; clipboardInput = null;
        testInputEvents.abort();
        mobileKeyboard.setKeyHandler(null);
        cancelGuestGesture();
        cancelGuestGesture = () => {};
      }).catch(() => {});
      lockConfiguration(false);
      for (const button of launchButtons) button.disabled = true;
      showStopButton(true);
      storagePanel.message('Isolated Vulkan test running · your saved home is preserved.');
      activeMachine.closed.catch(error => { if (!restarting) hostLog(`Test stopped: ${error}`, 'error'); });
    } catch (error) {
      activeMachine = null;
      setStatus('GPU test failed to start', 'error');
      hostLog(error.message, 'error');
      storagePanel.message(error.message, true);
      lockConfiguration(false);
    }
    return;
  }
  const archiveController = new AbortController();
  try {
    await queueHomeLease(async () => {
      releaseHomeLock = await acquireHomeLock();
      try { persistentHome = await openPersistentHome({ onError: error => storagePanel.message(`Home storage error: ${error.message}`, true),
        ...(new URLSearchParams(location.search).get('io-relaxed') === '1' ? { durability: 'relaxed' } : {}) }); }
      catch (error) { await releaseHomeLock(); releaseHomeLock = null; throw error; }
    });
    hostLog(`boot timing: home ready at ${bootTime()}`);
    const compressedInitramfs = useCompressedInitramfs(mode, location.search, gputestMode || selectedGpuTest === 'software');
    // Diagnostic CPIO appended below is outside the pinned final composition.
    // Keep native purge-marker invalidation for those explicit test modes.
    const cacheLifecycle = mode === 'firefox' && !gputestMode && selectedGpuTest !== 'software'
      ? (await activeManifest()).assets.firefox.cacheLifecycle : undefined;
    // io-cache=1 (default off): memoize the verified /init scan and desktop extras by SHA-256.
    const memo = new URLSearchParams(location.search).get('io-cache') === '1' && !gputestMode && selectedGpuTest !== 'software' ? composeCache() : undefined;
    initramfs = rootfs ? null : loadDesktopInitramfs(systemAsset(mode === 'firefox' ? 'firefox' : 'plain'), loadDesktopExtras(fetch, { preserveGzip: compressedInitramfs, cacheLifecycle, composeCache: memo }), {
      gzip: mode === 'firefox',
      composeCache: memo,
      preserveGzip: compressedInitramfs,
      compressExtras: compressedInitramfs,
      signal: archiveController.signal,
      onImage: bytes => hostLog(`boot timing: system image (${(bytes / 1048576).toFixed(0)} MiB) ready at ${bootTime()}`),
      onReady: () => hostLog(`boot timing: desktop extras appended at ${bootTime()}`),
    });
    initramfs?.catch(() => {});
    if (gputestMode || selectedGpuTest === 'software') {
      initramfs = await initramfs;
      const demo = await loadGputestArchive(hostLog, fetch, GPUTEST_APPS[gputestAppParam(location.search)]);
      if (demo) { initramfs = appendCpio(initramfs, demo); gputestInit = true; }
    }
    storagePanel.message('Home ready · waiting for guest mount');
  } catch (error) {
    archiveController.abort(error);
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
    repeatOwner: new URLSearchParams(location.search).get("input-repeat") !== "guest" ? "host" : "guest",
    absXMax: FB_W - 1,
    absYMax: FB_H - 1,
  });

  const inputEvents = bindGuestCanvasInput(pointer);

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
    // The exclusive home lease leaves the guest as the home's only writer, so its name and attribute caches stay exact.
    // io-fs=1 (default off): keep page cache across opens and a per-handle readdir listing.
    fileSystemDevice(persistentHome, { tag: 'home', cache: true, cacheSeconds: 3600,
      ...(new URLSearchParams(location.search).get('io-fs') === '1' ? { keepCache: true, stableReaddir: true } : {}) }),
  ];
  const vsock = vsockDevice();
  devices.push(vsock);
  if (rootfs) {
    devices.push(
      blockDevice({
        capacity: rootfs.byteLength,
        read: (offset, length) => rootfs.subarray(offset, offset + length),
        ...(rootfs.readOnly ? {} : { write: (offset, data) => {
          rootfs.set(data, offset);
        } }),
      }),
    );
  }

  const reader = output.readable.getReader();
  const inputWriter = consoleInputWriter;
  let bootReader = null;
  let bootClosed = false;
  let machineStarted = false;
  const cleanupBoot = () => {
    if (bootClosed) return;
    bootClosed = true;
    archiveController.abort();
    gpuHost?.stop(); gpuHost = null;
    if (clipboardVsock === vsock) { clipboardVsock = null; clipboardInput = null; }
    vsock.close();
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
  })().catch((err) => { if (machineStarted && !restarting && !bootClosed) hostLog(`guest console closed: ${err?.message || err || "no error details"}`, "error"); });

  try {
    const consoleMode = mode === "console";
    const rootCommand = rootfs
      ? `root=/dev/vda rootfstype=ext4 rw rootwait init=${consoleMode ? "/bin/sh" : "/init"}`
      : `rdinit=${gputestInit ? GPUTEST_RDINIT : '/init'}`;
    const modeFlags = [
      `demo.mode=${mode}`,
      'home.persistent=1',
      mode === "firefox" ? "firefox=1" : "",
      gputestInit ? "gputest=1" : "",
      ...(gputestInit ? gputestCmdlineFlags(location.search) : []),
      new URLSearchParams(location.search).get("firefox_trace") === "1" ? "firefox_trace=1" : "",
      ...firefoxJitFlags(location.search),
      // Opcode histogram in diagnostic Firefox builds (PBLOPS).
      new URLSearchParams(location.search).get("pblops") === "1" ? "pblops=1" : "",
      // Guest GL remote trace level (GLREMOTE_TRACE; 2 logs where batches end every 5 s).
      /^[0-9]$/.test(new URLSearchParams(location.search).get("glremote") ?? "")
        ? `glremote=${new URLSearchParams(location.search).get("glremote")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const memory = ramBytes(Number(ramSelect.value));
    guestGpuState = newGuestGpuState(gpuBackend);
    showGuestGpuStatus();
    const machine = await spawnMachine({
      cpus: Number(cpuInput.value),
      cmdline: `${rootCommand} ${modeFlags}`,
      initcpio: initramfs ?? undefined,
      devices,
      devicetree: { memory: { reg: [0, memory] } },
      audio: true,
      framebuffer: { canvas, width: FB_W, height: FB_H, bpp: 32, backend: activeConfiguration.backend },
      // Guest Vulkan uses the gpu_hostcall channel by default (dist/guest-gpu-vk.js).
      gpuHostcall: {
        ...guestGpuHostcallOptions(location.search, gpuBackend),
        log: (event) => { if (event.kind === "owner-log" || event.kind === "owner-error") hostLog(`gpu-owner: ${event.message}`); },
        onPresent: (frame, reply) => presentOverlay.present(frame, reply),
      },
    });
    activeMachine = machine;
    machineStarted = true;
    hostLog(`boot timing: machine started at ${bootTime()}`);
    clipboardVsock = vsock; clipboardInput = pointer;
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
    showStopButton(true);
    if (consoleMode) terminal?.focus();
    else canvas.focus({ preventScroll: true });
    hostLog("machine started (framebuffer + virtio input/console/net)");
    // Serve guest GPU sessions until the machine closes (cleanupBoot stops it).
    if (guestGpuEnabled(mode) && !bootClosed) gpuHost = startGpuHost({ vsock, log: hostLog, backend: gpuBackend });
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
      setStatus(`stopped: ${err?.message || err || "no error details"}`, "error");
      hostLog(errorDetails(err), "error");
    });
  } catch (err) {
    archiveController.abort(err);
    cleanupBoot();
    await persistentHome?.destroy().catch(() => {});
    persistentHome = null;
    activeMachine = null;
    setStatus("boot failed", "error");
    storagePanel.message(`Boot failed: ${err?.message || err || "No error details were provided"}`, true);
    hostLog(errorDetails(err), "error");
    consoleInputWriter = null;
    lockConfiguration(false);
  }
}

// Once a guest runs, the boot button becomes its stop button.
// SVG elements have no `hidden` property, so one icon swaps its shapes.
const bootButton = document.getElementById("boot");
const bootIcon = bootButton.querySelector("svg");
const powerShapes = bootIcon.innerHTML;
const stopConfirm = document.getElementById("stop-confirm");
const powerMenu = document.getElementById('power-menu');
createMoreMenu({ toggle: bootButton, menu: powerMenu, canOpen: () => !configurationLocked, action: item => { if (item.dataset.action === 'stop') setStopConfirmOpen(true); else void boot(item.dataset.mode); } });
function showStopButton(running) {
  bootIcon.innerHTML = running ? '<rect x="6" y="6" width="12" height="12" rx="1.5" />' : powerShapes;
  bootButton.classList.toggle("stop", running);
  bootButton.querySelector(".label").textContent = 'Power';
  document.getElementById('power-stop').hidden = !running;
  powerMenu.hidden = true;
  if (running) bootButton.disabled = false;
  else setStopConfirmOpen(false);
}
function setStopConfirmOpen(open) {
  stopConfirm.hidden = !open;
  if (open) placeToolsPopup(stopConfirm, bootButton);
  if (open) bootButton.setAttribute("aria-expanded", "true");
  else bootButton.setAttribute("aria-expanded", String(!powerMenu.hidden));
  if (open) document.getElementById("stop-cancel").focus();
}
stopConfirm.addEventListener("click", (ev) => ev.stopPropagation());
stopConfirm.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  setStopConfirmOpen(false);
  bootButton.focus();
});
document.addEventListener("click", () => setStopConfirmOpen(false));
document.getElementById("stop-cancel").addEventListener("click", () => {
  setStopConfirmOpen(false);
  bootButton.focus();
});
document.getElementById("stop-yes").addEventListener("click", () => {
  setStopConfirmOpen(false);
  void stopGuest();
});
async function stopGuest() {
  if (!activeMachine || restarting) return;
  restarting = true;
  packageRecovery.stop();
  // Release physical and virtual held keys while the input device still runs.
  cancelGuestGesture();
  mobileKeyboard.setKeyHandler(null);
  lockConfiguration(true);
  setStatus("stopping…", "booting");
  await persistentHome?.settle().catch(() => {});
  if (gpuTestReport) gpuTestReport.stopped = true;
  activeMachine.close();
  await activeMachine.closed.catch(() => {});
  // Reload releases the old guest's listeners, streams, workers and network,
  // as restart does. Drop auto-boot so the page stays stopped.
  sessionStorage.removeItem(resumeKey);
  const url = new URL(location.href);
  url.searchParams.delete("firefox");
  url.searchParams.delete("gputest");
  location.replace(url);
}

// Firefox mode is intended for unattended Chromium testing. Boot immediately;
// Guest init waits for Aurora readiness (bounded by a deadline), then launches /bin/firefox.
// ?gputest=1 alone auto-boots X; combined with ?firefox=1 it boots Firefox.
if (selectedGpuTest === 'webgpu' || selectedGpuTest === 'webgl') {
  queueMicrotask(() => void boot('wgpu'));
} else if (resumeMode || firefoxMode || gputestMode) {
  // Resume the confirmed launch mode after a clean restart. Defaults are
  // 4 GiB for Firefox and 1 GiB otherwise; validated preferences take priority.
  const mode = resumeMode || (firefoxMode ? "firefox" : "startx");
  setStatus(`${mode}: auto-booting…`, "booting");
  hostLog(`auto-boot enabled for ${mode}`);
  queueMicrotask(() => void boot(mode));
}
