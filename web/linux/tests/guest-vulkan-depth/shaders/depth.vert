#version 450
// A5: position with an explicit clip-space depth plus a flat colour. The
// depth test compares the interpolated z of constant-depth quads.
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 0) flat out vec4 v_color;
void main() {
    v_color = a_color;
    gl_Position = vec4(a_position, 1.0);
}
