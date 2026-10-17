// SPDX-License-Identifier: MIT
import { memory_bytes } from "./wasm.js";
import { createWebGLPresenter, createWebGPUPresenter } from "./framebuffer-presenter.js";
/**
 * Convert guest little-endian x8r8g8b8 (memory bytes B,G,R,A → u32 0xAARRGGBB)
 * into Canvas ImageData RGBA (u32 0xAABBGGRR). Alpha is forced opaque.
 *
 * Uses word-sized loads/stores; much faster than a per-channel nested loop.
 */
export function swizzle_bgra_to_rgba(dst, src, width, height, stride) {
    const pixels = width * height;
    if (dst.byteOffset % 4 || src.byteOffset % 4 || stride % 4) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const s = y * stride + x * 4, d = (y * width + x) * 4;
                dst[d] = src[s + 2]; dst[d + 1] = src[s + 1];
                dst[d + 2] = src[s]; dst[d + 3] = 255;
            }
        }
        return;
    }
    const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, pixels);
    // Prefer a single tight copy when stride matches the packed row width.
    if (stride === width * 4 && src.byteOffset % 4 === 0) {
        const src32 = new Uint32Array(src.buffer, src.byteOffset, pixels);
        for (let i = 0; i < pixels; i++) {
            const p = src32[i];
            dst32[i] =
                (p & 0xff00ff00) |
                    ((p & 0x000000ff) << 16) |
                    ((p & 0x00ff0000) >> 16) |
                    0xff000000;
        }
        return;
    }
    for (let y = 0; y < height; y++) {
        const row_offset = src.byteOffset + y * stride;
        const row = new Uint32Array(src.buffer, row_offset, width);
        const dst_row = y * width;
        for (let x = 0; x < width; x++) {
            const p = row[x];
            dst32[dst_row + x] =
                (p & 0xff00ff00) |
                    ((p & 0x000000ff) << 16) |
                    ((p & 0x00ff0000) >> 16) |
                    0xff000000;
        }
    }
}
// ../fbdiff/fbdiff.wat assembled with wat2wasm --enable-multi-memory --enable-threads;
// framebuffer.test.mjs checks that these bytes match fbdiff.wasm.
export const FBDIFF_WASM = "AGFzbQEAAAABCgFgBX9/f39/AX8CEQEDZW52BWd1ZXN0AgMBgIAEAwIBAAUDAQAABhUEfwFBAAt/AUEAC38BQQALfwFBAAsHMAYHc3RhZ2luZwIBA3RvcAMABmJvdHRvbQMBBGxlZnQDAgVyaWdodAMDBGRpZmYAAAr8AQH5AQEFf0F/JABBACQBIAIkAkEAJAMCQANAIAUgA08NASAAIAUgAWxqIQYgBSACbCEHQQAhCCACQRBrIQkCQCAERQRAAkADQCAIIAJPDQMgBiAIav0ABAAgByAIav0ARAEA/VH9Uw0BIAhBEGohCAwACwsCQANAIAYgCWr9AAQAIAcgCWr9AEQBAP1R/VMNASAJIAhNDQEgCUEQayEJDAALCwsgByAIaiAGIAhqIAlBEGogCGv8CgEAIwBBAEgEQCAFJAALIAVBAWokASAIIwJJBEAgCCQCCyAJQRBqIwNLBEAgCUEQaiQDCwsgBUEBaiEFDAALCyMAQQBOCw==";
let fbdiffModule;
// SIMD change detection over the guest memory, or null (no SIMD/multi-memory
// support, or an unshared memory): the host then compares rows in JavaScript.
function fbdiff(memory) {
    if (fbdiffModule === undefined) {
        try { fbdiffModule = new WebAssembly.Module(Uint8Array.from(atob(FBDIFF_WASM), c => c.charCodeAt(0))); }
        catch { fbdiffModule = null; }
    }
    if (!fbdiffModule) return null;
    try { return new WebAssembly.Instance(fbdiffModule, { env: { guest: memory } }).exports; }
    catch { return null; }
}
/**
 * Host-side canvas presenter for the wasm framebuffer driver.
 * Stable visible/input canvas, with optional GPU swizzle on a private surface.
 */
export function createFramebufferHost(memory, options) {
    const width = options.width ?? 1024;
    const height = options.height ?? 768;
    const bpp = options.bpp ?? 32;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
        throw new Error("invalid framebuffer dimensions");
    if (bpp !== 32)
        throw new Error("framebuffer only supports 32bpp");
    const canvas = options.canvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("canvas 2d context unavailable");
    let image = null;
    let closed = false;
    let raf = 0;
    let dirty = false;
    // Latest presented guest buffer (address and stride); it is read at paint time.
    let source = null;
    // Recycled staging buffer so a paint does not allocate 3MiB per frame.
    let staging = null;
    const rowBytes = width * 4;
    // Rectangle changed since the last paint: rows [top, bottom), pixels [left, right).
    // The guest presents on every wakeup, often with identical bytes; unchanged
    // frames draw nothing.
    let top = 0, bottom = 0, left = 0, right = 0;
    const fast = rowBytes % 16 === 0 ? fbdiff(memory) : null;
    const mark = (t, b, l, r) => {
        top = Math.min(top, t); bottom = Math.max(bottom, b);
        left = Math.min(left, l); right = Math.max(right, r);
    };
    // Rectangle to show again without new framebuffer bytes (keyed GL window
    // holes changed): rows [ptop, pbottom), pixels [pleft, pright).
    let ptop = height, pbottom = 0, pleft = width, pright = 0;
    const markPaint = (x, y, w, h) => {
        const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(width, x + w), y1 = Math.min(height, y + h);
        if (x0 >= x1 || y0 >= y1) return;
        ptop = Math.min(ptop, y0); pbottom = Math.max(pbottom, y1);
        pleft = Math.min(pleft, x0); pright = Math.max(pright, x1);
    };
    // Keyed GL window overlays (guest-gl-remote.js PresentSurface), by key:
    // {pending: newest unshown frame, x, y, element: the window's canvas,
    // rect: [x, y, w, h] it shows}. Each GL window's frames go straight to its
    // own bitmaprenderer canvas under the framebuffer canvas; the presenter
    // makes the framebuffer transparent where it shows the window's key colour
    // inside that rectangle, so stacking and the cursor stay the guest's.
    const overlays = new Map();
    const stage = canvas.parentElement ?? null;
    let overlaySupport = false, holesChanged = false, holeCount = 0;
    let renderer = null;
    let generation = 0;
    // "auto" means WebGPU. A WebGPU failure never falls back silently: the
    // display pauses (frames are still snapshotted) and the host reports
    // awaitingChoice so the page can ask the user for WebGL or Canvas2D.
    // An explicit WebGL request keeps its Canvas2D fallback.
    const backends = ["auto", "webgpu", "webgl", "canvas2d"];
    const webgpuTimeoutMs = options.webgpuTimeoutMs ?? 10000;
    const diagnostics = { backend: "canvas2d", requested: options.backend ?? "canvas2d",
        frames: 0, presents: 0, coalesced: 0, unchanged: 0, overlayFrames: 0, overlayDropped: 0, overlays: 0,
        fallbackReason: null, fallbackAdapter: null,
        failure: null, awaitingChoice: false, diff: fast ? "simd" : "js" };
    if (!backends.includes(diagnostics.requested))
        throw new Error("unknown framebuffer backend");
    const message = error => String(error?.message ?? error);
    const setBackend = backend => {
        if (!backends.includes(backend)) throw new Error("unknown framebuffer backend");
        if (closed) return Promise.resolve();
        diagnostics.requested = backend;
        return select(backend);
    };
    const publish = () => {
        // Overlays stay while a presenter restarts; a new one shows them again.
        const support = !!renderer?.setHoles && !!stage && !!globalThis.document;
        if (support !== overlaySupport) {
            overlaySupport = support;
            if (support) {
                // The underlays sit between the stage's background and the canvas.
                stage.style.isolation = "isolate";
                canvas.style.background = "transparent";
            }
            options.onOverlaySupport?.(support);
        }
        if (canvas.dataset) canvas.dataset.framebufferBackend = diagnostics.backend;
        if (canvas.dispatchEvent && globalThis.CustomEvent)
            canvas.dispatchEvent(new CustomEvent("framebuffer-backend", { detail: { ...diagnostics, setBackend } }));
    };
    const dropOverlay = key => {
        const o = overlays.get(key);
        if (!o) return;
        o.pending?.close();
        o.element?.remove();
        overlays.delete(key);
        diagnostics.overlays = overlays.size;
        if (o.rect) { markPaint(...o.rect); holesChanged = true; dirty = true; schedule_paint(); }
    };
    // Shows each overlay's newest frame and marks the framebuffer rectangles whose holes moved.
    const applyOverlays = () => {
        for (const o of overlays.values()) {
            if (!o.pending) continue;
            const bitmap = o.pending, rect = [o.x, o.y, bitmap.width, bitmap.height];
            o.pending = null;
            if (!o.element) {
                o.element = document.createElement("canvas");
                o.element.className = "gl-keyed-surface";
                Object.assign(o.element.style, { position: "absolute", zIndex: "-1", pointerEvents: "none", imageRendering: "pixelated" });
                stage.prepend(o.element);
                o.context = o.element.getContext("bitmaprenderer");
            }
            if (o.element.width !== bitmap.width) o.element.width = bitmap.width;
            if (o.element.height !== bitmap.height) o.element.height = bitmap.height;
            o.context.transferFromImageBitmap(bitmap);
            diagnostics.overlayFrames++;
            if (o.rect && o.rect.every((v, k) => v === rect[k])) continue;
            if (o.rect) markPaint(...o.rect);
            markPaint(...rect);
            o.rect = rect;
            place(o);
            holesChanged = true;
        }
    };
    // Positions an overlay's canvas over its guest root rectangle in CSS pixels,
    // clipped to the screen.
    const place = o => {
        const sx = canvas.clientWidth / width, sy = canvas.clientHeight / height, [x, y, w, h] = o.rect;
        const clip = [Math.max(0, -y) * sy, Math.max(0, x + w - width) * sx, Math.max(0, y + h - height) * sy, Math.max(0, -x) * sx];
        Object.assign(o.element.style, { left: `${canvas.offsetLeft + x * sx}px`, top: `${canvas.offsetTop + y * sy}px`,
            width: `${w * sx}px`, height: `${h * sy}px`, clipPath: `inset(${clip.map(v => `${v}px`).join(" ")})` });
    };
    const holes = () => [...overlays.values()].filter(o => o.rect)
        .map(o => ({ key: o.key, x: o.rect[0], y: o.rect[1], width: o.rect[2], height: o.rect[3] }));
    const repaint = () => { holesChanged = true; if (staging || source) { dirty = true; mark(0, height, 0, width); schedule_paint(); } };
    // Stop presenting and wait for the user; the latest frame stays pending.
    const awaitChoice = reason => {
        generation++;
        renderer?.close(); renderer = null;
        diagnostics.backend = "none";
        diagnostics.fallbackAdapter = null;
        diagnostics.failure = reason;
        diagnostics.awaitingChoice = true;
        dirty = !!staging;
        publish();
    };
    const startWebGPU = async lost => {
        const pending = createWebGPUPresenter(width, height, lost);
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`WebGPU did not start within ${webgpuTimeoutMs / 1000} s`)), webgpuTimeoutMs);
        });
        try { return await Promise.race([pending, timeout]); }
        catch (error) { pending.then(late => late.close(), () => { }); throw error; }
        finally { clearTimeout(timer); }
    };
    const select = async (backend, reason = null) => {
        const token = ++generation;
        renderer?.close(); renderer = null;
        const webgpu = backend === "auto" || backend === "webgpu";
        diagnostics.backend = webgpu ? "none" : "canvas2d";
        diagnostics.fallbackAdapter = null;
        diagnostics.fallbackReason = reason;
        diagnostics.failure = null;
        diagnostics.awaitingChoice = false;
        publish();
        if (closed) return;
        if (backend === "canvas2d") { repaint(); return; }
        const current = () => !closed && token === generation;
        const lost = reason => {
            if (!current()) return;
            if (webgpu) { awaitChoice(reason); return; }
            void select("canvas2d", reason);
        };
        if (webgpu) {
            let candidate;
            try { candidate = await startWebGPU(lost); }
            catch (error) { if (current()) awaitChoice(message(error)); return; }
            if (!current()) { candidate.close(); return; }
            renderer = candidate;
            diagnostics.backend = candidate.backend;
            diagnostics.fallbackAdapter = candidate.fallbackAdapter ?? null;
            publish();
            repaint();
            return;
        }
        let candidate;
        try { candidate = createWebGLPresenter(width, height, lost); }
        catch (error) {
            if (current()) { diagnostics.fallbackReason = message(error); publish(); repaint(); }
            return;
        }
        if (!current()) { candidate.close(); return; }
        renderer = candidate;
        diagnostics.backend = candidate.backend;
        publish();
        repaint();
    };
    const paint2d = (from = 0, to = height, x0 = 0, x1 = width) => {
        if (to <= from && image) return;
        if (!image) { image = ctx.createImageData(width, height); from = 0; to = height; x0 = 0; x1 = width; }
        swizzle_bgra_to_rgba(image.data.subarray(from * rowBytes, to * rowBytes),
            staging.subarray(from * rowBytes, to * rowBytes), width, to - from, rowBytes);
        ctx.putImageData(image, 0, 0, x0, from, x1 - x0, to - from);
    };
    // Copy rows that differ from the staging frame and widen [top, bottom) to them.
    // The kernel queues one present per main-thread turn while the guest draws, so
    // this full-frame compare runs once per animation frame, not once per present;
    // otherwise it saturates the main thread that relays every guest message.
    // The guest never waits for a present, so reading its buffer here is as
    // consistent as reading it when the present arrived, and more recent.
    const snapshot = () => {
        const pending = source;
        source = null;
        if (!pending)
            return;
        const { addr, stride } = pending;
        const bytes = memory_bytes(memory, addr, stride * (height - 1) + rowBytes);
        if (!bytes)
            return;
        // A new staging buffer holds no frame yet, so every row is copied.
        const need = rowBytes * height, fresh = !staging || staging.byteLength !== need;
        if (fast) {
            if (fresh) {
                const pages = Math.ceil(need / 65536) - fast.staging.buffer.byteLength / 65536;
                if (pages > 0) fast.staging.grow(pages);
                staging = new Uint8Array(fast.staging.buffer, 0, need);
            }
            if (!fast.diff(addr, stride, rowBytes, height, fresh ? 1 : 0)) { diagnostics.unchanged++; return; }
            mark(fast.top.value, fast.bottom.value, fast.left.value / 4, fast.right.value / 4);
            return;
        }
        if (fresh) staging = new Uint8Array(need);
        const words = width, old32 = new Uint32Array(staging.buffer, 0, need / 4);
        const aligned = bytes.byteOffset % 4 === 0 && stride % 4 === 0;
        let first = -1, last = -1, x0 = width, x1 = 0;
        for (let y = 0; y < height; y++) {
            let lo = 0, hi = width;
            if (aligned && !fresh) {
                const new32 = new Uint32Array(bytes.buffer, bytes.byteOffset + y * stride, words);
                const o = y * words;
                while (lo < words && new32[lo] === old32[o + lo]) lo++;
                if (lo === words) continue;
                while (hi > lo + 1 && new32[hi - 1] === old32[o + hi - 1]) hi--;
            }
            staging.set(bytes.subarray(y * stride + lo * 4, y * stride + hi * 4), y * rowBytes + lo * 4);
            if (first < 0) first = y;
            last = y; x0 = Math.min(x0, lo); x1 = Math.max(x1, hi);
        }
        if (first < 0) { diagnostics.unchanged++; return; }
        mark(first, last + 1, x0, x1);
    };
    const schedule_paint = () => {
        if (raf || closed)
            return;
        const request = globalThis.requestAnimationFrame ??
            ((cb) => setTimeout(cb, 16));
        raf = request(() => {
            raf = 0;
            if (closed || !dirty)
                return;
            // WebGPU is starting or failed: keep the frame for the next presenter.
            if (!renderer && diagnostics.backend === "none")
                return;
            dirty = false;
            snapshot();
            if (overlaySupport && overlays.size) applyOverlays();
            if (holesChanged && renderer?.setHoles) { const list = holes(); renderer.setHoles(list); holeCount = list.length; holesChanged = false; }
            if (!staging)
                return;
            // A backing-store resize clears the canvas even when guest bytes
            // have not changed. Restore its mode and repaint before deciding
            // that this frame can be skipped.
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width; canvas.height = height;
                mark(0, height, 0, width);
            }
            if (bottom <= top && pbottom <= ptop)
                return;
            let from = top, to = bottom, x0 = left, x1 = right, upload = bottom > top;
            // Shown: the uploaded rows plus where holes changed.
            let pfrom = Math.min(top, ptop), pto = Math.max(bottom, pbottom), px0 = Math.min(left, pleft), px1 = Math.max(right, pright);
            top = height; bottom = 0; left = width; right = 0;
            ptop = height; pbottom = 0; pleft = width; pright = 0;
            // Convert at most once per animation frame even if the guest queued
            // many presents while the main thread was busy.
            if (upload) { pfrom = Math.min(pfrom, from); pto = Math.max(pto, to); px0 = Math.min(px0, x0); px1 = Math.max(px1, x1); }
            try {
                if (renderer) {
                    // Only the changed rectangle is uploaded and copied; the canvas keeps the rest.
                    const frame = renderer.draw(staging, from, to, x0, x1, upload);
                    // The frame is transparent in holes: replace, do not blend.
                    if (holeCount) ctx.clearRect(px0, pfrom, px1 - px0, pto - pfrom);
                    try { ctx.drawImage(frame, px0, pfrom, px1 - px0, pto - pfrom, px0, pfrom, px1 - px0, pto - pfrom); }
                    finally { frame.close?.(); }
                } else paint2d(from, to, x0, x1);
            } catch (error) {
                if (diagnostics.backend === "webgpu") { awaitChoice(message(error)); return; }
                void select("canvas2d", message(error));
                paint2d();
            }
            diagnostics.frames++;
        });
    };
    const ready = select(diagnostics.requested);
    return {
        width,
        height,
        bpp,
        ready,
        get diagnostics() { return { ...diagnostics }; },
        /** Keyed GL window overlay frames from the GPU owner (guest-gl-remote.js PresentSurface). */
        overlay(frame) {
            if (frame.reset) { for (const key of [...overlays.keys()]) dropOverlay(key); return; }
            if (frame.end) { dropOverlay(frame.key); return; }
            if (!frame.bitmap) return;
            if (closed || !overlaySupport) { frame.bitmap.close(); return; }
            let o = overlays.get(frame.key);
            if (!o) {
                overlays.set(frame.key, o = { key: frame.key, pending: null, x: 0, y: 0, element: null, context: null, rect: null });
                diagnostics.overlays = overlays.size;
            }
            // Not shown yet: only the newest frame is.
            if (o.pending) { o.pending.close(); diagnostics.overlayDropped++; }
            o.pending = frame.bitmap; o.x = frame.x; o.y = frame.y;
            dirty = true;
            schedule_paint();
        },
        setBackend,
        get_mode(width_ptr, height_ptr, bpp_ptr) {
            const view = new DataView(memory.buffer);
            view.setUint32(width_ptr >>> 0, width, true);
            view.setUint32(height_ptr >>> 0, height, true);
            view.setUint32(bpp_ptr >>> 0, bpp, true);
        },
        present(addr, fb_width, fb_height, stride, fb_bpp) {
            if (closed)
                return;
            if (fb_width !== width || fb_height !== height || fb_bpp !== 32)
                return;
            if (!Number.isSafeInteger(stride) || stride < rowBytes)
                return;
            if (!memory_bytes(memory, addr >>> 0, stride * (height - 1) + rowBytes))
                return;
            source = { addr: addr >>> 0, stride };
            diagnostics.presents++;
            if (dirty) diagnostics.coalesced++;
            dirty = true;
            schedule_paint();
        },
        close() {
            closed = true;
            generation++;
            renderer?.close();
            renderer = null;
            for (const o of overlays.values()) { o.pending?.close(); o.element?.remove(); }
            overlays.clear();
            if (raf) {
                (globalThis.cancelAnimationFrame ?? clearTimeout)(raf);
                raf = 0;
            }
            dirty = false;
            source = null;
            staging = null;
        },
    };
}
/** Wasm imports for the fb module. A null host still advertises a default mode. */
export function framebuffer_imports(memory, host, defaults = {
    width: 1024,
    height: 768,
    bpp: 32,
}) {
    if (host) {
        return {
            get_mode: (w, h, b) => host.get_mode(w, h, b),
            present: (a, w, h, s, b) => host.present(a, w, h, s, b),
        };
    }
    return {
        get_mode(width_ptr, height_ptr, bpp_ptr) {
            const view = new DataView(memory.buffer);
            view.setUint32(width_ptr >>> 0, defaults.width, true);
            view.setUint32(height_ptr >>> 0, defaults.height, true);
            view.setUint32(bpp_ptr >>> 0, defaults.bpp, true);
        },
        present() {
            /* headless: discard frames */
        },
    };
}
