//! Narrow application-supplied SPIR-V -> validated Naga IR -> WGSL adapter.
//! Single-threaded instance, owned by a disposable browser Worker.
use std::cell::RefCell;

const INPUT_LIMIT: usize = 65_536;
const OUTPUT_LIMIT: usize = 262_144;
const ERROR_LIMIT: usize = 2_048;

#[derive(Default)]
struct State { input: Vec<u8>, output: Vec<u8>, entry: Vec<u8> }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

#[no_mangle]
pub extern "C" fn translator_version() -> u32 { 1 }

#[no_mangle]
pub extern "C" fn input_reserve(length: u32) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.output.clear();
        state.entry.clear();
        state.input.clear();
        let size = length as usize;
        if !(20..=INPUT_LIMIT).contains(&size) || size % 4 != 0 { return 0; }
        state.input.resize(size, 0);
        state.input.as_mut_ptr() as usize as u32
    })
}

fn compile(input: &[u8]) -> Result<(String, String), String> {
    let word = |i| u32::from_le_bytes(input[i..i + 4].try_into().unwrap());
    if input.len() < 20 || input.len() > INPUT_LIMIT || input.len() % 4 != 0 {
        return Err("invalid SPIR-V byte length".into());
    }
    if word(0) != 0x0723_0203 || word(4) < 0x0001_0000 || word(4) > 0x0001_0300 ||
        word(12) == 0 || word(12) > 16_384 || word(16) != 0 {
        return Err("unsupported SPIR-V header/version/id bound".into());
    }
    let mut offset = 20;
    while offset < input.len() {
        let bytes = (word(offset) >> 16) as usize * 4;
        if bytes == 0 || bytes > input.len() - offset {
            return Err("truncated or zero-length SPIR-V instruction".into());
        }
        offset += bytes;
    }
    let options = naga::front::spv::Options {
        adjust_coordinate_space: false,
        strict_capabilities: true,
        block_ctx_dump_prefix: None,
    };
    let module = naga::front::spv::parse_u8_slice(input, &options)
        .map_err(|error| format!("SPIR-V parse: {error}"))?;
    if module.entry_points.len() != 1 {
        return Err("profile requires exactly one compute entry point".into());
    }
    let entry = &module.entry_points[0];
    if entry.name != "main" || entry.stage != naga::ShaderStage::Compute ||
        entry.workgroup_size != [64, 1, 1] {
        return Err("profile requires compute main with local size 64,1,1".into());
    }
    if !module.overrides.is_empty() { return Err("specialization constants unsupported".into()); }
    let mut bindings = 0;
    for (_, global) in module.global_variables.iter() {
        match global.space {
            naga::AddressSpace::Storage { access } => {
                if access != (naga::StorageAccess::LOAD | naga::StorageAccess::STORE) {
                    return Err("storage must be read/write".into());
                }
                let binding = global.binding.as_ref().ok_or("storage requires a descriptor binding")?;
                if binding.group != 0 || binding.binding != 0 { return Err("only set 0 binding 0 supported".into()); }
                bindings += 1;
            },
            naga::AddressSpace::Private | naga::AddressSpace::WorkGroup if global.binding.is_none() => {},
            _ => return Err("unsupported resource/address space".into()),
        }
    }
    if bindings != 1 { return Err("profile requires one storage buffer".into()); }
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module).map_err(|error| format!("SPIR-V validation: {error}"))?;
    let output = naga::back::wgsl::write_string(&module, &info, naga::back::wgsl::WriterFlags::EXPLICIT_TYPES)
        .map_err(|error| format!("WGSL write: {error}"))?;
    if output.len() > OUTPUT_LIMIT { return Err("WGSL output exceeds profile limit".into()); }
    // Match the pinned WGSL writer's exact naming policy, including type-name collisions.
    let mut names = naga::FastHashMap::default();
    naga::proc::Namer::default().reset(&module, naga::keywords::wgsl::RESERVED,
        &[], &[], &["__"], &mut names);
    let name = names.remove(&naga::proc::NameKey::EntryPoint(0)).ok_or("missing generated entry point")?;
    if name.len() > 128 { return Err("generated entry name too long".into()); }
    Ok((output, name))
}

#[no_mangle]
pub extern "C" fn translate(length: u32) -> u32 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.output.clear();
        state.entry.clear();
        let result = if state.input.len() != length as usize {
            Err("input length does not match reserved storage".into())
        } else { compile(&state.input) };
        state.input.clear();
        match result {
            Ok((output, name)) => { state.output = output.into_bytes(); state.entry = name.into_bytes(); 0 },
            Err(error) => {
                state.output = error.chars().take(ERROR_LIMIT / 4).collect::<String>().into_bytes();
                1
            },
        }
    })
}

#[no_mangle]
pub extern "C" fn output_ptr() -> u32 {
    STATE.with(|cell| cell.borrow().output.as_ptr() as usize as u32)
}

#[no_mangle]
pub extern "C" fn output_len() -> u32 {
    STATE.with(|cell| cell.borrow().output.len() as u32)
}

#[no_mangle]
pub extern "C" fn entry_point_ptr() -> u32 {
    STATE.with(|cell| cell.borrow().entry.as_ptr() as usize as u32)
}

#[no_mangle]
pub extern "C" fn entry_point_len() -> u32 {
    STATE.with(|cell| cell.borrow().entry.len() as u32)
}
