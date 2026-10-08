// SPDX-License-Identifier: MIT
//
// Guest OpenGL ES 3.0 remoting (web/linux/tests/guest-glremote/glremote.c):
// the owner Worker replays the guest's command stream on a WebGL2 context of
// an OffscreenCanvas, so guest GLES runs on the host browser's GPU.
//
//   OP_GL_OPEN  (flags, info, cap, cookie)          -> context id > 0 | 0 (probe) | -errno
//       flags: 1 probe only, 2 alpha, 4 depth, 8 stencil. `info` receives a
//       NUL-terminated text (see openInfo). `cookie` points at 8 guest bytes
//       that stay unchanged while the context lives; contexts whose cookie is
//       in no attached guest memory any more are reclaimed.
//   OP_GL_EXEC  (ctx, cmd, bytes, reply, cap)       -> reply length | -errno
//       cmd: 32-bit words, header (op | nwords << 12) then nwords arguments,
//       ops numbered by OPS (= ops.def). Only the last command may be a query;
//       its reply is written to `reply` when it fits, the length is returned
//       either way (the guest re-sends the query alone with a larger buffer).
//   OP_GL_CLOSE (ctx)                               -> 0 | -errno
//
// Blob arguments are [bytes, mode, ...]: 0 inline words, 1 null, 2 guest
// pointer, 3 offset into the bound pixel/element buffer. Guest names are
// mapped to WebGL objects here; program/shader introspection is sent as text
// so the guest answers GetActive*/GetUniformLocation itself. Uniform locations
// are (active uniform index << 16) | array element.
//
// WebGL reserves identifiers starting with webgl_ / _webgl_, which Firefox's
// shader translator emits; they are renamed to xwebgl_ on the way in and back
// on the way out.

export const OP_GL_OPEN = 0x30;
export const OP_GL_EXEC = 0x31;
export const OP_GL_CLOSE = 0x32;

const EIO = 5, EFAULT = 14, ENODEV = 19, EINVAL = 22, EMFILE = 24, ENOSPC = 28;
const OPEN_PROBE = 1, OPEN_ALPHA = 2, OPEN_DEPTH = 4, OPEN_STENCIL = 8;
const MAX_CONTEXTS = 12;
const MAX_BYTES = 256 * 1048576;
const B_INLINE = 0, B_NULL = 1, B_POINTER = 2, B_OFFSET = 3;

// Same order as web/linux/tests/guest-glremote/ops.def (check-ops.mjs).
export const OPS = [
    "SetSurface", "GenObjects", "DeleteObjects", "ActiveTexture", "AttachShader", "BindAttribLocation", "BindBuffer",
    "BindFramebuffer", "BindRenderbuffer", "BindTexture", "BlendColor", "BlendEquation", "BlendEquationSeparate", "BlendFunc",
    "BlendFuncSeparate", "BufferData", "BufferSubData", "Clear", "ClearColor", "ClearDepthf", "ClearStencil", "ColorMask",
    "CompileShader", "CompressedTexImage2D", "CompressedTexSubImage2D", "CopyTexImage2D", "CopyTexSubImage2D",
    "CreateProgram", "CreateShader", "CullFace", "DeleteProgram", "DeleteShader", "DepthFunc", "DepthMask", "DepthRangef",
    "DetachShader", "Disable", "DisableVertexAttribArray", "DrawArrays", "DrawElements", "Enable",
    "EnableVertexAttribArray", "Finish", "Flush", "FramebufferRenderbuffer", "FramebufferTexture2D", "FrontFace",
    "GenerateMipmap", "Hint", "LineWidth", "LinkProgram", "PixelStorei", "PolygonOffset", "ReadPixels",
    "RenderbufferStorage", "SampleCoverage", "Scissor", "ShaderSource", "StencilFunc", "StencilFuncSeparate",
    "StencilMask", "StencilMaskSeparate", "StencilOp", "StencilOpSeparate", "TexImage2D", "TexParameterf",
    "TexParameteri", "TexSubImage2D", "Uniformf", "Uniformi", "Uniformui", "Uniformfv", "Uniformiv", "Uniformuiv",
    "UniformMatrixfv", "UseProgram", "ValidateProgram", "VertexAttribf", "VertexAttribPointer", "Viewport", "ReadBuffer",
    "DrawRangeElements", "TexImage3D", "TexSubImage3D", "CopyTexSubImage3D", "CompressedTexImage3D",
    "CompressedTexSubImage3D", "BeginQuery", "EndQuery", "DrawBuffers", "BlitFramebuffer",
    "RenderbufferStorageMultisample", "FramebufferTextureLayer", "BindVertexArray", "BeginTransformFeedback",
    "EndTransformFeedback", "BindBufferRange", "BindBufferBase", "TransformFeedbackVaryings", "VertexAttribIPointer",
    "VertexAttribI4i", "VertexAttribI4ui", "ClearBufferiv", "ClearBufferuiv", "ClearBufferfv", "ClearBufferfi",
    "CopyBufferSubData", "UniformBlockBinding", "DrawArraysInstanced", "DrawElementsInstanced", "BindSampler",
    "SamplerParameteri", "SamplerParameterf", "VertexAttribDivisor", "BindTransformFeedback", "PauseTransformFeedback",
    "ResumeTransformFeedback", "InvalidateFramebuffer", "InvalidateSubFramebuffer", "TexStorage2D", "TexStorage3D",
    "GetParameter", "GetIndexedParameter", "GetBufferParameter", "GetFramebufferAttachmentParameter",
    "GetRenderbufferParameter", "GetTexParameter", "GetSamplerParameter", "GetVertexAttrib", "GetVertexAttribOffset",
    "GetQuery", "GetQueryParameter", "GetUniform", "GetShaderPrecisionFormat", "GetInternalformatParameter", "GetError",
    "IsEnabled", "IsObject", "CheckFramebufferStatus", "GetFragDataLocation", "ProgramInfo", "ShaderInfo",
    "GetBufferSubData", "PresentSurface",
];

const K_PROGRAM = 8, K_SHADER = 9;
const KINDS = [
    ["createBuffer", "deleteBuffer", "isBuffer"],
    ["createTexture", "deleteTexture", "isTexture"],
    ["createFramebuffer", "deleteFramebuffer", "isFramebuffer"],
    ["createRenderbuffer", "deleteRenderbuffer", "isRenderbuffer"],
    ["createQuery", "deleteQuery", "isQuery"],
    ["createSampler", "deleteSampler", "isSampler"],
    ["createVertexArray", "deleteVertexArray", "isVertexArray"],
    ["createTransformFeedback", "deleteTransformFeedback", "isTransformFeedback"],
];

// GL enums used here (numeric: the Worker has no WebGL2RenderingContext constants before a context exists).
const GL = {
    NO_ERROR: 0, INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502,
    BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405,
    FLOAT: 0x1406, HALF_FLOAT: 0x140B, HALF_FLOAT_OES: 0x8D61, FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8DAD,
    PRIMITIVE_RESTART_FIXED_INDEX: 0x8D69, SAMPLES: 0x80A9, NUM_SAMPLE_COUNTS: 0x9380,
    COMPRESSED_TEXTURE_FORMATS: 0x86A3, NUM_COMPRESSED_TEXTURE_FORMATS: 0x86A2, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF,
    LINK_STATUS: 0x8B82, VALIDATE_STATUS: 0x8B83, DELETE_STATUS: 0x8B80, COMPILE_STATUS: 0x8B81,
    ACTIVE_ATTRIBUTES: 0x8B89, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_UNIFORM_BLOCKS: 0x8A36,
    TRANSFORM_FEEDBACK_VARYINGS: 0x8C83, TRANSFORM_FEEDBACK_BUFFER_MODE: 0x8C7F,
    UNIFORM_BLOCK_INDEX: 0x8A3A, UNIFORM_OFFSET: 0x8A3B, UNIFORM_ARRAY_STRIDE: 0x8A3C, UNIFORM_MATRIX_STRIDE: 0x8A3D,
    UNIFORM_IS_ROW_MAJOR: 0x8A3E, UNIFORM_BLOCK_BINDING: 0x8A3F, UNIFORM_BLOCK_DATA_SIZE: 0x8A40,
    UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 0x8A43, UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 0x8A44,
    UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 0x8A46, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4,
    UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246, VERSION: 0x1F02, VENDOR: 0x1F00, RENDERER: 0x1F01,
    NONE: 0, LEQUAL: 0x0203, LINEAR: 0x2601, NEAREST_MIPMAP_LINEAR: 0x2702, REPEAT: 0x2901, TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513, TEXTURE0: 0x84C0, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, TEXTURE_WRAP_R: 0x8072, TEXTURE_MIN_LOD: 0x813A, TEXTURE_MAX_LOD: 0x813B,
    TEXTURE_BASE_LEVEL: 0x813C, TEXTURE_MAX_LEVEL: 0x813D, TEXTURE_COMPARE_MODE: 0x884C, TEXTURE_COMPARE_FUNC: 0x884D,
    FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, FRAMEBUFFER_COMPLETE: 0x8CD5,
    DEPTH_STENCIL_ATTACHMENT: 0x821A, COLOR_ATTACHMENT0: 0x8CE0, TRIANGLES: 4, NEAREST: 0x2600, VIEWPORT: 0x0BA2, SCISSOR_BOX: 0x0C10,
    BLEND: 0x0BE2, SCISSOR_TEST: 0x0C11, CULL_FACE: 0x0B44, RASTERIZER_DISCARD: 0x8C89,
    ZERO: 0, ONE: 1, RED: 0x1903, GREEN: 0x1904, BLUE: 0x1905, ALPHA: 0x1906,
    RGBA8: 0x8058, RGBA16F: 0x881A, RGBA32F: 0x8814, SRGB8: 0x8C41, SRGB8_ALPHA8: 0x8C43,
    RENDERBUFFER: 0x8D41, RENDERBUFFER_BINDING: 0x8CA7, COLOR_BUFFER_BIT: 0x4000,
};

// Constant limits sent at open; the guest answers these without a roundtrip.
const LIMITS = [
    0x0D33, 0x851C, 0x84E8, 0x8073, 0x88FF, 0x8872, 0x8B4C, 0x8B4D, 0x8869, 0x8DFB, 0x8DFD, 0x8DFC, 0x8B4A, 0x8B49,
    0x8B4B, 0x9122, 0x9125, 0x8824, 0x8CDF, 0x8D57, 0x8A2F, 0x8A30, 0x8A2B, 0x8A2D, 0x8A2E, 0x8A31, 0x8A33, 0x8C8A,
    0x8C8B, 0x8C80, 0x80E8, 0x80E9, 0x84FD, 0x8D6B, 0x9111, 0x846E, 0x846D, 0x0D3A, 0x0D50, 0x8904, 0x8905, 0x8A34,
];
// WebGL extension -> GLES name advertised when the host offers it.
const EXTENSIONS = [
    ["EXT_color_buffer_float", "GL_EXT_color_buffer_float"],
    ["EXT_color_buffer_half_float", "GL_EXT_color_buffer_half_float"],
    ["OES_texture_float_linear", "GL_OES_texture_float_linear"],
    ["EXT_texture_filter_anisotropic", "GL_EXT_texture_filter_anisotropic"],
    ["EXT_float_blend", "GL_EXT_float_blend"],
    ["EXT_texture_norm16", "GL_EXT_texture_norm16"],
    ["WEBGL_compressed_texture_s3tc", "GL_EXT_texture_compression_s3tc"],
    ["WEBGL_compressed_texture_s3tc_srgb", "GL_EXT_texture_compression_s3tc_srgb"],
    ["WEBGL_compressed_texture_astc", "GL_KHR_texture_compression_astc_ldr"],
    ["WEBGL_compressed_texture_etc1", "GL_OES_compressed_ETC1_RGB8_texture"],
    ["EXT_texture_compression_rgtc", "GL_EXT_texture_compression_rgtc"],
    ["EXT_texture_compression_bptc", "GL_EXT_texture_compression_bptc"],
    ["EXT_texture_mirror_clamp_to_edge", "GL_EXT_texture_mirror_clamp_to_edge"],
    // ES 3.0 core formats WebGL2 exposes separately; nothing to advertise, uploads work when present.
    ["WEBGL_compressed_texture_etc", null],
];

class Fault extends Error {
    constructor(errno, message = "guest errno " + errno) {
        super(message);
        this.errno = errno;
    }
}

const contexts = new Map();
let nextContext = 1;
let probeResult = null;
let enabled = true, statsEnabled = false;

/** Owner config `gl`: the remote is on unless `{enabled: false}`; `{stats: true}` logs per-context call rates. */
export function configureGl(value) {
    enabled = value?.enabled !== false;
    statsEnabled = value?.stats === true;
    if (statsEnabled) {
        globalThis.__glDumpTextures = dumpTextures;
        globalThis.__glSetKeyedPresent = setKeyedPresent;
    }
}

/** Debug (?debug=1): level 0 of every 2D texture `min` to `max` wide in context `id`
 * (and its swizzle shadow) as PNG data URLs, read back without changing guest state.
 * `min` 0: only the textures WebRender drew text into or sampled glyphs from. */
async function dumpTextures(id, min = 64, max = 4096) {
    const ctx = contexts.get(id), out = [];
    if (!ctx)
        return out;
    const gl = ctx.gl, fbo = gl.createFramebuffer();
    // PACK_ALIGNMENT, PACK_ROW_LENGTH, PACK_SKIP_PIXELS, PACK_SKIP_ROWS
    const PACK_ALIGNMENT = 0x0D05, saved = [PACK_ALIGNMENT, 0x0D02, 0x0D04, 0x0D03].map((p) => [p, gl.getParameter(p)]);
    const packBuffer = gl.getParameter(0x88ED); // PIXEL_PACK_BUFFER_BINDING
    gl.bindBuffer(0x88EB, null);
    for (const [p] of saved)
        gl.pixelStorei(p, p === PACK_ALIGNMENT ? 4 : 0);
    // Keep a pending guest error for the guest's next GetError.
    const pending = gl.getError();
    if (pending)
        ctx.error ||= pending;
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, fbo);
    // Reads synchronously: guest commands run at every await and change bindings.
    const read = (texture, width, height) => {
        gl.framebufferTexture2D(GL.READ_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
        const error = gl.getError();
        if (error || !gl.isTexture(texture))
            return `attach error 0x${error.toString(16)} isTexture ${gl.isTexture(texture)}`;
        if (gl.getFramebufferAttachmentParameter(GL.READ_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, 0x8CD1) !== texture)
            return "attached another object";
        if (gl.checkFramebufferStatus(GL.READ_FRAMEBUFFER) !== 0x8CD5)
            return "incomplete";
        const pixels = new Uint8ClampedArray(width * height * 4);
        gl.readPixels(0, 0, width, height, 0x1908 /* RGBA */, GL.UNSIGNED_BYTE, pixels);
        const readError = gl.getError();
        return readError ? `read error 0x${readError.toString(16)}` : { pixels, width, height };
    };
    const encode = async (r) => {
        if (typeof r === "string" || !r)
            return r;
        const { pixels, width, height } = r;
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
        let s = "";
        for (let k = 0; k < bytes.length; k += 0x8000)
            s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        return "data:image/png;base64," + btoa(s);
    };
    for (const [name, o] of ctx.objects[1]) {
        const t = ctx.texInfo.get(o), base = t?.base;
        if (!base || (min ? base.width < min : !ctx.textTargets?.has(o)) || base.width > max || base.width * base.height > 4096 * 4096)
            continue;
        out.push({ name, ...base, swizzle: t.swizzle, image: read(o, base.width, base.height),
            shadow: t.shadow ? read(t.shadow.texture, t.shadow.width, t.shadow.height) : null, dirty: t.dirty ?? null });
    }
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, ctx.fbBound.get(GL.READ_FRAMEBUFFER) ?? null);
    gl.deleteFramebuffer(fbo);
    for (const [p, v] of saved)
        gl.pixelStorei(p, v);
    gl.bindBuffer(0x88EB, packBuffer);
    if (ctx.textDraws)
        out.push({ name: "textDraws", draws: Object.fromEntries(ctx.textDraws) });
    for (const t of out) {
        t.image = await encode(t.image);
        t.shadow = await encode(t.shadow);
    }
    return out;
}

// Keyed window presentation. The guest paints a window surface's visible
// pixels in the guest framebuffer with a key colour, and the page's
// framebuffer presenter shows the context's canvas wherever it finds that
// colour. Each swap then posts the canvas as an ImageBitmap to the page
// ("gpu-present" with keyed: true) instead of reading it back to the guest.
// Only while the page says its presenter can do it; each live key belongs to
// one context, and the presenter has room for KEYS.length of them.
const KEYS = [0xfe01fd, 0x01fe02, 0xfd02fc, 0x02fd01];
const PRESENT_END = 1;
let keyedSink = false;
const keyOwners = new Map(); // key -> context
/** Page presenter state (guest-gpu-owner.js): keyed overlays can be shown or not. */
export function setKeyedPresent(on) {
    keyedSink = !!on && typeof globalThis.postMessage === "function";
    if (!keyedSink)
        for (const ctx of [...keyOwners.values()])
            endKeyed(ctx, false);
}
function endKeyed(ctx, notify = true) {
    if (!ctx.key)
        return;
    if (notify && keyedSink)
        globalThis.postMessage({ type: "gpu-present", keyed: true, key: ctx.key, end: true });
    keyOwners.delete(ctx.key);
    ctx.key = 0;
}

const encoder = new TextEncoder(), decoder = new TextDecoder();
const toHost = (text) => text.replace(/\b(_?)webgl_/g, "$1xwebgl_");
const toGuest = (text) => text.replace(/\b(_?)xwebgl_/g, "$1webgl_");

function bytesAt(memory, pointer, length) {
    const buffer = memory.buffer;
    pointer >>>= 0;
    length >>>= 0;
    if (length > MAX_BYTES)
        throw new Fault(EINVAL);
    if ((length && !pointer) || pointer + length > buffer.byteLength)
        throw new Fault(EFAULT);
    return new Uint8Array(buffer, pointer, length);
}

function typedClass(type) {
    switch (type) {
        case GL.BYTE: return Int8Array;
        case GL.UNSIGNED_BYTE: return Uint8Array;
        case GL.SHORT: return Int16Array;
        case GL.INT: return Int32Array;
        case GL.FLOAT: return Float32Array;
        case GL.UNSIGNED_SHORT: case GL.HALF_FLOAT: case GL.HALF_FLOAT_OES:
        case 0x8363: case 0x8033: case 0x8034: return Uint16Array;
        default: return Uint32Array; // UNSIGNED_INT and the packed 32-bit types
    }
}

/** View of guest bytes as `Type` (aligned and, when WebGL refuses shared memory, copied). */
function typed(ctx, bytes, Type) {
    const size = Type.BYTES_PER_ELEMENT;
    if (ctx.copyShared || bytes.byteOffset % size) {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return new Type(copy.buffer, 0, Math.floor(bytes.byteLength / size));
    }
    return new Type(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / size));
}

/** Output view: writes land in guest memory directly, or through `finish()` when copied. */
function outTyped(ctx, bytes, Type) {
    const size = Type.BYTES_PER_ELEMENT;
    if (ctx.copyShared || bytes.byteOffset % size) {
        const copy = new Uint8Array(bytes.byteLength);
        return { view: new Type(copy.buffer, 0, Math.floor(bytes.byteLength / size)), finish: () => bytes.set(copy) };
    }
    return { view: new Type(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / size)), finish() { } };
}

function text(bytes) {
    return decoder.decode(bytes.slice());
}

function probe() {
    if (probeResult === null) {
        probeResult = false;
        try {
            if (typeof OffscreenCanvas === "function") {
                const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
                probeResult = !!gl;
                gl?.getExtension("WEBGL_lose_context")?.loseContext();
            }
        }
        catch {
            probeResult = false;
        }
    }
    return probeResult;
}

function alive(ctx, memories) {
    if (!ctx.cookiePointer)
        return true;
    for (const memory of memories) {
        const buffer = memory.buffer;
        if (ctx.cookiePointer + 8 > buffer.byteLength)
            continue;
        const bytes = new Uint8Array(buffer, ctx.cookiePointer, 8);
        let same = true;
        for (let i = 0; i < 8 && same; i++)
            same = bytes[i] === ctx.cookie[i];
        if (same)
            return true;
    }
    return false;
}

function closeContext(id, log, why) {
    const ctx = contexts.get(id);
    if (!ctx)
        return false;
    contexts.delete(id);
    endKeyed(ctx);
    log?.(`gl context ${id} closed (${why}): execs=${ctx.execs} commands=${ctx.commands}`);
    try {
        ctx.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    catch { }
    return true;
}

function openInfo(gl, ctx) {
    const lines = [];
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = debug ? gl.getParameter(GL.UNMASKED_VENDOR_WEBGL) : gl.getParameter(GL.VENDOR);
    const renderer = debug ? gl.getParameter(GL.UNMASKED_RENDERER_WEBGL) : gl.getParameter(GL.RENDERER);
    ctx.identity = `${renderer}`;
    lines.push(`version OpenGL ES 3.0 glremote (${gl.getParameter(GL.VERSION)})`);
    lines.push(`renderer Host WebGL2 (${renderer})`);
    lines.push(`vendor glremote (${vendor})`);
    lines.push("glsl OpenGL ES GLSL ES 3.00");
    lines.push("present keyed");
    const names = [];
    for (const [webgl, gles] of EXTENSIONS)
        if (gl.getExtension(webgl) && gles)
            names.push(gles);
    lines.push(`ext ${names.join(" ")}`);
    const limits = [...LIMITS];
    if (names.includes("GL_EXT_texture_filter_anisotropic"))
        limits.push(GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    for (const pname of limits) {
        const values = numbers(ctx, gl.getParameter(pname));
        if (values.length)
            lines.push(`p ${pname} ${values.join(" ")}`);
    }
    const formats = numbers(ctx, gl.getParameter(GL.COMPRESSED_TEXTURE_FORMATS));
    lines.push(`p ${GL.COMPRESSED_TEXTURE_FORMATS} ${formats.join(" ")}`);
    lines.push(`p ${GL.NUM_COMPRESSED_TEXTURE_FORMATS} ${formats.length}`);
    while (gl.getError()) { }
    return lines.join("\n") + "\n";
}

function open(memory, a, log, memories) {
    const flags = a[0] >>> 0;
    if (!enabled || !probe())
        throw new Fault(ENODEV);
    if (flags & OPEN_PROBE)
        return 0;
    if (contexts.size >= MAX_CONTEXTS)
        for (const [id, ctx] of [...contexts])
            if (!alive(ctx, memories))
                closeContext(id, log, "guest gone");
    if (contexts.size >= MAX_CONTEXTS)
        throw new Fault(EMFILE);
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2", {
        alpha: !!(flags & OPEN_ALPHA), depth: !!(flags & OPEN_DEPTH), stencil: !!(flags & OPEN_STENCIL),
        antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance",
    });
    if (!gl)
        throw new Fault(ENODEV);
    const id = nextContext++;
    const ctx = {
        id, gl, canvas, lost: false, error: 0, key: 0, copyShared: false, execs: 0, commands: 0, failures: 0,
        objects: Array.from({ length: K_PROGRAM + 1 }, () => new Map()), names: new WeakMap(),
        programs: new WeakMap(), program: null, cookiePointer: 0, cookie: null, memory: null, cmdPointer: 0,
        w: null, i32: null, f32: null, warned: new Set(), log,
        texUnit: 0, texBound: new Map(), texInfo: new WeakMap(), fbBound: new Map(), fbAttach: new WeakMap(), fbComplex: new WeakMap(), texPool: [], complete: new Set(),
        // State the texture swizzle pass changes and puts back (see swizzledDraw).
        caps: new Map(), viewport: Array.from(gl.getParameter(GL.VIEWPORT)), scissorBox: Array.from(gl.getParameter(GL.SCISSOR_BOX)),
        colorMask: [true, true, true, true], vao: null, samplers: new Map(), feedback: false, swizzled: new Set(), swizzlePass: null, shadowed: false,
        stats: { start: performance.now(), execs: 0, replies: 0, ms: 0, ops: new Uint32Array(OPS.length + 1), opMs: new Float64Array(OPS.length + 1), texReuse: 0,
            errorAfter: new Uint32Array(OPS.length + 1) },
    };
    canvas.addEventListener?.("webglcontextlost", (event) => {
        event.preventDefault();
        ctx.lost = true;
        log(`gl context ${id} lost`);
    });
    try {
        const probeBuffer = gl.createBuffer();
        gl.bindBuffer(GL.ARRAY_BUFFER, probeBuffer);
        gl.bufferData(GL.ARRAY_BUFFER, new Uint8Array(new SharedArrayBuffer(4)), GL.STATIC_DRAW);
        gl.bindBuffer(GL.ARRAY_BUFFER, null);
        gl.deleteBuffer(probeBuffer);
    }
    catch {
        ctx.copyShared = true;
    }
    const info = encoder.encode(openInfo(gl, ctx));
    if (info.length + 1 > a[2] >>> 0) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        throw new Fault(ENOSPC);
    }
    const out = bytesAt(memory, a[1], info.length + 1);
    out.set(info);
    out[info.length] = 0;
    if (a[3] >>> 0) {
        ctx.cookiePointer = a[3] >>> 0;
        ctx.cookie = bytesAt(memory, ctx.cookiePointer, 8).slice();
    }
    contexts.set(id, ctx);
    log(`gl context ${id} open: ${ctx.identity}${ctx.copyShared ? " (copying shared memory)" : ""}`);
    return id;
}

export function handleGlCall(memory, op, a, log, memories = []) {
    switch (op) {
        case OP_GL_OPEN:
            return open(memory, a, log, memories);
        case OP_GL_CLOSE:
            if (!closeContext(a[0] >>> 0, log, "guest close"))
                throw new Fault(EINVAL);
            return 0;
        case OP_GL_EXEC: {
            const ctx = contexts.get(a[0] >>> 0);
            if (!ctx)
                throw new Fault(EINVAL);
            if (ctx.lost || ctx.gl.isContextLost())
                throw new Fault(EIO);
            return exec(ctx, memory, a[1] >>> 0, a[2] >>> 0, a[3] >>> 0, a[4] >>> 0);
        }
        default:
            throw new Fault(EINVAL);
    }
}

// ---- execution ----

function exec(ctx, memory, pointer, length, replyPointer, capacity) {
    if (pointer & 3 || length & 3)
        throw new Fault(EINVAL);
    const bytes = bytesAt(memory, pointer, length);
    const words = length >>> 2;
    ctx.memory = memory;
    ctx.cmdPointer = pointer;
    ctx.w = new Uint32Array(bytes.buffer, pointer, words);
    ctx.i32 = new Int32Array(bytes.buffer, pointer, words);
    ctx.f32 = new Float32Array(bytes.buffer, pointer, words);
    ctx.execs++;
    const stats = statsEnabled ? ctx.stats : null, started = stats && performance.now();
    let reply = null, previous = 0;
    for (let i = 0; i < words;) {
        const header = ctx.w[i];
        const op = header & 0xfff, n = header >>> 12;
        if (i + 1 + n > words || !op || op > OPS.length)
            throw new Fault(EINVAL);
        ctx.commands++;
        if (stats) {
            const t = performance.now();
            reply = run(ctx, op, i + 1, n);
            stats.ops[op]++;
            stats.opMs[op] += performance.now() - t;
            if (OPS[op - 1] === "GetError")
                stats.errorAfter[previous]++;
            previous = op;
        }
        else
            reply = run(ctx, op, i + 1, n);
        i += 1 + n;
    }
    if (stats) {
        const ended = performance.now();
        stats.execs++;
        stats.ms += ended - started;
        if (reply)
            stats.replies++;
        if (ended - stats.start >= 5000)
            reportStats(ctx, ended);
    }
    if (!reply)
        return 0;
    if (reply.length <= capacity)
        bytesAt(memory, replyPointer, reply.length).set(reply);
    return reply.length;
}

// Every 5 s of activity: calls per second, host GL time and the busiest ops.
function reportStats(ctx, now) {
    const stats = ctx.stats, seconds = (now - stats.start) / 1000;
    const top = [...stats.ops].map((count, op) => [count, op]).filter(([count]) => count).sort((x, y) => y[0] - x[0]).slice(0, 8)
        .map(([count, op]) => `${OPS[op - 1]}=${(count / seconds).toFixed(0)}`).join(" ");
    const slow = [...stats.opMs].map((ms, op) => [ms, op]).filter(([ms]) => ms >= 1).sort((x, y) => y[0] - x[0]).slice(0, 6)
        .map(([ms, op]) => `${OPS[op - 1]}=${(ms / seconds).toFixed(1)}`).join(" ");
    // The op before each GetError in its batch ("batch" when GetError starts one).
    const errorAfter = [...stats.errorAfter].map((count, op) => [count, op]).filter(([count]) => count).sort((x, y) => y[0] - x[0]).slice(0, 6)
        .map(([count, op]) => `${op ? OPS[op - 1] : "batch"}=${(count / seconds).toFixed(0)}`).join(" ");
    ctx.log(`gl context ${ctx.id} stats ${seconds.toFixed(1)}s: execs/s=${(stats.execs / seconds).toFixed(1)} ` +
        `sync/s=${(stats.replies / seconds).toFixed(1)} host-gl-ms/s=${(stats.ms / seconds).toFixed(1)} tex-reuse/s=${(stats.texReuse / seconds).toFixed(1)} ops/s: ${top} ms/s: ${slow}` +
        (errorAfter ? ` GetError after: ${errorAfter}` : ""));
    stats.start = now;
    stats.execs = stats.replies = stats.ms = stats.texReuse = 0;
    stats.ops.fill(0);
    stats.opMs.fill(0);
    stats.errorAfter.fill(0);
}

function run(ctx, op, i, n) {
    const handler = HANDLERS[op];
    try {
        return handler(ctx, i, n) ?? null;
    }
    catch (error) {
        if (error instanceof Fault && error.errno === EFAULT)
            throw error;
        if (!ctx.copyShared && error instanceof TypeError && /shared/i.test(String(error.message))) {
            ctx.copyShared = true;
            ctx.log(`gl context ${ctx.id}: WebGL refuses shared memory views, copying`);
            return run(ctx, op, i, n);
        }
        if (!ctx.error)
            ctx.error = error instanceof TypeError || error instanceof RangeError ? GL.INVALID_VALUE : GL.INVALID_OPERATION;
        if (ctx.failures++ < 20)
            ctx.log(`gl context ${ctx.id}: ${OPS[op - 1]} failed: ${error?.message ?? error}`);
        return null;
    }
}

// Blob at word index i: {mode, bytes, pointer|offset}.
function blob(ctx, i) {
    const bytes = ctx.w[i], mode = ctx.w[i + 1];
    if (mode === B_INLINE)
        return { mode, bytes, data: bytesAt(ctx.memory, ctx.cmdPointer + (i + 2) * 4, bytes) };
    if (mode === B_POINTER)
        return { mode, bytes, data: bytesAt(ctx.memory, ctx.w[i + 2], bytes) };
    if (mode === B_OFFSET)
        return { mode, bytes, offset: ctx.w[i + 2] };
    return { mode: B_NULL, bytes };
}
function blobText(ctx, i) {
    const b = blob(ctx, i);
    return b.data ? text(b.data) : "";
}
// Pixel/data source for uploads: a typed view, a pixel-unpack offset or null.
function source(ctx, b, type) {
    if (b.mode === B_OFFSET)
        return b.offset;
    if (b.mode === B_NULL)
        return null;
    return typed(ctx, b.data, typedClass(type));
}
const hostType = (type) => type === GL.HALF_FLOAT_OES ? GL.HALF_FLOAT : type;

function object(ctx, kind, name) {
    if (!name)
        return null;
    const map = ctx.objects[kind >= K_PROGRAM ? K_PROGRAM : kind];
    let o = map.get(name);
    if (!o && kind < K_PROGRAM) {
        // GL lets buffers/textures/framebuffers/renderbuffers be bound by an ungenerated name.
        o = ctx.gl[KINDS[kind][0]]();
        map.set(name, o);
        ctx.names.set(o, name);
    }
    return o ?? null;
}
const programOf = (ctx, name) => object(ctx, K_PROGRAM, name);

function warnOnce(ctx, key, message) {
    if (ctx.warned.has(key))
        return;
    ctx.warned.add(key);
    ctx.log(`gl context ${ctx.id}: ${message}`);
}

// Uniform locations: (index << 16) | element against the program's active uniforms.
function programRecord(ctx, program) {
    let record = ctx.programs.get(program);
    if (!record) {
        record = { locations: new Map(), names: [] };
        ctx.programs.set(program, record);
    }
    return record;
}
function location(ctx, program, value) {
    if (!program || value === -1)
        return null;
    const record = programRecord(ctx, program);
    let loc = record.locations.get(value);
    if (loc === undefined) {
        const index = value >>> 16, element = value & 0xffff;
        let name = record.names[index];
        if (name === undefined)
            name = record.names[index] = ctx.gl.getActiveUniform(program, index)?.name ?? null;
        loc = null;
        if (name !== null) {
            const base = name.endsWith("[0]") ? name.slice(0, -3) : name;
            loc = ctx.gl.getUniformLocation(program, element ? `${base}[${element}]` : name);
        }
        record.locations.set(value, loc);
    }
    return loc;
}

// Numeric replies: [u32 count][u32 0][f64 values].
function numbers(ctx, value) {
    if (value === null || value === undefined)
        return [0];
    if (typeof value === "number")
        return [value];
    if (typeof value === "boolean")
        return [value ? 1 : 0];
    if (typeof value === "object" && (ArrayBuffer.isView(value) || Array.isArray(value)))
        return Array.from(value, (v) => typeof v === "boolean" ? (v ? 1 : 0) : Number(v));
    if (typeof value === "object")
        return [ctx.names.get(value) ?? 0];
    return [];
}
function numberReply(values) {
    const out = new Uint8Array(8 + values.length * 8);
    const view = new DataView(out.buffer);
    view.setUint32(0, values.length, true);
    values.forEach((v, k) => view.setFloat64(8 + k * 8, v, true));
    return out;
}
const reply = (ctx, value) => numberReply(numbers(ctx, value));

function programInfo(ctx, name) {
    const gl = ctx.gl, program = programOf(ctx, name);
    if (!(program instanceof WebGLProgram))
        return "link 0\nvalidate 0\ndeleted 1\nattached 0\nlog 0\n\n";
    const lines = [];
    const p = (pname) => gl.getProgramParameter(program, pname);
    const linked = !!p(GL.LINK_STATUS);
    lines.push(`link ${linked ? 1 : 0}`, `validate ${p(GL.VALIDATE_STATUS) ? 1 : 0}`, `deleted ${p(GL.DELETE_STATUS) ? 1 : 0}`);
    const attached = (gl.getAttachedShaders(program) ?? []).map((s) => ctx.names.get(s) ?? 0);
    lines.push(`attached ${attached.length}${attached.map((s) => " " + s).join("")}`);
    const log = toGuest(gl.getProgramInfoLog(program) ?? "");
    const logBytes = encoder.encode(log);
    lines.push(`log ${logBytes.length}`);
    const tail = [];
    if (linked) {
        for (let k = 0, count = p(GL.ACTIVE_ATTRIBUTES); k < count; k++) {
            const info = gl.getActiveAttrib(program, k);
            if (info)
                tail.push(`a ${info.size} ${info.type} ${gl.getAttribLocation(program, info.name)} ${toGuest(info.name)}`);
        }
        const count = p(GL.ACTIVE_UNIFORMS);
        const indices = Array.from({ length: count }, (_, k) => k);
        const field = (pname) => count ? gl.getActiveUniforms(program, indices, pname) : [];
        const block = field(GL.UNIFORM_BLOCK_INDEX), offset = field(GL.UNIFORM_OFFSET);
        const astride = field(GL.UNIFORM_ARRAY_STRIDE), mstride = field(GL.UNIFORM_MATRIX_STRIDE);
        const rowMajor = field(GL.UNIFORM_IS_ROW_MAJOR);
        const record = programRecord(ctx, program);
        for (let k = 0; k < count; k++) {
            const info = gl.getActiveUniform(program, k);
            record.names[k] = info?.name ?? null;
            tail.push(`u ${info?.size ?? 0} ${info?.type ?? 0} ${block[k]} ${offset[k]} ${astride[k]} ${mstride[k]} ${rowMajor[k] ? 1 : 0} ${toGuest(info?.name ?? "")}`);
        }
        for (let k = 0, blocks = p(GL.ACTIVE_UNIFORM_BLOCKS); k < blocks; k++) {
            const b = (pname) => gl.getActiveUniformBlockParameter(program, k, pname);
            const members = Array.from(b(GL.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES) ?? []);
            tail.push(`b ${b(GL.UNIFORM_BLOCK_BINDING)} ${b(GL.UNIFORM_BLOCK_DATA_SIZE)} ${b(GL.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER) ? 1 : 0} ` +
                `${b(GL.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER) ? 1 : 0} ${members.length}${members.map((m) => " " + m).join("")} ` +
                toGuest(gl.getActiveUniformBlockName(program, k) ?? ""));
        }
        for (let k = 0, count = p(GL.TRANSFORM_FEEDBACK_VARYINGS); k < count; k++) {
            const info = gl.getTransformFeedbackVarying(program, k);
            if (info)
                tail.push(`v ${info.size} ${info.type} ${toGuest(info.name)}`);
        }
    }
    tail.push(`tf ${p(GL.TRANSFORM_FEEDBACK_BUFFER_MODE) ?? 0}`);
    return [lines.join("\n") + "\n", logBytes, "\n" + tail.join("\n") + "\n"];
}

function shaderInfo(ctx, name) {
    const gl = ctx.gl, shader = programOf(ctx, name);
    if (!(shader instanceof WebGLShader))
        return ["compile 0\ndeleted 1\nlog 0\n", new Uint8Array(), "\n"];
    const logBytes = encoder.encode(toGuest(gl.getShaderInfoLog(shader) ?? ""));
    return [`compile ${gl.getShaderParameter(shader, GL.COMPILE_STATUS) ? 1 : 0}\ndeleted ${gl.getShaderParameter(shader, GL.DELETE_STATUS) ? 1 : 0}\nlog ${logBytes.length}\n`, logBytes, "\n"];
}
function textReply(parts) {
    const chunks = parts.map((part) => typeof part === "string" ? encoder.encode(part) : part);
    const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.length;
    }
    return out;
}

// Texture recycling. Firefox's WebGL swap chain creates and deletes a canvas-sized
// texture every frame, and each host allocation makes ANGLE create a new image that the
// next sync call waits for. A deleted single-level 2D texture that no framebuffer holds
// is kept per shape and reused by the next null-data level-0 TexImage2D of that shape
// into a texture with no image yet; GLES leaves those contents undefined.
const TEX_POOL_LIMIT = 6;
const TEX_DEFAULTS = new Map([
    [GL.TEXTURE_MIN_FILTER, [false, GL.NEAREST_MIPMAP_LINEAR]], [GL.TEXTURE_MAG_FILTER, [false, GL.LINEAR]],
    [GL.TEXTURE_WRAP_S, [false, GL.REPEAT]], [GL.TEXTURE_WRAP_T, [false, GL.REPEAT]], [GL.TEXTURE_WRAP_R, [false, GL.REPEAT]],
    [GL.TEXTURE_MIN_LOD, [true, -1000]], [GL.TEXTURE_MAX_LOD, [true, 1000]], [GL.TEXTURE_BASE_LEVEL, [false, 0]],
    [GL.TEXTURE_MAX_LEVEL, [false, 1000]], [GL.TEXTURE_COMPARE_MODE, [false, GL.NONE]], [GL.TEXTURE_COMPARE_FUNC, [false, GL.LEQUAL]],
]);
const CUBE_FACES = new Set([0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851A]);
const bindingKey = (ctx, target) => ctx.texUnit * 0x10000 + (CUBE_FACES.has(target) ? GL.TEXTURE_CUBE_MAP : target);
function texInfo(ctx, o) {
    let t = ctx.texInfo.get(o);
    if (!t)
        ctx.texInfo.set(o, t = { fresh: true, shape: null, params: new Map() });
    return t;
}
const boundTexture = (ctx, target) => ctx.texBound.get(bindingKey(ctx, target)) ?? null;
/** Any image definition other than one level-0 2D image makes the texture ineligible. */
function texDefined(ctx, target) {
    const o = boundTexture(ctx, target);
    if (o)
        Object.assign(texInfo(ctx, o), { fresh: false, shape: null });
}
function attached(ctx, o) {
    for (const fb of ctx.objects[2].values())
        for (const a of ctx.fbAttach.get(fb)?.values() ?? [])
            if (a === o)
                return true;
    for (const fb of ctx.fbBound.values())
        for (const a of ctx.fbAttach.get(fb)?.values() ?? [])
            if (a === o)
                return true;
    return false;
}
/** `simple`: level 0 of a 2D texture; anything else keeps the framebuffer's status uncached. */
function attach(ctx, target, attachment, o, simple) {
    const fb = ctx.fbBound.get(target === GL.READ_FRAMEBUFFER ? GL.READ_FRAMEBUFFER : GL.DRAW_FRAMEBUFFER);
    if (!fb)
        return;
    let map = ctx.fbAttach.get(fb), complex = ctx.fbComplex.get(fb);
    if (!map) {
        ctx.fbAttach.set(fb, map = new Map());
        ctx.fbComplex.set(fb, complex = new Set());
    }
    if (o)
        map.set(attachment, o);
    else
        map.delete(attachment);
    // DEPTH_STENCIL_ATTACHMENT also replaces the depth and stencil points.
    if (attachment === GL.DEPTH_STENCIL_ATTACHMENT)
        complex.add(-1);
    else if (o && !simple)
        complex.add(attachment);
    else
        complex.delete(attachment);
    if (o instanceof WebGLTexture)
        texInfo(ctx, o).fresh = false;
}
function unbindTexture(ctx, o) {
    for (const [key, bound] of ctx.texBound) {
        if (bound !== o)
            continue;
        ctx.gl.activeTexture(GL.TEXTURE0 + (key >>> 16));
        ctx.gl.bindTexture(key & 0xffff, null);
        ctx.texBound.delete(key);
    }
    ctx.gl.activeTexture(GL.TEXTURE0 + ctx.texUnit);
}
function poolTexture(ctx, o) {
    const t = ctx.texInfo.get(o);
    if (!t?.shape || t.swizzle || t.shadow || attached(ctx, o) || [...t.params.keys()].some((p) => !TEX_DEFAULTS.has(p)))
        return false;
    unbindTexture(ctx, o);
    ctx.texPool.push({ shape: t.shape, o });
    if (ctx.texPool.length > TEX_POOL_LIMIT)
        ctx.gl.deleteTexture(ctx.texPool.shift().o);
    return true;
}
/** Replace the bound fresh texture `o` with a pooled one of `shape`; true when done. */
function reuseTexture(ctx, target, o, shape) {
    const k = ctx.texPool.findIndex((e) => e.shape === shape);
    if (k < 0 || attached(ctx, o) || [...ctx.texBound.values()].filter((b) => b === o).length !== 1)
        return false;
    const p = ctx.texPool.splice(k, 1)[0].o, name = ctx.names.get(o), t = texInfo(ctx, o), pt = texInfo(ctx, p);
    ctx.objects[1].set(name, p);
    ctx.names.set(p, name);
    ctx.gl.bindTexture(target, p);
    ctx.texBound.set(bindingKey(ctx, target), p);
    ctx.gl.deleteTexture(o);
    ctx.texInfo.delete(o);
    for (const [pname, [float, value]] of new Map([...[...pt.params.keys()].filter((q) => !t.params.has(q)).map((q) => [q, TEX_DEFAULTS.get(q)]), ...t.params]))
        float ? ctx.gl.texParameterf(target, pname, value) : ctx.gl.texParameteri(target, pname, value);
    Object.assign(pt, { fresh: false, shape, params: t.params });
    ctx.stats.texReuse++;
    return true;
}

// Texture swizzle. WebGL2 has no TEXTURE_SWIZZLE_*; WebRender on GLES keeps BGRA
// images in RGBA textures and swizzles them when sampling. A texture with a
// non-identity swizzle gets a shadow texture holding its level 0 with the swizzle
// applied, which is bound in its place for draws. The shadow is redrawn from the
// texture, over the changed region only, before a draw that needs it. Only 2D
// textures with a known level-0 format other than integer or depth formats are
// emulated; others warn once and sample unswizzled.
const SWIZZLE_SLOT = new Map([[0x8E42, 0], [0x8E43, 1], [0x8E44, 2], [0x8E45, 3]]);
const SWIZZLE_IDENTITY = [GL.RED, GL.GREEN, GL.BLUE, GL.ALPHA];
const SWIZZLE_VALUES = new Set([GL.RED, GL.GREEN, GL.BLUE, GL.ALPHA, GL.ZERO, GL.ONE]);
const INTEGER_FORMATS = new Set([0x8231, 0x8232, 0x8233, 0x8234, 0x8235, 0x8236, 0x8237, 0x8238, 0x8239, 0x823A, 0x823B, 0x823C,
    0x8D70, 0x8D71, 0x8D76, 0x8D77, 0x8D7C, 0x8D7D, 0x8D82, 0x8D83, 0x8D88, 0x8D89, 0x8D8E, 0x8D8F, 0x906F,
    0x8D94, 0x8D95, 0x8D96, 0x8D97, 0x8D98, 0x8D99]);
const DEPTH_FORMATS = new Set([0x1902, 0x84F9, 0x81A5, 0x81A6, 0x81A7, 0x8CAC, 0x88F0, 0x8CAD, 0x1901, 0x8D48]);
const FLOAT32_FORMATS = new Set([0x822E, 0x8230, 0x8815, 0x8814, 0x8F94, 0x8F95, 0x8F96, 0x8F97]);
const FLOAT16_FORMATS = new Set([0x822D, 0x822F, 0x881B, 0x881A, 0x8C3A, 0x8C3D, 0x8059]);
/** Colour-renderable format holding every value of `format` exactly enough, or 0. */
function shadowFormat(ctx, format, type) {
    if (INTEGER_FORMATS.has(format) || DEPTH_FORMATS.has(format))
        return 0;
    if (format === GL.SRGB8 || format === GL.SRGB8_ALPHA8)
        return GL.SRGB8_ALPHA8;
    const wide = FLOAT32_FORMATS.has(format) || type === GL.FLOAT ? GL.RGBA32F
        : FLOAT16_FORMATS.has(format) || type === GL.HALF_FLOAT || type === GL.HALF_FLOAT_OES ? GL.RGBA16F : 0;
    if (!wide)
        return GL.RGBA8;
    return ctx.gl.getExtension("EXT_color_buffer_float") ? wide : 0;
}
/** Level 0 of the 2D texture bound to `target` now has this format and size. */
function defineLevel0(ctx, target, level, format, type, width, height) {
    const o = target === GL.TEXTURE_2D && level === 0 ? boundTexture(ctx, target) : null;
    if (!o)
        return;
    const t = texInfo(ctx, o);
    t.base = { format, type, width, height };
    if (t.shadow)
        t.dirty = { x0: 0, y0: 0, x1: width, y1: height };
}
/** A region of level 0 of the texture bound to `target` changed. */
function touchLevel0(ctx, target, level, x, y, width, height) {
    const o = target === GL.TEXTURE_2D && level === 0 ? boundTexture(ctx, target) : null;
    const t = o && ctx.texInfo.get(o);
    if (!t?.shadow || width <= 0 || height <= 0)
        return;
    const d = t.dirty;
    t.dirty = d ? { x0: Math.min(d.x0, x), y0: Math.min(d.y0, y), x1: Math.max(d.x1, x + width), y1: Math.max(d.y1, y + height) }
        : { x0: x, y0: y, x1: x + width, y1: y + height };
}
/** Drawing into the draw framebuffer changes whatever textures it holds. */
function renderedTo(ctx) {
    if (!ctx.swizzled.size && !ctx.shadowed)
        return;
    const fb = ctx.fbBound.get(GL.DRAW_FRAMEBUFFER);
    for (const o of (fb && ctx.fbAttach.get(fb)?.values()) ?? []) {
        const t = o instanceof WebGLTexture && ctx.texInfo.get(o);
        if (t?.shadow && t.base)
            t.dirty = { x0: 0, y0: 0, x1: t.base.width, y1: t.base.height };
    }
}
function swizzleParameter(ctx, target, slot, value) {
    if (!SWIZZLE_VALUES.has(value)) {
        ctx.error ||= GL.INVALID_ENUM;
        return;
    }
    const o = boundTexture(ctx, target);
    if (!o)
        return warnOnce(ctx, "swizzle-default", "texture swizzle on the default texture is ignored");
    if (target !== GL.TEXTURE_2D)
        warnOnce(ctx, "swizzle-target", `texture swizzle is emulated for 2D textures only; target 0x${target.toString(16)} samples unswizzled`);
    const t = texInfo(ctx, o), swizzle = [...(t.swizzle ?? SWIZZLE_IDENTITY)];
    swizzle[slot] = value;
    t.swizzle = swizzle.every((v, k) => v === SWIZZLE_IDENTITY[k]) ? null : swizzle;
    t.swizzle ? ctx.swizzled.add(o) : ctx.swizzled.delete(o);
}
function swizzlePass(ctx) {
    if (ctx.swizzlePass !== null)
        return ctx.swizzlePass;
    const gl = ctx.gl, program = gl.createProgram();
    const stage = (type, text) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
    };
    stage(0x8B31, "#version 300 es\nvoid main() {\n  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}\n");
    stage(0x8B30, "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\nuniform sampler2D s;\nuniform mat4 m;\nuniform vec4 k;\nout vec4 o;\n" +
        "void main() { o = m * texelFetch(s, ivec2(gl_FragCoord.xy), 0) + k; }\n");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
        warnOnce(ctx, "swizzle-pass", `texture swizzle pass failed to link: ${gl.getProgramInfoLog(program)}`);
        gl.deleteProgram(program);
        return ctx.swizzlePass = false;
    }
    const sampler = gl.createSampler();
    gl.samplerParameteri(sampler, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
    gl.samplerParameteri(sampler, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
    return ctx.swizzlePass = {
        program, sampler, fbo: gl.createFramebuffer(), vao: gl.createVertexArray(), target: null,
        s: gl.getUniformLocation(program, "s"), m: gl.getUniformLocation(program, "m"), k: gl.getUniformLocation(program, "k"),
    };
}
/** Draws the dirty region of `o` (bound on `unit`) into its shadow; false when it cannot. */
function redrawShadow(ctx, unit, o, t) {
    const gl = ctx.gl, pass = swizzlePass(ctx), shadow = t.shadow, d = t.dirty;
    if (!pass)
        return false;
    if (ctx.feedback) {
        warnOnce(ctx, "swizzle-feedback", "swizzled texture changed during transform feedback; it samples its previous contents");
        return false;
    }
    const matrix = new Float32Array(16), constant = new Float32Array(4);
    t.swizzle.forEach((source, k) => {
        const from = SWIZZLE_IDENTITY.indexOf(source);
        if (from >= 0)
            matrix[from * 4 + k] = 1;
        else if (source === GL.ONE)
            constant[k] = 1;
    });
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, pass.fbo);
    if (pass.target !== shadow.texture) {
        gl.framebufferTexture2D(GL.DRAW_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, shadow.texture, 0);
        pass.target = shadow.texture;
    }
    const x0 = Math.max(0, d.x0), y0 = Math.max(0, d.y0), x1 = Math.min(shadow.width, d.x1), y1 = Math.min(shadow.height, d.y1);
    gl.viewport(0, 0, shadow.width, shadow.height);
    gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    if (!ctx.caps.get(GL.SCISSOR_TEST))
        gl.enable(GL.SCISSOR_TEST);
    for (const cap of [GL.BLEND, GL.CULL_FACE, GL.RASTERIZER_DISCARD])
        if (ctx.caps.get(cap))
            gl.disable(cap);
    const mask = ctx.colorMask, fullMask = mask.every(Boolean);
    if (!fullMask)
        gl.colorMask(true, true, true, true);
    gl.useProgram(pass.program);
    gl.uniformMatrix4fv(pass.m, false, matrix);
    gl.uniform4fv(pass.k, constant);
    gl.uniform1i(pass.s, unit);
    gl.bindVertexArray(pass.vao);
    gl.bindSampler(unit, pass.sampler);
    gl.bindTexture(GL.TEXTURE_2D, o);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    gl.bindSampler(unit, ctx.samplers.get(unit) ?? null);
    gl.bindVertexArray(ctx.vao);
    gl.useProgram(ctx.program);
    if (!fullMask)
        gl.colorMask(...mask);
    for (const cap of [GL.BLEND, GL.CULL_FACE, GL.RASTERIZER_DISCARD])
        if (ctx.caps.get(cap))
            gl.enable(cap);
    if (!ctx.caps.get(GL.SCISSOR_TEST))
        gl.disable(GL.SCISSOR_TEST);
    gl.scissor(...ctx.scissorBox);
    gl.viewport(...ctx.viewport);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, ctx.fbBound.get(GL.DRAW_FRAMEBUFFER) ?? null);
    return true;
}
/** Shadow of swizzled texture `o` bound on `unit`, brought up to date; null when not emulated. Leaves `unit` active. */
function shadowTexture(ctx, unit, o) {
    const gl = ctx.gl, t = ctx.texInfo.get(o), base = t?.base;
    const format = base && shadowFormat(ctx, base.format, base.type);
    if (!format) {
        warnOnce(ctx, "swizzle-format", "texture swizzle needs a 2D texture with a known non-integer, non-depth level 0; sampling unswizzled");
        return null;
    }
    gl.activeTexture(GL.TEXTURE0 + unit);
    let shadow = t.shadow;
    if (!shadow || shadow.width !== base.width || shadow.height !== base.height || shadow.format !== format) {
        if (shadow)
            gl.deleteTexture(shadow.texture);
        shadow = t.shadow = { texture: gl.createTexture(), width: base.width, height: base.height, format, key: "", params: -1 };
        ctx.shadowed = true;
        gl.bindTexture(GL.TEXTURE_2D, shadow.texture);
        gl.texStorage2D(GL.TEXTURE_2D, 1, format, base.width, base.height);
        t.dirty = { x0: 0, y0: 0, x1: base.width, y1: base.height };
    }
    const key = t.swizzle.join();
    if (shadow.key !== key) {
        shadow.key = key;
        t.dirty = { x0: 0, y0: 0, x1: base.width, y1: base.height };
    }
    if (shadow.params !== (t.paramsVersion ?? 0)) {
        gl.bindTexture(GL.TEXTURE_2D, shadow.texture);
        for (const [pname, [float, value]] of t.params)
            if (pname !== GL.TEXTURE_BASE_LEVEL && pname !== GL.TEXTURE_MAX_LEVEL)
                float ? gl.texParameterf(GL.TEXTURE_2D, pname, value) : gl.texParameteri(GL.TEXTURE_2D, pname, value);
        shadow.params = t.paramsVersion ?? 0;
    }
    if (t.dirty && redrawShadow(ctx, unit, o, t))
        t.dirty = null;
    gl.bindTexture(GL.TEXTURE_2D, o);
    return shadow.texture;
}
/** Debug: counts, per texture on unit 0, text-shader draws and whether GL has the expected texture bound. */
function textDrawRecord(ctx, swapped) {
    const o = ctx.texBound.get(GL.TEXTURE_2D) ?? null, t = o && ctx.texInfo.get(o);
    const k = swapped ? swapped.indexOf(0) : -1, expected = k >= 0 && k % 3 === 0 ? swapped[k + 2] : o;
    ctx.gl.activeTexture(GL.TEXTURE0);
    const actual = ctx.gl.getParameter(0x8069 /* TEXTURE_BINDING_2D */);
    ctx.gl.activeTexture(GL.TEXTURE0 + ctx.texUnit);
    const fb = ctx.fbBound.get(GL.DRAW_FRAMEBUFFER), target = fb && ctx.fbAttach.get(fb)?.get(GL.COLOR_ATTACHMENT0);
    const tt = target && ctx.texInfo.get(target)?.base;
    const key = `[${ctx.textPrograms.get(ctx.program)}] fb ${fb ? `t${target ? ctx.names.get(target) : "?"} ${tt?.width}x${tt?.height}` : "default"} vp ${ctx.viewport.join(",")} t${o ? ctx.names.get(o) : 0} fmt${t?.base?.format ?? "?"} ${t?.base?.width ?? 0}x${t?.base?.height ?? 0}` +
        `${t?.swizzle ? " swizzled" : ""}${k >= 0 ? " shadow" : ""}${actual === expected ? "" : " MISMATCH"}`;
    (ctx.textDraws ??= new Map()).set(key, (ctx.textDraws.get(key) ?? 0) + 1);
    (ctx.textTargets ??= new Set()).add(target).add(o);
}
/** Runs `draw` with every bound swizzled 2D texture replaced by its shadow. */
function swizzledDraw(ctx, draw) {
    let swapped = null;
    if (ctx.swizzled.size) {
        for (const [key, o] of ctx.texBound) {
            if ((key & 0xffff) !== GL.TEXTURE_2D || !ctx.swizzled.has(o))
                continue;
            const shadow = shadowTexture(ctx, key >>> 16, o);
            if (shadow)
                (swapped ??= []).push(key >>> 16, o, shadow);
        }
        if (swapped)
            for (let k = 0; k < swapped.length; k += 3) {
                ctx.gl.activeTexture(GL.TEXTURE0 + swapped[k]);
                ctx.gl.bindTexture(GL.TEXTURE_2D, swapped[k + 2]);
            }
    }
    if (ctx.textPrograms?.has(ctx.program))
        textDrawRecord(ctx, swapped);
    try {
        draw();
    }
    finally {
        if (swapped)
            for (let k = 0; k < swapped.length; k += 3) {
                ctx.gl.activeTexture(GL.TEXTURE0 + swapped[k]);
                ctx.gl.bindTexture(GL.TEXTURE_2D, swapped[k + 1]);
            }
        if (ctx.swizzled.size)
            ctx.gl.activeTexture(GL.TEXTURE0 + ctx.texUnit);
        renderedTo(ctx);
    }
}

function deleteObject(ctx, kind, name) {
    const map = ctx.objects[kind >= K_PROGRAM ? K_PROGRAM : kind];
    const o = map.get(name);
    if (!o)
        return;
    map.delete(name);
    if (kind === 1 && poolTexture(ctx, o))
        return;
    if (kind === 1) {
        unbindTexture(ctx, o);
        ctx.swizzled.delete(o);
        const shadow = ctx.texInfo.get(o)?.shadow;
        if (shadow)
            ctx.gl.deleteTexture(shadow.texture);
    }
    for (const fb of ctx.fbBound.values())
        for (const [point, a] of ctx.fbAttach.get(fb) ?? [])
            if (a === o)
                ctx.fbAttach.get(fb).delete(point);
    if (kind === 2)
        for (const [target, fb] of ctx.fbBound)
            if (fb === o)
                ctx.fbBound.delete(target);
    // Deleting a bound sampler or vertex array unbinds it, as GL does.
    if (kind === 5)
        for (const [unit, sampler] of ctx.samplers)
            if (sampler === o)
                ctx.samplers.delete(unit);
    if (kind === 6 && ctx.vao === o)
        ctx.vao = null;
    // GL keeps a deleted program in use until another replaces it, but WebGL
    // refuses to bind a deleted one again (the swizzle pass rebinds it), so the
    // host deletes the current program only once it is no longer current.
    if (kind === K_PROGRAM && o === ctx.program)
        ctx.programDeleted = true;
    else if (kind === K_PROGRAM)
        ctx.gl.deleteProgram(o);
    else if (kind === K_SHADER)
        ctx.gl.deleteShader(o);
    else
        ctx.gl[KINDS[kind][1]](o);
}

const H = {};
H.SetSurface = (c, i) => {
    const w = Math.max(1, c.w[i]), h = Math.max(1, c.w[i + 1]);
    if (c.canvas.width !== w)
        c.canvas.width = w;
    if (c.canvas.height !== h)
        c.canvas.height = h;
};
H.GenObjects = (c, i) => {
    const kind = c.w[i], count = c.w[i + 1];
    if (kind >= KINDS.length)
        throw new RangeError("bad object kind");
    const map = c.objects[kind];
    for (let k = 0; k < count; k++) {
        const name = c.w[i + 2 + k];
        if (map.has(name))
            continue;
        const o = c.gl[KINDS[kind][0]]();
        map.set(name, o);
        c.names.set(o, name);
    }
};
H.DeleteObjects = (c, i) => {
    const kind = c.w[i], count = c.w[i + 1];
    for (let k = 0; k < count; k++)
        deleteObject(c, kind, c.w[i + 2 + k]);
};
H.ActiveTexture = (c, i) => {
    c.gl.activeTexture(c.w[i]);
    c.texUnit = c.w[i] - GL.TEXTURE0;
};
H.AttachShader = (c, i) => {
    const program = programOf(c, c.w[i]), shader = programOf(c, c.w[i + 1]);
    if (c.textShaders?.has(shader))
        (c.textPrograms ??= new WeakMap()).set(program, `${c.textPrograms.get(program) ?? ""} ${c.textShaders.get(shader)}`);
    c.gl.attachShader(program, shader);
};
H.BindAttribLocation = (c, i) => c.gl.bindAttribLocation(programOf(c, c.w[i]), c.w[i + 1], toHost(blobText(c, i + 2)));
H.BindBuffer = (c, i) => c.gl.bindBuffer(c.w[i], object(c, 0, c.w[i + 1]));
H.BindFramebuffer = (c, i) => {
    const target = c.w[i], fb = object(c, 2, c.w[i + 1]);
    c.gl.bindFramebuffer(target, fb);
    for (const t of target === GL.FRAMEBUFFER ? [GL.READ_FRAMEBUFFER, GL.DRAW_FRAMEBUFFER] : [target === GL.READ_FRAMEBUFFER ? target : GL.DRAW_FRAMEBUFFER])
        fb ? c.fbBound.set(t, fb) : c.fbBound.delete(t);
};
H.BindRenderbuffer = (c, i) => c.gl.bindRenderbuffer(c.w[i], object(c, 3, c.w[i + 1]));
H.BindTexture = (c, i) => {
    const o = object(c, 1, c.w[i + 1]);
    c.gl.bindTexture(c.w[i], o);
    o ? c.texBound.set(bindingKey(c, c.w[i]), o) : c.texBound.delete(bindingKey(c, c.w[i]));
};
H.BlendColor = (c, i) => c.gl.blendColor(c.f32[i], c.f32[i + 1], c.f32[i + 2], c.f32[i + 3]);
H.BlendEquation = (c, i) => c.gl.blendEquation(c.w[i]);
H.BlendEquationSeparate = (c, i) => c.gl.blendEquationSeparate(c.w[i], c.w[i + 1]);
H.BlendFunc = (c, i) => c.gl.blendFunc(c.w[i], c.w[i + 1]);
H.BlendFuncSeparate = (c, i) => c.gl.blendFuncSeparate(c.w[i], c.w[i + 1], c.w[i + 2], c.w[i + 3]);
H.BufferData = (c, i) => {
    const b = blob(c, i + 2);
    if (b.mode === B_NULL)
        c.gl.bufferData(c.w[i], b.bytes, c.w[i + 1]);
    else
        c.gl.bufferData(c.w[i], typed(c, b.data, Uint8Array), c.w[i + 1]);
};
H.BufferSubData = (c, i) => c.gl.bufferSubData(c.w[i], c.w[i + 1], typed(c, blob(c, i + 2).data, Uint8Array));
H.Clear = (c, i) => {
    c.gl.clear(c.w[i]);
    renderedTo(c);
};
H.ClearColor = (c, i) => c.gl.clearColor(c.f32[i], c.f32[i + 1], c.f32[i + 2], c.f32[i + 3]);
H.ClearDepthf = (c, i) => c.gl.clearDepth(c.f32[i]);
H.ClearStencil = (c, i) => c.gl.clearStencil(c.i32[i]);
H.ColorMask = (c, i) => {
    c.colorMask = [!!c.w[i], !!c.w[i + 1], !!c.w[i + 2], !!c.w[i + 3]];
    c.gl.colorMask(...c.colorMask);
};
H.CompileShader = (c, i) => c.gl.compileShader(programOf(c, c.w[i]));
function compressed(c, b) {
    return b.mode === B_OFFSET ? [b.bytes, b.offset] : [typed(c, b.data ?? new Uint8Array(), Uint8Array)];
}
H.CompressedTexImage2D = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.compressedTexImage2D(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], ...compressed(c, blob(c, i + 6)));
    defineLevel0(c, c.w[i], c.i32[i + 1], c.w[i + 2], GL.UNSIGNED_BYTE, c.i32[i + 3], c.i32[i + 4]);
};
H.CompressedTexSubImage2D = (c, i) => {
    c.gl.compressedTexSubImage2D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.w[i + 6], ...compressed(c, blob(c, i + 7)));
    touchLevel0(c, c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5]);
};
H.CopyTexImage2D = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.copyTexImage2D(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7]);
    defineLevel0(c, c.w[i], c.i32[i + 1], c.w[i + 2], GL.UNSIGNED_BYTE, c.i32[i + 5], c.i32[i + 6]);
};
H.CopyTexSubImage2D = (c, i) => {
    c.gl.copyTexSubImage2D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7]);
    touchLevel0(c, c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 6], c.i32[i + 7]);
};
H.CreateProgram = (c, i) => {
    const o = c.gl.createProgram();
    c.objects[K_PROGRAM].set(c.w[i], o);
    c.names.set(o, c.w[i]);
};
H.CreateShader = (c, i) => {
    const o = c.gl.createShader(c.w[i]);
    c.objects[K_PROGRAM].set(c.w[i + 1], o);
    c.names.set(o, c.w[i + 1]);
};
H.CullFace = (c, i) => c.gl.cullFace(c.w[i]);
H.DeleteProgram = (c, i) => deleteObject(c, K_PROGRAM, c.w[i]);
H.DeleteShader = (c, i) => deleteObject(c, K_SHADER, c.w[i]);
H.DepthFunc = (c, i) => c.gl.depthFunc(c.w[i]);
H.DepthMask = (c, i) => c.gl.depthMask(!!c.w[i]);
H.DepthRangef = (c, i) => c.gl.depthRange(c.f32[i], c.f32[i + 1]);
H.DetachShader = (c, i) => c.gl.detachShader(programOf(c, c.w[i]), programOf(c, c.w[i + 1]));
H.Disable = (c, i) => {
    if (c.w[i] === GL.PRIMITIVE_RESTART_FIXED_INDEX)
        return warnOnce(c, "restart-off", "WebGL2 always restarts at the fixed index; Disable(PRIMITIVE_RESTART_FIXED_INDEX) ignored");
    c.gl.disable(c.w[i]);
    c.caps.set(c.w[i], false);
};
H.DisableVertexAttribArray = (c, i) => c.gl.disableVertexAttribArray(c.w[i]);
H.DrawArrays = (c, i) => swizzledDraw(c, () => c.gl.drawArrays(c.w[i], c.i32[i + 1], c.i32[i + 2]));
H.DrawElements = (c, i) => swizzledDraw(c, () => c.gl.drawElements(c.w[i], c.i32[i + 1], c.w[i + 2], c.w[i + 3]));
H.Enable = (c, i) => {
    if (c.w[i] === GL.PRIMITIVE_RESTART_FIXED_INDEX)
        return;
    c.gl.enable(c.w[i]);
    c.caps.set(c.w[i], true);
};
H.EnableVertexAttribArray = (c, i) => c.gl.enableVertexAttribArray(c.w[i]);
H.Finish = (c) => c.gl.finish();
H.Flush = (c) => c.gl.flush();
H.FramebufferRenderbuffer = (c, i) => {
    const rb = object(c, 3, c.w[i + 3]);
    c.gl.framebufferRenderbuffer(c.w[i], c.w[i + 1], c.w[i + 2], rb);
    attach(c, c.w[i], c.w[i + 1], rb, false);
};
H.FramebufferTexture2D = (c, i) => {
    const o = object(c, 1, c.w[i + 3]);
    c.gl.framebufferTexture2D(c.w[i], c.w[i + 1], c.w[i + 2], o, c.i32[i + 4]);
    attach(c, c.w[i], c.w[i + 1], o, c.w[i + 2] === GL.TEXTURE_2D && c.i32[i + 4] === 0);
};
H.FrontFace = (c, i) => c.gl.frontFace(c.w[i]);
H.GenerateMipmap = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.generateMipmap(c.w[i]);
};
H.Hint = (c, i) => c.gl.hint(c.w[i], c.w[i + 1]);
H.LineWidth = (c, i) => c.gl.lineWidth(c.f32[i]);
H.LinkProgram = (c, i) => {
    const program = programOf(c, c.w[i]);
    if (program)
        c.programs.delete(program);
    c.gl.linkProgram(program);
};
H.PixelStorei = (c, i) => c.gl.pixelStorei(c.w[i], c.i32[i + 1]);
H.PolygonOffset = (c, i) => c.gl.polygonOffset(c.f32[i], c.f32[i + 1]);
H.ReadPixels = (c, i) => {
    const [x, y, w, h, format, type] = [c.i32[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.w[i + 4], hostType(c.w[i + 5])];
    const b = blob(c, i + 6);
    if (b.mode === B_OFFSET)
        return void c.gl.readPixels(x, y, w, h, format, type, b.offset);
    const out = outTyped(c, b.data, typedClass(type));
    c.gl.readPixels(x, y, w, h, format, type, out.view);
    out.finish();
};
H.RenderbufferStorage = (c, i) => c.gl.renderbufferStorage(c.w[i], c.w[i + 1], c.i32[i + 2], c.i32[i + 3]);
H.SampleCoverage = (c, i) => c.gl.sampleCoverage(c.f32[i], !!c.w[i + 1]);
H.Scissor = (c, i) => {
    c.scissorBox = [c.i32[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3]];
    c.gl.scissor(...c.scissorBox);
};
H.ShaderSource = (c, i) => {
    const text = toHost(blobText(c, i + 1));
    // Debug: remember WebRender's text shaders (see textDrawRecord).
    if (statsEnabled && text.includes("v_mask_swizzle"))
        (c.textShaders ??= new WeakMap()).set(programOf(c, c.w[i]), [...text.matchAll(/#define (WR_FEATURE_\w+|WR_\w*_SHADER)/g)].map((m) => m[1].replace("WR_FEATURE_", "")).join("+"));
    c.gl.shaderSource(programOf(c, c.w[i]), text);
};
H.StencilFunc = (c, i) => c.gl.stencilFunc(c.w[i], c.i32[i + 1], c.w[i + 2]);
H.StencilFuncSeparate = (c, i) => c.gl.stencilFuncSeparate(c.w[i], c.w[i + 1], c.i32[i + 2], c.w[i + 3]);
H.StencilMask = (c, i) => c.gl.stencilMask(c.w[i]);
H.StencilMaskSeparate = (c, i) => c.gl.stencilMaskSeparate(c.w[i], c.w[i + 1]);
H.StencilOp = (c, i) => c.gl.stencilOp(c.w[i], c.w[i + 1], c.w[i + 2]);
H.StencilOpSeparate = (c, i) => c.gl.stencilOpSeparate(c.w[i], c.w[i + 1], c.w[i + 2], c.w[i + 3]);
H.TexImage2D = (c, i) => {
    const type = hostType(c.w[i + 7]), target = c.w[i], o = boundTexture(c, target);
    if (o && target === GL.TEXTURE_2D && c.i32[i + 1] === 0) {
        const t = texInfo(c, o), shape = Array.from(c.w.subarray(i + 2, i + 8)).join();
        if (t.fresh && blob(c, i + 8).mode === B_NULL && reuseTexture(c, target, o, shape))
            return defineLevel0(c, target, 0, c.w[i + 2], type, c.i32[i + 3], c.i32[i + 4]);
        if (t.fresh || t.shape)
            Object.assign(t, { fresh: false, shape });
    }
    else
        texDefined(c, target);
    c.gl.texImage2D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.w[i + 6], type, source(c, blob(c, i + 8), type));
    defineLevel0(c, target, c.i32[i + 1], c.w[i + 2], type, c.i32[i + 3], c.i32[i + 4]);
};
function texParameter(c, target, pname, float, value) {
    const slot = SWIZZLE_SLOT.get(pname);
    if (slot !== undefined)
        return swizzleParameter(c, target, slot, float ? Math.round(value) : value);
    const o = boundTexture(c, target);
    if (o) {
        const t = texInfo(c, o);
        t.params.set(pname, [float, value]);
        t.paramsVersion = (t.paramsVersion ?? 0) + 1;
    }
    float ? c.gl.texParameterf(target, pname, value) : c.gl.texParameteri(target, pname, value);
}
H.TexParameterf = (c, i) => texParameter(c, c.w[i], c.w[i + 1], true, c.f32[i + 2]);
H.TexParameteri = (c, i) => texParameter(c, c.w[i], c.w[i + 1], false, c.i32[i + 2]);
H.TexSubImage2D = (c, i) => {
    const type = hostType(c.w[i + 7]);
    c.gl.texSubImage2D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.w[i + 6], type, source(c, blob(c, i + 8), type));
    touchLevel0(c, c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5]);
};
const UNIFORM_SCALAR = { f: [null, "uniform1f", "uniform2f", "uniform3f", "uniform4f"], i: [null, "uniform1i", "uniform2i", "uniform3i", "uniform4i"], ui: [null, "uniform1ui", "uniform2ui", "uniform3ui", "uniform4ui"] };
const UNIFORM_VECTOR = { f: [null, "uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv"], i: [null, "uniform1iv", "uniform2iv", "uniform3iv", "uniform4iv"], ui: [null, "uniform1uiv", "uniform2uiv", "uniform3uiv", "uniform4uiv"] };
function uniformScalar(kind, words) {
    return (c, i) => {
        const n = c.w[i + 1], loc = location(c, c.program, c.i32[i]);
        if (n < 1 || n > 4)
            throw new RangeError("bad uniform size");
        const v = Array.from({ length: n }, (_, k) => words(c)[i + 2 + k]);
        c.gl[UNIFORM_SCALAR[kind][n]](loc, ...v);
    };
}
function uniformVector(kind, Type) {
    return (c, i) => {
        const n = c.w[i + 1], loc = location(c, c.program, c.i32[i]);
        if (n < 1 || n > 4)
            throw new RangeError("bad uniform size");
        c.gl[UNIFORM_VECTOR[kind][n]](loc, typed(c, blob(c, i + 3).data, Type));
    };
}
H.Uniformf = uniformScalar("f", (c) => c.f32);
H.Uniformi = uniformScalar("i", (c) => c.i32);
H.Uniformui = uniformScalar("ui", (c) => c.w);
H.Uniformfv = uniformVector("f", Float32Array);
H.Uniformiv = uniformVector("i", Int32Array);
H.Uniformuiv = uniformVector("ui", Uint32Array);
H.UniformMatrixfv = (c, i) => {
    const cols = c.w[i + 1], rows = c.w[i + 2];
    if (cols < 2 || cols > 4 || rows < 2 || rows > 4)
        throw new RangeError("bad matrix shape");
    const name = cols === rows ? `uniformMatrix${cols}fv` : `uniformMatrix${cols}x${rows}fv`;
    c.gl[name](location(c, c.program, c.i32[i]), !!c.w[i + 4], typed(c, blob(c, i + 5).data, Float32Array));
};
H.UseProgram = (c, i) => {
    const previous = c.program;
    c.program = programOf(c, c.w[i]);
    c.gl.useProgram(c.program);
    if (c.programDeleted && previous !== c.program) {
        c.programDeleted = false;
        c.gl.deleteProgram(previous);
    }
};
H.ValidateProgram = (c, i) => c.gl.validateProgram(programOf(c, c.w[i]));
H.VertexAttribf = (c, i) => c.gl.vertexAttrib4f(c.w[i], c.f32[i + 1], c.f32[i + 2], c.f32[i + 3], c.f32[i + 4]);
H.VertexAttribPointer = (c, i) => c.gl.vertexAttribPointer(c.w[i], c.i32[i + 1], c.w[i + 2], !!c.w[i + 3], c.i32[i + 4], c.w[i + 5]);
H.Viewport = (c, i) => {
    c.viewport = [c.i32[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3]];
    c.gl.viewport(...c.viewport);
};
H.ReadBuffer = (c, i) => c.gl.readBuffer(c.w[i]);
H.DrawRangeElements = (c, i) => swizzledDraw(c, () => c.gl.drawRangeElements(c.w[i], c.w[i + 1], c.w[i + 2], c.i32[i + 3], c.w[i + 4], c.w[i + 5]));
H.TexImage3D = (c, i) => {
    const type = hostType(c.w[i + 8]);
    texDefined(c, c.w[i]);
    c.gl.texImage3D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.w[i + 7], type, source(c, blob(c, i + 9), type));
};
H.TexSubImage3D = (c, i) => {
    const type = hostType(c.w[i + 9]);
    c.gl.texSubImage3D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7], c.w[i + 8], type, source(c, blob(c, i + 10), type));
};
H.CopyTexSubImage3D = (c, i) =>
    c.gl.copyTexSubImage3D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7], c.i32[i + 8]);
H.CompressedTexImage3D = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.compressedTexImage3D(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], ...compressed(c, blob(c, i + 7)));
};
H.CompressedTexSubImage3D = (c, i) =>
    c.gl.compressedTexSubImage3D(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7], c.w[i + 8], ...compressed(c, blob(c, i + 9)));
H.BeginQuery = (c, i) => c.gl.beginQuery(c.w[i], object(c, 4, c.w[i + 1]));
H.EndQuery = (c, i) => c.gl.endQuery(c.w[i]);
H.DrawBuffers = (c, i) => c.gl.drawBuffers(Array.from(c.w.subarray(i + 1, i + 1 + c.w[i])));
H.BlitFramebuffer = (c, i) => {
    c.gl.blitFramebuffer(c.i32[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6], c.i32[i + 7], c.w[i + 8], c.w[i + 9]);
    renderedTo(c);
};
H.RenderbufferStorageMultisample = (c, i) => c.gl.renderbufferStorageMultisample(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4]);
H.FramebufferTextureLayer = (c, i) => {
    const o = object(c, 1, c.w[i + 2]);
    c.gl.framebufferTextureLayer(c.w[i], c.w[i + 1], o, c.i32[i + 3], c.i32[i + 4]);
    attach(c, c.w[i], c.w[i + 1], o, false);
};
H.BindVertexArray = (c, i) => {
    c.vao = object(c, 6, c.w[i]);
    c.gl.bindVertexArray(c.vao);
};
H.BeginTransformFeedback = (c, i) => {
    c.gl.beginTransformFeedback(c.w[i]);
    c.feedback = true;
};
H.EndTransformFeedback = (c) => {
    c.gl.endTransformFeedback();
    c.feedback = false;
};
H.BindBufferRange = (c, i) => c.gl.bindBufferRange(c.w[i], c.w[i + 1], object(c, 0, c.w[i + 2]), c.w[i + 3], c.w[i + 4]);
H.BindBufferBase = (c, i) => c.gl.bindBufferBase(c.w[i], c.w[i + 1], object(c, 0, c.w[i + 2]));
H.TransformFeedbackVaryings = (c, i) => {
    const names = blobText(c, i + 2).split("\0").filter((name) => name.length).map(toHost);
    c.gl.transformFeedbackVaryings(programOf(c, c.w[i]), names, c.w[i + 1]);
};
H.VertexAttribIPointer = (c, i) => c.gl.vertexAttribIPointer(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.w[i + 4]);
H.VertexAttribI4i = (c, i) => c.gl.vertexAttribI4i(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4]);
H.VertexAttribI4ui = (c, i) => c.gl.vertexAttribI4ui(c.w[i], c.w[i + 1], c.w[i + 2], c.w[i + 3], c.w[i + 4]);
H.ClearBufferiv = (c, i) => {
    c.gl.clearBufferiv(c.w[i], c.i32[i + 1], Int32Array.from(c.i32.subarray(i + 2, i + 6)));
    renderedTo(c);
};
H.ClearBufferuiv = (c, i) => {
    c.gl.clearBufferuiv(c.w[i], c.i32[i + 1], Uint32Array.from(c.w.subarray(i + 2, i + 6)));
    renderedTo(c);
};
H.ClearBufferfv = (c, i) => {
    c.gl.clearBufferfv(c.w[i], c.i32[i + 1], Float32Array.from(c.f32.subarray(i + 2, i + 6)));
    renderedTo(c);
};
H.ClearBufferfi = (c, i) => {
    c.gl.clearBufferfi(c.w[i], c.i32[i + 1], c.f32[i + 2], c.i32[i + 3]);
    renderedTo(c);
};
H.CopyBufferSubData = (c, i) => c.gl.copyBufferSubData(c.w[i], c.w[i + 1], c.w[i + 2], c.w[i + 3], c.w[i + 4]);
H.UniformBlockBinding = (c, i) => c.gl.uniformBlockBinding(programOf(c, c.w[i]), c.w[i + 1], c.w[i + 2]);
H.DrawArraysInstanced = (c, i) => swizzledDraw(c, () => c.gl.drawArraysInstanced(c.w[i], c.i32[i + 1], c.i32[i + 2], c.i32[i + 3]));
H.DrawElementsInstanced = (c, i) => swizzledDraw(c, () => c.gl.drawElementsInstanced(c.w[i], c.i32[i + 1], c.w[i + 2], c.w[i + 3], c.i32[i + 4]));
H.BindSampler = (c, i) => {
    const o = object(c, 5, c.w[i + 1]);
    c.gl.bindSampler(c.w[i], o);
    o ? c.samplers.set(c.w[i], o) : c.samplers.delete(c.w[i]);
};
H.SamplerParameteri = (c, i) => c.gl.samplerParameteri(object(c, 5, c.w[i]), c.w[i + 1], c.i32[i + 2]);
H.SamplerParameterf = (c, i) => c.gl.samplerParameterf(object(c, 5, c.w[i]), c.w[i + 1], c.f32[i + 2]);
H.VertexAttribDivisor = (c, i) => c.gl.vertexAttribDivisor(c.w[i], c.w[i + 1]);
H.BindTransformFeedback = (c, i) => c.gl.bindTransformFeedback(c.w[i], object(c, 7, c.w[i + 1]));
H.PauseTransformFeedback = (c) => {
    c.gl.pauseTransformFeedback();
    c.feedback = false;
};
H.ResumeTransformFeedback = (c) => {
    c.gl.resumeTransformFeedback();
    c.feedback = true;
};
H.InvalidateFramebuffer = (c, i) => c.gl.invalidateFramebuffer(c.w[i], Array.from(c.w.subarray(i + 2, i + 2 + c.w[i + 1])));
H.InvalidateSubFramebuffer = (c, i) =>
    c.gl.invalidateSubFramebuffer(c.w[i], Array.from(c.w.subarray(i + 6, i + 6 + c.w[i + 5])), c.i32[i + 1], c.i32[i + 2], c.i32[i + 3], c.i32[i + 4]);
H.TexStorage2D = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.texStorage2D(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4]);
    defineLevel0(c, c.w[i], 0, c.w[i + 2], GL.UNSIGNED_BYTE, c.i32[i + 3], c.i32[i + 4]);
};
H.TexStorage3D = (c, i) => {
    texDefined(c, c.w[i]);
    c.gl.texStorage3D(c.w[i], c.i32[i + 1], c.w[i + 2], c.i32[i + 3], c.i32[i + 4], c.i32[i + 5]);
};

// Queries.
H.GetParameter = (c, i) => reply(c, c.gl.getParameter(c.w[i]));
H.GetIndexedParameter = (c, i) => reply(c, c.gl.getIndexedParameter(c.w[i], c.w[i + 1]));
H.GetBufferParameter = (c, i) => reply(c, c.gl.getBufferParameter(c.w[i], c.w[i + 1]));
H.GetFramebufferAttachmentParameter = (c, i) => reply(c, c.gl.getFramebufferAttachmentParameter(c.w[i], c.w[i + 1], c.w[i + 2]));
H.GetRenderbufferParameter = (c, i) => reply(c, c.gl.getRenderbufferParameter(c.w[i], c.w[i + 1]));
H.GetTexParameter = (c, i) => {
    const slot = SWIZZLE_SLOT.get(c.w[i + 1]), o = slot === undefined ? null : boundTexture(c, c.w[i]);
    if (slot !== undefined)
        return numberReply([((o && c.texInfo.get(o)?.swizzle) ?? SWIZZLE_IDENTITY)[slot]]);
    return reply(c, c.gl.getTexParameter(c.w[i], c.w[i + 1]));
};
H.GetSamplerParameter = (c, i) => reply(c, c.gl.getSamplerParameter(object(c, 5, c.w[i]), c.w[i + 1]));
H.GetVertexAttrib = (c, i) => reply(c, c.gl.getVertexAttrib(c.w[i], c.w[i + 1]));
H.GetVertexAttribOffset = (c, i) => reply(c, c.gl.getVertexAttribOffset(c.w[i], c.w[i + 1]));
H.GetQuery = (c, i) => reply(c, c.gl.getQuery(c.w[i], c.w[i + 1]));
H.GetQueryParameter = (c, i) => reply(c, c.gl.getQueryParameter(object(c, 4, c.w[i]), c.w[i + 1]));
H.GetUniform = (c, i) => {
    const program = programOf(c, c.w[i]);
    return reply(c, c.gl.getUniform(program, location(c, program, c.i32[i + 1])));
};
H.GetShaderPrecisionFormat = (c, i) => {
    const f = c.gl.getShaderPrecisionFormat(c.w[i], c.w[i + 1]);
    return numberReply(f ? [f.rangeMin, f.rangeMax, f.precision] : []);
};
H.GetInternalformatParameter = (c, i) => {
    if (c.w[i + 2] === GL.NUM_SAMPLE_COUNTS)
        return numberReply([(c.gl.getInternalformatParameter(c.w[i], c.w[i + 1], GL.SAMPLES) ?? []).length]);
    return reply(c, c.gl.getInternalformatParameter(c.w[i], c.w[i + 1], c.w[i + 2]) ?? []);
};
H.GetError = (c) => {
    const error = c.error || c.gl.getError();
    c.error = 0;
    return numberReply([error]);
};
H.IsEnabled = (c, i) => numberReply([c.w[i] === GL.PRIMITIVE_RESTART_FIXED_INDEX ? 1 : c.gl.isEnabled(c.w[i]) ? 1 : 0]);
H.IsObject = (c, i) => {
    const kind = c.w[i], o = c.objects[kind >= K_PROGRAM ? K_PROGRAM : kind]?.get(c.w[i + 1]);
    let yes = false;
    if (o && kind === K_PROGRAM)
        yes = o instanceof WebGLProgram && c.gl.isProgram(o);
    else if (o && kind === K_SHADER)
        yes = o instanceof WebGLShader && c.gl.isShader(o);
    else if (o && kind < KINDS.length)
        yes = c.gl[KINDS[kind][2]](o);
    return numberReply([yes ? 1 : 0]);
};
// Completeness depends only on the attachments' formats, sizes and identities. Firefox
// checks a new framebuffer per WebGL frame; each check would wait for the host GPU
// process, so complete results are kept per attachment shape.
function fbSignature(c, target) {
    const fb = c.fbBound.get(target === GL.READ_FRAMEBUFFER ? GL.READ_FRAMEBUFFER : GL.DRAW_FRAMEBUFFER);
    const map = fb && c.fbAttach.get(fb);
    if (!map?.size || c.fbComplex.get(fb).size)
        return null;
    const seen = [], parts = [];
    for (const [point, o] of [...map].sort((x, y) => x[0] - y[0])) {
        const shape = o instanceof WebGLTexture && c.texInfo.get(o)?.shape;
        if (!shape)
            return null;
        if (!seen.includes(o))
            seen.push(o);
        parts.push(`${point}:${seen.indexOf(o)}:${shape}`);
    }
    return parts.join(";");
}
H.CheckFramebufferStatus = (c, i) => {
    const signature = fbSignature(c, c.w[i]);
    if (signature && c.complete.has(signature))
        return numberReply([GL.FRAMEBUFFER_COMPLETE]);
    const status = c.gl.checkFramebufferStatus(c.w[i]);
    if (signature && status === GL.FRAMEBUFFER_COMPLETE)
        c.complete.add(signature);
    return numberReply([status]);
};
H.GetFragDataLocation = (c, i) => numberReply([c.gl.getFragDataLocation(programOf(c, c.w[i]), toHost(blobText(c, i + 1)))]);
H.ProgramInfo = (c, i) => textReply(programInfo(c, c.w[i]));
H.ShaderInfo = (c, i) => textReply(shaderInfo(c, c.w[i]));
H.GetBufferSubData = (c, i) => {
    const b = blob(c, i + 2);
    const out = outTyped(c, b.data, Uint8Array);
    c.gl.getBufferSubData(c.w[i], c.w[i + 1], out.view);
    out.finish();
    return new Uint8Array();
};
// flags, root x, root y, damage x, y, width, height (canvas pixels, top-left
// origin). Reply: the key the window must show, or 0 when the guest has to
// present by reading back (no keyed presenter on the page, or no free key).
H.PresentSurface = (c, i) => {
    if (c.w[i] & PRESENT_END || !keyedSink || typeof c.canvas.transferToImageBitmap !== "function") {
        endKeyed(c);
        return numberReply([0]);
    }
    if (!c.key) {
        const key = KEYS.find((k) => !keyOwners.has(k));
        if (key === undefined)
            return numberReply([0]);
        c.key = key;
        keyOwners.set(key, c);
    }
    const bitmap = transferKeepingFrame(c);
    globalThis.postMessage({ type: "gpu-present", keyed: true, key: c.key, x: c.i32[i + 1], y: c.i32[i + 2],
        damage: [c.i32[i + 3], c.i32[i + 4], c.i32[i + 5], c.i32[i + 6]], bitmap }, [bitmap]);
    return numberReply([c.key]);
};

// Chromium's transferToImageBitmap takes the drawing buffer and leaves the
// canvas cleared even with preserveDrawingBuffer, but the guest's window keeps
// its frame (EGL_BUFFER_PRESERVED, buffer age 1) and redraws only damage, so
// the colour buffer is copied aside and back around the transfer.
function transferKeepingFrame(ctx) {
    const gl = ctx.gl, { width, height } = ctx.canvas;
    let keep = ctx.keepFrame;
    if (!keep || keep.width !== width || keep.height !== height) {
        if (keep) {
            gl.deleteFramebuffer(keep.fbo);
            gl.deleteRenderbuffer(keep.renderbuffer);
        }
        keep = ctx.keepFrame = { width, height, fbo: gl.createFramebuffer(), renderbuffer: gl.createRenderbuffer() };
        const bound = gl.getParameter(GL.RENDERBUFFER_BINDING);
        gl.bindRenderbuffer(GL.RENDERBUFFER, keep.renderbuffer);
        gl.renderbufferStorage(GL.RENDERBUFFER, GL.RGBA8, width, height);
        gl.bindRenderbuffer(GL.RENDERBUFFER, bound);
        gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, keep.fbo);
        gl.framebufferRenderbuffer(GL.DRAW_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.RENDERBUFFER, keep.renderbuffer);
    }
    // Blits obey only the scissor test among the guest's state.
    const scissor = ctx.caps.get(GL.SCISSOR_TEST);
    if (scissor)
        gl.disable(GL.SCISSOR_TEST);
    const copy = (from, to) => {
        gl.bindFramebuffer(GL.READ_FRAMEBUFFER, from);
        gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, to);
        gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, GL.COLOR_BUFFER_BIT, GL.NEAREST);
    };
    copy(null, keep.fbo);
    const bitmap = ctx.canvas.transferToImageBitmap();
    // The canvas clears itself at its next drawing call, which would wipe the
    // copied frame; clearing no buffers runs that first.
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
    gl.clear(0);
    copy(keep.fbo, null);
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, ctx.fbBound.get(GL.READ_FRAMEBUFFER) ?? null);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, ctx.fbBound.get(GL.DRAW_FRAMEBUFFER) ?? null);
    if (scissor)
        gl.enable(GL.SCISSOR_TEST);
    return bitmap;
}

const HANDLERS = [null, ...OPS.map((name) => {
    if (!H[name])
        throw new Error(`guest-gl-remote: no handler for ${name}`);
    return H[name];
})];
