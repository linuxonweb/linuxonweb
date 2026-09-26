#version 450
layout(location = 0) in vec2 varying_color;
layout(location = 0) out vec4 pixel;
void main() { pixel = vec4(varying_color, 0.0, 1.0); }
