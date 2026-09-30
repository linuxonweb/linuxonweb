#version 450
// A4: two textures on distinct units plus a uniform block in the same set.
// Channel selection and a 0/1 scale keep every expected byte exact.
layout(set = 0, binding = 0) uniform sampler2D u_first;
layout(set = 0, binding = 1) uniform sampler2D u_second;
layout(set = 0, binding = 2) uniform Select { vec4 scale; } u_select;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    vec4 a = texture(u_first, v_uv);
    vec4 b = texture(u_second, v_uv);
    color = vec4(a.rg, b.ba) * u_select.scale;
}
