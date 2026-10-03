//! Exact Nightly159 remote codec; isolated primitive, no Firefox integration.
#![allow(dead_code)]
include!(env!("NIGHTLY_REMOTE_SCHEMA"));
use bincode::Options;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;
const REVISION: &str = "4f4dc63098fae64a0e6d1d3dc6f4f328da8fd5c8";
#[wasm_bindgen]
pub fn protocol_version() -> String {
    format!(
        "Nightly159:{REVISION}:{}",
        env!("NIGHTLY_REMOTE_SCHEMA_SHA256")
    )
}
fn profile(gl: bool) -> wgt::Limits {
    let mut v = if gl {
        wgt::Limits::downlevel_webgl2_defaults()
    } else {
        wgt::Limits::downlevel_defaults()
    };
    v.max_buffer_size = 1024 * 1024;
    v.max_storage_buffer_binding_size = v.max_storage_buffer_binding_size.min(1024 * 1024);
    v
}
fn fail(x: impl ToString) -> JsValue {
    js_sys::Error::new(&x.to_string()).into()
}
fn decode(bytes: &[u8], count: u32) -> Result<Vec<Message<'static>>, String> {
    if bytes.len() > 1024 * 1024 || count > 128 {
        return Err("batch budget".into());
    }
    let options = bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(1024 * 1024);
    let mut cursor = std::io::Cursor::new(bytes);
    let mut out = Vec::new();
    for _ in 0..count {
        out.push(
            options
                .deserialize_from(&mut cursor)
                .map_err(|e| e.to_string())?,
        )
    }
    if cursor.position() != bytes.len() as u64 {
        return Err("trailing bytes/count mismatch".into());
    }
    Ok(out)
}
fn id<T: id::Marker>(index: u32) -> id::Id<T> {
    unsafe { id::Id::from_raw(id::RawId::zip(index, 1)) }
}
fn pack(messages: &[Message]) -> Vec<u8> {
    messages
        .iter()
        .flat_map(|m| bincode::serialize(m).unwrap())
        .collect()
}
#[wasm_bindgen]
pub fn golden() -> String {
    let m = Message::BufferMap {
        device_id: id(1),
        buffer_id: id(2),
        mode: 1,
        offset: 8,
        size: 16,
    };
    let bytes = pack(&[m]);
    let response = bincode::serialize(&ServerMessage::BufferMapResponse(
        id(2),
        BufferMapResult::Success {
            is_writable: false,
            offset: 8,
            size: 16,
        },
    ))
    .unwrap();
    serde_json::json!({"map":bytes,"response":response,"nativeIdBytes":std::mem::size_of::<id::BufferId>(),"wireIdBytes":bincode::serialize(&id::<id::markers::Buffer>(2)).unwrap().len(),"ffiLayout":[std::mem::size_of::<*const u8>(),null,std::mem::size_of::<id::BufferId>(),std::mem::size_of::<ByteBuf>(),std::mem::align_of::<ByteBuf>(),std::mem::offset_of!(ByteBuf,len),std::mem::offset_of!(ByteBuf,capacity),std::mem::size_of::<BufferMapClosure>(),std::mem::align_of::<BufferMapClosure>(),std::mem::offset_of!(BufferMapClosure,user_data),std::mem::size_of::<FfiBufferDescriptor>(),std::mem::align_of::<FfiBufferDescriptor>(),std::mem::offset_of!(FfiBufferDescriptor,size),std::mem::offset_of!(FfiBufferDescriptor,usage),std::mem::offset_of!(FfiBufferDescriptor,mapped_at_creation),HostMap::Read as u32,HostMap::Write as u32,BufferMapAsyncStatus::Success as u32],"decoded":decode(&bytes,1).is_ok(),"truncatedRejected":decode(&bytes[..bytes.len()-1],1).is_err(),"trailingRejected":decode(&[bytes.clone(),vec![0]].concat(),1).is_err(),"wrongCountRejected":decode(&bytes,2).is_err()}).to_string()
}
#[wasm_bindgen]
pub fn buffer_fixture(compute: bool, gl: bool) -> Vec<u8> {
    let mut m = vec![
        Message::RequestAdapter {
            adapter_id: id(1),
            desc: RequestAdapterOptions {
                power_preference: wgt::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
            },
        },
        Message::RequestDevice {
            adapter_id: id(1),
            device_id: id(2),
            queue_id: id(3),
            desc: DeviceDescriptor {
                label: None,
                required_features: wgt::Features::empty(),
                required_limits: profile(gl),
                ..Default::default()
            },
        },
    ];
    for (i, u) in [
        (
            4,
            wgt::BufferUsages::COPY_SRC
                | wgt::BufferUsages::COPY_DST
                | if compute {
                    wgt::BufferUsages::STORAGE
                } else {
                    wgt::BufferUsages::empty()
                },
        ),
        (5, wgt::BufferUsages::COPY_DST | wgt::BufferUsages::MAP_READ),
    ] {
        m.push(Message::Device(
            id(2),
            DeviceAction::CreateBuffer {
                buffer_id: id(i),
                desc: BufferDescriptor {
                    label: None,
                    size: 64,
                    usage: u,
                    mapped_at_creation: false,
                },
                shmem_handle_index: 0,
            },
        ));
    }
    m.push(Message::QueueWrite {
        queue_id: id(3),
        data_source: QueueWriteDataSource::DataBuffer(0),
        action: QueueWriteAction::Buffer {
            dst: id(4),
            offset: 0,
        },
    });
    m.push(Message::Device(
        id(2),
        DeviceAction::CreateCommandEncoder(id(6), wgt::CommandEncoderDescriptor { label: None }),
    ));
    if compute {
        use wgpu_core_remote_types::{
            binding_model::{BindGroupEntry, BindingResource, BufferBinding},
            encoders::{BindingCommand, ComputePassDescriptor},
            ffi::FfiOption,
            pipelines::ProgrammableStageDescriptor,
        };
        m.push(Message::Device(id(2),DeviceAction::CreateShaderModule(id(8),None,"@group(0) @binding(0) var<storage,read_write> data:array<u32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) p:vec3<u32>){if(p.x<16u){data[p.x]=data[p.x]*3u+7u;}}".into())));
        m.push(Message::Device(
            id(2),
            DeviceAction::CreateComputePipeline(
                id(9),
                ComputePipelineDescriptor {
                    label: None,
                    layout: None,
                    stage: ProgrammableStageDescriptor {
                        module: id(8),
                        entry_point: Some("main".into()),
                        constants: Default::default(),
                    },
                },
                false,
            ),
        ));
        m.push(Message::Device(
            id(2),
            DeviceAction::ComputePipelineGetBindGroupLayout(id(9), 0, id(10)),
        ));
        m.push(Message::Device(
            id(2),
            DeviceAction::CreateBindGroup(
                id(11),
                BindGroupDescriptor {
                    label: None,
                    layout: id(10),
                    entries: vec![BindGroupEntry {
                        binding: 0,
                        resource: BindingResource::Buffer(BufferBinding {
                            buffer: id(4),
                            offset: 0,
                            size: FfiOption::Some(64),
                        }),
                    }]
                    .into(),
                },
            ),
        ));
        m.push(Message::CommandEncoder(
            id(6),
            CommandEncoderCommand::BeginComputePass {
                desc: ComputePassDescriptor::default(),
                compute_pass_encoder_id: id(12),
            },
        ));
        m.push(Message::ComputePassEncoder(
            id(12),
            ComputePassEncoderCommand::SetPipeline(id(9)),
        ));
        m.push(Message::ComputePassEncoder(
            id(12),
            ComputePassEncoderCommand::BindingCommand(BindingCommand::SetBindGroup {
                index: 0,
                bind_group: Some(id(11)),
                dynamic_offsets: vec![],
            }),
        ));
        m.push(Message::ComputePassEncoder(
            id(12),
            ComputePassEncoderCommand::DispatchWorkgroups {
                workgroup_count_x: 4,
                workgroup_count_y: 1,
                workgroup_count_z: 1,
            },
        ));
        m.push(Message::ComputePassEncoder(
            id(12),
            ComputePassEncoderCommand::End,
        ));
    }
    m.push(Message::CommandEncoder(
        id(6),
        CommandEncoderCommand::CopyBufferToBuffer {
            source: id(4),
            source_offset: 0,
            destination: id(5),
            destination_offset: 0,
            size: Some(64),
        },
    ));
    m.push(Message::CommandEncoder(
        id(6),
        CommandEncoderCommand::Finish {
            desc: wgt::CommandBufferDescriptor { label: None },
            command_buffer_id: id(7),
        },
    ));
    m.push(Message::QueueSubmit(
        id(3),
        vec![id(7)].into(),
        vec![].into(),
        vec![].into(),
    ));
    m.push(Message::QueueOnSubmittedWorkDone {
        device_id: id(2),
        queue_id: id(3),
    });
    m.push(Message::Device(
        id(2),
        DeviceAction::PushErrorScope(FfiErrorFilter::Validation),
    ));
    m.push(Message::Device(id(2), DeviceAction::PopErrorScope));
    m.push(Message::Device(id(2), DeviceAction::PopErrorScope));
    m.push(Message::BufferMap {
        device_id: id(2),
        buffer_id: id(5),
        mode: 1,
        offset: 0,
        size: 64,
    });
    m.push(Message::BufferUnmap(id(2), id(5), false));
    pack(&m)
}
fn key<T: id::Marker>(i: id::Id<T>) -> String {
    let (a, b) = i.unzip();
    format!("{}:{a}:{b}", T::TYPE)
}
#[wasm_bindgen]
pub struct RemoteServer {
    session: u32,
    closed: bool,
    poisoned: bool,
    adapter: wgpu::Adapter,
    surface: Option<wgpu::Surface<'static>>,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    adapter_id: Option<id::AdapterId>,
    device_id: Option<id::DeviceId>,
    queue_id: Option<id::QueueId>,
    shaders: HashMap<id::ShaderModuleId, wgpu::ShaderModule>,
    pipelines: HashMap<id::ComputePipelineId, wgpu::ComputePipeline>,
    layouts: HashMap<id::BindGroupLayoutId, wgpu::BindGroupLayout>,
    groups: HashMap<id::BindGroupId, wgpu::BindGroup>,
    passes:
        HashMap<id::ComputePassEncoderId, (id::CommandEncoderId, Vec<ComputePassEncoderCommand>)>,
    buffers: HashMap<id::BufferId, wgpu::Buffer>,
    encoders: HashMap<id::CommandEncoderId, wgpu::CommandEncoder>,
    commands: HashMap<id::CommandBufferId, wgpu::CommandBuffer>,
    seen: HashSet<String>,
    scopes: Vec<wgpu::ErrorScopeGuard>,
    gl: bool,
    mapped: HashSet<id::BufferId>,
    events: Arc<Mutex<Vec<(u32, String)>>>,
}
impl RemoteServer {
    fn fresh<T: id::Marker>(&mut self, i: id::Id<T>) -> Result<(), JsValue> {
        if self.seen.len() >= 256 || !self.seen.insert(key(i)) {
            Err(fail("duplicate/stale ID or session budget"))
        } else {
            Ok(())
        }
    }
    fn device(&self, i: id::DeviceId) -> Result<&wgpu::Device, JsValue> {
        if self.device_id != Some(i) {
            return Err(fail("unknown/stale device"));
        }
        self.device.as_ref().ok_or_else(|| fail("device missing"))
    }
    fn queue(&self, i: id::QueueId) -> Result<&wgpu::Queue, JsValue> {
        if self.queue_id != Some(i) {
            return Err(fail("unknown/stale queue"));
        }
        self.queue.as_ref().ok_or_else(|| fail("queue missing"))
    }
    fn buffer(&self, i: id::BufferId) -> Result<&wgpu::Buffer, JsValue> {
        self.buffers
            .get(&i)
            .ok_or_else(|| fail("unknown/stale buffer"))
    }
    async fn callback<T>(
        &self,
        mut rx: futures_channel::oneshot::Receiver<T>,
    ) -> Result<T, JsValue> {
        let end = js_sys::Date::now() + 30000.;
        loop {
            if self.gl {
                self.device
                    .as_ref()
                    .unwrap()
                    .poll(wgpu::PollType::Poll)
                    .map_err(fail)?;
            }
            if let Some(v) = rx.try_recv().map_err(fail)? {
                return Ok(v);
            }
            if js_sys::Date::now() > end {
                return Err(fail("callback deadline"));
            }
            let promise = js_sys::Promise::new(&mut |resolve, _| {
                let g = js_sys::global();
                let f = js_sys::Reflect::get(&g, &"setTimeout".into())
                    .unwrap()
                    .unchecked_into::<js_sys::Function>();
                let _ = f.call2(&g, &resolve, &1.into());
            });
            wasm_bindgen_futures::JsFuture::from(promise).await?;
        }
    }
    async fn process(
        &mut self,
        m: Message<'static>,
        data: &[u8],
        replies: &mut Vec<Vec<u8>>,
        mapped: &mut Vec<Vec<u8>>,
    ) -> Result<(), JsValue> {
        let mut response = None;
        match m {
            Message::RequestAdapter { adapter_id, desc } => {
                if desc.force_fallback_adapter {
                    return Err(fail(
                        "force-fallback unsupported by browser WebGPU; select a software browser",
                    ));
                }
                self.fresh(adapter_id)?;
                self.adapter_id = Some(adapter_id);
                let i = self.adapter.get_info();
                let limits = profile(self.gl);
                response = Some(ServerMessage::RequestAdapterResponse(
                    adapter_id,
                    Some(AdapterInformation {
                        id: adapter_id,
                        limits,
                        features: wgt::FeaturesWebGPU::empty(),
                        name: i.name.into(),
                        vendor: i.vendor,
                        device: i.device,
                        device_type: match i.device_type {
                            wgpu::DeviceType::DiscreteGpu => wgt::DeviceType::DiscreteGpu,
                            wgpu::DeviceType::IntegratedGpu => wgt::DeviceType::IntegratedGpu,
                            wgpu::DeviceType::Cpu => wgt::DeviceType::Cpu,
                            wgpu::DeviceType::VirtualGpu => wgt::DeviceType::VirtualGpu,
                            wgpu::DeviceType::Other => wgt::DeviceType::Other,
                        },
                        driver: i.driver.into(),
                        driver_info: i.driver_info.into(),
                        backend: if self.gl {
                            wgt::Backend::Gl
                        } else {
                            wgt::Backend::BrowserWebGpu
                        },
                        support_use_shared_texture_in_swap_chain: false,
                        subgroup_min_size: i.subgroup_min_size,
                        subgroup_max_size: i.subgroup_max_size,
                    }),
                ));
            }
            Message::RequestDevice {
                adapter_id,
                device_id,
                queue_id,
                desc,
            } => {
                if Some(adapter_id) != self.adapter_id || self.device.is_some() {
                    return Err(fail("adapter/device ownership"));
                }
                self.fresh(device_id)?;
                self.fresh(queue_id)?;
                if !desc.required_features.is_empty()
                    || !desc.required_limits.check_limits(&profile(self.gl))
                {
                    return Err(fail("primitive advertises no optional features"));
                }
                let d = wgpu::DeviceDescriptor {
                    label: Some("Nightly159 current remote primitive"),
                    required_features: wgpu::Features::empty(),
                    required_limits: if self.gl {
                        wgpu::Limits::downlevel_webgl2_defaults()
                    } else {
                        wgpu::Limits::downlevel_defaults()
                    },
                    ..Default::default()
                };
                let (device, queue) = self.adapter.request_device(&d).await.map_err(fail)?;
                let events = self.events.clone();
                device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
                    let kind = match e {
                        wgpu::Error::Validation { .. } => 0,
                        wgpu::Error::OutOfMemory { .. } => 1,
                        wgpu::Error::Internal { .. } => 2,
                    };
                    let mut v = events.lock().unwrap();
                    if v.len() < 32 {
                        v.push((kind, e.to_string()));
                    }
                }));
                let events = self.events.clone();
                device.set_device_lost_callback(move |reason, message| {
                    let mut v = events.lock().unwrap();
                    if v.len() < 32 {
                        v.push((
                            if reason == wgpu::DeviceLostReason::Destroyed {
                                4
                            } else {
                                3
                            },
                            message,
                        ));
                    }
                });
                self.device = Some(device);
                self.queue = Some(queue);
                self.device_id = Some(device_id);
                self.queue_id = Some(queue_id);
                response = Some(ServerMessage::RequestDeviceResponse(
                    device_id, queue_id, None,
                ));
            }
            Message::Device(di, DeviceAction::CreateShaderModule(i, label, wgsl)) => {
                if self.gl || wgsl.len() > 65536 {
                    return Err(fail("compute/WGSL unavailable on selected backend/profile"));
                }
                self.fresh(i)?;
                let scope = self
                    .device(di)?
                    .push_error_scope(wgpu::ErrorFilter::Validation);
                let object = self
                    .device(di)?
                    .create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: label.as_deref(),
                        source: wgpu::ShaderSource::Wgsl(wgsl),
                    });
                if let Some(e) = scope.pop().await {
                    return Err(fail(e));
                }
                self.shaders.insert(i, object);
                response = Some(ServerMessage::CreateShaderModuleResponse(i, vec![]));
            }
            Message::Device(di, DeviceAction::CreateComputePipeline(i, desc, false)) => {
                if self.gl || desc.layout.is_some() || !desc.stage.constants.is_empty() {
                    return Err(fail("compute pipeline profile"));
                }
                self.fresh(i)?;
                let shader = self
                    .shaders
                    .get(&desc.stage.module)
                    .ok_or_else(|| fail("unknown/stale shader"))?;
                let scope = self
                    .device(di)?
                    .push_error_scope(wgpu::ErrorFilter::Validation);
                let object =
                    self.device(di)?
                        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                            label: desc.label.as_deref(),
                            layout: None,
                            module: shader,
                            entry_point: desc.stage.entry_point.as_deref(),
                            compilation_options: Default::default(),
                            cache: None,
                        });
                if let Some(e) = scope.pop().await {
                    return Err(fail(e));
                }
                self.pipelines.insert(i, object);
                response = Some(ServerMessage::CreateComputePipelineResponse {
                    pipeline_id: i,
                    error: None,
                });
            }
            Message::Device(di, DeviceAction::ComputePipelineGetBindGroupLayout(p, index, i)) => {
                self.device(di)?;
                self.fresh(i)?;
                if index != 0 {
                    return Err(fail("compute binding profile"));
                }
                let object = self
                    .pipelines
                    .get(&p)
                    .ok_or_else(|| fail("unknown/stale pipeline"))?
                    .get_bind_group_layout(index);
                self.layouts.insert(i, object);
            }
            Message::Device(di, DeviceAction::CreateBindGroup(i, desc)) => {
                self.fresh(i)?;
                if desc.entries.len() != 1 {
                    return Err(fail("single storage binding profile"));
                }
                let mut entries = Vec::new();
                for e in desc.entries.iter() {
                    let wgpu_core_remote_types::binding_model::BindingResource::Buffer(b) =
                        &e.resource
                    else {
                        return Err(fail("buffer bindings only"));
                    };
                    entries.push(wgpu::BindGroupEntry {
                        binding: e.binding,
                        resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                            buffer: self.buffer(b.buffer)?,
                            offset: b.offset,
                            size: b.size.to_std().and_then(std::num::NonZeroU64::new),
                        }),
                    });
                }
                let layout = self
                    .layouts
                    .get(&desc.layout)
                    .ok_or_else(|| fail("unknown/stale layout"))?;
                let object = self
                    .device(di)?
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: desc.label.as_deref(),
                        layout,
                        entries: &entries,
                    });
                self.groups.insert(i, object);
            }
            Message::CommandEncoder(
                e,
                CommandEncoderCommand::BeginComputePass {
                    desc,
                    compute_pass_encoder_id: p,
                },
            ) => {
                if self.gl
                    || desc.timestamp_writes.is_some()
                    || !self.encoders.contains_key(&e)
                    || !self.passes.is_empty()
                {
                    return Err(fail("compute pass profile/ownership"));
                }
                self.fresh(p)?;
                self.passes.insert(p, (e, vec![]));
            }
            Message::ComputePassEncoder(p, ComputePassEncoderCommand::End) => {
                let (e, commands) = self
                    .passes
                    .remove(&p)
                    .ok_or_else(|| fail("unknown/stale pass"))?;
                let encoder = self
                    .encoders
                    .get_mut(&e)
                    .ok_or_else(|| fail("unknown/stale encoder"))?;
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor::default());
                for c in &commands {
                    match c {
                        ComputePassEncoderCommand::SetPipeline(i) => pass.set_pipeline(
                            self.pipelines
                                .get(i)
                                .ok_or_else(|| fail("unknown/stale pipeline"))?,
                        ),
                        ComputePassEncoderCommand::BindingCommand(
                            wgpu_core_remote_types::encoders::BindingCommand::SetBindGroup {
                                index,
                                bind_group: Some(i),
                                dynamic_offsets,
                            },
                        ) => pass.set_bind_group(
                            *index,
                            self.groups
                                .get(i)
                                .ok_or_else(|| fail("unknown/stale bindgroup"))?,
                            dynamic_offsets,
                        ),
                        ComputePassEncoderCommand::DispatchWorkgroups {
                            workgroup_count_x: x,
                            workgroup_count_y: y,
                            workgroup_count_z: z,
                        } => {
                            if *x > 64
                                || *y > 64
                                || *z > 64
                                || u64::from(*x) * u64::from(*y) * u64::from(*z) > 4096
                            {
                                return Err(fail("compute dispatch budget"));
                            }
                            pass.dispatch_workgroups(*x, *y, *z)
                        }
                        _ => return Err(fail("compute command profile")),
                    }
                }
            }
            Message::ComputePassEncoder(p, c) => {
                let (_, commands) = self
                    .passes
                    .get_mut(&p)
                    .ok_or_else(|| fail("unknown/stale pass"))?;
                if commands.len() > 32 {
                    return Err(fail("compute command budget"));
                }
                commands.push(c);
            }
            Message::Device(
                di,
                DeviceAction::CreateBuffer {
                    buffer_id,
                    desc,
                    shmem_handle_index,
                },
            ) => {
                if desc.size > 1024 * 1024
                    || self.buffers.values().map(|b| b.size()).sum::<u64>() + desc.size
                        > 4 * 1024 * 1024
                    || desc.mapped_at_creation
                    || shmem_handle_index != 0
                    || (self.gl && desc.usage.contains(wgt::BufferUsages::STORAGE))
                {
                    return Err(fail("buffer profile/shmem unsupported"));
                }
                self.fresh(buffer_id)?;
                let b = self.device(di)?.create_buffer(&wgpu::BufferDescriptor {
                    label: desc.label.as_deref(),
                    size: desc.size,
                    usage: wgpu::BufferUsages::from_bits(desc.usage.bits())
                        .ok_or_else(|| fail("unsupported buffer usage"))?,
                    mapped_at_creation: false,
                });
                self.buffers.insert(buffer_id, b);
            }
            Message::Device(di, DeviceAction::CreateCommandEncoder(e, desc)) => {
                self.fresh(e)?;
                let x = self
                    .device(di)?
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: desc.label.as_deref(),
                    });
                self.encoders.insert(e, x);
            }
            Message::Device(di, DeviceAction::PushErrorScope(filter)) => {
                let guard = self.device(di)?.push_error_scope(match filter {
                    FfiErrorFilter::Validation => wgpu::ErrorFilter::Validation,
                    FfiErrorFilter::OutOfMemory => wgpu::ErrorFilter::OutOfMemory,
                    FfiErrorFilter::Internal => wgpu::ErrorFilter::Internal,
                });
                self.scopes.push(guard);
            }
            Message::Device(di, DeviceAction::PopErrorScope) => {
                self.device(di)?;
                if self.scopes.is_empty() {
                    response = Some(ServerMessage::PopErrorScopeResponse(
                        di,
                        FfiPopErrorScopeResultType::EmptyErrorScopeStack,
                        "".into(),
                    ));
                } else {
                    self.device(di)?;
                    let r = self.scopes.pop().unwrap().pop().await;
                    response = Some(match r {
                        None => ServerMessage::PopErrorScopeResponse(
                            di,
                            FfiPopErrorScopeResultType::NoError,
                            "".into(),
                        ),
                        Some(e) => ServerMessage::PopErrorScopeResponse(
                            di,
                            match &e {
                                wgpu::Error::Validation { .. } => {
                                    FfiPopErrorScopeResultType::Validation
                                }
                                wgpu::Error::OutOfMemory { .. } => {
                                    FfiPopErrorScopeResultType::OutOfMemory
                                }
                                wgpu::Error::Internal { .. } => {
                                    FfiPopErrorScopeResultType::Internal
                                }
                            },
                            e.to_string().into(),
                        ),
                    });
                }
            }
            Message::QueueWrite {
                queue_id,
                data_source: QueueWriteDataSource::DataBuffer(0),
                action: QueueWriteAction::Buffer { dst, offset },
            } => {
                self.queue(queue_id)?
                    .write_buffer(self.buffer(dst)?, offset, data);
            }
            Message::CommandEncoder(
                e,
                CommandEncoderCommand::CopyBufferToBuffer {
                    source,
                    source_offset,
                    destination,
                    destination_offset,
                    size: Some(size),
                },
            ) => {
                let source = self.buffer(source)?.clone();
                let destination = self.buffer(destination)?.clone();
                self.encoders
                    .get_mut(&e)
                    .ok_or_else(|| fail("unknown/stale encoder"))?
                    .copy_buffer_to_buffer(
                        &source,
                        source_offset,
                        &destination,
                        destination_offset,
                        size,
                    );
            }
            Message::CommandEncoder(
                e,
                CommandEncoderCommand::Finish {
                    desc: _,
                    command_buffer_id: c,
                },
            ) => {
                self.fresh(c)?;
                let encoder = self
                    .encoders
                    .remove(&e)
                    .ok_or_else(|| fail("unknown/stale encoder"))?;
                self.commands.insert(c, encoder.finish());
            }
            Message::QueueSubmit(q, ids, textures, external) => {
                if !textures.is_empty() || !external.is_empty() {
                    return Err(fail("presentation not supported"));
                }
                let mut cmds = Vec::new();
                for i in ids.iter() {
                    cmds.push(
                        self.commands
                            .remove(i)
                            .ok_or_else(|| fail("unknown/stale command"))?,
                    );
                }
                self.queue(q)?.submit(cmds);
                let (tx, rx) = futures_channel::oneshot::channel();
                self.queue(q)?.on_submitted_work_done(move || {
                    let _ = tx.send(());
                });
                self.callback(rx).await?;
            }
            Message::QueueOnSubmittedWorkDone {
                device_id,
                queue_id,
            } => {
                self.device(device_id)?;
                let (tx, rx) = futures_channel::oneshot::channel();
                self.queue(queue_id)?.on_submitted_work_done(move || {
                    let _ = tx.send(());
                });
                self.callback(rx).await?;
                response = Some(ServerMessage::QueueOnSubmittedWorkDoneResponse(queue_id));
            }
            Message::BufferMap {
                device_id,
                buffer_id,
                mode,
                offset,
                size,
            } => {
                self.device(device_id)?;
                if mode != 1 || size > 1024 * 1024 {
                    return Err(fail("read map profile"));
                }
                let b = self.buffer(buffer_id)?;
                let range = b.slice(
                    offset
                        ..offset
                            .checked_add(size)
                            .ok_or_else(|| fail("range overflow"))?,
                );
                let (tx, rx) = futures_channel::oneshot::channel();
                range.map_async(wgpu::MapMode::Read, move |r| {
                    let _ = tx.send(r);
                });
                let result = self.callback(rx).await?;
                response = Some(match result {
                    Ok(()) => {
                        mapped.push(range.get_mapped_range().map_err(fail)?.to_vec());
                        self.mapped.insert(buffer_id);
                        ServerMessage::BufferMapResponse(
                            buffer_id,
                            BufferMapResult::Success {
                                is_writable: false,
                                offset,
                                size,
                            },
                        )
                    }
                    Err(e) => ServerMessage::BufferMapResponse(
                        buffer_id,
                        BufferMapResult::Error(e.to_string().into()),
                    ),
                });
            }
            Message::BufferUnmap(di, b, false) => {
                self.device(di)?;
                if !self.mapped.remove(&b) {
                    return Err(fail("buffer not mapped"));
                }
                self.buffer(b)?.unmap();
            }
            Message::DropBuffer(b) => {
                self.buffers
                    .remove(&b)
                    .ok_or_else(|| fail("unknown/stale buffer"))?
                    .destroy();
            }
            _ => return Err(fail("operation outside current bounded remote profile")),
        }
        if let Some(r) = response {
            replies.push(bincode::serialize(&r).map_err(fail)?)
        }
        Ok(())
    }
}
#[wasm_bindgen]
impl RemoteServer {
    #[wasm_bindgen(js_name=create)]
    pub async fn create(
        session: u32,
        backend: String,
        protocol: String,
    ) -> Result<RemoteServer, JsValue> {
        if protocol != protocol_version()
            || session == 0
            || !matches!(backend.as_str(), "auto" | "webgpu" | "webgl")
        {
            return Err(fail("invalid session/backend"));
        }
        async fn acquire(
            gl: bool,
        ) -> Result<(wgpu::Adapter, Option<wgpu::Surface<'static>>), JsValue> {
            let mut d = wgpu::InstanceDescriptor::new_without_display_handle();
            d.backends = if gl {
                wgpu::Backends::GL
            } else {
                wgpu::Backends::BROWSER_WEBGPU
            };
            let instance = wgpu::Instance::new(d);
            let surface = if gl {
                Some(
                    instance
                        .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(
                            web_sys::OffscreenCanvas::new(1, 1)?,
                        ))
                        .map_err(fail)?,
                )
            } else {
                None
            };
            let a = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    compatible_surface: surface.as_ref(),
                    ..Default::default()
                })
                .await
                .map_err(fail)?;
            Ok((a, surface))
        }
        let (adapter, surface) = if backend == "webgl" {
            acquire(true).await?
        } else {
            match acquire(false).await {
                Ok(v) => v,
                Err(_) if backend == "auto" => acquire(true).await?,
                Err(e) => return Err(e),
            }
        };
        let gl = adapter.get_info().backend == wgpu::Backend::Gl;
        Ok(Self {
            session,
            closed: false,
            poisoned: false,
            adapter,
            surface,
            device: None,
            queue: None,
            adapter_id: None,
            device_id: None,
            queue_id: None,
            shaders: HashMap::new(),
            pipelines: HashMap::new(),
            layouts: HashMap::new(),
            groups: HashMap::new(),
            passes: HashMap::new(),
            buffers: HashMap::new(),
            encoders: HashMap::new(),
            commands: HashMap::new(),
            seen: HashSet::new(),
            scopes: Vec::new(),
            gl,
            mapped: HashSet::new(),
            events: Arc::new(Mutex::new(vec![])),
        })
    }
    pub async fn dispatch(
        &mut self,
        session: u32,
        bytes: Vec<u8>,
        count: u32,
        data: Vec<u8>,
    ) -> Result<String, JsValue> {
        if session != self.session || self.closed || self.poisoned {
            return Err(fail("closed/stale/failed session"));
        }
        if data.len() > 1024 * 1024 {
            return Err(fail("data budget"));
        }
        let messages = decode(&bytes, count).map_err(fail)?;
        let mut replies = Vec::new();
        let mut mapped = Vec::new();
        for m in messages {
            if let Err(e) = self.process(m, &data, &mut replies, &mut mapped).await {
                self.poisoned = true;
                return Err(e);
            }
        }
        let events = std::mem::take(&mut *self.events.lock().unwrap());
        for (kind, message) in &events {
            if let Some(di) = self.device_id {
                let r = if *kind >= 3 {
                    self.closed = true;
                    ServerMessage::DeviceLost(
                        di,
                        if *kind == 4 {
                            FfiDeviceLostReason::Destroyed
                        } else {
                            FfiDeviceLostReason::Unknown
                        },
                        message.as_str().into(),
                    )
                } else {
                    ServerMessage::UncapturedError(
                        di,
                        match kind {
                            0 => FfiErrorFilter::Validation,
                            1 => FfiErrorFilter::OutOfMemory,
                            _ => FfiErrorFilter::Internal,
                        },
                        message.as_str().into(),
                    )
                };
                replies.push(bincode::serialize(&r).map_err(fail)?);
            }
        }
        Ok(serde_json::json!({"session":session,"replies":replies,"mapped":mapped,"backend":format!("{:?}",self.adapter.get_info().backend),"adapter":{"name":self.adapter.get_info().name,"vendor":self.adapter.get_info().vendor,"device":self.adapter.get_info().device,"deviceType":format!("{:?}",self.adapter.get_info().device_type),"driver":self.adapter.get_info().driver,"driverInfo":self.adapter.get_info().driver_info},"capabilities":{"bufferCopyReadMap":true,"wgslComputeStorage":!self.gl,"texturesRender":false,"optionalFeatures":[],"maxBufferBytes":1048576,"maxLiveBufferBytes":4194304},"pass":events.is_empty(),"events":events}).to_string())
    }
    pub fn resource_count(&self) -> u32 {
        (self.buffers.len()
            + self.commands.len()
            + self.encoders.len()
            + self.passes.len()
            + self.groups.len()
            + self.layouts.len()
            + self.pipelines.len()
            + self.shaders.len()
            + self.scopes.len()
            + self.mapped.len()
            + usize::from(self.device.is_some())
            + usize::from(self.queue.is_some())
            + usize::from(self.surface.is_some())) as u32
    }
    pub fn close(&mut self) -> u32 {
        for b in self.buffers.values() {
            b.destroy()
        }
        self.buffers.clear();
        self.commands.clear();
        self.encoders.clear();
        self.passes.clear();
        self.groups.clear();
        self.layouts.clear();
        self.pipelines.clear();
        self.shaders.clear();
        self.scopes.clear();
        self.mapped.clear();
        if let Some(d) = self.device.take() {
            d.destroy()
        }
        self.queue.take();
        self.surface.take();
        self.closed = true;
        self.resource_count()
    }
}

impl Drop for RemoteServer {
    fn drop(&mut self) {
        self.close();
    }
}

#[wasm_bindgen]
pub fn stale_buffer_fixture() -> Vec<u8> {
    pack(&[
        Message::DropBuffer(id(5)),
        Message::BufferMap {
            device_id: id(2),
            buffer_id: id(5),
            mode: 1,
            offset: 0,
            size: 64,
        },
    ])
}

#[wasm_bindgen]
pub fn stale_scope_fixture() -> Vec<u8> {
    pack(&[Message::Device(id(999), DeviceAction::PopErrorScope)])
}
