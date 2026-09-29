#version 450
// A3: MVP and positions both come from a uniform block; no vertex buffers.
layout(set = 0, binding = 0) uniform Transform { mat4 mvp; vec4 positions[6]; } transform;
void main() { gl_Position = transform.mvp * transform.positions[gl_VertexIndex]; }
