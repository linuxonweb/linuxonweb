#version 450
// Rejected: texture binding outside the profile (binding < 16).
layout(set = 0, binding = 16) uniform sampler2D u_texture;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_texture, v_uv);
}
