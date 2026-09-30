#version 450
// Rejected: arrays of combined samplers.
layout(set = 0, binding = 0) uniform sampler2D u_textures[2];
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_textures[0], v_uv) + texture(u_textures[1], v_uv);
}
