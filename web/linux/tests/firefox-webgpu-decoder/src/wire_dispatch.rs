// Hand-written tail of the generated `wire_generated` module (included by
// build.py after the verbatim Firefox items, so the private enums are in
// scope). Kind numbers match lib.rs KINDS (1-based).

pub(crate) fn decode_kind(kind: u32, bytes: &[u8], out: &mut Vec<u8>) -> Result<(), String> {
    match kind {
        // wgpu_server_device_action
        1 => crate::run::<DeviceAction<'static>>(bytes, out),
        // wgpu_server_command_encoder_action
        2 => crate::run::<wgc::device::trace::Command>(bytes, out),
        // wgpu_server_render_pass
        3 => crate::run::<RecordedRenderPass>(bytes, out),
        // wgpu_server_compute_pass
        4 => crate::run::<RecordedComputePass>(bytes, out),
        // wgpu_server_queue_write_action
        5 => crate::run::<QueueWriteAction>(bytes, out),
        // wgpu_server_texture_action
        6 => crate::run::<TextureAction<'static>>(bytes, out),
        // wgpu_server_adapter_request_device
        7 => crate::run::<wgc::device::DeviceDescriptor<'static>>(bytes, out),
        _ => Err(format!("unknown kind {kind}")),
    }
}
