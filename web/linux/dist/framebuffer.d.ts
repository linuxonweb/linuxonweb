/** Minimal 2d context surface used by the presenter (canvas or offscreen). */
export type FramebufferContext2D = {
    createImageData(sw: number, sh: number): ImageData;
    putImageData(imageData: ImageData, dx: number, dy: number): void;
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
}
export interface FramebufferHost {
    readonly width: number;
    readonly height: number;
    readonly bpp: number;
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
 * Kernel memory is swizzled into ImageData and painted with Canvas2D.
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
