#version 450
layout(location = 0) in vec2 position;
layout(location = 1) in vec3 color;
layout(location = 0) out vec3 varying_color;
out gl_PerVertex { vec4 gl_Position; };
struct VertexPayload { vec2 position; vec3 color; };
void main() {
    VertexPayload value = VertexPayload(position, color);
    gl_Position = vec4(value.position * vec2(0.5, 0.75) + vec2(0.25, -0.1), 0.75, 1.0);
    varying_color = value.color;
}
