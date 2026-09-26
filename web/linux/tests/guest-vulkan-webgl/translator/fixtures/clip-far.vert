#version 450
layout(location = 0) in vec2 position;
layout(location = 1) in vec3 color;
layout(location = 0) out vec3 varying_color;
out gl_PerVertex { vec4 gl_Position; };
// All vertices are outside Vulkan's far clip plane: z/w = 1.25.
void main() {
    gl_Position = vec4(position, 1.25, 1.0);
    varying_color = color;
}
