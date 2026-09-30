#version 450
// Rejected: separate texture2D + sampler objects are outside the A4 profile.
layout(set = 0, binding = 0) uniform texture2D u_image;
layout(set = 0, binding = 1) uniform sampler u_sampler;
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    color = texture(sampler2D(u_image, u_sampler), v_uv);
}
