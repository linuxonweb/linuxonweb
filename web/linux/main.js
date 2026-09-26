// Demo boot: canvas framebuffer + virtio console/input/net + smoke/GUI rootfs.
import {
  spawnMachine,
  consoleDevice,
  entropyDevice,
  blockDevice,
  inputDevice,
  Key,
  createNetwork,
  attach_guest,
  wsTcpProxyNetwork,
} from "./dist/index.js";
import { createTouchGestureAdapter } from "./touch-gesture.mjs";
import { compositionEvents, mapKeyboardEvent } from "./keyboard.mjs";

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
const terminalEl = document.getElementById("terminal");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const resolutionSelect = document.getElementById("resolution");
const cpuInput = document.getElementById("cpu-cores");
const cpuValue = document.getElementById("cpu-value");
const ramSelect = document.getElementById("ram");
const settingsNote = document.getElementById("settings-note");
const firefoxMode = new URLSearchParams(location.search).get("firefox") === "1";

let FB_W = 1280;
let FB_H = 720;
let consoleInputWriter = null;

const terminal = new globalThis.Terminal({
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: true,
  cursorStyle: "block",
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.18,
  scrollback: 5000,
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
const fitTerminal = () => {
  try {
    fitAddon.fit();
  } catch {
    /* terminal may not be measurable during initial layout */
  }
};
new ResizeObserver(fitTerminal).observe(terminalEl);
queueMicrotask(fitTerminal);

terminal.onData((data) => {
  if (!consoleInputWriter) return;
  void consoleInputWriter.write(new TextEncoder().encode(data)).catch((err) => {
    hostLog(`console input failed: ${err}`, "error");
  });
});

function hostLog(line, kind = "host") {
  const color = kind === "error" ? "\x1b[31m" : "\x1b[36m";
  terminal.write(`${color}[host]\x1b[0m ${line}\r\n`);
}

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

const hostCores = Math.max(1, navigator.hardwareConcurrency || 2);
cpuInput.max = String(hostCores);
cpuInput.value = String(Math.min(2, hostCores));

function updateCpuLabel() {
  const cores = Number(cpuInput.value);
  cpuValue.value = `${cores} ${cores === 1 ? "core" : "cores"}`;
  cpuValue.textContent = cpuValue.value;
}

function updateResolution() {
  [FB_W, FB_H] = resolutionSelect.value.split("x").map(Number);
  canvas.width = FB_W;
  canvas.height = FB_H;
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
  if (ev.key === "Escape") setSettingsOpen(false);
});
resolutionSelect.addEventListener("change", updateResolution);
cpuInput.addEventListener("input", updateCpuLabel);
updateResolution();
updateCpuLabel();

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

async function loadBytes(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      // Stream gzip responses directly through the browser decompressor so
      // the compressed response is not retained alongside the decompressed
      // initramfs. If streaming is unavailable, retain the old byte-buffer
      // path; the caller's unpackGzip fallback remains unchanged.
      if (/\.gz(?:[?#]|$)/i.test(url) && res.body && typeof DecompressionStream === "function") {
        const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      /* try next */
    }
  }
  return null;
}

async function unpackGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("gzip initramfs requires browser DecompressionStream support");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function lockConfiguration(locked) {
  for (const button of launchButtons) button.disabled = locked;
  resolutionSelect.disabled = locked;
  cpuInput.disabled = locked;
  ramSelect.disabled = locked;
  settingsNote.textContent = locked
    ? "Settings are locked for this running guest. Reload to create another machine."
    : "Settings lock while the guest is running.";
}

function ramBytes(mebibytes) {
  // wasm32 leaves its final 64 KiB page unused so the byte size fits in u32.
  return mebibytes === 4096 ? 0xffff0000 : mebibytes * 1024 * 1024;
}

async function boot(mode) {
  lockConfiguration(true);
  setSettingsOpen(false);
  setStatus(`booting ${mode}…`, "booting");
  terminal.clear();
  hostLog(
    `boot mode=${mode}, display=${FB_W}x${FB_H}, cpus=${cpuInput.value}, ram=${ramSelect.selectedOptions[0].text}`,
  );
  // Prefer the GUI initramfs (Xfbdev + WM/xterm). Fall back to ext4.
  // Firefox mode uses the larger image containing the stripped static browser
  // and its runtime resources. Other modes keep the lightweight GUI image.
  // Cache-bust so the browser always fetches the latest GUI image.
  const bust = `?v=${Date.now()}`;
  const packedInitramfs = await loadBytes([
    ...(mode === "firefox"
      ? [
          `./initramfs-firefox.cpio.gz${bust}`,
          `/demo/initramfs-firefox.cpio.gz${bust}`,
          `./initramfs-firefox.cpio${bust}`,
          `/demo/initramfs-firefox.cpio${bust}`,
        ]
      : []),
    `./initramfs.cpio${bust}`,
    `/demo/initramfs.cpio${bust}`,
  ]);
  // The kernel consumes a raw newc archive. Firefox mode stages gzip to keep
  // the browser download bounded, so unpack it before handing it to the VM.
  const initramfs = packedInitramfs?.[0] === 0x1f && packedInitramfs?.[1] === 0x8b
    ? await unpackGzip(packedInitramfs)
    : packedInitramfs;
  const rootfs = initramfs
    ? null
    : await loadBytes([`./rootfs.ext4${bust}`, `/demo/rootfs.ext4${bust}`]);

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
  canvas.style.touchAction = "none";
  let composing = false;

  canvas.addEventListener("keydown", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    const code = mapKeyboardEvent(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, true);
  });
  canvas.addEventListener("keyup", (ev) => {
    if (composing || ev.isComposing || ev.key === "Process") return;
    const code = mapKeyboardEvent(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, false);
  });
  canvas.addEventListener("compositionstart", () => { composing = true; });
  canvas.addEventListener("compositionend", (ev) => {
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

  canvas.addEventListener("pointermove", (ev) => {
    const { x, y } = canvasCoords(ev);
    if (ev.pointerType === "touch") {
      touchGesture.move(ev.pointerId, x, y);
      ev.preventDefault();
      return;
    }
    queuePointer(x, y);
  });
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.focus();
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
  canvas.addEventListener("pointerup", (ev) => {
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
  canvas.addEventListener("pointercancel", (ev) => {
    if (ev.pointerType === "touch") {
      touchGesture.cancel(ev.pointerId);
      ev.preventDefault();
      return;
    }
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, false);
  });
  canvas.addEventListener(
    "wheel",
    (ev) => {
      // Linux REL_WHEEL: positive = up. Browser deltaY: positive = down.
      const steps = Math.max(1, Math.round(Math.abs(ev.deltaY) / 100));
      pointer.wheel(ev.deltaY < 0 ? steps : -steps);
      ev.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

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
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      terminal.write(new Uint8Array(value));
    }
  })();

  try {
    const consoleMode = mode === "console";
    const rootCommand = rootfs
      ? `root=/dev/vda rootfstype=ext4 rw rootwait init=${consoleMode ? "/bin/sh" : "/init"}`
      : `rdinit=${consoleMode ? "/bin/sh" : "/init"}`;
    const modeFlags = [
      `demo.mode=${mode}`,
      mode === "firefox" ? "firefox=1" : "",
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
      framebuffer: { canvas, width: FB_W, height: FB_H, bpp: 32 },
    });
    void machine.closed
      .finally(() => {
        attached.attachment.close();
        network.close();
        consoleInputWriter = null;
      })
      .catch(() => {});
    setStatus(
      initramfs
        ? `running · ${mode} · initramfs`
        : rootfs
          ? `running · ${mode} · ext4`
          : "running · no userspace image",
      "running",
    );
    if (consoleMode) terminal.focus();
    else canvas.focus();
    hostLog("machine started (framebuffer + virtio input/console/net)");
    const bootReader = machine.bootConsole.getReader();
    (async () => {
      for (;;) {
        const { value, done } = await bootReader.read();
        if (done) break;
        terminal.write(new Uint8Array(value));
      }
    })();
    machine.closed.catch((err) => {
      setStatus(`stopped: ${err}`, "error");
      hostLog(String(err), "error");
    });
  } catch (err) {
    setStatus("boot failed", "error");
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
if (firefoxMode) {
  // The Firefox initramfs keeps roughly 750 MiB unevictable while booting;
  // reserve the supported 4 GiB maximum for the automatic browser path
  // without changing the normal 1 GiB default for console/X modes.
  if (Number(ramSelect.value) < 4096) ramSelect.value = "4096";
  setStatus("Firefox mode: auto-booting…", "booting");
  hostLog("?firefox=1: auto-boot enabled; Firefox starts after X is ready");
  queueMicrotask(() => document.getElementById("start-firefox").click());
}
