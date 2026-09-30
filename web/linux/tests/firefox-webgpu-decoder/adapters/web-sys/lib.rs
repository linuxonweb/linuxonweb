//! W3 decoder adapter for wasm32-unknown-unknown builds of wgpu-types.
//!
//! Firefox patches web-sys to an empty dummy crate (feature list only).
//! wgpu-types names four web-sys types in `ExternalImageSource` (cfg wasm32
//! and not linux). These stand-ins have no public constructor and are never
//! created; they exist only so the wire types compile.
macro_rules! element {
    ($name:ident, $w:ident, $h:ident) => {
        #[derive(Clone, Debug)]
        pub struct $name(js_sys::Object);
        impl $name {
            pub fn $w(&self) -> u32 {
                0
            }
            pub fn $h(&self) -> u32 {
                0
            }
        }
        impl core::ops::Deref for $name {
            type Target = js_sys::Object;
            fn deref(&self) -> &js_sys::Object {
                &self.0
            }
        }
    };
}
element!(ImageBitmap, width, height);
element!(HtmlVideoElement, video_width, video_height);
element!(HtmlCanvasElement, width, height);
element!(OffscreenCanvas, width, height);
