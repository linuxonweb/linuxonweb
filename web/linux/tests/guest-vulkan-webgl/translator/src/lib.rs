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

// A4 adapter (no Naga source change): pinned Naga 0.20 samples only through
// an OpSampledImage coupling. Vulkan GLSL combined `sampler2D` globals are a
// single UniformConstant variable of OpTypeSampledImage, which Naga maps to an
// image global, leaving no sampler. Split each such variable into its image
// global plus a synthesized sampler global at binding + 16 in the same set,
// and rewrite every OpLoad of it into image load + sampler load + OpSampledImage.
// Everything outside that exact shape is rejected, including separate
// samplers/images, arrays and passing combined samplers through functions.
// Inputs without combined samplers are returned unchanged (byte-identical).
// Kept identical to guest-vulkan-graphics/translator/src/lib.rs.
fn split_combined_samplers(input: &[u8]) -> Result<Vec<u8>, String> {
    use std::collections::{HashMap, HashSet};
    let word = |i: usize| u32::from_le_bytes(input[i..i + 4].try_into().unwrap());
    let mut images = HashSet::new();
    let mut sampled = HashMap::new(); // sampled-image type -> image type
    let mut pointers = HashSet::new(); // UniformConstant pointer -> sampled-image
    let mut vars = Vec::new();
    let mut sets = HashMap::new();
    let mut bindings = HashMap::new();
    let mut annotations_end = 0usize;
    let mut offset = 20;
    while offset < input.len() {
        let instruction = word(offset);
        let count = (instruction >> 16) as usize;
        let opcode = instruction & 0xffff;
        let operand = |n: usize| if n < count { Some(word(offset + 4 * n)) } else { None };
        match opcode {
            25 => { images.insert(operand(1).ok_or("malformed OpTypeImage")?); },
            26 => return Err("separate samplers unsupported (use combined sampler2D)".into()),
            27 => {
                let (id, image) = (operand(1).ok_or("malformed OpTypeSampledImage")?, operand(2).ok_or("malformed OpTypeSampledImage")?);
                if !images.contains(&image) { return Err("sampled image must reference a declared image type".into()); }
                sampled.insert(id, image);
            },
            28 | 29 => {
                let element = operand(2).ok_or("malformed array type")?;
                if images.contains(&element) || sampled.contains_key(&element) {
                    return Err("arrays of images or samplers unsupported".into());
                }
            },
            32 => {
                let (id, storage, base) = (operand(1).ok_or("malformed pointer")?, operand(2).ok_or("malformed pointer")?, operand(3).ok_or("malformed pointer")?);
                if images.contains(&base) { return Err("separate images unsupported (use combined sampler2D)".into()); }
                if sampled.contains_key(&base) {
                    if storage != 0 { return Err("combined sampler pointer must be UniformConstant".into()); }
                    pointers.insert(id);
                }
            },
            59 => {
                if pointers.contains(&operand(1).ok_or("malformed OpVariable")?) {
                    if count != 4 { return Err("combined sampler variable cannot have an initializer".into()); }
                    vars.push((operand(2).unwrap(), offset));
                }
            },
            55 => {
                let ty = operand(1).ok_or("malformed OpFunctionParameter")?;
                if pointers.contains(&ty) || sampled.contains_key(&ty) || images.contains(&ty) {
                    return Err("image/sampler function parameters unsupported".into());
                }
            },
            71 => {
                if let (Some(target), Some(decoration), Some(value)) = (operand(1), operand(2), operand(3)) {
                    if decoration == 34 { sets.insert(target, value); }
                    if decoration == 33 { bindings.insert(target, value); }
                }
                annotations_end = offset + 4 * count;
            },
            72..=75 | 332 | 5632 | 5633 => annotations_end = offset + 4 * count,
            _ => {},
        }
        offset += 4 * count;
    }
    if vars.is_empty() { return Ok(input.to_vec()); }
    if vars.len() > 4 { return Err("combined sampler count exceeds profile (4)".into()); }
    let ids: HashSet<u32> = vars.iter().map(|v| v.0).collect();
    // Only direct OpLoad of a combined variable is allowed; any other use as
    // an operand (calls, stores, copies, access chains, OpCopyObject ...) is refused.
    let mut offset = 20;
    while offset < input.len() {
        let count = (word(offset) >> 16) as usize;
        let opcode = word(offset) & 0xffff;
        // Explicit pointer/value operand positions only; literal operands
        // (constants, strings, indices) must never be mistaken for ids.
        let refs: Vec<usize> = match opcode {
            62 | 63 => vec![1, 2],                        // OpStore, OpCopyMemory
            60 | 65 | 66 | 67 | 70 | 83 | 124 => vec![3], // texel pointer, access chains, copy, bitcast
            57 => (4..count).collect(),                   // OpFunctionCall arguments
            245 => (3..count).step_by(2).collect(),       // OpPhi values
            169 => vec![4, 5],                            // OpSelect
            401..=403 => vec![3, 4],                      // pointer comparisons
            _ => Vec::new(),
        };
        if refs.iter().any(|&n| n < count && ids.contains(&word(offset + 4 * n))) {
            return Err("combined samplers may only be loaded directly".into());
        }
        offset += 4 * count;
    }
    let bound = word(12);
    if bound as usize + 2 + vars.len() > 16_400 { return Err("SPIR-V id bound exceeds profile".into()); }
    let sampler_type = bound; let sampler_pointer = bound + 1;
    let mut split = HashMap::new(); // combined var -> synthesized sampler var
    let mut decorations = Vec::new();
    for (index, &(id, _)) in vars.iter().enumerate() {
        let (set, binding) = match (sets.get(&id), bindings.get(&id)) {
            (Some(&s), Some(&b)) => (s, b),
            _ => return Err("combined sampler requires explicit DescriptorSet and Binding".into()),
        };
        if set >= 4 || binding >= 16 { return Err("texture set/binding outside profile (set < 4, binding < 16)".into()); }
        let sampler = bound + 2 + index as u32;
        split.insert(id, sampler);
        decorations.extend_from_slice(&[71 | 4 << 16, sampler, 34, set, 71 | 4 << 16, sampler, 33, binding + 16]);
    }
    if annotations_end == 0 { return Err("combined sampler requires explicit DescriptorSet and Binding".into()); }
    let mut out: Vec<u32> = Vec::with_capacity(input.len() / 4 + 64);
    for i in 0..5 { out.push(word(4 * i)); }
    out[3] = bound + 2 + vars.len() as u32;
    let mut offset = 20;
    while offset < input.len() {
        let count = (word(offset) >> 16) as usize;
        let opcode = word(offset) & 0xffff;
        if offset == vars[0].1 { out.extend_from_slice(&[26 | 2 << 16, sampler_type, 32 | 4 << 16, sampler_pointer, 0, sampler_type]); }
        if opcode == 61 && count >= 4 && split.contains_key(&word(offset + 12)) {
            let (ty, result, var) = (word(offset + 4), word(offset + 8), word(offset + 12));
            // New ids for the two loads come after all synthesized declarations.
            let image_load = out[3]; let sampler_load = out[3] + 1; out[3] += 2;
            if out[3] > 16_400 { return Err("SPIR-V id bound exceeds profile".into()); }
            out.extend_from_slice(&[61 | 4 << 16, ty, image_load, var,
                61 | 4 << 16, sampler_type, sampler_load, split[&var],
                86 | 5 << 16, ty, result, image_load, sampler_load]);
        } else {
            for n in 0..count { out.push(word(offset + 4 * n)); }
        }
        if opcode == 59 && count == 4 {
            if let Some(&sampler) = split.get(&word(offset + 8)) {
                out.extend_from_slice(&[59 | 4 << 16, sampler_pointer, sampler, 0]);
            }
        }
        offset += 4 * count;
        if offset == annotations_end { out.extend_from_slice(&decorations); }
    }
    Ok(out.iter().flat_map(|w| w.to_le_bytes()).collect())
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
    let rewritten = split_combined_samplers(input)?;
    let module = naga::front::spv::parse_u8_slice(&rewritten, &options)
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
    let mut texture_globals: Vec<(Handle<naga::GlobalVariable>, naga::ResourceBinding)> = Vec::new();
    let mut sampler_globals: Vec<(Handle<naga::GlobalVariable>, naga::ResourceBinding)> = Vec::new();
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
            (naga::AddressSpace::Handle, Some(binding)) => match module.types[global.ty].inner {
                TypeInner::Image { dim: naga::ImageDimension::D2, arrayed: false,
                    class: naga::ImageClass::Sampled { kind: naga::ScalarKind::Float, multi: false } }
                    if binding.group < 4 && binding.binding < 16 => texture_globals.push((handle, binding.clone())),
                TypeInner::Sampler { comparison: false }
                    if binding.group < 4 && (16..32).contains(&binding.binding) => sampler_globals.push((handle, binding.clone())),
                _ => return Err("texture profile permits only combined sampler2D (float, 2D, non-array, non-multisampled)".into()),
            },
            _ => return Err("graphics profile permits only uniform buffers and private globals".into()),
        }
    }
    if uniform_globals.len() > 8 { return Err("uniform buffer count exceeds profile".into()); }
    if texture_globals.len() > 4 { return Err("texture count exceeds profile".into()); }
    for (index, (_, binding)) in texture_globals.iter().chain(sampler_globals.iter()).enumerate() {
        if uniform_globals.iter().any(|item| &item.1 == binding) ||
            texture_globals.iter().chain(sampler_globals.iter()).skip(index + 1).any(|other| &other.1 == binding) {
            return Err("duplicate resource set/binding".into());
        }
    }
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module).map_err(|error| format!("SPIR-V validation: {error}"))?;
    let usage = info.get_entry_point(0);
    let mut used: Vec<_> = uniform_globals.into_iter().filter(|item| !usage[item.0].is_empty()).collect();
    used.sort_by_key(|item| (item.1.group, item.1.binding));
    // Every used texture is sampled only through its own synthesized sampler
    // (same set, binding + 16) and every sampling pair is such a pair.
    let mut textures: Vec<_> = texture_globals.into_iter().filter(|item| !usage[item.0].is_empty()).collect();
    textures.sort_by_key(|item| (item.1.group, item.1.binding));
    for key in usage.sampling_set.iter() {
        let image = module.global_variables[key.image].binding.as_ref();
        let sampler = module.global_variables[key.sampler].binding.as_ref();
        match (image, sampler) {
            (Some(i), Some(s)) if textures.iter().any(|t| t.0 == key.image) &&
                i.group == s.group && s.binding == i.binding + 16 => {},
            _ => return Err("texture sampled through a foreign sampler".into()),
        }
    }
    for texture in &textures {
        if !usage.sampling_set.iter().any(|key| key.image == texture.0) {
            return Err("texture must be sampled through its combined sampler".into());
        }
    }
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
    if reflection.texture_mapping.len() != textures.len() || !reflection.push_constant_items.is_empty() ||
        reflection.uniforms.len() != used.len() {
        return Err("GLSL backend returned prohibited resources".into());
    }
    let mut resources: Vec<((u32, u32), String)> = Vec::new();
    for (handle, b, size, members) in &used {
        let block = reflection.uniforms.remove(handle).ok_or("GLSL backend omitted a used uniform block")?;
        if block.is_empty() || block.len() > 160 || !block.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("unsupported backend uniform block name".into());
        }
        resources.push(((b.group, b.binding), format!("{{\"group\":{},\"binding\":{},\"type\":\"uniform\",\"size\":{size},\"members\":[{members}],\"blockName\":{}}}",
            b.group, b.binding, quoted(&block))));
    }
    // GLSL ES 3.00 has no sampler objects in source: each combined sampler is
    // one sampler2D uniform named by the writer's exact texture mapping; the
    // host binds its texture unit by that name.
    for (handle, b) in &textures {
        let mut names = reflection.texture_mapping.iter().filter(|(_, mapping)| mapping.texture == *handle);
        let (name, mapping) = names.next().ok_or("GLSL backend omitted a used texture")?;
        if names.next().is_some() { return Err("texture mapped to several GLSL samplers".into()); }
        let sampler = mapping.sampler.ok_or("GLSL texture mapping lacks its sampler")?;
        match module.global_variables[sampler].binding.as_ref() {
            Some(s) if s.group == b.group && s.binding == b.binding + 16 => {},
            _ => return Err("GLSL texture mapped to a foreign sampler".into()),
        }
        if name.is_empty() || name.len() > 160 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("unsupported backend sampler name".into());
        }
        resources.push(((b.group, b.binding), format!("{{\"group\":{},\"binding\":{},\"type\":\"texture\",\"samplerBinding\":{},\"samplerName\":{}}}",
            b.group, b.binding, b.binding + 16, quoted(name))));
    }
    resources.sort_by_key(|item| item.0);
    let resource_json: Vec<&str> = resources.iter().map(|item| item.1.as_str()).collect();
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
