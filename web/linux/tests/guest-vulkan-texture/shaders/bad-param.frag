#version 450
// Rejected: combined samplers passed through a function parameter.
layout(set = 0, binding = 0) uniform sampler2D u_texture;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
vec4 fetch(sampler2D s, vec2 uv) { return texture(s, uv); }
void main() {
    color = fetch(u_texture, v_uv);
}
