//! W4b golden generator / verifier for `wgpu_server_adapter_pack_info`.
//!
//! `AdapterInformation<S>` (gfx/wgpu_bindings/src/lib.rs:94-107) is `#[repr(C)]`
//! with private fields, so the harness uses a field-for-field `#[repr(C)]` mirror.
//! Every golden is checked against the real type:
//!   1. `bincode::serialize(mirror)` -> bytes (the golden),
//!   2. the real `bincode::deserialize::<AdapterInformation<String>>` (the exact call
//!      `wgpu_client_adapter_extract_info` makes in the content process) accepts the
//!      bytes with no trailing data,
//!   3. the decoded value, viewed through the mirror, equals the input field-by-field,
//!   4. re-serializing the real value reproduces the bytes exactly.
//! Limits pass through the real `restrict_limits` (extracted verbatim from server.rs
//! into restrict.rs by make-pack-info-goldens.py), as upstream pack_info does.
//! The None case is the real `bincode::serialize_into(&mut data, &0u64)`.
//!
//! Usage: harness gen OUT_DIR | harness verify FILE...

use std::io::Write;
use std::path::PathBuf;

use bincode::Options;
use serde::Serialize;
use wgc::id;

include!("restrict.rs");

#[repr(C)]
#[derive(Serialize, Debug, PartialEq, Clone)]
struct Mirror {
    id: id::AdapterId,
    limits: wgt::Limits,
    features: wgt::Features,
    name: String,
    vendor: u32,
    device: u32,
    device_type: wgt::DeviceType,
    driver: String,
    driver_info: String,
    backend: wgt::Backend,
}

const _: () = assert!(
    std::mem::size_of::<Mirror>() == std::mem::size_of::<wgpu_bindings::AdapterInformation<String>>()
);

fn strict() -> impl Options {
    bincode::DefaultOptions::new().with_fixint_encoding().reject_trailing_bytes()
}

/// Decode with the real type; returns the mirror view. Panics on any mismatch.
fn check_real(bytes: &[u8]) -> Mirror {
    // Same call as client.rs:491 (bincode::deserialize, fixint, trailing allowed) ...
    let loose: wgpu_bindings::AdapterInformation<String> = bincode::deserialize(bytes).expect("real deserialize");
    // ... and strictly: the bytes must be consumed exactly.
    let real: wgpu_bindings::AdapterInformation<String> = strict().deserialize(bytes).expect("trailing bytes");
    drop(loose);
    let again = bincode::serialize(&real).expect("real serialize");
    assert_eq!(again, bytes, "real re-serialization differs");
    // Same #[repr(C)] field list => identical layout; view through the mirror.
    let view: Mirror = unsafe { std::mem::transmute(real) };
    view
}

fn restrict_ok(l: &wgt::Limits) -> bool {
    restrict_limits(l.clone()) == *l
}

struct Payload(Vec<u8>);
impl Payload {
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn string(&mut self, s: &str) {
        self.u64(s.len() as u64);
        self.0.extend_from_slice(s.as_bytes());
        while self.0.len() % 8 != 0 {
            self.0.push(0);
        }
    }
}

fn limits_array(l: &wgt::Limits) -> [u64; 34] {
    [
        l.max_texture_dimension_1d as u64, l.max_texture_dimension_2d as u64, l.max_texture_dimension_3d as u64,
        l.max_texture_array_layers as u64, l.max_bind_groups as u64, l.max_bindings_per_bind_group as u64,
        l.max_dynamic_uniform_buffers_per_pipeline_layout as u64, l.max_dynamic_storage_buffers_per_pipeline_layout as u64,
        l.max_sampled_textures_per_shader_stage as u64, l.max_samplers_per_shader_stage as u64,
        l.max_storage_buffers_per_shader_stage as u64, l.max_storage_textures_per_shader_stage as u64,
        l.max_uniform_buffers_per_shader_stage as u64, l.max_uniform_buffer_binding_size as u64,
        l.max_storage_buffer_binding_size as u64, l.max_vertex_buffers as u64, l.max_buffer_size,
        l.max_vertex_attributes as u64, l.max_vertex_buffer_array_stride as u64,
        l.min_uniform_buffer_offset_alignment as u64, l.min_storage_buffer_offset_alignment as u64,
        l.max_inter_stage_shader_components as u64, l.max_color_attachments as u64,
        l.max_color_attachment_bytes_per_sample as u64, l.max_compute_workgroup_storage_size as u64,
        l.max_compute_invocations_per_workgroup as u64, l.max_compute_workgroup_size_x as u64,
        l.max_compute_workgroup_size_y as u64, l.max_compute_workgroup_size_z as u64,
        l.max_compute_workgroups_per_dimension as u64, l.min_subgroup_size as u64, l.max_subgroup_size as u64,
        l.max_push_constant_size as u64, l.max_non_sampler_bindings as u64,
    ]
}

struct Vector {
    name: &'static str,
    id: id::AdapterId,
    raw_limits: wgt::Limits, // what the host adapter reports (before restrict_limits)
    features: wgt::Features,
    name_s: &'static str,
    vendor: u32,
    device: u32,
    device_type: wgt::DeviceType,
    driver: &'static str,
    driver_info: &'static str,
    backend: wgt::Backend,
    is_fallback: bool,
}

fn vectors() -> Vec<Vector> {
    // Chromium/Dawn-style WebGPU adapter limits on a discrete NVIDIA GPU.
    let nvidia = wgt::Limits {
        max_texture_dimension_1d: 16384,
        max_texture_dimension_2d: 16384,
        max_texture_dimension_3d: 2048,
        max_texture_array_layers: 2048,
        max_bind_groups: 4,
        max_bindings_per_bind_group: 1000,
        max_dynamic_uniform_buffers_per_pipeline_layout: 10,
        max_dynamic_storage_buffers_per_pipeline_layout: 8,
        max_sampled_textures_per_shader_stage: 16,
        max_samplers_per_shader_stage: 16,
        max_storage_buffers_per_shader_stage: 10,
        max_storage_textures_per_shader_stage: 8,
        max_uniform_buffers_per_shader_stage: 12,
        max_uniform_buffer_binding_size: 65536,
        max_storage_buffer_binding_size: 2147483644,
        max_vertex_buffers: 8,
        max_buffer_size: 4294967296,
        max_vertex_attributes: 30,
        max_vertex_buffer_array_stride: 2048,
        min_uniform_buffer_offset_alignment: 256,
        min_storage_buffer_offset_alignment: 256,
        max_inter_stage_shader_components: 112,
        max_color_attachments: 8,
        max_color_attachment_bytes_per_sample: 32,
        max_compute_workgroup_storage_size: 32768,
        max_compute_invocations_per_workgroup: 1024,
        max_compute_workgroup_size_x: 1024,
        max_compute_workgroup_size_y: 1024,
        max_compute_workgroup_size_z: 64,
        max_compute_workgroups_per_dimension: 65535,
        min_subgroup_size: 32,
        max_subgroup_size: 32,
        max_push_constant_size: 0,
        max_non_sampler_bindings: 1_000_000,
    };
    // Every clamped field above its cap (native-Vulkan-like numbers).
    let big = wgt::Limits {
        max_texture_dimension_1d: 65536,
        max_texture_dimension_2d: 65536,
        max_texture_dimension_3d: 32768,
        max_sampled_textures_per_shader_stage: 1_048_576,
        max_samplers_per_shader_stage: 4000,
        max_storage_buffers_per_shader_stage: 1_048_576,
        max_storage_textures_per_shader_stage: 65,
        max_uniform_buffers_per_shader_stage: 200,
        max_uniform_buffer_binding_size: u32::MAX,
        max_storage_buffer_binding_size: (1 << 30) + 1,
        max_buffer_size: u64::MAX,
        max_non_sampler_bindings: 7,
        min_subgroup_size: 4,
        max_subgroup_size: 128,
        max_push_constant_size: 256,
        ..nvidia.clone()
    };
    vec![
        Vector {
            name: "nvidia-like",
            id: id::AdapterId::zip(0, 1, wgt::Backend::Vulkan),
            raw_limits: nvidia,
            features: wgt::Features::DEPTH_CLIP_CONTROL
                | wgt::Features::TEXTURE_COMPRESSION_BC
                | wgt::Features::TIMESTAMP_QUERY
                | wgt::Features::INDIRECT_FIRST_INSTANCE
                | wgt::Features::SHADER_F16
                | wgt::Features::RG11B10UFLOAT_RENDERABLE
                | wgt::Features::BGRA8UNORM_STORAGE
                | wgt::Features::FLOAT32_FILTERABLE,
            name_s: "NVIDIA GeForce MX110",
            vendor: 0x10de,
            device: 0,
            device_type: wgt::DeviceType::DiscreteGpu,
            driver: "WebGPU (host passthrough)",
            driver_info: "nvidia turing",
            backend: wgt::Backend::Vulkan,
            is_fallback: false,
        },
        Vector {
            name: "clamped",
            id: id::AdapterId::zip(0x1234_5678, 0x1fff_ffff, wgt::Backend::Vulkan),
            raw_limits: big,
            features: wgt::Features::all_webgpu_mask(),
            name_s: "d\u{e9}j\u{e0} vu \u{2603} adapter",
            vendor: 0x8086,
            device: 0x9a49,
            device_type: wgt::DeviceType::IntegratedGpu,
            driver: "WebGPU (host passthrough)",
            driver_info: "intel gen-12lp",
            backend: wgt::Backend::Gl,
            is_fallback: false,
        },
        Vector {
            name: "cpu-fallback",
            id: id::AdapterId::zip(3, 7, wgt::Backend::Vulkan),
            raw_limits: wgt::Limits::downlevel_webgl2_defaults(),
            features: wgt::Features::empty(),
            name_s: "",
            vendor: 0,
            device: 0,
            device_type: wgt::DeviceType::Cpu,
            driver: "",
            driver_info: "",
            backend: wgt::Backend::Vulkan,
            is_fallback: true,
        },
    ]
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn gen(out: PathBuf) {
    std::fs::create_dir_all(&out).unwrap();
    let mut manifest = Vec::new();
    for v in vectors() {
        let m = Mirror {
            id: v.id,
            limits: restrict_limits(v.raw_limits.clone()),
            features: v.features,
            name: v.name_s.into(),
            vendor: v.vendor,
            device: v.device,
            device_type: v.device_type,
            driver: v.driver.into(),
            driver_info: v.driver_info.into(),
            backend: v.backend,
        };
        let bytes = bincode::serialize(&m).unwrap();
        let view = check_real(&bytes);
        assert_eq!(view, m, "{}: real decode differs from mirror", v.name);
        assert!(restrict_ok(&view.limits));
        // Executor PACK_INFO payload (guest-gpu-wgpu.js packInfo) producing it.
        let mut p = Payload(Vec::new());
        p.u64(34);
        for x in limits_array(&v.raw_limits) {
            p.u64(x);
        }
        p.u64(v.features.bits());
        p.u64(v.vendor as u64);
        p.u64(v.device as u64);
        p.u64(v.device_type as u64);
        p.u64(v.backend as u64);
        p.u64(v.is_fallback as u64);
        for s in [v.name_s, v.driver, v.driver_info, "vendor-string", "arch", "description", "csv,features"] {
            p.string(s);
        }
        let raw: u64 = unsafe { std::mem::transmute::<id::AdapterId, u64>(v.id) };
        std::fs::write(out.join(format!("{}.bin", v.name)), &bytes).unwrap();
        std::fs::write(out.join(format!("{}.payload", v.name)), &p.0).unwrap();
        manifest.push(format!(
            "{{\"name\":\"{}\",\"adapter_id\":\"0x{raw:016x}\",\"bin\":\"{}.bin\",\"bin_len\":{},\"payload\":\"{}.payload\",\"payload_len\":{}}}",
            v.name, v.name, bytes.len(), v.name, p.0.len()
        ));
        println!("golden {} id=0x{raw:016x} bin={} payload={} {}", v.name, bytes.len(), p.0.len(), hex(&bytes[..16]));
    }
    // None: server.rs:273-275.
    let mut none = Vec::new();
    bincode::serialize_into(&mut none, &0u64).unwrap();
    std::fs::write(out.join("none.bin"), &none).unwrap();
    manifest.push(format!("{{\"name\":\"none\",\"adapter_id\":\"0x0\",\"bin\":\"none.bin\",\"bin_len\":{}}}", none.len()));
    let mut f = std::fs::File::create(out.join("manifest-raw.json")).unwrap();
    writeln!(f, "{{\"goldens\":[{}]}}", manifest.join(",")).unwrap();
}

fn verify(files: &[String]) {
    for file in files {
        let bytes = std::fs::read(file).unwrap();
        if bytes.len() == 8 && bytes == 0u64.to_le_bytes() {
            println!("verify {file}: None (bincode 0u64)");
            continue;
        }
        let view = check_real(&bytes);
        assert!(restrict_ok(&view.limits), "{file}: limits are not restricted");
        let raw: u64 = unsafe { std::mem::transmute::<id::AdapterId, u64>(view.id) };
        println!(
            "verify {file}: OK len={} id=0x{raw:016x} name={:?} vendor=0x{:x} device=0x{:x} type={:?} backend={:?} driver={:?} driver_info={:?} features=0x{:x} max_buffer_size={} tex2d={} non_sampler={}",
            bytes.len(), view.name, view.vendor, view.device, view.device_type, view.backend, view.driver,
            view.driver_info, view.features.bits(), view.limits.max_buffer_size, view.limits.max_texture_dimension_2d,
            view.limits.max_non_sampler_bindings
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("gen") => gen(PathBuf::from(&args[2])),
        Some("verify") => verify(&args[2..]),
        _ => {
            eprintln!("usage: {} gen OUT | verify FILE...", args[0]);
            std::process::exit(2);
        }
    }
}
