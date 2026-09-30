#version 450
// Rejected: a texture used without sampling (texelFetch) has no sampler pair.
layout(set = 0, binding = 0) uniform sampler2D u_texture;
layout(location = 0) out vec4 color;
void main() {
    color = texelFetch(u_texture, ivec2(gl_FragCoord.xy) & 3, 0);
}
