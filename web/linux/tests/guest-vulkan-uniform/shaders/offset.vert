#version 450
// Shared VERTEX|FRAGMENT block at set 0 binding 1, plus an ordinary attribute.
layout(location = 0) in vec2 position;
layout(set = 0, binding = 1) uniform Params { vec4 offset; vec4 tint; } params;
void main() { gl_Position = vec4(position + params.offset.xy, 0.0, 1.0); }
