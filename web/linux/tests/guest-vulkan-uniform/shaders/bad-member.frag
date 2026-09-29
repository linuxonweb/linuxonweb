#version 450
// Negative: scalar member is not in the tightly packed vec4/mat4 profile.
layout(set = 0, binding = 0) uniform Material { float scale; } material;
layout(location = 0) out vec4 color;
void main() { color = vec4(material.scale); }
