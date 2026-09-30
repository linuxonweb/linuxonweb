#version 450
// Rejected: depth-comparison samplers.
layout(set = 0, binding = 0) uniform sampler2DShadow u_shadow;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(texture(u_shadow, vec3(v_uv, 0.5)));
}
