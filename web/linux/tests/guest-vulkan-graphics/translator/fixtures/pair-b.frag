#version 450
layout(location = 0) in vec3 varying_color;
layout(location = 0) out vec4 pixel;
void main() { pixel = vec4(varying_color.bgr, 1.0); }
