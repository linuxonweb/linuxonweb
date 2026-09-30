#version 450
// Rejected: only 2D non-array float textures are in the profile.
layout(set = 0, binding = 0) uniform sampler3D u_volume;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_volume, vec3(v_uv, 0.5));
}
