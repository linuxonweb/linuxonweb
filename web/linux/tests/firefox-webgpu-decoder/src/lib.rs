//! Firefox 128 WebGPU wire decoder (packet W3).
//!
//! Decodes the bincode ByteBufs that Firefox's WebGPU child sends to
//! `wgpu_server_*` into JSON for the host GPU-owner Worker. The wire types
//! are wgpu-core/wgpu-types (Firefox's vendored rev c7458638) plus the
//! private gfx/wgpu_bindings enums, which build.py extracts verbatim into
//! `wire_generated.rs`.
//!
//! ABI (no imports):
//!   alloc(len) -> ptr        0 if len == 0 or len > MAX_INPUT
//!   free(ptr, len)
//!   decode(kind, ptr, len) -> status   0 ok, 1 decode error, 2 bad kind,
//!                                      3 input too large, 4 bad pointer
//!   result_ptr(), result_len()         UTF-8 JSON of the last decode
//!   max_input() -> usize
//! Output: {"ok":true,"kind":K,"canonical":B,"value":V} or
//!         {"ok":false,"kind":K,"error":"..."}.
//! `canonical` is true when bincode re-encoding of the decoded value
//! reproduces the input bytes exactly.

use bincode::Options;
use serde::{de::DeserializeOwned, Serialize};
use std::alloc::{alloc as raw_alloc, dealloc, Layout};
use std::cell::RefCell;
use std::marker::PhantomData;

mod guard;
mod wire_generated;

pub const MAX_INPUT: usize = 16 << 20;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

pub(crate) const KINDS: [&str; 7] = [
    "DeviceAction",
    "CommandEncoderAction",
    "RenderPass",
    "ComputePass",
    "QueueWriteAction",
    "TextureAction",
    "DeviceDescriptor",
];

fn opts() -> impl Options {
    // Firefox: bincode::serialize / bincode::deserialize = fixint, little
    // endian, no limit, trailing bytes allowed on deserialize. The decoder
    // bounds reads to the input and rejects trailing bytes.
    bincode::DefaultOptions::new().with_fixint_encoding()
}

/// Decode `bytes` as `T`, append `"canonical":..,"value":..` JSON to `out`.
pub(crate) fn run<T: DeserializeOwned + Serialize>(bytes: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    let value: T = opts()
        .with_limit(bytes.len() as u64)
        .reject_trailing_bytes()
        .deserialize_seed(guard::Root::<T>(PhantomData), bytes)
        .map_err(|e| e.to_string())?;
    let canonical = match opts().serialize(&value) {
        Ok(re) => re == bytes,
        Err(_) => false,
    };
    let mut json = Vec::with_capacity(bytes.len() * 4 + 64);
    json.extend_from_slice(if canonical { b"\"canonical\":true,\"value\":" } else { b"\"canonical\":false,\"value\":" });
    serde_json::to_writer(&mut json, &value).map_err(|e| format!("json: {e}"))?;
    out.extend_from_slice(&json);
    Ok(())
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"?\"".into())
}

fn set_result(v: Vec<u8>) {
    RESULT.with(|r| *r.borrow_mut() = v);
}

#[no_mangle]
pub extern "C" fn max_input() -> usize {
    MAX_INPUT
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_INPUT {
        return std::ptr::null_mut();
    }
    match Layout::from_size_align(len, 8) {
        Ok(l) => unsafe { raw_alloc(l) },
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 || len > MAX_INPUT {
        return;
    }
    if let Ok(l) = Layout::from_size_align(len, 8) {
        unsafe { dealloc(ptr, l) }
    }
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

fn memory_bytes() -> usize {
    #[cfg(target_arch = "wasm32")]
    {
        core::arch::wasm32::memory_size(0) * 65536
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        usize::MAX
    }
}

#[no_mangle]
pub extern "C" fn decode(kind: u32, ptr: *const u8, len: usize) -> u32 {
    let name = kind
        .checked_sub(1)
        .and_then(|k| KINDS.get(k as usize))
        .copied();
    let head = |ok: bool| {
        let mut v = Vec::new();
        v.extend_from_slice(if ok { b"{\"ok\":true,\"kind\":" } else { b"{\"ok\":false,\"kind\":" });
        v.extend_from_slice(json_str(name.unwrap_or("?")).as_bytes());
        v.push(b',');
        v
    };
    let fail = |code: u32, msg: &str| {
        let mut v = head(false);
        v.extend_from_slice(b"\"error\":");
        v.extend_from_slice(json_str(msg).as_bytes());
        v.push(b'}');
        set_result(v);
        code
    };
    let Some(_) = name else {
        return fail(2, &format!("unknown kind {kind}"));
    };
    if len > MAX_INPUT {
        return fail(3, &format!("input {len} bytes exceeds {MAX_INPUT}"));
    }
    if len > 0 && (ptr.is_null() || (ptr as usize).checked_add(len).map_or(true, |e| e > memory_bytes())) {
        return fail(4, "input pointer out of bounds");
    }
    let bytes: &[u8] = if len == 0 { &[] } else { unsafe { std::slice::from_raw_parts(ptr, len) } };
    let mut out = head(true);
    match wire_generated::decode_kind(kind, bytes, &mut out) {
        Ok(()) => {
            out.push(b'}');
            set_result(out);
            0
        }
        Err(e) => fail(1, &e),
    }
}
