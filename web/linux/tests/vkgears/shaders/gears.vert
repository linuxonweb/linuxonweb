#version 450
// V1 vkgears: glxgears' fixed-function lighting done per vertex.
// One directional light at eye-space direction normalize(5,5,10), light0
// diffuse (1,1,1) and ambient (0,0,0), GL default light-model ambient 0.2,
// material AMBIENT_AND_DIFFUSE = gear colour, no specular. Normals are
// transformed by mat3(modelview) (rotation + translation only, as glxgears)
// and renormalised (GL_NORMALIZE). Flat faces carry the provoking-vertex
// normal on all of their vertices, so their colour is constant.
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 0) out vec4 v_color;
layout(set = 0, binding = 0) uniform Gear {
    mat4 mvp;
    mat4 modelview;
    vec4 color;
} gear;
void main() {
    vec3 n = normalize(mat3(gear.modelview) * a_normal);
    vec3 l = normalize(vec3(5.0, 5.0, 10.0));
    float diffuse = max(dot(n, l), 0.0);
    v_color = vec4(clamp(gear.color.rgb * (0.2 + diffuse), 0.0, 1.0), 1.0);
    gl_Position = gear.mvp * vec4(a_position, 1.0);
}
