//! Golden generator for the Firefox 128 WebGPU client wire format (packet W3).
//!
//! Every golden except `device-create-shader-module` is produced by calling the
//! real, unmodified `gfx/wgpu_bindings` client functions that the Firefox
//! content process calls, so the bytes come from the exact
//! `bincode::serialize` path (`make_byte_buf`) Firefox 128.14.0esr uses.
//!
//! Descriptor structs in `client.rs` have private fields. The harness builds
//! layout-identical `#[repr(C)]` mirrors and passes them by pointer cast, the
//! same way C++ passes its cbindgen-generated structs.
//!
//! Firefox 128 never serializes `DeviceAction::CreateShaderModule` (shader
//! modules use the direct `wgpu_server_device_create_shader_module` FFI), so
//! that golden comes from a mirror of the private `DeviceAction` enum. The
//! mirror is cross-checked by re-serializing `CreateCommandEncoder` and
//! `CreateSampler` and comparing them byte-for-byte to the real client output.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::ffi::CString;
use std::io::Write;
use std::os::raw::c_char;
use std::path::PathBuf;

use nsstring::{nsACString, nsCStr};
use wgc::id;
use wgpu_bindings::client as cl;
use wgpu_bindings::command as cmd;

#[repr(C)]
struct MByteBuf {
    data: *const u8,
    len: usize,
    capacity: usize,
}

fn new_bb() -> wgpu_bindings::ByteBuf {
    // ByteBuf is #[repr(C)] { *const u8, usize, usize } with private fields.
    unsafe { std::mem::zeroed() }
}

fn bb_bytes(bb: &wgpu_bindings::ByteBuf) -> Vec<u8> {
    let m = unsafe { &*(bb as *const wgpu_bindings::ByteBuf as *const MByteBuf) };
    if m.data.is_null() {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(m.data, m.len) }.to_vec()
}

// ---- layout-identical mirrors of client.rs private-field descriptors ----

#[repr(C)]
struct MConstantEntry {
    key: *const c_char,
    value: f64,
}

#[repr(C)]
struct MProgrammableStage {
    module: id::ShaderModuleId,
    entry_point: *const c_char,
    constants: *const MConstantEntry,
    constants_length: usize,
}

#[repr(C)]
struct MComputePipelineDescriptor<'a> {
    label: Option<&'a nsACString>,
    layout: Option<id::PipelineLayoutId>,
    stage: MProgrammableStage,
}

#[repr(C)]
struct MVertexBufferLayout {
    array_stride: wgt::BufferAddress,
    step_mode: wgt::VertexStepMode,
    attributes: *const wgt::VertexAttribute,
    attributes_length: usize,
}

#[repr(C)]
struct MVertexState {
    stage: MProgrammableStage,
    buffers: *const MVertexBufferLayout,
    buffers_length: usize,
}

#[repr(C)]
struct MColorTargetState<'a> {
    format: wgt::TextureFormat,
    blend: Option<&'a wgt::BlendState>,
    write_mask: wgt::ColorWrites,
}

#[repr(C)]
struct MFragmentState<'a> {
    stage: MProgrammableStage,
    targets: *const MColorTargetState<'a>,
    targets_length: usize,
}

#[repr(C)]
struct MPrimitiveState<'a> {
    topology: wgt::PrimitiveTopology,
    strip_index_format: Option<&'a wgt::IndexFormat>,
    front_face: wgt::FrontFace,
    cull_mode: Option<&'a wgt::Face>,
    polygon_mode: wgt::PolygonMode,
    unclipped_depth: bool,
}

#[repr(C)]
struct MRenderPipelineDescriptor<'a> {
    label: Option<&'a nsACString>,
    layout: Option<id::PipelineLayoutId>,
    vertex: &'a MVertexState,
    primitive: MPrimitiveState<'a>,
    fragment: Option<&'a MFragmentState<'a>>,
    depth_stencil: Option<&'a wgt::DepthStencilState>,
    multisample: wgt::MultisampleState,
}

#[repr(C)]
#[allow(dead_code)]
enum MRawTextureSampleType {
    Float,
    UnfilterableFloat,
    Uint,
    Sint,
    Depth,
}

#[repr(C)]
#[allow(dead_code)]
enum MRawBindingType {
    UniformBuffer,
    StorageBuffer,
    ReadonlyStorageBuffer,
    Sampler,
    SampledTexture,
    ReadonlyStorageTexture,
    WriteonlyStorageTexture,
    ReadWriteStorageTexture,
}

#[repr(C)]
struct MBindGroupLayoutEntry<'a> {
    binding: u32,
    visibility: wgt::ShaderStages,
    ty: MRawBindingType,
    has_dynamic_offset: bool,
    min_binding_size: Option<wgt::BufferSize>,
    view_dimension: Option<&'a wgt::TextureViewDimension>,
    texture_sample_type: Option<&'a MRawTextureSampleType>,
    multisampled: bool,
    storage_texture_format: Option<&'a wgt::TextureFormat>,
    sampler_filter: bool,
    sampler_compare: bool,
}

#[repr(C)]
struct MBindGroupLayoutDescriptor<'a> {
    label: Option<&'a nsACString>,
    entries: *const MBindGroupLayoutEntry<'a>,
    entries_length: usize,
}

#[repr(C)]
struct MBindGroupEntry {
    binding: u32,
    buffer: Option<id::BufferId>,
    offset: wgt::BufferAddress,
    size: Option<wgt::BufferSize>,
    sampler: Option<id::SamplerId>,
    texture_view: Option<id::TextureViewId>,
}

#[repr(C)]
struct MBindGroupDescriptor<'a> {
    label: Option<&'a nsACString>,
    layout: id::BindGroupLayoutId,
    entries: *const MBindGroupEntry,
    entries_length: usize,
}

#[repr(C)]
struct MPipelineLayoutDescriptor<'a> {
    label: Option<&'a nsACString>,
    bind_group_layouts: *const id::BindGroupLayoutId,
    bind_group_layouts_length: usize,
}

#[repr(C)]
struct MSamplerDescriptor<'a> {
    label: Option<&'a nsACString>,
    address_modes: [wgt::AddressMode; 3],
    mag_filter: wgt::FilterMode,
    min_filter: wgt::FilterMode,
    mipmap_filter: wgt::FilterMode,
    lod_min_clamp: f32,
    lod_max_clamp: f32,
    compare: Option<&'a wgt::CompareFunction>,
    max_anisotropy: u16,
}

#[repr(C)]
struct MTextureViewDescriptor<'a> {
    label: Option<&'a nsACString>,
    format: Option<&'a wgt::TextureFormat>,
    dimension: Option<&'a wgt::TextureViewDimension>,
    aspect: wgt::TextureAspect,
    base_mip_level: u32,
    mip_level_count: Option<&'a u32>,
    base_array_layer: u32,
    array_layer_count: Option<&'a u32>,
}

#[repr(C)]
struct MRenderBundleEncoderDescriptor<'a> {
    label: Option<&'a nsACString>,
    color_formats: *const wgt::TextureFormat,
    color_formats_length: usize,
    depth_stencil_format: Option<&'a wgt::TextureFormat>,
    depth_read_only: bool,
    stencil_read_only: bool,
    sample_count: u32,
}

macro_rules! cast {
    ($v:expr, $t:ty) => {
        unsafe { &*(&$v as *const _ as *const $t) }
    };
}

// ---- mirror of the private DeviceAction enum (shader-module golden only) ----

#[derive(serde::Serialize)]
#[allow(dead_code)]
enum MErrorBufferType {
    None = 0,
    DeviceLost = 1,
    Internal = 2,
    OutOfMemory = 3,
    Validation = 4,
}

#[derive(serde::Serialize)]
struct MImplicitLayout<'a> {
    pipeline: id::PipelineLayoutId,
    bind_groups: Cow<'a, [Option<id::BindGroupLayoutId>]>,
}

#[derive(serde::Serialize)]
#[allow(dead_code)]
enum MDeviceAction<'a> {
    CreateTexture(id::TextureId, wgc::resource::TextureDescriptor<'a>, Option<wgpu_bindings::SwapChainId>),
    CreateSampler(id::SamplerId, wgc::resource::SamplerDescriptor<'a>),
    CreateBindGroupLayout(id::BindGroupLayoutId, wgc::binding_model::BindGroupLayoutDescriptor<'a>),
    RenderPipelineGetBindGroupLayout(id::RenderPipelineId, u32, id::BindGroupLayoutId),
    ComputePipelineGetBindGroupLayout(id::ComputePipelineId, u32, id::BindGroupLayoutId),
    CreatePipelineLayout(id::PipelineLayoutId, wgc::binding_model::PipelineLayoutDescriptor<'a>),
    CreateBindGroup(id::BindGroupId, wgc::binding_model::BindGroupDescriptor<'a>),
    CreateShaderModule(id::ShaderModuleId, wgc::pipeline::ShaderModuleDescriptor<'a>, Cow<'a, str>),
    CreateComputePipeline(id::ComputePipelineId, wgc::pipeline::ComputePipelineDescriptor<'a>, Option<MImplicitLayout<'a>>),
    CreateRenderPipeline(id::RenderPipelineId, wgc::pipeline::RenderPipelineDescriptor<'a>, Option<MImplicitLayout<'a>>),
    CreateRenderBundle(id::RenderBundleId, wgc::command::RenderBundleEncoder, wgc::command::RenderBundleDescriptor<'a>),
    CreateRenderBundleError(id::RenderBundleId, wgc::Label<'a>),
    CreateCommandEncoder(id::CommandEncoderId, wgt::CommandEncoderDescriptor<wgc::Label<'a>>),
    Error { message: String, r#type: MErrorBufferType },
}

// ---- output bookkeeping ----

struct Out {
    dir: PathBuf,
    entries: Vec<String>,
    ids: BTreeMap<String, String>,
}

impl Out {
    fn emit(&mut self, name: &str, kind: &str, source: &str, bytes: &[u8]) {
        assert!(!bytes.is_empty(), "{name}: empty byte buffer");
        let file = format!("{name}.bin");
        std::fs::write(self.dir.join(&file), bytes).unwrap();
        self.entries.push(format!(
            "{{\"name\":\"{name}\",\"kind\":\"{kind}\",\"file\":\"{file}\",\"size\":{},\"source\":\"{source}\"}}",
            bytes.len()
        ));
    }
    fn id<T: Copy + std::fmt::Debug>(&mut self, name: &str, raw: (u32, u32, wgt::Backend)) {
        let _ = std::marker::PhantomData::<T>;
        self.ids.insert(
            name.to_string(),
            format!("{{\"index\":{},\"epoch\":{},\"backend\":\"{:?}\"}}", raw.0, raw.1, raw.2),
        );
    }
    fn finish(&self) {
        let mut f = std::fs::File::create(self.dir.join("manifest-raw.json")).unwrap();
        writeln!(f, "{{\"generator\":\"webgpu-golden-harness\",\"goldens\":[").unwrap();
        writeln!(f, "{}", self.entries.join(",\n")).unwrap();
        writeln!(f, "],\"ids\":{{").unwrap();
        let ids: Vec<String> = self.ids.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
        writeln!(f, "{}", ids.join(",\n")).unwrap();
        writeln!(f, "}}}}").unwrap();
    }
}

macro_rules! rec {
    ($out:expr, $name:expr, $id:expr) => {
        $out.id::<()>($name, $id.unzip())
    };
}

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: harness OUTDIR"));
    std::fs::create_dir_all(&dir).unwrap();
    let mut out = Out { dir, entries: Vec::new(), ids: BTreeMap::new() };

    let infra = cl::wgpu_client_new();
    let client: &cl::Client = unsafe { &*infra.client };

    let mut adapters = [id::AdapterId::zip(1, 1, wgt::Backend::Empty); 4];
    let n = unsafe { cl::wgpu_client_make_adapter_ids(client, adapters.as_mut_ptr(), adapters.len()) };
    assert!(n >= 1);
    let adapter = adapters[0];
    rec!(out, "adapter", adapter);
    let device = cl::wgpu_client_make_device_id(client, adapter);
    rec!(out, "device", device);

    // 1. Device descriptor (wgpu_server_adapter_request_device payload).
    {
        let label = nsCStr::from("w3-device");
        let mut limits = wgt::Limits::default();
        limits.max_bind_groups = 4;
        limits.max_storage_buffer_binding_size = 1 << 27;
        let desc = wgt::DeviceDescriptor::<Option<&nsACString>> {
            label: Some(&*label),
            required_features: wgt::Features::DEPTH_CLIP_CONTROL | wgt::Features::TIMESTAMP_QUERY,
            required_limits: limits,
        };
        let mut bb = new_bb();
        cl::wgpu_client_serialize_device_descriptor(&desc, &mut bb);
        out.emit("device-descriptor", "DeviceDescriptor", "wgpu_client_serialize_device_descriptor", &bb_bytes(&bb));
    }

    // Buffer ids are allocated client-side; creation itself is direct FFI.
    let buf_vertex = cl::wgpu_client_make_buffer_id(client, device);
    let buf_uniform = cl::wgpu_client_make_buffer_id(client, device);
    let buf_storage = cl::wgpu_client_make_buffer_id(client, device);
    let buf_readback = cl::wgpu_client_make_buffer_id(client, device);
    rec!(out, "buf_vertex", buf_vertex);
    rec!(out, "buf_uniform", buf_uniform);
    rec!(out, "buf_storage", buf_storage);
    rec!(out, "buf_readback", buf_readback);

    // 2. Texture.
    let texture;
    {
        let label = nsCStr::from("w3-texture");
        let view_formats = [wgt::TextureFormat::Rgba8UnormSrgb];
        let desc = wgt::TextureDescriptor::<Option<&nsACString>, wgpu_bindings::FfiSlice<wgt::TextureFormat>> {
            label: Some(&*label),
            size: wgt::Extent3d { width: 64, height: 32, depth_or_array_layers: 1 },
            mip_level_count: 2,
            sample_count: 1,
            dimension: wgt::TextureDimension::D2,
            format: wgt::TextureFormat::Rgba8Unorm,
            usage: wgt::TextureUsages::COPY_SRC
                | wgt::TextureUsages::COPY_DST
                | wgt::TextureUsages::TEXTURE_BINDING
                | wgt::TextureUsages::RENDER_ATTACHMENT,
            view_formats: wgpu_bindings::FfiSlice {
                data: view_formats.as_ptr(),
                length: view_formats.len(),
                _marker: std::marker::PhantomData,
            },
        };
        let mut bb = new_bb();
        texture = cl::wgpu_client_create_texture(client, device, &desc, None, &mut bb);
        out.emit("device-create-texture", "DeviceAction", "wgpu_client_create_texture", &bb_bytes(&bb));
        rec!(out, "texture", texture);
    }
    // 2b. Swap-chain texture (Option<SwapChainId> = Some).
    let texture2;
    {
        let desc = wgt::TextureDescriptor::<Option<&nsACString>, wgpu_bindings::FfiSlice<wgt::TextureFormat>> {
            label: None,
            size: wgt::Extent3d { width: 16, height: 16, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgt::TextureDimension::D2,
            format: wgt::TextureFormat::Bgra8Unorm,
            usage: wgt::TextureUsages::COPY_SRC | wgt::TextureUsages::RENDER_ATTACHMENT,
            view_formats: wgpu_bindings::FfiSlice { data: std::ptr::null(), length: 0, _marker: std::marker::PhantomData },
        };
        let sc = wgpu_bindings::SwapChainId(0x1234_5678_9abc);
        let mut bb = new_bb();
        texture2 = cl::wgpu_client_create_texture(client, device, &desc, Some(&sc), &mut bb);
        out.emit("device-create-texture-swapchain", "DeviceAction", "wgpu_client_create_texture", &bb_bytes(&bb));
        rec!(out, "texture2", texture2);
    }

    // 3. Texture view (TextureAction).
    let view;
    {
        let label = nsCStr::from("w3-view");
        let fmt = wgt::TextureFormat::Rgba8UnormSrgb;
        let dim = wgt::TextureViewDimension::D2;
        let mips = 1u32;
        let d = MTextureViewDescriptor {
            label: Some(&*label),
            format: Some(&fmt),
            dimension: Some(&dim),
            aspect: wgt::TextureAspect::All,
            base_mip_level: 1,
            mip_level_count: Some(&mips),
            base_array_layer: 0,
            array_layer_count: None,
        };
        let mut bb = new_bb();
        view = cl::wgpu_client_create_texture_view(client, device, cast!(d, cl::TextureViewDescriptor), &mut bb);
        out.emit("texture-create-view", "TextureAction", "wgpu_client_create_texture_view", &bb_bytes(&bb));
        rec!(out, "view", view);
    }

    // 4. Sampler.
    let sampler;
    let sampler_bytes;
    {
        let label = nsCStr::from("w3-sampler");
        let cmp = wgt::CompareFunction::LessEqual;
        let d = MSamplerDescriptor {
            label: Some(&*label),
            address_modes: [wgt::AddressMode::Repeat, wgt::AddressMode::MirrorRepeat, wgt::AddressMode::ClampToEdge],
            mag_filter: wgt::FilterMode::Linear,
            min_filter: wgt::FilterMode::Nearest,
            mipmap_filter: wgt::FilterMode::Linear,
            lod_min_clamp: 0.5,
            lod_max_clamp: 8.0,
            compare: Some(&cmp),
            max_anisotropy: 4,
        };
        let mut bb = new_bb();
        sampler = cl::wgpu_client_create_sampler(client, device, cast!(d, cl::SamplerDescriptor), &mut bb);
        sampler_bytes = bb_bytes(&bb);
        out.emit("device-create-sampler", "DeviceAction", "wgpu_client_create_sampler", &sampler_bytes);
        rec!(out, "sampler", sampler);
    }

    // 5. Bind group layout.
    let bgl;
    {
        let label = nsCStr::from("w3-bgl");
        let d2 = wgt::TextureViewDimension::D2;
        let st = MRawTextureSampleType::Float;
        let sfmt = wgt::TextureFormat::Rgba8Unorm;
        let entries = [
            MBindGroupLayoutEntry {
                binding: 0,
                visibility: wgt::ShaderStages::VERTEX | wgt::ShaderStages::FRAGMENT,
                ty: MRawBindingType::UniformBuffer,
                has_dynamic_offset: true,
                min_binding_size: wgt::BufferSize::new(64),
                view_dimension: None,
                texture_sample_type: None,
                multisampled: false,
                storage_texture_format: None,
                sampler_filter: false,
                sampler_compare: false,
            },
            MBindGroupLayoutEntry {
                binding: 1,
                visibility: wgt::ShaderStages::FRAGMENT,
                ty: MRawBindingType::Sampler,
                has_dynamic_offset: false,
                min_binding_size: None,
                view_dimension: None,
                texture_sample_type: None,
                multisampled: false,
                storage_texture_format: None,
                sampler_filter: true,
                sampler_compare: false,
            },
            MBindGroupLayoutEntry {
                binding: 2,
                visibility: wgt::ShaderStages::FRAGMENT,
                ty: MRawBindingType::SampledTexture,
                has_dynamic_offset: false,
                min_binding_size: None,
                view_dimension: Some(&d2),
                texture_sample_type: Some(&st),
                multisampled: false,
                storage_texture_format: None,
                sampler_filter: false,
                sampler_compare: false,
            },
            MBindGroupLayoutEntry {
                binding: 3,
                visibility: wgt::ShaderStages::COMPUTE,
                ty: MRawBindingType::ReadonlyStorageBuffer,
                has_dynamic_offset: false,
                min_binding_size: None,
                view_dimension: None,
                texture_sample_type: None,
                multisampled: false,
                storage_texture_format: None,
                sampler_filter: false,
                sampler_compare: false,
            },
            MBindGroupLayoutEntry {
                binding: 4,
                visibility: wgt::ShaderStages::COMPUTE,
                ty: MRawBindingType::WriteonlyStorageTexture,
                has_dynamic_offset: false,
                min_binding_size: None,
                view_dimension: Some(&d2),
                texture_sample_type: None,
                multisampled: false,
                storage_texture_format: Some(&sfmt),
                sampler_filter: false,
                sampler_compare: false,
            },
        ];
        let d = MBindGroupLayoutDescriptor { label: Some(&*label), entries: entries.as_ptr(), entries_length: entries.len() };
        let mut bb = new_bb();
        bgl = unsafe { cl::wgpu_client_create_bind_group_layout(client, device, cast!(d, cl::BindGroupLayoutDescriptor), &mut bb) };
        out.emit("device-create-bind-group-layout", "DeviceAction", "wgpu_client_create_bind_group_layout", &bb_bytes(&bb));
        rec!(out, "bgl", bgl);
    }

    // 6. Pipeline layout.
    let pl;
    {
        let label = nsCStr::from("w3-pl");
        let bgls = [bgl];
        let d = MPipelineLayoutDescriptor { label: Some(&*label), bind_group_layouts: bgls.as_ptr(), bind_group_layouts_length: 1 };
        let mut bb = new_bb();
        pl = unsafe { cl::wgpu_client_create_pipeline_layout(client, device, cast!(d, cl::PipelineLayoutDescriptor), &mut bb) };
        out.emit("device-create-pipeline-layout", "DeviceAction", "wgpu_client_create_pipeline_layout", &bb_bytes(&bb));
        rec!(out, "pl", pl);
    }

    // 7. Bind group.
    let bg;
    {
        let label = nsCStr::from("w3-bg");
        let entries = [
            MBindGroupEntry { binding: 0, buffer: Some(buf_uniform), offset: 256, size: wgt::BufferSize::new(64), sampler: None, texture_view: None },
            MBindGroupEntry { binding: 1, buffer: None, offset: 0, size: None, sampler: Some(sampler), texture_view: None },
            MBindGroupEntry { binding: 2, buffer: None, offset: 0, size: None, sampler: None, texture_view: Some(view) },
            MBindGroupEntry { binding: 3, buffer: Some(buf_storage), offset: 0, size: None, sampler: None, texture_view: None },
        ];
        let d = MBindGroupDescriptor { label: Some(&*label), layout: bgl, entries: entries.as_ptr(), entries_length: entries.len() };
        let mut bb = new_bb();
        bg = unsafe { cl::wgpu_client_create_bind_group(client, device, cast!(d, cl::BindGroupDescriptor), &mut bb) };
        out.emit("device-create-bind-group", "DeviceAction", "wgpu_client_create_bind_group", &bb_bytes(&bb));
        rec!(out, "bg", bg);
    }

    // 8. Shader module (mirror; 128 client never serializes this variant).
    let shader = cl::wgpu_client_make_shader_module_id(client, device);
    rec!(out, "shader", shader);
    const WGSL: &str = "@group(0) @binding(3) var<storage, read> src: array<u32>;\n@compute @workgroup_size(64) fn cs_main(@builtin(global_invocation_id) g: vec3<u32>) { _ = src[g.x]; }\n@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(p, 0.0, 1.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.5, 0.25, 1.0); }\n";
    {
        let action = MDeviceAction::CreateShaderModule(
            shader,
            wgc::pipeline::ShaderModuleDescriptor { label: Some(Cow::Borrowed("w3-shader")), shader_bound_checks: wgt::ShaderBoundChecks::new() },
            Cow::Borrowed(WGSL),
        );
        let bytes = bincode::serialize(&action).unwrap();
        out.emit("device-create-shader-module", "DeviceAction", "mirror:DeviceAction::CreateShaderModule", &bytes);
    }

    // 9. Compute pipeline, explicit layout with an override constant.
    let cpipe;
    {
        let label = nsCStr::from("w3-cpipe");
        let entry = CString::new("cs_main").unwrap();
        let key = CString::new("scale").unwrap();
        let consts = [MConstantEntry { key: key.as_ptr(), value: 2.5 }];
        let d = MComputePipelineDescriptor {
            label: Some(&*label),
            layout: Some(pl),
            stage: MProgrammableStage { module: shader, entry_point: entry.as_ptr(), constants: consts.as_ptr(), constants_length: 1 },
        };
        let mut bb = new_bb();
        let mut ipl: Option<id::PipelineLayoutId> = None;
        let mut ibgl: [Option<id::BindGroupLayoutId>; 8] = [None; 8];
        cpipe = unsafe {
            cl::wgpu_client_create_compute_pipeline(client, device, cast!(d, cl::ComputePipelineDescriptor), &mut bb, &mut ipl, ibgl.as_mut_ptr())
        };
        out.emit("device-create-compute-pipeline", "DeviceAction", "wgpu_client_create_compute_pipeline", &bb_bytes(&bb));
        rec!(out, "cpipe", cpipe);
    }
    // 9b. Compute pipeline, implicit layout ("auto").
    let cpipe_auto;
    {
        let entry = CString::new("cs_main").unwrap();
        let d = MComputePipelineDescriptor {
            label: None,
            layout: None,
            stage: MProgrammableStage { module: shader, entry_point: entry.as_ptr(), constants: std::ptr::null(), constants_length: 0 },
        };
        let mut bb = new_bb();
        let mut ipl: Option<id::PipelineLayoutId> = None;
        let mut ibgl: [Option<id::BindGroupLayoutId>; 8] = [None; 8];
        cpipe_auto = unsafe {
            cl::wgpu_client_create_compute_pipeline(client, device, cast!(d, cl::ComputePipelineDescriptor), &mut bb, &mut ipl, ibgl.as_mut_ptr())
        };
        out.emit("device-create-compute-pipeline-implicit", "DeviceAction", "wgpu_client_create_compute_pipeline", &bb_bytes(&bb));
        rec!(out, "cpipe_auto", cpipe_auto);
        rec!(out, "cpipe_auto_pl", ipl.unwrap());
        let nbgl = ibgl.iter().filter(|b| b.is_some()).count();
        out.ids.insert("cpipe_auto_bgl_count".into(), nbgl.to_string());
        if let Some(b) = ibgl[0] {
            rec!(out, "cpipe_auto_bgl0", b);
        }
    }
    // 9c. getBindGroupLayout on the implicit compute pipeline.
    {
        let mut bb = new_bb();
        let b = unsafe { cl::wgpu_client_compute_pipeline_get_bind_group_layout(client, cpipe_auto, 0, &mut bb) };
        out.emit("device-compute-pipeline-get-bgl", "DeviceAction", "wgpu_client_compute_pipeline_get_bind_group_layout", &bb_bytes(&bb));
        rec!(out, "cpipe_get_bgl", b);
    }

    // 10. Render pipeline.
    let rpipe;
    {
        let label = nsCStr::from("w3-rpipe");
        let vs = CString::new("vs_main").unwrap();
        let fs = CString::new("fs_main").unwrap();
        let attrs = [
            wgt::VertexAttribute { format: wgt::VertexFormat::Float32x2, offset: 0, shader_location: 0 },
            wgt::VertexAttribute { format: wgt::VertexFormat::Unorm8x4, offset: 8, shader_location: 1 },
        ];
        let vbl = [MVertexBufferLayout { array_stride: 12, step_mode: wgt::VertexStepMode::Vertex, attributes: attrs.as_ptr(), attributes_length: 2 }];
        let vstate = MVertexState {
            stage: MProgrammableStage { module: shader, entry_point: vs.as_ptr(), constants: std::ptr::null(), constants_length: 0 },
            buffers: vbl.as_ptr(),
            buffers_length: 1,
        };
        let blend = wgt::BlendState::ALPHA_BLENDING;
        let targets = [MColorTargetState { format: wgt::TextureFormat::Rgba8Unorm, blend: Some(&blend), write_mask: wgt::ColorWrites::ALL }];
        let fstate = MFragmentState {
            stage: MProgrammableStage { module: shader, entry_point: fs.as_ptr(), constants: std::ptr::null(), constants_length: 0 },
            targets: targets.as_ptr(),
            targets_length: 1,
        };
        let cull = wgt::Face::Back;
        let ds = wgt::DepthStencilState {
            format: wgt::TextureFormat::Depth24PlusStencil8,
            depth_write_enabled: true,
            depth_compare: wgt::CompareFunction::Less,
            stencil: wgt::StencilState {
                front: wgt::StencilFaceState { compare: wgt::CompareFunction::Always, fail_op: wgt::StencilOperation::Keep, depth_fail_op: wgt::StencilOperation::Keep, pass_op: wgt::StencilOperation::Replace },
                back: wgt::StencilFaceState::IGNORE,
                read_mask: 0xff,
                write_mask: 0x0f,
            },
            bias: wgt::DepthBiasState { constant: 2, slope_scale: 1.5, clamp: 0.0 },
        };
        let d = MRenderPipelineDescriptor {
            label: Some(&*label),
            layout: Some(pl),
            vertex: &vstate,
            primitive: MPrimitiveState {
                topology: wgt::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgt::FrontFace::Ccw,
                cull_mode: Some(&cull),
                polygon_mode: wgt::PolygonMode::Fill,
                unclipped_depth: false,
            },
            fragment: Some(&fstate),
            depth_stencil: Some(&ds),
            multisample: wgt::MultisampleState { count: 1, mask: !0, alpha_to_coverage_enabled: false },
        };
        let mut bb = new_bb();
        let mut ipl: Option<id::PipelineLayoutId> = None;
        let mut ibgl: [Option<id::BindGroupLayoutId>; 8] = [None; 8];
        rpipe = unsafe {
            cl::wgpu_client_create_render_pipeline(client, device, cast!(d, cl::RenderPipelineDescriptor), &mut bb, &mut ipl, ibgl.as_mut_ptr())
        };
        out.emit("device-create-render-pipeline", "DeviceAction", "wgpu_client_create_render_pipeline", &bb_bytes(&bb));
        rec!(out, "rpipe", rpipe);
    }
    // 10b. Render pipeline getBindGroupLayout.
    {
        let mut bb = new_bb();
        let b = unsafe { cl::wgpu_client_render_pipeline_get_bind_group_layout(client, rpipe, 0, &mut bb) };
        out.emit("device-render-pipeline-get-bgl", "DeviceAction", "wgpu_client_render_pipeline_get_bind_group_layout", &bb_bytes(&bb));
        rec!(out, "rpipe_get_bgl", b);
    }

    // 11. Command encoder.
    let encoder;
    let encoder_bytes;
    {
        let label = nsCStr::from("w3-encoder");
        let d = wgt::CommandEncoderDescriptor::<Option<&nsACString>> { label: Some(&*label) };
        let mut bb = new_bb();
        encoder = cl::wgpu_client_create_command_encoder(client, device, &d, &mut bb);
        encoder_bytes = bb_bytes(&bb);
        out.emit("device-create-command-encoder", "DeviceAction", "wgpu_client_create_command_encoder", &encoder_bytes);
        rec!(out, "encoder", encoder);
    }

    // 12. Render bundle (client-side encoder recorded with wgc bundle_ffi).
    {
        let label = nsCStr::from("w3-bundle-enc");
        let fmts = [wgt::TextureFormat::Rgba8Unorm];
        let dsf = wgt::TextureFormat::Depth24PlusStencil8;
        let d = MRenderBundleEncoderDescriptor {
            label: Some(&*label),
            color_formats: fmts.as_ptr(),
            color_formats_length: 1,
            depth_stencil_format: Some(&dsf),
            depth_read_only: false,
            stencil_read_only: true,
            sample_count: 1,
        };
        let mut bb = new_bb();
        let enc = cl::wgpu_device_create_render_bundle_encoder(device, cast!(d, cl::RenderBundleEncoderDescriptor), &mut bb);
        assert!(!enc.is_null());
        unsafe {
            use wgc::command::bundle_ffi as bf;
            bf::wgpu_render_bundle_set_pipeline(&mut *enc, rpipe);
            let offs = [512u32];
            bf::wgpu_render_bundle_set_bind_group(&mut *enc, 0, bg, offs.as_ptr(), 1);
            bf::wgpu_render_bundle_set_vertex_buffer(&mut *enc, 0, buf_vertex, 0, None);
            bf::wgpu_render_bundle_draw(&mut *enc, 3, 1, 0, 0);
        }
        let blabel = nsCStr::from("w3-bundle");
        let bd = wgt::RenderBundleDescriptor::<Option<&nsACString>> { label: Some(&*blabel) };
        let mut bb = new_bb();
        let bundle = unsafe { cl::wgpu_client_create_render_bundle(client, enc, device, &bd, &mut bb) };
        out.emit("device-create-render-bundle", "DeviceAction", "wgpu_client_create_render_bundle", &bb_bytes(&bb));
        rec!(out, "bundle", bundle);
    }
    // 12b. Render bundle error.
    {
        let label = nsCStr::from("w3-bundle-bad");
        let mut bb = new_bb();
        let b = unsafe { cl::wgpu_client_create_render_bundle_error(client, device, Some(&*label), &mut bb) };
        out.emit("device-create-render-bundle-error", "DeviceAction", "wgpu_client_create_render_bundle_error", &bb_bytes(&bb));
        rec!(out, "bundle_err", b);
    }
    // 12c. DeviceAction::Error from a rejected render bundle encoder (9 colour formats).
    {
        let fmts = [wgt::TextureFormat::Rgba8Unorm; 9];
        let d = MRenderBundleEncoderDescriptor {
            label: None,
            color_formats: fmts.as_ptr(),
            color_formats_length: 9,
            depth_stencil_format: None,
            depth_read_only: false,
            stencil_read_only: false,
            sample_count: 1,
        };
        let mut bb = new_bb();
        let enc = cl::wgpu_device_create_render_bundle_encoder(device, cast!(d, cl::RenderBundleEncoderDescriptor), &mut bb);
        assert!(enc.is_null());
        out.emit("device-error", "DeviceAction", "wgpu_device_create_render_bundle_encoder(error)", &bb_bytes(&bb));
    }

    // 13. Command-encoder actions.
    let copy_tex = |t: id::TextureId, mip: u32| wgt::ImageCopyTexture { texture: t, mip_level: mip, origin: wgt::Origin3d { x: 4, y: 8, z: 0 }, aspect: wgt::TextureAspect::All };
    {
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_copy_buffer_to_buffer(buf_storage, 16, buf_readback, 32, 1024, &mut bb) };
        out.emit("encoder-copy-buffer-to-buffer", "CommandEncoderAction", "wgpu_command_encoder_copy_buffer_to_buffer", &bb_bytes(&bb));
    }
    {
        let bpr = 256u32;
        let rpi = 32u32;
        let layout = wgpu_bindings::ImageDataLayout { offset: 512, bytes_per_row: Some(&bpr), rows_per_image: Some(&rpi) };
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_copy_texture_to_buffer(copy_tex(texture, 0), buf_readback, &layout, wgt::Extent3d { width: 16, height: 8, depth_or_array_layers: 1 }, &mut bb) };
        out.emit("encoder-copy-texture-to-buffer", "CommandEncoderAction", "wgpu_command_encoder_copy_texture_to_buffer", &bb_bytes(&bb));
    }
    {
        let bpr = 256u32;
        let layout = wgpu_bindings::ImageDataLayout { offset: 0, bytes_per_row: Some(&bpr), rows_per_image: None };
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_copy_buffer_to_texture(buf_storage, &layout, copy_tex(texture, 1), wgt::Extent3d { width: 8, height: 4, depth_or_array_layers: 1 }, &mut bb) };
        out.emit("encoder-copy-buffer-to-texture", "CommandEncoderAction", "wgpu_command_encoder_copy_buffer_to_texture", &bb_bytes(&bb));
    }
    {
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_copy_texture_to_texture(copy_tex(texture, 0), copy_tex(texture2, 0), wgt::Extent3d { width: 8, height: 8, depth_or_array_layers: 1 }, &mut bb) };
        out.emit("encoder-copy-texture-to-texture", "CommandEncoderAction", "wgpu_command_encoder_copy_texture_to_texture", &bb_bytes(&bb));
    }
    {
        let size = 128u64;
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_clear_buffer(buf_storage, 64, Some(&size), &mut bb) };
        out.emit("encoder-clear-buffer", "CommandEncoderAction", "wgpu_command_encoder_clear_buffer", &bb_bytes(&bb));
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_clear_buffer(buf_storage, 0, None, &mut bb) };
        out.emit("encoder-clear-buffer-whole", "CommandEncoderAction", "wgpu_command_encoder_clear_buffer", &bb_bytes(&bb));
    }
    {
        let s = nsCStr::from("w3-group");
        let mut bb = new_bb();
        cl::wgpu_command_encoder_push_debug_group(&s, &mut bb);
        out.emit("encoder-push-debug-group", "CommandEncoderAction", "wgpu_command_encoder_push_debug_group", &bb_bytes(&bb));
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_pop_debug_group(&mut bb) };
        out.emit("encoder-pop-debug-group", "CommandEncoderAction", "wgpu_command_encoder_pop_debug_group", &bb_bytes(&bb));
        let m = nsCStr::from("w3-marker \u{00e9}");
        let mut bb = new_bb();
        unsafe { cl::wgpu_command_encoder_insert_debug_marker(&m, &mut bb) };
        out.emit("encoder-insert-debug-marker", "CommandEncoderAction", "wgpu_command_encoder_insert_debug_marker", &bb_bytes(&bb));
    }

    // 14. Render pass.
    let qset = id::QuerySetId::zip(3, 1, wgt::Backend::Vulkan);
    rec!(out, "qset", qset);
    {
        let label = nsCStr::from("w3-rpass");
        let color = [wgc::command::RenderPassColorAttachment {
            view,
            resolve_target: None,
            channel: wgc::command::PassChannel {
                load_op: wgc::command::LoadOp::Clear,
                store_op: wgc::command::StoreOp::Store,
                clear_value: wgt::Color { r: 0.25, g: 0.5, b: 0.75, a: 1.0 },
                read_only: false,
            },
        }];
        let depth = wgc::command::RenderPassDepthStencilAttachment {
            view,
            depth: wgc::command::PassChannel { load_op: wgc::command::LoadOp::Clear, store_op: wgc::command::StoreOp::Discard, clear_value: 1.0f32, read_only: false },
            stencil: wgc::command::PassChannel { load_op: wgc::command::LoadOp::Load, store_op: wgc::command::StoreOp::Store, clear_value: 0u32, read_only: false },
        };
        let b = 0u32;
        let e = 1u32;
        let tsw = cl::RenderPassTimestampWrites { query_set: qset, beginning_of_pass_write_index: Some(&b), end_of_pass_write_index: Some(&e) };
        let d = cl::RenderPassDescriptor {
            label: Some(&*label),
            color_attachments: color.as_ptr(),
            color_attachments_length: 1,
            depth_stencil_attachment: &depth,
            timestamp_writes: Some(&tsw),
            occlusion_query_set: Some(qset),
        };
        let pass = unsafe { cl::wgpu_command_encoder_begin_render_pass(&d) };
        let p = unsafe { &mut *pass };
        let grp = CString::new("w3-rgroup").unwrap();
        let mrk = CString::new("w3-rmarker").unwrap();
        unsafe {
            cmd::wgpu_recorded_render_pass_push_debug_group(p, grp.as_ptr(), 0);
            cmd::wgpu_recorded_render_pass_set_pipeline(p, rpipe);
            let offs = [256u32, 768u32];
            cmd::wgpu_recorded_render_pass_set_bind_group(p, 0, bg, offs.as_ptr(), 2);
            cmd::wgpu_recorded_render_pass_set_vertex_buffer(p, 0, buf_vertex, 48, wgt::BufferSize::new(96));
            cmd::wgpu_recorded_render_pass_set_index_buffer(p, buf_vertex, wgt::IndexFormat::Uint16, 0, None);
            cmd::wgpu_recorded_render_pass_set_viewport(p, 0.0, 0.0, 64.0, 32.0, 0.0, 1.0);
            cmd::wgpu_recorded_render_pass_set_scissor_rect(p, 1, 2, 30, 20);
            cmd::wgpu_recorded_render_pass_set_blend_constant(p, &wgt::Color { r: 1.0, g: 0.0, b: 0.5, a: 0.25 });
            cmd::wgpu_recorded_render_pass_set_stencil_reference(p, 7);
            cmd::wgpu_recorded_render_pass_draw(p, 3, 2, 1, 0);
            cmd::wgpu_recorded_render_pass_insert_debug_marker(p, mrk.as_ptr(), 0);
            cmd::wgpu_recorded_render_pass_draw_indexed(p, 6, 1, 0, -2, 0);
            cmd::wgpu_recorded_render_pass_draw_indirect(p, buf_storage, 256);
            cmd::wgpu_recorded_render_pass_begin_occlusion_query(p, 5);
            cmd::wgpu_recorded_render_pass_end_occlusion_query(p);
            cmd::wgpu_recorded_render_pass_pop_debug_group(p);
        }
        let mut bb = new_bb();
        unsafe { cl::wgpu_render_pass_finish(pass, &mut bb) };
        out.emit("render-pass", "RenderPass", "wgpu_command_encoder_begin_render_pass+wgpu_recorded_render_pass_*+wgpu_render_pass_finish", &bb_bytes(&bb));
    }

    // 15. Compute pass.
    {
        let label = nsCStr::from("w3-cpass");
        let d = cl::ComputePassDescriptor { label: Some(&*label), timestamp_writes: None };
        let pass = unsafe { cl::wgpu_command_encoder_begin_compute_pass(&d) };
        let p = unsafe { &mut *pass };
        let grp = CString::new("w3-cgroup").unwrap();
        let mrk = CString::new("w3-cmarker").unwrap();
        unsafe {
            cmd::wgpu_recorded_compute_pass_push_debug_group(p, grp.as_ptr(), 0);
            cmd::wgpu_recorded_compute_pass_set_pipeline(p, cpipe);
            let offs = [1024u32];
            cmd::wgpu_recorded_compute_pass_set_bind_group(p, 0, bg, offs.as_ptr(), 1);
            cmd::wgpu_recorded_compute_pass_dispatch_workgroups(p, 4, 2, 1);
            cmd::wgpu_recorded_compute_pass_insert_debug_marker(p, mrk.as_ptr(), 0);
            cmd::wgpu_recorded_compute_pass_dispatch_workgroups_indirect(p, buf_storage, 64);
            cmd::wgpu_recorded_compute_pass_pop_debug_group(p);
        }
        let mut bb = new_bb();
        unsafe { cl::wgpu_compute_pass_finish(pass, &mut bb) };
        out.emit("compute-pass", "ComputePass", "wgpu_command_encoder_begin_compute_pass+wgpu_recorded_compute_pass_*+wgpu_compute_pass_finish", &bb_bytes(&bb));
    }

    // 16. Queue writes (payload bytes travel in a separate shmem, not the ByteBuf).
    {
        let mut bb = new_bb();
        unsafe { cl::wgpu_queue_write_buffer(buf_uniform, 256, &mut bb) };
        out.emit("queue-write-buffer", "QueueWriteAction", "wgpu_queue_write_buffer", &bb_bytes(&bb));
        let bpr = 256u32;
        let rpi = 32u32;
        let layout = wgpu_bindings::ImageDataLayout { offset: 0, bytes_per_row: Some(&bpr), rows_per_image: Some(&rpi) };
        let mut bb = new_bb();
        unsafe { cl::wgpu_queue_write_texture(copy_tex(texture, 0), layout, wgt::Extent3d { width: 16, height: 16, depth_or_array_layers: 1 }, &mut bb) };
        out.emit("queue-write-texture", "QueueWriteAction", "wgpu_queue_write_texture", &bb_bytes(&bb));
    }

    // Cross-check the DeviceAction mirror against real client output.
    {
        let label = Some(Cow::Borrowed("w3-encoder"));
        let m = bincode::serialize(&MDeviceAction::CreateCommandEncoder(encoder, wgt::CommandEncoderDescriptor { label })).unwrap();
        assert_eq!(m, encoder_bytes, "DeviceAction mirror mismatch (CreateCommandEncoder)");
        let sd = wgc::resource::SamplerDescriptor {
            label: Some(Cow::Borrowed("w3-sampler")),
            address_modes: [wgt::AddressMode::Repeat, wgt::AddressMode::MirrorRepeat, wgt::AddressMode::ClampToEdge],
            mag_filter: wgt::FilterMode::Linear,
            min_filter: wgt::FilterMode::Nearest,
            mipmap_filter: wgt::FilterMode::Linear,
            lod_min_clamp: 0.5,
            lod_max_clamp: 8.0,
            compare: Some(wgt::CompareFunction::LessEqual),
            anisotropy_clamp: 4,
            border_color: None,
        };
        let m = bincode::serialize(&MDeviceAction::CreateSampler(sampler, sd)).unwrap();
        assert_eq!(m, sampler_bytes, "DeviceAction mirror mismatch (CreateSampler)");
        out.ids.insert("mirror_crosscheck".into(), "\"CreateCommandEncoder,CreateSampler byte-identical\"".into());
    }

    out.finish();
    eprintln!("wrote {} goldens", out.entries.len());
}

// nsstring's Drop calls into Gecko's nsSubstring.cpp. The harness only uses
// borrowed nsCStr values (no owned buffers), so finalization has nothing to
// release; these stand-ins exist solely so the host binary links.
#[no_mangle]
pub unsafe extern "C" fn Gecko_FinalizeCString(_this: *mut nsACString) {}
#[no_mangle]
pub unsafe extern "C" fn Gecko_AssignCString(_this: *mut nsACString, _other: *const nsACString) {
    panic!("harness does not support owned nsCString assignment");
}
