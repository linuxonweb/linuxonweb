#version 450
layout(location = 0) in vec2 position;
layout(location = 1) in vec3 color;
layout(location = 0) out vec3 varying_color;
out gl_PerVertex { vec4 gl_Position; };
// For input x in [-1,1], w is positive and varies from 1 to 2.
// Projected xy stays equal to position; later independent CPU oracle must use
// sum(lambda_i * color_i / w_i) / sum(lambda_i / w_i), not affine colors.
void main() {
    float w = 1.5 + 0.5 * position.x;
    gl_Position = vec4(position * w, 0.25 * w, w);
    varying_color = color;
}
