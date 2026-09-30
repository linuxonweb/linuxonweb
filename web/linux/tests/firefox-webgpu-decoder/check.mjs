#!/usr/bin/env node
// W3 Node gate for the Firefox 128 WebGPU wire decoder.
//
//   node check.mjs WASM OUTPUT_DIR
//
// 1. Every golden ByteBuf decodes (status 0, canonical) to the expected JSON,
//    compared leaf by leaf. Expected values are transcribed from the golden
//    harness inputs (golden-harness/src/main.rs), the client-allocated ids in
//    goldens/manifest.json, and wgpu-types Limits::defaults(); they are not
//    derived from decoder output.
// 2. Negative inputs (every truncation prefix, trailing garbage, oversized,
//    bad pointer, bad kind, huge lengths, bad enum tags, id guard cases, zero
//    BufferSize, >8 colour attachments, bad UTF-8/format strings, non-finite
//    floats, seeded mutation fuzz) are rejected without a trap, and a canary
//    golden still decodes identically after every one of them.
// 3. Size, hash and timings are reported.
// Writes OUTPUT_DIR/result.json (OUTPUT_DIR must not exist).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecoder, parseWireJson, KINDS } from "./decoder.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [wasmPath, outDir] = process.argv.slice(2);
if (!wasmPath || !outDir) {
  console.error("usage: node check.mjs WASM OUTPUT_DIR");
  process.exit(2);
}
for (const v of ["TMPDIR", "TMP", "TEMP"]) {
  if (!process.env[v] || /^\/(tmp|dev\/shm)(\/|$)/.test(process.env[v])) {
    console.error(`${v} must point at disk-backed task storage`);
    process.exit(2);
  }
}
if (fs.existsSync(outDir)) {
  console.error(`${outDir} exists; use a new run directory`);
  process.exit(2);
}

// ---------------------------------------------------------------- helpers
let checks = 0;
const failures = [];
function ok(cond, what) {
  checks++;
  if (!cond) failures.push(what);
  return cond;
}
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
// Leaf-by-leaf comparison; each leaf and each key set is one check.
function cmp(where, actual, expected) {
  if (typeof expected === "function") return ok(expected(actual), `${where}: predicate failed on ${show(actual)}`);
  if (Array.isArray(expected)) {
    if (!ok(Array.isArray(actual) && actual.length === expected.length, `${where}: expected array[${expected.length}], got ${show(actual)}`)) return;
    expected.forEach((e, i) => cmp(`${where}[${i}]`, actual[i], e));
    return;
  }
  if (isObj(expected)) {
    if (!ok(isObj(actual), `${where}: expected object, got ${show(actual)}`)) return;
    const ek = Object.keys(expected).sort().join(",");
    const ak = Object.keys(actual).sort().join(",");
    if (!ok(ek === ak, `${where}: keys ${ak} != ${ek}`)) return;
    for (const k of Object.keys(expected)) cmp(`${where}.${k}`, actual[k], expected[k]);
    return;
  }
  ok(actual === expected, `${where}: ${show(actual)} !== ${show(expected)}`);
}
function show(v) {
  try {
    return JSON.stringify(v, (k, x) => (typeof x === "bigint" ? `${x}n` : x)).slice(0, 160);
  } catch {
    return String(v);
  }
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const cat = (...parts) => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
const u32le = (v) => new Uint8Array(new Uint32Array([v]).buffer);
const u64le = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
};
function find(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
function patched(src, at, bytes) {
  const b = new Uint8Array(src);
  b.set(bytes, at);
  return b;
}

// ---------------------------------------------------------------- load
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "goldens/manifest.json"), "utf8"));
const goldens = new Map();
for (const g of manifest.goldens) {
  const bytes = u8(fs.readFileSync(path.join(HERE, "goldens", g.file)));
  ok(bytes.length === g.size && sha256(bytes) === g.sha256, `golden ${g.name}: size/hash differs from manifest`);
  goldens.set(g.name, { ...g, bytes });
}
const ids = manifest.ids;
const I = (name) => ({ Id: [ids[name].index, ids[name].epoch, ids[name].backend] });
const Iraw = (index, epoch = 1, backend = "Vulkan") => ({ Id: [index, epoch, backend] });

const wasmBytes = fs.readFileSync(wasmPath);
const t0 = performance.now();
const module = await WebAssembly.compile(wasmBytes);
const t1 = performance.now();
const dec = await createDecoder(module);
const t2 = performance.now();
const decTok = await createDecoder(module, { forceTokenizer: true });
ok(WebAssembly.Module.imports(module).length === 0, "module has imports");

// ---------------------------------------------------------------- expected
const STAGE = (mod, entry, constants = {}) => ({
  module: mod, entry_point: entry, constants,
  zero_initialize_workgroup_memory: true, vertex_pulling_transform: false,
});
const COPY_TEX = (t, mip) => ({ texture: t, mip_level: mip, origin: { x: 4, y: 8, z: 0 }, aspect: "all" });
const LIMITS = {
  maxTextureDimension1D: 8192, maxTextureDimension2D: 8192, maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256, maxBindGroups: 4, maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8, maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12, maxUniformBufferBindingSize: 64 << 10,
  maxStorageBufferBindingSize: 1 << 27, maxVertexBuffers: 8, maxBufferSize: 256 << 20,
  maxVertexAttributes: 16, maxVertexBufferArrayStride: 2048,
  minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256,
  maxInterStageShaderComponents: 60, maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 32,
  maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535, minSubgroupSize: 0, maxSubgroupSize: 0,
  maxPushConstantSize: 0, maxNonSamplerBindings: 1000000,
};
const WGSL = "@group(0) @binding(3) var<storage, read> src: array<u32>;\n@compute @workgroup_size(64) fn cs_main(@builtin(global_invocation_id) g: vec3<u32>) { _ = src[g.x]; }\n@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(p, 0.0, 1.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.5, 0.25, 1.0); }\n";
const strBytes = (s) => Array.from(new TextEncoder().encode(s));

const EXPECTED = {
  "device-descriptor": {
    label: "w3-device",
    required_features: (1 << 0) | (1 << 5), // DEPTH_CLIP_CONTROL | TIMESTAMP_QUERY
    required_limits: LIMITS,
  },
  "device-create-texture": { CreateTexture: [I("texture"), {
    label: "w3-texture", size: { width: 64, height: 32, depthOrArrayLayers: 1 }, mip_level_count: 2,
    sample_count: 1, dimension: "2d", format: "rgba8unorm",
    usage: 1 | 2 | 4 | 16, // COPY_SRC|COPY_DST|TEXTURE_BINDING|RENDER_ATTACHMENT
    view_formats: ["rgba8unorm-srgb"] }, null] },
  "device-create-texture-swapchain": { CreateTexture: [I("texture2"), {
    label: null, size: { width: 16, height: 16, depthOrArrayLayers: 1 }, mip_level_count: 1,
    sample_count: 1, dimension: "2d", format: "bgra8unorm", usage: 1 | 16, view_formats: [] },
    0x1234_5678_9abc] },
  "texture-create-view": { CreateView: [I("view"), {
    label: "w3-view", format: "rgba8unorm-srgb", dimension: "2d",
    range: { aspect: "all", baseMipLevel: 1, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: null } }] },
  "device-create-sampler": { CreateSampler: [I("sampler"), {
    label: "w3-sampler", address_modes: ["repeat", "mirror-repeat", "clamp-to-edge"],
    mag_filter: "linear", min_filter: "nearest", mipmap_filter: "linear",
    lod_min_clamp: 0.5, lod_max_clamp: 8, compare: "less-equal", anisotropy_clamp: 4, border_color: null }] },
  "device-create-bind-group-layout": { CreateBindGroupLayout: [I("bgl"), { label: "w3-bgl", entries: [
    { binding: 0, visibility: 1 | 2, ty: { Buffer: { ty: "Uniform", has_dynamic_offset: true, min_binding_size: 64 } }, count: null },
    { binding: 1, visibility: 2, ty: { Sampler: "filtering" }, count: null },
    { binding: 2, visibility: 2, ty: { Texture: { sample_type: { Float: { filterable: true } }, view_dimension: "2d", multisampled: false } }, count: null },
    { binding: 3, visibility: 4, ty: { Buffer: { ty: { Storage: { read_only: true } }, has_dynamic_offset: false, min_binding_size: null } }, count: null },
    { binding: 4, visibility: 4, ty: { StorageTexture: { access: "write-only", format: "rgba8unorm", view_dimension: "2d" } }, count: null },
  ] }] },
  "device-create-pipeline-layout": { CreatePipelineLayout: [I("pl"), {
    label: "w3-pl", bind_group_layouts: [I("bgl")], push_constant_ranges: [] }] },
  "device-create-bind-group": { CreateBindGroup: [I("bg"), { label: "w3-bg", layout: I("bgl"), entries: [
    { binding: 0, resource: { Buffer: { buffer_id: I("buf_uniform"), offset: 256, size: 64 } } },
    { binding: 1, resource: { Sampler: I("sampler") } },
    { binding: 2, resource: { TextureView: I("view") } },
    { binding: 3, resource: { Buffer: { buffer_id: I("buf_storage"), offset: 0, size: null } } },
  ] }] },
  "device-create-shader-module": { CreateShaderModule: [I("shader"),
    { label: "w3-shader", shader_bound_checks: { runtime_checks: true } }, WGSL] },
  "device-create-compute-pipeline": { CreateComputePipeline: [I("cpipe"), {
    label: "w3-cpipe", layout: I("pl"), stage: STAGE(I("shader"), "cs_main", { scale: 2.5 }), cache: null }, null] },
  "device-create-compute-pipeline-implicit": { CreateComputePipeline: [I("cpipe_auto"), {
    label: null, layout: null, stage: STAGE(I("shader"), "cs_main"), cache: null },
    { pipeline: I("cpipe_auto_pl"),
      bind_groups: Array.from({ length: ids.cpipe_auto_bgl_count }, (_, i) => Iraw(ids.cpipe_auto_bgl0.index + i)) }] },
  "device-compute-pipeline-get-bgl": { ComputePipelineGetBindGroupLayout: [I("cpipe_auto"), 0, I("cpipe_get_bgl")] },
  "device-create-render-pipeline": { CreateRenderPipeline: [I("rpipe"), {
    label: "w3-rpipe", layout: I("pl"),
    vertex: { stage: STAGE(I("shader"), "vs_main"), buffers: [{ arrayStride: 12, stepMode: "vertex", attributes: [
      { format: "float32x2", offset: 0, shaderLocation: 0 },
      { format: "unorm8x4", offset: 8, shaderLocation: 1 } ] }] },
    primitive: { topology: "triangle-list", stripIndexFormat: null, frontFace: "ccw", cullMode: "back",
      unclippedDepth: false, polygonMode: "fill", conservative: false },
    depth_stencil: { format: "depth24plus-stencil8", depth_write_enabled: true, depth_compare: "less",
      stencil: {
        front: { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "replace" },
        back: { compare: "always", failOp: "keep", depthFailOp: "keep", passOp: "keep" },
        read_mask: 0xff, write_mask: 0x0f },
      bias: { constant: 2, slope_scale: 1.5, clamp: 0 } },
    multisample: { count: 1, mask: 0xffff_ffff_ffff_ffffn, alphaToCoverageEnabled: false },
    fragment: { stage: STAGE(I("shader"), "fs_main"), targets: [{ format: "rgba8unorm", blend: {
      color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } }, writeMask: 15 }] },
    multiview: null, cache: null }, null] },
  "device-render-pipeline-get-bgl": { RenderPipelineGetBindGroupLayout: [I("rpipe"), 0, I("rpipe_get_bgl")] },
  "device-create-command-encoder": { CreateCommandEncoder: [I("encoder"), { label: "w3-encoder" }] },
  "device-create-render-bundle": { CreateRenderBundle: [I("bundle"), {
    base: { label: "w3-bundle-enc", commands: [
      { SetPipeline: I("rpipe") },
      { SetBindGroup: { index: 0, num_dynamic_offsets: 1, bind_group_id: I("bg") } },
      { SetVertexBuffer: { slot: 0, buffer_id: I("buf_vertex"), offset: 0, size: null } },
      { Draw: { vertex_count: 3, instance_count: 1, first_vertex: 0, first_instance: 0 } } ],
      dynamic_offsets: [512], string_data: [], push_constant_data: [] },
    parent_id: I("device"),
    context: { attachments: { colors: ["rgba8unorm"], resolves: [], depth_stencil: "depth24plus-stencil8" }, sample_count: 1, multiview: null },
    is_depth_read_only: false, is_stencil_read_only: true }, { label: "w3-bundle" }] },
  "device-create-render-bundle-error": { CreateRenderBundleError: [I("bundle_err"), "w3-bundle-bad"] },
  "device-error": { Error: {
    message: (m) => typeof m === "string" && m.includes("create_render_bundle_encoder") && m.includes("color attachments 9"),
    type: "Validation" } },
  "encoder-copy-buffer-to-buffer": { CopyBufferToBuffer: {
    src: I("buf_storage"), src_offset: 16, dst: I("buf_readback"), dst_offset: 32, size: 1024 } },
  "encoder-copy-texture-to-buffer": { CopyTextureToBuffer: {
    src: COPY_TEX(I("texture"), 0),
    dst: { buffer: I("buf_readback"), layout: { offset: 512, bytes_per_row: 256, rows_per_image: 32 } },
    size: { width: 16, height: 8, depthOrArrayLayers: 1 } } },
  "encoder-copy-buffer-to-texture": { CopyBufferToTexture: {
    src: { buffer: I("buf_storage"), layout: { offset: 0, bytes_per_row: 256, rows_per_image: null } },
    dst: COPY_TEX(I("texture"), 1), size: { width: 8, height: 4, depthOrArrayLayers: 1 } } },
  "encoder-copy-texture-to-texture": { CopyTextureToTexture: {
    src: COPY_TEX(I("texture"), 0), dst: COPY_TEX(I("texture2"), 0), size: { width: 8, height: 8, depthOrArrayLayers: 1 } } },
  "encoder-clear-buffer": { ClearBuffer: { dst: I("buf_storage"), offset: 64, size: 128 } },
  "encoder-clear-buffer-whole": { ClearBuffer: { dst: I("buf_storage"), offset: 0, size: null } },
  "encoder-push-debug-group": { PushDebugGroup: "w3-group" },
  "encoder-pop-debug-group": "PopDebugGroup",
  "encoder-insert-debug-marker": { InsertDebugMarker: "w3-marker é" },
  "render-pass": {
    base: { label: "w3-rpass", commands: [
      { PushDebugGroup: { color: 0, len: 9 } },
      { SetPipeline: I("rpipe") },
      { SetBindGroup: { index: 0, num_dynamic_offsets: 2, bind_group_id: I("bg") } },
      { SetVertexBuffer: { slot: 0, buffer_id: I("buf_vertex"), offset: 48, size: 96 } },
      { SetIndexBuffer: { buffer_id: I("buf_vertex"), index_format: "uint16", offset: 0, size: null } },
      { SetViewport: { x: 0, y: 0, w: 64, h: 32, depth_min: 0, depth_max: 1 } },
      { SetScissor: { x: 1, y: 2, w: 30, h: 20 } },
      { SetBlendConstant: { r: 1, g: 0, b: 0.5, a: 0.25 } },
      { SetStencilReference: 7 },
      { Draw: { vertex_count: 3, instance_count: 2, first_vertex: 1, first_instance: 0 } },
      { InsertDebugMarker: { color: 0, len: 10 } },
      { DrawIndexed: { index_count: 6, instance_count: 1, first_index: 0, base_vertex: -2, first_instance: 0 } },
      { MultiDrawIndirect: { buffer_id: I("buf_storage"), offset: 256, count: null, indexed: false } },
      { BeginOcclusionQuery: { query_index: 5 } },
      "EndOcclusionQuery",
      "PopDebugGroup" ],
      dynamic_offsets: [256, 768], string_data: strBytes("w3-rgroupw3-rmarker") },
    color_attachments: [{ view: I("view"), resolve_target: null, channel: {
      load_op: "clear", store_op: "store", clear_value: { r: 0.25, g: 0.5, b: 0.75, a: 1 }, read_only: false } }],
    depth_stencil_attachment: { view: I("view"),
      depth: { load_op: "clear", store_op: "discard", clear_value: 1, read_only: false },
      stencil: { load_op: "load", store_op: "store", clear_value: 0, read_only: false } },
    timestamp_writes: { query_set: I("qset"), beginning_of_pass_write_index: 0, end_of_pass_write_index: 1 },
    occlusion_query_set_id: I("qset"),
  },
  "compute-pass": {
    base: { label: "w3-cpass", commands: [
      { PushDebugGroup: { color: 0, len: 9 } },
      { SetPipeline: I("cpipe") },
      { SetBindGroup: { index: 0, num_dynamic_offsets: 1, bind_group_id: I("bg") } },
      { Dispatch: [4, 2, 1] },
      { InsertDebugMarker: { color: 0, len: 10 } },
      { DispatchIndirect: { buffer_id: I("buf_storage"), offset: 64 } },
      "PopDebugGroup" ],
      dynamic_offsets: [1024], string_data: strBytes("w3-cgroupw3-cmarker") },
    timestamp_writes: null,
  },
  "queue-write-buffer": { Buffer: { dst: I("buf_uniform"), offset: 256 } },
  "queue-write-texture": { Texture: {
    dst: COPY_TEX(I("texture"), 0), layout: { offset: 0, bytes_per_row: 256, rows_per_image: 32 },
    size: { width: 16, height: 16, depthOrArrayLayers: 1 } } },
};

// ---------------------------------------------------------------- goldens
const goldenResults = [];
ok(Object.keys(EXPECTED).length === goldens.size, `expected table covers ${Object.keys(EXPECTED).length} of ${goldens.size} goldens`);
const goldenText = new Map();
for (const g of goldens.values()) {
  const before = checks - failures.length;
  const r = dec.decode(g.kind, g.bytes);
  const f0 = failures.length;
  ok(r.status === 0 && r.ok === true, `${g.name}: status ${r.status} ${r.error ?? ""}`);
  ok(r.kind === g.kind, `${g.name}: kind ${r.kind}`);
  ok(r.canonical === true, `${g.name}: re-encoding is not byte-identical`);
  ok(g.name in EXPECTED, `${g.name}: no expectation`);
  const c0 = checks;
  if (g.name in EXPECTED) cmp(g.name, r.value, EXPECTED[g.name]);
  // Same text through the portable tokenizer path must give the same value.
  const text = dec.lastResultText();
  goldenText.set(g.name, text);
  const viaTok = decTok.decode(g.kind, g.bytes);
  ok(show(viaTok.value) === show(r.value), `${g.name}: tokenizer parse differs`);
  ok(show(parseWireJson(text, { forceReviver: true }).value) === show(r.value), `${g.name}: reviver parse differs`);
  // Numeric kind is accepted too.
  ok(dec.decode(KINDS.indexOf(g.kind) + 1, g.bytes).status === 0, `${g.name}: numeric kind`);
  goldenResults.push({ name: g.name, kind: g.kind, bytes: g.bytes.length, fieldChecks: checks - c0, pass: failures.length === f0 });
}

// ---------------------------------------------------------------- negatives
const CANARY = goldens.get("render-pass");
const canaryText = goldenText.get("render-pass");
let traps = 0;
let negatives = 0;
const negSummary = {};
function stillUsable(label) {
  const r = dec.decode(CANARY.kind, CANARY.bytes);
  return ok(r.status === 0 && dec.lastResultText() === canaryText, `instance unusable after ${label}`);
}
function reject(category, label, kind, bytes, { status = 1, errorIncludes } = {}) {
  negatives++;
  negSummary[category] = (negSummary[category] ?? 0) + 1;
  let r;
  try {
    r = dec.decode(kind, bytes);
  } catch (e) {
    traps++;
    ok(false, `${category}/${label}: trapped: ${e}`);
    return;
  }
  ok(r.status === status && r.ok === false && typeof r.error === "string", `${category}/${label}: expected status ${status}, got ${r.status} ${show(r.value ?? r.error)}`);
  if (errorIncludes) ok(r.error?.includes(errorIncludes), `${category}/${label}: error "${r.error}" lacks "${errorIncludes}"`);
  stillUsable(`${category}/${label}`);
}
function accept(label, kind, bytes, check) {
  let r;
  try {
    r = dec.decode(kind, bytes);
  } catch (e) {
    traps++;
    ok(false, `${label}: trapped: ${e}`);
    return;
  }
  if (ok(r.status === 0, `${label}: expected success, got ${r.status} ${r.error ?? ""}`)) check(r.value, r);
  stillUsable(label);
}

// Every truncation prefix of every golden (bincode is prefix-free per type).
for (const g of goldens.values()) {
  for (let n = 0; n < g.bytes.length; n++) reject("truncation", `${g.name}[0..${n}]`, g.kind, g.bytes.subarray(0, n));
}
// Trailing garbage (Firefox's bincode::deserialize would ignore it; W3 rejects).
for (const g of goldens.values()) {
  reject("trailing", `${g.name}+00`, g.kind, cat(g.bytes, [0]), { errorIncludes: "bytes remaining" });
  reject("trailing", `${g.name}+7`, g.kind, cat(g.bytes, [1, 2, 3, 4, 5, 6, 7]));
}
// Oversized input.
{
  const ex = dec.exports;
  const max = dec.maxInput;
  ok(max === 16 << 20, `max_input ${max}`);
  ok(ex.alloc(max + 1) === 0, "alloc(max+1) must return 0");
  ok(ex.alloc(0) === 0, "alloc(0) must return 0");
  reject("oversized", "wrapper max+1", "ComputePass", new Uint8Array(max + 1), { status: 3 });
  // Direct ABI: decode(kind, ptr, huge len) never reads memory.
  negatives++;
  ok(ex.decode(4, 8, 0xffff_ffff) === 3, "decode(len=0xffffffff) must return 3");
  stillUsable("raw oversized");
  // Bad pointer: range past the end of linear memory.
  negatives++;
  ok(ex.decode(4, ex.memory.buffer.byteLength - 4, 64) === 4, "decode(out-of-bounds ptr) must return 4");
  ok(ex.decode(4, 0, 16) === 4, "decode(null ptr, len 16) must return 4");
  stillUsable("bad pointer");
}
// Bad kind.
for (const k of [0, 8, 9, 0x7fffffff, 0xffffffff, "NoSuchKind"]) {
  reject("bad-kind", String(k), k, goldens.get("compute-pass").bytes, { status: 2 });
}
// Huge claimed lengths.
{
  const cp = goldens.get("compute-pass").bytes; // 01 | len u64 @1 | "w3-cpass" | cmds u64 @17 | ...
  for (const n of [2n ** 62n, 2n ** 64n - 1n, 1n << 32n, 1_000_000n]) {
    reject("huge-length", `commands=${n}`, "ComputePass", patched(cp, 17, u64le(n)));
    reject("huge-length", `label=${n}`, "ComputePass", patched(cp, 1, u64le(n)));
  }
  const sd = find(cp, cat(u64le(19), strBytes("w3-cgroup")));
  ok(sd > 0, "locate compute string_data");
  reject("huge-length", "string_data=2^63", "ComputePass", patched(cp, sd, u64le(2n ** 63n)));
  const sm = goldens.get("device-create-shader-module").bytes;
  const wl = find(sm, cat(u64le(WGSL.length), strBytes("@group")));
  ok(wl > 0, "locate WGSL length");
  reject("huge-length", "wgsl=2^64-1", "DeviceAction", patched(sm, wl, u64le(2n ** 64n - 1n)));
}
// Bad enum tags.
{
  const cb = goldens.get("encoder-clear-buffer").bytes; // Command tag @0, Id @4..20, offset u64 @20, Option @28, u64 @29
  reject("bad-tag", "Command=0xff", "CommandEncoderAction", patched(cb, 0, u32le(0xff)));
  reject("bad-tag", "Command=0xffffffff", "CommandEncoderAction", patched(cb, 0, u32le(0xffffffff)));
  reject("bad-tag", "SerialId=1", "CommandEncoderAction", patched(cb, 4, u32le(1)));
  reject("bad-tag", "Option=2", "CommandEncoderAction", patched(cb, 28, [2]));
  reject("bad-tag", "DeviceAction=99", "DeviceAction", patched(goldens.get("device-create-sampler").bytes, 0, u32le(99)));
  reject("bad-tag", "ComputeCommand=10", "ComputePass", patched(goldens.get("compute-pass").bytes, 0x19, u32le(10)));
  reject("bad-tag", "QueueWriteAction=2", "QueueWriteAction", patched(goldens.get("queue-write-buffer").bytes, 0, u32le(2)));
  reject("bad-tag", "TextureAction=1", "TextureAction", patched(goldens.get("texture-create-view").bytes, 0, u32le(1)));
  reject("bad-tag", "PopDebugGroup+pad", "CommandEncoderAction", u32le(0x7fffffff));
}
// Id guard: every case that would panic in RawId::zip or Backend serialization.
{
  const cb = goldens.get("encoder-clear-buffer").bytes;
  const ID = 8; // index @8, epoch @12, backend @16
  reject("id-guard", "epoch=2^29", "CommandEncoderAction", patched(cb, ID + 4, u32le(1 << 29)), { errorIncludes: "epoch" });
  reject("id-guard", "epoch=2^32-1", "CommandEncoderAction", patched(cb, ID + 4, u32le(0xffffffff)), { errorIncludes: "epoch" });
  reject("id-guard", "backend=5", "CommandEncoderAction", patched(cb, ID + 8, u32le(5)), { errorIncludes: "backend" });
  reject("id-guard", "backend=0xffffffff", "CommandEncoderAction", patched(cb, ID + 8, u32le(0xffffffff)), { errorIncludes: "backend" });
  reject("id-guard", "zero id", "CommandEncoderAction", patched(cb, ID, cat(u32le(0), u32le(0), u32le(0))), { errorIncludes: "zero" });
  // Boundaries that must still decode.
  const idOf = (v) => v.ClearBuffer.dst.Id;
  accept("id-guard epoch=2^29-1", "CommandEncoderAction", patched(cb, ID + 4, u32le((1 << 29) - 1)),
    (v) => cmp("epoch 2^29-1", idOf(v), [2, (1 << 29) - 1, "Vulkan"]));
  accept("id-guard index=2^32-1", "CommandEncoderAction", patched(cb, ID, u32le(0xffffffff)),
    (v) => cmp("index max", idOf(v), [0xffffffff, 1, "Vulkan"]));
  accept("id-guard 0,0,Vulkan", "CommandEncoderAction", patched(cb, ID, cat(u32le(0), u32le(0), u32le(1))),
    (v) => cmp("0,0,Vulkan", idOf(v), [0, 0, "Vulkan"]));
  ["Empty", "Vulkan", "Metal", "Dx12", "Gl"].forEach((name, b) =>
    accept(`id-guard backend=${b}`, "CommandEncoderAction", patched(cb, ID + 8, u32le(b)),
      (v) => cmp(`backend ${b}`, idOf(v)[2], name)));
  // Guard applies inside nested containers too (bind group entry buffer id).
  const bgb = goldens.get("device-create-bind-group").bytes;
  const at = find(bgb, cat(u32le(0), u32le(ids.buf_uniform.index), u32le(1), u32le(1)));
  ok(at > 0, "locate nested buffer id");
  reject("id-guard", "nested epoch=2^29", "DeviceAction", patched(bgb, at + 8, u32le(1 << 29)), { errorIncludes: "epoch" });
  reject("id-guard", "nested backend=7", "DeviceAction", patched(bgb, at + 12, u32le(7)), { errorIncludes: "backend" });
}
// Zero BufferSize (NonZeroU64).
{
  const rp = goldens.get("render-pass").bytes;
  const vb = find(rp, cat(u64le(48), [1], u64le(96)));
  ok(vb > 0, "locate SetVertexBuffer size");
  reject("zero-buffersize", "SetVertexBuffer.size=0", "RenderPass", patched(rp, vb + 9, u64le(0)));
  const bgb = goldens.get("device-create-bind-group").bytes;
  const bs = find(bgb, cat(u64le(256), [1], u64le(64)));
  ok(bs > 0, "locate bind group entry size");
  reject("zero-buffersize", "BindGroupEntry.size=0", "DeviceAction", patched(bgb, bs + 9, u64le(0)));
}
// Colour attachments: ArrayVec capacity 8.
{
  const rp = goldens.get("render-pass").bytes;
  const sd = find(rp, cat(u64le(19), strBytes("w3-rgroup")));
  ok(sd > 0, "locate render string_data");
  const lenAt = sd + 8 + 19;
  ok(show(Array.from(rp.subarray(lenAt, lenAt + 8))) === show(Array.from(u64le(1))), "colour attachment count is 1");
  const ELEM = 1 + 16 + 1 + 4 + 4 + 32 + 1; // Some | view | resolve None | load | store | Color | read_only
  const head = rp.subarray(0, lenAt);
  const elem = rp.subarray(lenAt + 8, lenAt + 8 + ELEM);
  const tail = rp.subarray(lenAt + 8 + ELEM);
  const withN = (n) => cat(head, u64le(n), ...Array(n).fill(elem), tail);
  accept("colour-attachments=8", "RenderPass", withN(8), (v) => {
    ok(v.color_attachments.length === 8, "8 colour attachments");
    cmp("attachment[7]", v.color_attachments[7], EXPECTED["render-pass"].color_attachments[0]);
  });
  reject("colour-attachments", "9", "RenderPass", withN(9));
  reject("colour-attachments", "claim 9 with 8 present", "RenderPass", cat(head, u64le(9), ...Array(8).fill(elem), tail));
  reject("colour-attachments", "claim 2^40", "RenderPass", cat(head, u64le(2n ** 40n), elem, tail));
}
// Strings: invalid UTF-8, unknown texture format.
{
  const pd = goldens.get("encoder-push-debug-group").bytes; // tag | len u64 | "w3-group"
  reject("utf8", "0xff", "CommandEncoderAction", patched(pd, 12, [0xff]));
  reject("utf8", "lone continuation", "CommandEncoderAction", patched(pd, 13, [0x80]));
  reject("utf8", "overlong NUL", "CommandEncoderAction", patched(pd, 12, [0xc0, 0x80]));
  reject("utf8", "surrogate", "CommandEncoderAction", patched(pd, 12, [0xed, 0xa0, 0x80]));
  const im = goldens.get("encoder-insert-debug-marker").bytes;
  reject("utf8", "truncated 2-byte", "CommandEncoderAction", patched(im, im.length - 1, [0x41]));
  const tx = goldens.get("device-create-texture").bytes;
  const f = find(tx, cat(u64le(10), strBytes("rgba8unorm")));
  ok(f > 0, "locate texture format");
  reject("format", "rgba8unorz", "DeviceAction", patched(tx, f + 8 + 9, strBytes("z")));
  reject("format", "bad utf8 format", "DeviceAction", patched(tx, f + 8, [0xff]));
  reject("format", "empty format", "DeviceAction", cat(tx.subarray(0, f), u64le(0), tx.subarray(f + 18)));
}
// Non-finite floats (WebIDL restricted float/double; JSON has no NaN/Inf).
{
  const s = goldens.get("device-create-sampler").bytes;
  const at = find(s, cat(new Uint8Array(new Float32Array([0.5]).buffer), new Uint8Array(new Float32Array([8]).buffer)));
  ok(at > 0, "locate lod clamps");
  const f32 = (x) => new Uint8Array(new Float32Array([x]).buffer);
  const f64 = (x) => new Uint8Array(new Float64Array([x]).buffer);
  reject("non-finite", "lod_min=NaN", "DeviceAction", patched(s, at, f32(NaN)), { errorIncludes: "non-finite" });
  reject("non-finite", "lod_max=+Inf", "DeviceAction", patched(s, at + 4, f32(Infinity)), { errorIncludes: "non-finite" });
  const rp = goldens.get("render-pass").bytes;
  const cv = find(rp, cat(f64(0.25), f64(0.5), f64(0.75), f64(1)));
  ok(cv > 0, "locate clear colour");
  reject("non-finite", "clear.r=-Inf", "RenderPass", patched(rp, cv, f64(-Infinity)), { errorIncludes: "non-finite" });
  const cpp = goldens.get("device-create-compute-pipeline").bytes;
  const k = find(cpp, f64(2.5));
  ok(k > 0, "locate constant");
  reject("non-finite", "constant=NaN", "DeviceAction", patched(cpp, k, f64(NaN)), { errorIncludes: "non-finite" });
  accept("finite -0.0 constant", "DeviceAction", patched(cpp, k, f64(-0)), (v) =>
    ok(Object.is(v.CreateComputePipeline[1].stage.constants.scale, -0) || v.CreateComputePipeline[1].stage.constants.scale === 0, "-0 constant"));
}
// Seeded mutation fuzz: 1-4 byte flips of every golden, plus random buffers.
// No trap is permitted; each result is either a success or a structured error.
let fuzzOk = 0, fuzzErr = 0;
{
  let x = 0x9e3779b9;
  const rnd = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0));
  for (const g of goldens.values()) {
    for (let i = 0; i < 300; i++) {
      const b = new Uint8Array(g.bytes);
      const flips = 1 + (rnd() % 4);
      for (let j = 0; j < flips; j++) b[rnd() % b.length] = rnd() & 0xff;
      let r;
      try {
        r = dec.decode(g.kind, b);
      } catch (e) {
        traps++;
        ok(false, `fuzz ${g.name}#${i}: trapped: ${e}`);
        continue;
      }
      checks++;
      if (r.status === 0) fuzzOk++;
      else if (r.status === 1 && typeof r.error === "string") fuzzErr++;
      else failures.push(`fuzz ${g.name}#${i}: status ${r.status}`);
    }
    stillUsable(`fuzz ${g.name}`);
  }
  for (let k = 1; k <= KINDS.length; k++) {
    for (let i = 0; i < 300; i++) {
      const b = new Uint8Array(rnd() % 257);
      for (let j = 0; j < b.length; j++) b[j] = rnd() & 0xff;
      let r;
      try {
        r = dec.decode(k, b);
      } catch (e) {
        traps++;
        ok(false, `random kind ${k}#${i}: trapped: ${e}`);
        continue;
      }
      checks++;
      if (r.status === 0) fuzzOk++;
      else if (r.status === 1) fuzzErr++;
      else failures.push(`random kind ${k}#${i}: status ${r.status}`);
    }
  }
  stillUsable("random buffers");
}

// ---------------------------------------------------------------- timing
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}
const perGolden = {};
{
  const ITER = 2000;
  for (const g of goldens.values()) {
    const ts = [];
    for (let i = 0; i < ITER; i++) {
      const a = performance.now();
      dec.decode(g.kind, g.bytes);
      ts.push(performance.now() - a);
    }
    perGolden[g.name] = { bytes: g.bytes.length, medianUs: +(median(ts) * 1000).toFixed(2) };
  }
}
// Large synthetic compute pass: N Dispatch commands.
let bigPass;
{
  const N = 500_000;
  const cmd = cat(u32le(2), u32le(7), u32le(8), u32le(9)); // ComputeCommand::Dispatch([7,8,9])
  const body = new Uint8Array(N * cmd.length);
  for (let i = 0; i < N; i++) body.set(cmd, i * cmd.length);
  const bytes = cat([0], u64le(N), body, u64le(0), u64le(0), [0]); // label None, commands, dyn offsets, string data, timestamp None
  const runs = [];
  let r;
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    r = dec.decode("ComputePass", bytes);
    runs.push(performance.now() - a);
  }
  const good = ok(r.status === 0 && r.canonical === true && r.value.base.commands.length === N, "big compute pass decodes");
  if (good) cmp("big pass last", r.value.base.commands[N - 1], { Dispatch: [7, 8, 9] });
  const ms = median(runs);
  // Split: Wasm decode + re-encode + JSON serialization only (no JS parse).
  const ex = dec.exports;
  const p = ex.alloc(bytes.length) >>> 0;
  new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
  const wasmRuns = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    ok(ex.decode(4, p, bytes.length) === 0, "raw big pass decode");
    wasmRuns.push(performance.now() - a);
  }
  ex.free(p, bytes.length);
  const text = dec.lastResultText();
  const parseRuns = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    parseWireJson(text);
    parseRuns.push(performance.now() - a);
  }
  const reviverRuns = [];
  for (let i = 0; i < 3; i++) {
    const a = performance.now();
    parseWireJson(text, { forceReviver: true });
    reviverRuns.push(performance.now() - a);
  }
  bigPass = {
    commands: N, inputBytes: bytes.length, jsonBytes: dec.lastResultText().length,
    medianMs: +ms.toFixed(1), wasmOnlyMedianMs: +median(wasmRuns).toFixed(1), jsonParseMedianMs: +median(parseRuns).toFixed(1), reviverParseMedianMs: +median(reviverRuns).toFixed(1),
    inputMBps: +(bytes.length / 1e6 / (ms / 1000)).toFixed(1),
    memoryBytesAfter: dec.memoryBytes(),
  };
  stillUsable("big pass");
}

// ---------------------------------------------------------------- report
const result = {
  schema: "firefox-webgpu-w3-gate-v1",
  pass: failures.length === 0 && traps === 0,
  checks,
  failures: failures.slice(0, 50),
  failureCount: failures.length,
  traps,
  goldens: { count: goldens.size, passed: goldenResults.filter((g) => g.pass).length,
    fieldChecks: goldenResults.reduce((a, g) => a + g.fieldChecks, 0), results: goldenResults },
  negatives: { cases: negatives, byCategory: negSummary },
  fuzz: { mutants: goldens.size * 300, randomBuffers: KINDS.length * 300, decodedOk: fuzzOk, structuredErrors: fuzzErr },
  wasm: { path: path.resolve(wasmPath), bytes: wasmBytes.length, sha256: sha256(wasmBytes), imports: 0,
    exports: WebAssembly.Module.exports(module).map((e) => e.name) },
  timing: {
    node: process.version,
    compileMs: +(t1 - t0).toFixed(2), instantiateMs: +(t2 - t1).toFixed(2),
    perGoldenMedianUs: perGolden, bigComputePass: bigPass,
    parseMode: "plain JSON.parse unless a 16+ digit run exists, then source-text reviver; reviver and tokenizer paths cross-checked per golden",
  },
  memoryBytesEnd: dec.memoryBytes(),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, (k, v) => (typeof v === "bigint" ? v.toString() : v), 1) + "\n");
console.log(JSON.stringify({ pass: result.pass, checks, failures: failures.length, traps, goldens: result.goldens.passed,
  negatives: negatives, wasmBytes: wasmBytes.length, sha256: result.wasm.sha256, bigPassMs: bigPass.medianMs }, null, 1));
if (failures.length) console.log(failures.slice(0, 20).join("\n"));
process.exit(result.pass ? 0 : 1);
