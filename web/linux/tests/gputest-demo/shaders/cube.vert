#version 450
// G2 rotating cube: object-space position plus a flat per-face colour,
// transformed by a per-frame MVP from a UNIFORM_BUFFER (set 0, binding 0).
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 0) flat out vec4 v_color;
layout(set = 0, binding = 0) uniform Transform { mat4 mvp; } transform;
void main() {
    v_color = a_color;
    gl_Position = transform.mvp * vec4(a_position, 1.0);
}
