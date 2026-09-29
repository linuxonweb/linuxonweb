#version 450
layout(set = 1, binding = 0) uniform Material { vec4 color; } material;
layout(location = 0) out vec4 color;
void main() { color = material.color; }
