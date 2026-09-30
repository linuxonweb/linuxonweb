#version 450
// Rejected: integer textures.
layout(set = 0, binding = 0) uniform usampler2D u_integer;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(texture(u_integer, v_uv)) / 255.0;
}
