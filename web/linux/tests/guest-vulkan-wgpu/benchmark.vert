#version 450
layout(location=0) in vec2 position;
layout(location=0) out vec2 seed;
void main(){gl_Position=vec4(position,0,1);seed=position*0.25+0.5;}
