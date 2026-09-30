//! W3 decoder adapter for wasm32-unknown-unknown builds of wgpu-types.
//!
//! Firefox patches js-sys to an empty dummy crate. wgpu-types names
//! `js_sys::Object` only as the Deref target of `ExternalImageSource`
//! (cfg wasm32 and not linux). The decoder never constructs it.
#[derive(Clone, Debug)]
pub struct Object(());
