#version 450
layout(set = 0, binding = 1) uniform Params { vec4 offset; vec4 tint; } params;
layout(location = 0) out vec4 color;
void main() { color = params.tint; }
