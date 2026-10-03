//! Experimental, bounded guest Vulkan graphics profile, executed by real Rust wgpu.
//! The browser owns this module; it is not linked into the Linux guest ABI.
use futures_channel::oneshot;
use serde_json::{Value, json};
use std::{borrow::Cow, collections::HashMap};
use wasm_bindgen::prelude::*;
fn err(s: impl ToString) -> JsValue {
    js_sys::Error::new(&s.to_string()).into()
}
fn parse(s: &str) -> Result<Value, JsValue> {
    serde_json::from_str(s).map_err(err)
}
fn uint(v: &Value, key: &str) -> Result<u32, JsValue> {
    v[key]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| err(format!("invalid {key}")))
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, JsValue> {
    v[key].as_str().ok_or_else(|| err(format!("invalid {key}")))
}
struct Target {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
    initialized: bool,
}
enum Resource {
    Pipeline(wgpu::RenderPipeline),
    Buffer(wgpu::Buffer, u32),
    Target(Target),
}
#[wasm_bindgen]
pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    resources: HashMap<u32, Resource>,
    next: u32,
    info: String,
    closed: bool,
    passes: u32,
    draws: u32,
    readbacks: u32,
    needs_poll: bool,
    surface: Option<wgpu::Surface<'static>>,
}
async fn acquire(
    instance: &wgpu::Instance,
    gl: bool,
    force_fallback: bool,
) -> Result<(wgpu::Adapter, Option<wgpu::Surface<'static>>), JsValue> {
    // The WebGL HAL enumerates adapters only for an existing context/surface.
    // Keep the private offscreen surface alive; rendered targets remain textures.
    let surface = if gl {
        let canvas = web_sys::OffscreenCanvas::new(1, 1)?;
        Some(
            instance
                .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
                .map_err(err)?,
        )
    } else {
        None
    };
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: force_fallback,
            compatible_surface: surface.as_ref(),
            ..Default::default()
        })
        .await
        .map_err(|e| err(format!("wgpu adapter unavailable: {e}")))?;
    Ok((adapter, surface))
}
impl Renderer {
    fn available(&self) -> Result<(), JsValue> {
        if self.closed {
            Err(err("wgpu renderer closed"))
        } else {
            Ok(())
        }
    }
    fn add(&mut self, r: Resource) -> Result<u32, JsValue> {
        self.available()?;
        if self.resources.len() >= 64 {
            return Err(err("resource budget exceeded"));
        }
        let id = self.next;
        self.next += 1;
        self.resources.insert(id, r);
        Ok(id)
    }
    fn target(&self, id: u32) -> Result<&Target, JsValue> {
        self.available()?;
        match self.resources.get(&id) {
            Some(Resource::Target(t)) => Ok(t),
            _ => Err(err("unknown target")),
        }
    }
    async fn callback<T>(&self, mut rx: oneshot::Receiver<T>) -> Result<T, JsValue> {
        if !self.needs_poll {
            return rx.await.map_err(err);
        }
        let deadline = js_sys::Date::now() + 60000.;
        loop {
            self.device.poll(wgpu::PollType::Poll).map_err(err)?;
            if let Some(value) = rx.try_recv().map_err(err)? {
                return Ok(value);
            }
            if js_sys::Date::now() > deadline {
                return Err(err("wgpu GL completion deadline"));
            }
            let promise = js_sys::Promise::new(&mut |resolve, _reject| {
                let global = js_sys::global();
                let function = js_sys::Reflect::get(&global, &JsValue::from_str("setTimeout"))
                    .unwrap()
                    .unchecked_into::<js_sys::Function>();
                let _ = function.call2(&global, &resolve, &JsValue::from_f64(1.));
            });
            wasm_bindgen_futures::JsFuture::from(promise).await?;
        }
    }
    async fn completed(&self) -> Result<(), JsValue> {
        let (tx, rx) = oneshot::channel();
        self.queue.on_submitted_work_done(move || {
            let _ = tx.send(());
        });
        self.callback(rx).await
    }
}
#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(js_name = create)]
    pub async fn create(backend: String, force_fallback: bool) -> Result<Renderer, JsValue> {
        std::panic::set_hook(Box::new(|info| {
            let global = js_sys::global();
            let message = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &message,
                &JsValue::from_str("type"),
                &JsValue::from_str("log"),
            );
            let _ = js_sys::Reflect::set(
                &message,
                &JsValue::from_str("message"),
                &JsValue::from_str(&format!("WGPU_RUST_PANIC {info}")),
            );
            if let Ok(function) = js_sys::Reflect::get(&global, &JsValue::from_str("postMessage")) {
                if let Some(function) = function.dyn_ref::<js_sys::Function>() {
                    let _ = function.call1(&global, &message);
                }
            }
        }));
        if backend != "webgpu" && backend != "webgl" && backend != "auto" {
            return Err(err("unsupported wgpu backend"));
        }
        if force_fallback && backend != "webgl" {
            return Err(err(
                "wgpu browser WebGPU force-fallback request is unsupported; select a software browser adapter explicitly",
            ));
        }
        let mut chosen = if backend == "webgl" {
            wgpu::Backends::GL
        } else {
            wgpu::Backends::BROWSER_WEBGPU
        };
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = chosen;
        let mut instance = wgpu::Instance::new(desc);
        let mut adapter = acquire(&instance, backend == "webgl", force_fallback).await;
        if adapter.is_err() && backend == "auto" {
            chosen = wgpu::Backends::GL;
            let mut d = wgpu::InstanceDescriptor::new_without_display_handle();
            d.backends = chosen;
            instance = wgpu::Instance::new(d);
            adapter = acquire(&instance, true, force_fallback).await;
        }
        let (adapter, surface) = adapter?;
        let info = adapter.get_info();
        let needs_poll = info.backend == wgpu::Backend::Gl;
        let required_limits = if needs_poll {
            wgpu::Limits::downlevel_webgl2_defaults()
        } else {
            wgpu::Limits::downlevel_defaults()
        }
        .using_resolution(adapter.limits());
        let adapter_info = json!({"name":info.name,"vendor":info.vendor,"device":info.device,"deviceType":format!("{:?}",info.device_type),"driver":info.driver,"driverInfo":info.driver_info,"backend":format!("{:?}",info.backend),"requestedBackend":format!("{chosen:?}"),"forceFallbackAdapter":force_fallback,"maxVertexStride":if needs_poll{252}else{2048},"integerViewport":needs_poll});
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("guest-vulkan-wgpu"),
                required_features: wgpu::Features::empty(),
                required_limits,
                experimental_features: Default::default(),
                memory_hints: Default::default(),
                trace: Default::default(),
            })
            .await
            .map_err(err)?;
        Ok(Self {
            device,
            queue,
            resources: HashMap::new(),
            next: 1,
            info: adapter_info.to_string(),
            closed: false,
            passes: 0,
            draws: 0,
            readbacks: 0,
            needs_poll,
            surface,
        })
    }
    pub fn adapter_info(&self) -> String {
        self.info.clone()
    }
    pub fn stats(&self) -> String {
        json!({"resources":self.resources.len(),"nativeObjects":self.resources.len(),"passes":self.passes,"draws":self.draws,"readbacks":self.readbacks,"state":if self.closed{"closed"}else{"active"}}).to_string()
    }
    pub async fn create_pipeline(&mut self, descriptor: String) -> Result<u32, JsValue> {
        self.available()?;
        let d = parse(&descriptor)?;
        if d["uniforms"].as_array().is_some_and(|a| !a.is_empty())
            || d.get("textures").is_some()
            || !d["depth"].is_null()
        {
            return Err(err("wgpu initial profile has no bindings or depth"));
        }
        let mut attributes: Vec<Vec<wgpu::VertexAttribute>> = vec![];
        let layouts = d["vertexBuffers"]
            .as_array()
            .ok_or_else(|| err("vertex layouts"))?;
        for layout in layouts {
            let mut a = vec![];
            for v in layout["attributes"]
                .as_array()
                .ok_or_else(|| err("attributes"))?
            {
                a.push(wgpu::VertexAttribute {
                    format: match text(v, "format")? {
                        "float32x2" => wgpu::VertexFormat::Float32x2,
                        "float32x3" => wgpu::VertexFormat::Float32x3,
                        "float32x4" => wgpu::VertexFormat::Float32x4,
                        _ => return Err(err("vertex format")),
                    },
                    offset: uint(v, "offset")? as u64,
                    shader_location: uint(v, "location")?,
                });
            }
            attributes.push(a);
        }
        let buffers: Vec<_> = layouts
            .iter()
            .enumerate()
            .map(|(i, l)| {
                Ok(Some(wgpu::VertexBufferLayout {
                    array_stride: uint(l, "stride")? as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &attributes[i],
                }))
            })
            .collect::<Result<_, JsValue>>()?;
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let vertex = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("guest SPIR-V vertex translated by Naga"),
                source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(text(&d["vertex"], "wgsl")?)),
            });
        let fragment = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("guest SPIR-V fragment translated by Naga"),
                source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(text(&d["fragment"], "wgsl")?)),
            });
        let pipeline = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("guest Vulkan pipeline"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &vertex,
                    entry_point: Some(text(&d["vertex"], "entryPoint")?),
                    buffers: &buffers,
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &fragment,
                    entry_point: Some(text(&d["fragment"], "entryPoint")?),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    front_face: if d["frontFace"] == "cw" {
                        wgpu::FrontFace::Cw
                    } else {
                        wgpu::FrontFace::Ccw
                    },
                    cull_mode: match d["cullMode"].as_str() {
                        Some("front") => Some(wgpu::Face::Front),
                        Some("back") => Some(wgpu::Face::Back),
                        _ => None,
                    },
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
        if let Some(e) = scope.pop().await {
            return Err(err(e));
        }
        self.add(Resource::Pipeline(pipeline))
    }
    pub async fn create_buffer(&mut self, size: u32) -> Result<u32, JsValue> {
        self.available()?;
        if size == 0 || size > 65536 || size % 4 != 0 {
            return Err(err("vertex buffer size"));
        }
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let b = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("guest vertex buffer"),
            size: size as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        if let Some(e) = scope.pop().await {
            return Err(err(e));
        }
        self.add(Resource::Buffer(b, size))
    }
    pub async fn upload(&self, id: u32, offset: u32, data: Vec<u8>) -> Result<(), JsValue> {
        self.available()?;
        let Some(Resource::Buffer(b, size)) = self.resources.get(&id) else {
            return Err(err("unknown buffer"));
        };
        if offset % 4 != 0 || data.len() % 4 != 0 || offset as usize + data.len() > *size as usize {
            return Err(err("upload range"));
        }
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        self.queue.write_buffer(b, offset as u64, &data);
        if let Some(e) = scope.pop().await {
            return Err(err(e));
        }
        Ok(())
    }
    pub async fn create_target(&mut self, width: u32, height: u32) -> Result<u32, JsValue> {
        self.available()?;
        if width == 0 || height == 0 || width > 512 || height > 512 {
            return Err(err("target extent"));
        }
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let t = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("guest RGBA8 offscreen target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        if let Some(e) = scope.pop().await {
            return Err(err(e));
        }
        self.add(Resource::Target(Target {
            texture: t,
            width,
            height,
            initialized: false,
        }))
    }
    pub async fn render(&mut self, descriptor: String) -> Result<(), JsValue> {
        self.available()?;
        let d = parse(&descriptor)?;
        let id = uint(&d, "target")?;
        let t = self.target(id)?;
        let ds = d["draws"].as_array().ok_or_else(|| err("draws"))?;
        if ds.len() > 256 {
            return Err(err("draw budget"));
        }
        let load = match text(&d, "loadOp")? {
            "load" => {
                if !t.initialized {
                    return Err(err("uninitialized target"));
                }
                wgpu::LoadOp::Load
            }
            "clear" => {
                let c = d["clearColor"]
                    .as_array()
                    .ok_or_else(|| err("clear color"))?;
                if c.len() != 4 {
                    return Err(err("clear color"));
                }
                let n = |i: usize| c[i].as_f64().ok_or_else(|| err("clear color"));
                wgpu::LoadOp::Clear(wgpu::Color {
                    r: n(0)?,
                    g: n(1)?,
                    b: n(2)?,
                    a: n(3)?,
                })
            }
            _ => return Err(err("load operation")),
        };
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let view = t.texture.create_view(&Default::default());
        {
            let attachments = [Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
            })];
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("guest Vulkan renderpass"),
                color_attachments: &attachments,
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            for draw in ds {
                let pid = uint(draw, "pipeline")?;
                let Some(Resource::Pipeline(pipeline)) = self.resources.get(&pid) else {
                    return Err(err("unknown pipeline"));
                };
                pass.set_pipeline(pipeline);
                for (slot, b) in draw["vertexBuffers"]
                    .as_array()
                    .ok_or_else(|| err("vertex bindings"))?
                    .iter()
                    .enumerate()
                {
                    let Some(Resource::Buffer(buffer, size)) =
                        self.resources.get(&uint(b, "buffer")?)
                    else {
                        return Err(err("unknown buffer"));
                    };
                    let offset = b["offset"].as_u64().unwrap_or(0);
                    let length = b["size"].as_u64().unwrap_or(*size as u64 - offset);
                    pass.set_vertex_buffer(slot as u32, buffer.slice(offset..offset + length));
                }
                if let Some(v) = draw.get("viewport") {
                    let n = |key: &str| {
                        v[key]
                            .as_f64()
                            .map(|n| n as f32)
                            .ok_or_else(|| err("viewport"))
                    };
                    pass.set_viewport(
                        n("x")?,
                        n("y")?,
                        n("width")?,
                        n("height")?,
                        n("minDepth")?,
                        n("maxDepth")?,
                    );
                } else {
                    pass.set_viewport(0., 0., t.width as f32, t.height as f32, 0., 1.);
                }
                if let Some(s) = draw.get("scissor") {
                    pass.set_scissor_rect(
                        uint(s, "x")?,
                        uint(s, "y")?,
                        uint(s, "width")?,
                        uint(s, "height")?,
                    );
                }
                let first = draw["firstVertex"].as_u64().unwrap_or(0) as u32;
                pass.draw(first..first + uint(draw, "vertexCount")?, 0..1);
            }
        }
        self.queue.submit([encoder.finish()]);
        self.completed().await?;
        if let Some(e) = scope.pop().await {
            return Err(err(e));
        }
        if let Some(Resource::Target(t)) = self.resources.get_mut(&id) {
            t.initialized = true;
        }
        self.passes += 1;
        self.draws += ds.len() as u32;
        Ok(())
    }
    pub async fn readback(&mut self, id: u32) -> Result<Vec<u8>, JsValue> {
        self.available()?;
        let t = self.target(id)?;
        if !t.initialized {
            return Err(err("uninitialized target"));
        }
        let (w, h) = (t.width, t.height);
        let row = (w * 4).div_ceil(256) * 256;
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("completed guest readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &t.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let (tx, rx) = oneshot::channel();
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result);
            });
        self.callback(rx).await?.map_err(err)?;
        if let Some(e) = scope.pop().await {
            buffer.destroy();
            return Err(err(e));
        }
        let mut pixels = vec![0; (w * h * 4) as usize];
        {
            let mapped = buffer.slice(..).get_mapped_range().map_err(err)?;
            for y in 0..h as usize {
                pixels[y * w as usize * 4..(y + 1) * w as usize * 4]
                    .copy_from_slice(&mapped[y * row as usize..y * row as usize + w as usize * 4]);
            }
        }
        buffer.unmap();
        buffer.destroy();
        self.readbacks += 1;
        Ok(pixels)
    }
    pub fn destroy(&mut self, id: u32) -> Result<(), JsValue> {
        self.available()?;
        match self.resources.remove(&id) {
            Some(Resource::Buffer(b, _)) => b.destroy(),
            Some(Resource::Target(t)) => t.texture.destroy(),
            Some(Resource::Pipeline(_)) => {}
            None => return Err(err("unknown resource")),
        };
        Ok(())
    }
    pub fn close(&mut self) {
        if !self.closed {
            for (_, r) in self.resources.drain() {
                match r {
                    Resource::Buffer(b, _) => b.destroy(),
                    Resource::Target(t) => t.texture.destroy(),
                    _ => {}
                }
            }
            self.device.destroy();
            self.surface.take();
            self.closed = true;
        }
    }
}
