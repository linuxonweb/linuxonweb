//! Independent graphics ABI: supplied SPIR-V -> validated IR -> GLSL ES 300 + reflection.
//! This crate deliberately does not modify the accepted compute translator.
use std::cell::RefCell;
use naga::{Binding, BuiltIn, Handle, Interpolation, Module, Sampling, ShaderStage, Type, TypeInner};

const INPUT_LIMIT: usize = 65_536;
const OUTPUT_LIMIT: usize = 262_144;
const METADATA_LIMIT: usize = 16_384;
#[derive(Default)]
struct State { input: Vec<u8>, output: Vec<u8>, metadata: Vec<u8> }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

#[no_mangle]
pub extern "C" fn translator_version() -> u32 { 0x474c_0001 }
#[no_mangle]
pub extern "C" fn input_reserve(length: u32) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.output.clear(); state.metadata.clear(); state.input.clear();
        let size = length as usize;
        if !(20..=INPUT_LIMIT).contains(&size) || size % 4 != 0 { return 0; }
        state.input.resize(size, 0);
        state.input.as_mut_ptr() as usize as u32
    })
}

// JSON strings are escaped independently of either shader language's identifiers.
fn quoted(value: &str) -> String {
    let mut out = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"),
            c if c <= '\u{1f}' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"'); out
}

struct Io { location: Option<u32>, builtin: bool, components: u8, json: String }
fn reflect(module: &Module, ty: Handle<Type>, binding: Option<&Binding>, stage: ShaderStage,
           input: bool, depth: usize, items: &mut Vec<Io>) -> Result<(), String> {
    if depth > 4 || items.len() >= 9 { return Err("interface exceeds profile bounds".into()); }
    if binding.is_none() {
        if let TypeInner::Struct { ref members, .. } = module.types[ty].inner {
            for member in members {
                reflect(module, member.ty, member.binding.as_ref(), stage, input, depth + 1, items)?;
            }
            return Ok(());
        }
        return Err("interface leaf has no binding".into());
    }
    if let Some(Binding::BuiltIn(BuiltIn::VertexIndex)) = binding {
        // Vulkan gl_VertexIndex (including firstVertex); Naga types it as u32.
        match module.types[ty].inner {
            TypeInner::Scalar(scalar) if stage == ShaderStage::Vertex && input &&
                scalar.kind == naga::ScalarKind::Uint && scalar.width == 4 => {},
            _ => return Err("vertex_index is only supported as a vertex-stage u32 input".into()),
        }
        if items.iter().any(|item| item.builtin && item.location == Some(u32::MAX)) {
            return Err("duplicate interface binding".into());
        }
        items.push(Io { location: Some(u32::MAX), builtin: true, components: 1,
            json: "{\"builtin\":\"vertex_index\",\"type\":{\"scalar\":\"u32\",\"components\":1},\"interpolation\":null}".into() });
        return Ok(());
    }
    let components = match module.types[ty].inner {
        TypeInner::Vector { size, scalar } if scalar.kind == naga::ScalarKind::Float && scalar.width == 4 => size as u8,
        _ => return Err("interface supports only float32 vectors of 2 to 4 components".into()),
    };
    let type_json = format!("{{\"scalar\":\"f32\",\"components\":{components}}}");
    let (location, builtin, json) = match binding.unwrap() {
        Binding::BuiltIn(BuiltIn::Position { invariant })
            if components == 4 && ((stage == ShaderStage::Vertex && !input) ||
                                  (stage == ShaderStage::Fragment && input)) => {
            (None, true, format!("{{\"builtin\":\"position\",\"type\":{type_json},\"invariant\":{invariant},\"interpolation\":null}}"))
        },
        Binding::Location { location, second_blend_source, interpolation, sampling } => {
            if *location >= 8 || *second_blend_source { return Err("unsupported interface location/blend source".into()); }
            if stage == ShaderStage::Fragment && !input && (*location != 0 || components != 4) {
                return Err("fragment output must be location 0 float32x4".into());
            }
            let varying = (stage == ShaderStage::Vertex && !input) || (stage == ShaderStage::Fragment && input);
            let interpolation_json = if varying {
                let mode = match interpolation {
                    Some(Interpolation::Perspective) => "perspective",
                    Some(Interpolation::Linear) => return Err("linear/noperspective interpolation unsupported by WebGL profile".into()),
                    Some(Interpolation::Flat) => "flat",
                    None => return Err("varying requires explicit IR interpolation".into()),
                };
                let sampling = match sampling {
                    None => "null",
                    Some(Sampling::Center) => "\"center\"",
                    _ => return Err("only center sampling supported".into()),
                };
                format!("{{\"mode\":\"{mode}\",\"sampling\":{sampling}}}")
            } else { "null".into() };
            (Some(*location), false, format!("{{\"location\":{location},\"type\":{type_json},\"interpolation\":{interpolation_json}}}"))
        },
        _ => return Err("unsupported interface builtin".into()),
    };
    if items.iter().any(|item| item.location == location && item.builtin == builtin) {
        return Err("duplicate interface binding".into());
    }
    items.push(Io { location, builtin, components, json });
    Ok(())
}

// Bounded std140/std430-compatible uniform profile: tightly packed vec4,
// mat4x4 (column-major, stride 16) and array<vec4, N> (stride 16) members.
fn uniform_layout(module: &Module, ty: Handle<Type>) -> Result<(u32, String), String> {
    let float4 = |ty: Handle<Type>| matches!(module.types[ty].inner, TypeInner::Vector { size: naga::VectorSize::Quad, scalar }
        if scalar.kind == naga::ScalarKind::Float && scalar.width == 4);
    let (members, span) = match module.types[ty].inner {
        TypeInner::Struct { ref members, span } => (members, span),
        _ => return Err("uniform buffer must be a block struct".into()),
    };
    if members.is_empty() || members.len() > 16 { return Err("uniform block member count outside profile".into()); }
    let mut offset = 0u32; let mut items = Vec::new();
    for member in members {
        let (kind, length, size) = match module.types[member.ty].inner {
            _ if float4(member.ty) => ("vec4", 0, 16),
            TypeInner::Matrix { columns: naga::VectorSize::Quad, rows: naga::VectorSize::Quad, scalar }
                if scalar.kind == naga::ScalarKind::Float && scalar.width == 4 => ("mat4x4", 0, 64),
            TypeInner::Array { base, size: naga::ArraySize::Constant(n), stride: 16 }
                if float4(base) && n.get() <= 1024 => ("vec4", n.get(), 16 * n.get()),
            _ => return Err("uniform members must be vec4<f32>, mat4x4<f32> or array<vec4<f32>, N>".into()),
        };
        if member.offset != offset { return Err("uniform members must be tightly packed".into()); }
        items.push(format!("{{\"offset\":{offset},\"type\":\"{kind}\",\"arrayLength\":{length}}}"));
        offset += size;
    }
    if span != offset || offset > 16_384 { return Err("uniform block size outside profile".into()); }
    Ok((offset, items.join(",")))
}

fn compile(input: &[u8]) -> Result<(String, String), String> {
    if !(20..=INPUT_LIMIT).contains(&input.len()) || input.len() % 4 != 0 {
        return Err("invalid SPIR-V byte length".into());
    }
    let word = |i| u32::from_le_bytes(input[i..i + 4].try_into().unwrap());
    if word(0) != 0x0723_0203 || !(0x0001_0000..=0x0001_0300).contains(&word(4)) ||
        word(12) == 0 || word(12) > 16_384 || word(16) != 0 {
        return Err("unsupported SPIR-V header/version/id bound".into());
    }
    let mut offset = 20;
    let mut entry_declarations = 0;
    while offset < input.len() {
        let instruction = word(offset);
        let bytes = (instruction >> 16) as usize * 4;
        if bytes == 0 || bytes > input.len() - offset { return Err("truncated SPIR-V instruction".into()); }
        let opcode = instruction & 0xffff;
        if opcode == 15 { entry_declarations += 1; }
        // Pinned Naga's apply_default_interpolation overwrites explicit sampling
        // when interpolation is implicit. Reject unsupported raw decorations
        // before that normalization, including interface-block members/groups.
        let decoration_offset = match opcode {
            71 if bytes >= 12 => Some(offset + 8),  // OpDecorate
            72 if bytes >= 16 => Some(offset + 12), // OpMemberDecorate
            _ => None,
        };
        if let Some(position) = decoration_offset {
            if matches!(word(position), 16 | 17) {
                return Err("only center sampling supported (raw SPIR-V decoration)".into());
            }
            if word(position) == 4 { return Err("row-major uniform matrices unsupported".into()); }
        }
        offset += bytes;
    }
    // Naga may collapse duplicate OpEntryPoint declarations for one function.
    // Enforce the input profile before parsing as well as on the resulting IR.
    if entry_declarations != 1 { return Err("exactly one graphics entry point declaration required".into()); }
    let options = naga::front::spv::Options {
        adjust_coordinate_space: true, strict_capabilities: true, block_ctx_dump_prefix: None,
    };
    let module = naga::front::spv::parse_u8_slice(input, &options)
        .map_err(|error| format!("SPIR-V parse: {error}"))?;
    if module.entry_points.len() != 1 { return Err("exactly one graphics entry point required".into()); }
    let entry = &module.entry_points[0];
    let stage = match entry.stage {
        ShaderStage::Vertex => "vertex", ShaderStage::Fragment => "fragment",
        _ => return Err("compute is not a graphics stage".into()),
    };
    if entry.name.is_empty() || entry.name.len() > 128 { return Err("original entry name exceeds profile bounds".into()); }
    if entry.early_depth_test.is_some() { return Err("early depth tests unsupported".into()); }
    if !module.overrides.is_empty() { return Err("specialization constants unsupported".into()); }
    let mut uniform_globals = Vec::new();
    for (handle, global) in module.global_variables.iter() {
        match (global.space, global.binding.as_ref()) {
            (naga::AddressSpace::Private, None) => {},
            (naga::AddressSpace::Uniform, Some(binding)) => {
                if binding.group >= 4 || binding.binding >= 16 {
                    return Err("uniform set/binding outside profile (set < 4, binding < 16)".into());
                }
                if uniform_globals.iter().any(|(_, other, _, _): &(Handle<naga::GlobalVariable>, naga::ResourceBinding, u32, String)| other == binding) {
                    return Err("duplicate uniform set/binding".into());
                }
                let (size, members) = uniform_layout(&module, global.ty)?;
                uniform_globals.push((handle, binding.clone(), size, members));
            },
            _ => return Err("graphics profile permits only uniform buffers and private globals".into()),
        }
    }
    if uniform_globals.len() > 8 { return Err("uniform buffer count exceeds profile".into()); }
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module).map_err(|error| format!("SPIR-V validation: {error}"))?;
    let usage = info.get_entry_point(0);
    let mut used: Vec<_> = uniform_globals.into_iter().filter(|item| !usage[item.0].is_empty()).collect();
    used.sort_by_key(|item| (item.1.group, item.1.binding));
    let mut inputs = Vec::new(); let mut outputs = Vec::new();
    for argument in &entry.function.arguments {
        reflect(&module, argument.ty, argument.binding.as_ref(), entry.stage, true, 0, &mut inputs)?;
    }
    if let Some(result) = &entry.function.result {
        reflect(&module, result.ty, result.binding.as_ref(), entry.stage, false, 0, &mut outputs)?;
    }
    if entry.stage == ShaderStage::Vertex && outputs.iter().filter(|item| item.builtin).count() != 1 {
        return Err("vertex shader requires position output".into());
    }
    if entry.stage == ShaderStage::Fragment && (outputs.len() != 1 || outputs[0].components != 4) {
        return Err("fragment shader requires one float32x4 color output".into());
    }
    inputs.sort_by_key(|item| item.location); outputs.sort_by_key(|item| item.location);
    let options = naga::back::glsl::Options {
        version: naga::back::glsl::Version::Embedded { version: 300, is_webgl: true },
        writer_flags: naga::back::glsl::WriterFlags::ADJUST_COORDINATE_SPACE,
        binding_map: Default::default(), zero_initialize_workgroup_memory: true,
    };
    let pipeline = naga::back::glsl::PipelineOptions {
        shader_stage: entry.stage, entry_point: entry.name.clone(), multiview: None,
    };
    let mut output = String::new();
    let mut reflection = naga::back::glsl::Writer::new(&mut output, &module, &info,
        &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
        .map_err(|error| format!("GLSL writer: {error}"))?
        .write().map_err(|error| format!("GLSL write: {error}"))?;
    if output.len() > OUTPUT_LIMIT { return Err("GLSL output exceeds profile limit".into()); }
    if !reflection.texture_mapping.is_empty() || !reflection.push_constant_items.is_empty() ||
        reflection.uniforms.len() != used.len() {
        return Err("GLSL backend returned prohibited resources".into());
    }
    let mut resource_json = Vec::new();
    for (handle, b, size, members) in &used {
        let block = reflection.uniforms.remove(handle).ok_or("GLSL backend omitted a used uniform block")?;
        if block.is_empty() || block.len() > 160 || !block.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("unsupported backend uniform block name".into());
        }
        resource_json.push(format!("{{\"group\":{},\"binding\":{},\"type\":\"uniform\",\"size\":{size},\"members\":[{members}],\"blockName\":{}}}",
            b.group, b.binding, quoted(&block)));
    }
    if !used.is_empty() {
        // ES 3.00 cannot express Vulkan set/binding; the host assigns block
        // bindings by reflected name. Force std140 so offsets are portable and
        // verify them after linking. Resource-free output remains unchanged.
        let marker = "precision highp int;\n";
        let at = output.find(marker).ok_or("GLSL precision header missing")? + marker.len();
        output.insert_str(at, "layout(std140) uniform;\n");
        if output.len() > OUTPUT_LIMIT { return Err("GLSL output exceeds profile limit".into()); }
    }
    // Exact writer reflection, not source parsing or a fabricated name map.
    // GLES 300 uses explicit vertex-input/fragment-output locations; the pinned
    // writer may therefore return no host-assigned varying bindings.
    if reflection.varying.len() > 16 { return Err("backend varying bounds exceeded".into()); }
    let mut bindings: Vec<_> = reflection.varying.into_iter().collect();
    bindings.sort_by(|a, b| (a.1.location, a.1.index, &a.0).cmp(&(b.1.location, b.1.index, &b.0)));
    let mut varying_json = Vec::new();
    for (name, binding) in bindings {
        if name.is_empty() || name.len() > 160 || binding.location >= 8 || binding.index != 0 {
            return Err("unsupported backend varying binding".into());
        }
        varying_json.push(format!("{{\"name\":{},\"location\":{},\"index\":{}}}",
            quoted(&name), binding.location, binding.index));
    }
    let join = |items: &[Io]| items.iter().map(|item| item.json.as_str()).collect::<Vec<_>>().join(",");
    // Pinned GLSL write_function selects literal main for every entry point.
    // Frontend Y adjustment and backend Y/Z adjustment require a pixel parity
    // gate; these booleans record configuration, not a coordinate proof.
    let metadata = format!("{{\"schema\":1,\"profile\":\"graphics-empty-webgl-v1\",\"backend\":\"glsl-es-300\",\"stage\":\"{stage}\",\"originalEntryPoint\":{},\"entryPoint\":\"main\",\"coordinateAdjustment\":true,\"backendCoordinateAdjustment\":true,\"inputs\":[{}],\"outputs\":[{}],\"resources\":[{}],\"varyingBindings\":[{}]}}",
        quoted(&entry.name), join(&inputs), join(&outputs), resource_json.join(","), varying_json.join(","));
    if metadata.len() > METADATA_LIMIT { return Err("reflection exceeds profile limit".into()); }
    Ok((output, metadata))
}

#[no_mangle]
pub extern "C" fn translate(length: u32) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut(); state.output.clear(); state.metadata.clear();
        let result = if state.input.len() == length as usize { compile(&state.input) }
                     else { Err("input length does not match reservation".into()) };
        state.input.clear();
        match result {
            Ok((output, metadata)) => { state.output = output.into_bytes(); state.metadata = metadata.into_bytes(); 0 },
            Err(error) => { state.output = error.chars().take(512).collect::<String>().into_bytes(); 1 },
        }
    })
}
#[no_mangle]
pub extern "C" fn output_ptr() -> u32 { STATE.with(|s| s.borrow().output.as_ptr() as usize as u32) }
#[no_mangle]
pub extern "C" fn output_len() -> u32 { STATE.with(|s| s.borrow().output.len() as u32) }
#[no_mangle]
pub extern "C" fn metadata_ptr() -> u32 { STATE.with(|s| s.borrow().metadata.as_ptr() as usize as u32) }
#[no_mangle]
pub extern "C" fn metadata_len() -> u32 { STATE.with(|s| s.borrow().metadata.len() as u32) }
