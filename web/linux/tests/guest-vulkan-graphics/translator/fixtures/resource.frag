#version 450
layout(set = 0, binding = 0) uniform Color { vec4 color; };
layout(location = 0) out vec4 pixel;
void main() { pixel = color; }
