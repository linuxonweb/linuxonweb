#version 450
layout(location=0) in vec2 seed;
layout(location=0) out vec4 color;
void main(){vec3 s=vec3(seed,0.375);vec3 v=vec3(0.125,0.25,0.5);for(int i=0;i<8192;i++)v=v*0.9999+s*0.0001;color=vec4(v,1);}
