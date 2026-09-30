#version 450
// A4: one combined image sampler (set 0, binding 0).
layout(set = 0, binding = 0) uniform sampler2D u_texture;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_texture, v_uv);
}
