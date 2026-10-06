/** Minimal 2d context surface used by the presenter (canvas or offscreen). */
export type FramebufferContext2D = {
    createImageData(sw: number, sh: number): ImageData;
    putImageData(imageData: ImageData, dx: number, dy: number): void;
    drawImage?(image: CanvasImageSource, dx: number, dy: number): void;
};
export type FramebufferCanvas = {
    width: number;
    height: number;
    getContext(contextId: "2d"): FramebufferContext2D | null;
};
export interface FramebufferOptions {
    /** Target canvas. Sized to the framebuffer mode on attach. */
    canvas: FramebufferCanvas;
    /** Pixel width. Defaults to 1024. */
    width?: number;
    /** Pixel height. Defaults to 768. */
    height?: number;
    /** Bits per pixel. Only 32 (x8r8g8b8) is supported. */
    bpp?: number;
    /**
     * Host presentation only. Canvas2D remains the measured safe default.
     * "auto" and "webgpu" use WebGPU without any automatic fallback: on failure
     * the display pauses and diagnostics report awaitingChoice. Explicit WebGL
     * still falls back to Canvas2D.
     */
    backend?: "auto" | "webgpu" | "webgl" | "canvas2d";
    /** Bound on WebGPU adapter/device/pipeline start. Defaults to 10000 ms. */
    webgpuTimeoutMs?: number;
}
export interface FramebufferDiagnostics {
    /** "none" while WebGPU starts or after it failed (display paused). */
    backend: "canvas2d" | "webgl" | "webgpu" | "none";
    requested: string;
    frames: number;
    presents: number;
    coalesced: number;
    fallbackReason: string | null;
    fallbackAdapter: boolean | null;
    /** Why WebGPU presentation stopped or could not start. */
    failure: string | null;
    /** True when WebGPU failed and the user must choose another presenter. */
    awaitingChoice: boolean;
}
/** Detail of the "framebuffer-backend" event dispatched on the canvas. */
export interface FramebufferBackendEventDetail extends FramebufferDiagnostics {
    setBackend(backend: "auto" | "webgpu" | "webgl" | "canvas2d"): Promise<void>;
}
export interface FramebufferHost {
    readonly width: number;
    readonly height: number;
    readonly bpp: number;
    readonly ready: Promise<void>;
    readonly diagnostics: FramebufferDiagnostics;
    /** Switch presenter without restarting the guest; resolves once selected. */
    setBackend(backend: "auto" | "webgpu" | "webgl" | "canvas2d"): Promise<void>;
    get_mode(width_ptr: number, height_ptr: number, bpp_ptr: number): void;
    present(addr: number, width: number, height: number, stride: number, bpp: number): void;
    close(): void;
}
/**
 * Convert guest little-endian x8r8g8b8 (memory bytes B,G,R,A → u32 0xAARRGGBB)
 * into Canvas ImageData RGBA (u32 0xAABBGGRR). Alpha is forced opaque.
 *
 * Uses word-sized loads/stores; much faster than a per-channel nested loop.
 */
export declare function swizzle_bgra_to_rgba(dst: Uint8ClampedArray, src: Uint8Array, width: number, height: number, stride: number): void;
/**
 * Host-side canvas presenter for the wasm framebuffer driver.
 * Preserves the visible/input canvas; optional GPU surfaces convert guest BGRA.
 */
export declare function createFramebufferHost(memory: WebAssembly.Memory, options: FramebufferOptions): FramebufferHost;
/** Wasm imports for the fb module. A null host still advertises a default mode. */
export declare function framebuffer_imports(memory: WebAssembly.Memory, host: FramebufferHost | null, defaults?: {
    width: number;
    height: number;
    bpp: number;
}): ImportsFb;
export type ImportsFb = {
    get_mode(width_ptr: number, height_ptr: number, bpp_ptr: number): void;
    present(addr: number, width: number, height: number, stride: number, bpp: number): void;
};
