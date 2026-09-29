#version 450
// Negative: binding 16 exceeds the bounded profile (binding < 16).
layout(set = 0, binding = 16) uniform Material { vec4 color; } material;
layout(location = 0) out vec4 color;
void main() { color = material.color; }
