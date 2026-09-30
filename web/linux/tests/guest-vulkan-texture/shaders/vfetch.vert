#version 450
// A4: vertex-stage sampling with an explicit level. The attribute selects a
// texel centre; the sampled colour is forwarded as a flat varying.
layout(set = 0, binding = 3) uniform sampler2D u_lookup;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 0) flat out vec4 v_color;
void main() {
    v_color = textureLod(u_lookup, a_uv, 0.0);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
