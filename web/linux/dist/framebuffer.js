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
    // Recycled staging buffer so present() does not allocate 3MiB per frame.
    let staging = null;
    const rowBytes = width * 4;
    // Rows changed since the last paint ([top, bottom)). The guest presents on every
    // wakeup, often with identical bytes; unchanged presents schedule no repaint.
    let top = 0, bottom = 0;
    let renderer = null;
    let generation = 0;
    // "auto" means WebGPU. A WebGPU failure never falls back silently: the
    // display pauses (frames are still snapshotted) and the host reports
    // awaitingChoice so the page can ask the user for WebGL or Canvas2D.
    // An explicit WebGL request keeps its Canvas2D fallback.
    const backends = ["auto", "webgpu", "webgl", "canvas2d"];
    const webgpuTimeoutMs = options.webgpuTimeoutMs ?? 10000;
    const diagnostics = { backend: "canvas2d", requested: options.backend ?? "canvas2d",
        frames: 0, presents: 0, coalesced: 0, unchanged: 0, fallbackReason: null, fallbackAdapter: null,
        failure: null, awaitingChoice: false };
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
        if (canvas.dataset) canvas.dataset.framebufferBackend = diagnostics.backend;
        if (canvas.dispatchEvent && globalThis.CustomEvent)
            canvas.dispatchEvent(new CustomEvent("framebuffer-backend", { detail: { ...diagnostics, setBackend } }));
    };
    const repaint = () => { if (staging) { dirty = true; top = 0; bottom = height; schedule_paint(); } };
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
    const paint2d = (from = 0, to = height) => {
        if (to <= from && image) return;
        if (!image) { image = ctx.createImageData(width, height); from = 0; to = height; }
        swizzle_bgra_to_rgba(image.data.subarray(from * rowBytes, to * rowBytes),
            staging.subarray(from * rowBytes, to * rowBytes), width, to - from, rowBytes);
        ctx.putImageData(image, 0, 0, 0, from, width, to - from);
    };
    const schedule_paint = () => {
        if (raf || closed)
            return;
        const request = globalThis.requestAnimationFrame ??
            ((cb) => setTimeout(cb, 16));
        raf = request(() => {
            raf = 0;
            if (closed || !dirty || !staging)
                return;
            // WebGPU is starting or failed: keep the frame for the next presenter.
            if (!renderer && diagnostics.backend === "none")
                return;
            dirty = false;
            let from = top, to = bottom;
            top = height; bottom = 0;
            // Convert at most once per animation frame even if the guest queued
            // many presents while the main thread was busy.
            // A CSS/backing-store resize must not crop or scale the guest mode;
            // it also clears the canvas, so the whole frame is drawn again.
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width; canvas.height = height;
                from = 0; to = height;
            }
            try {
                if (renderer) {
                    // Only the changed rows are uploaded and copied; the canvas keeps the rest.
                    const frame = renderer.draw(staging, from, to);
                    try { ctx.drawImage(frame, 0, from, width, to - from, 0, from, width, to - from); }
                    finally { frame.close?.(); }
                } else paint2d(from, to);
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
            const bytes = memory_bytes(memory, addr >>> 0, stride * (height - 1) + rowBytes);
            if (!bytes)
                return;
            // Snapshot out of shared memory before the guest draws again. Reuse the
            // staging allocation; only the first frame (or a mode change) allocates.
            const need = rowBytes * height, fresh = !staging || staging.byteLength !== need;
            if (fresh) {
                staging = new Uint8Array(need);
                top = 0; bottom = height;
            }
            // Copy only rows that differ, recording the changed row range. A new
            // staging buffer holds no frame yet, so every row is copied.
            const words = width, old32 = new Uint32Array(staging.buffer, 0, need / 4);
            const aligned = bytes.byteOffset % 4 === 0 && stride % 4 === 0;
            let first = -1, last = -1;
            for (let y = 0; y < height; y++) {
                const row = bytes.subarray(y * stride, y * stride + rowBytes);
                let same = aligned && !fresh;
                if (same) {
                    const new32 = new Uint32Array(bytes.buffer, bytes.byteOffset + y * stride, words);
                    for (let x = 0, o = y * words; x < words; x++)
                        if (new32[x] !== old32[o + x]) { same = false; break; }
                }
                if (same) continue;
                staging.set(row, y * rowBytes);
                if (first < 0) first = y;
                last = y;
            }
            diagnostics.presents++;
            if (first < 0) { diagnostics.unchanged++; return; }
            top = Math.min(top, first); bottom = Math.max(bottom, last + 1);
            if (dirty) diagnostics.coalesced++;
            dirty = true;
            schedule_paint();
        },
        close() {
            closed = true;
            generation++;
            renderer?.close();
            renderer = null;
            if (raf) {
                (globalThis.cancelAnimationFrame ?? clearTimeout)(raf);
                raf = 0;
            }
            dirty = false;
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
