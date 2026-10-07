// SPDX-License-Identifier: MIT
// Host presentation only: these shaders do not implement a guest GPU device.
function surface(width, height) {
    if (globalThis.OffscreenCanvas) return new OffscreenCanvas(width, height);
    const canvas = globalThis.document?.createElement("canvas");
    if (!canvas) throw new Error("GPU canvas unavailable");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

export function createWebGLPresenter(width, height, onLost) {
    const canvas = surface(width, height);
    const gl = canvas.getContext("webgl", {
        alpha: false, antialias: false, depth: false, stencil: false,
        preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL unavailable");
    const shaders = [];
    let program, buffer, texture;
    let closed = false;
    const lose = event => {
        event.preventDefault();
        if (!closed) onLost("WebGL context lost");
    };
    const close = () => {
        closed = true;
        canvas.removeEventListener?.("webglcontextlost", lose);
        if (texture) gl.deleteTexture(texture);
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        for (const shader of shaders) gl.deleteShader(shader);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    try {
        const compile = (type, source) => {
            const shader = gl.createShader(type);
            shaders.push(shader);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(shader) || "shader compilation failed");
            return shader;
        };
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, `
            attribute vec2 position; varying vec2 uv;
            void main() { gl_Position=vec4(position,0.,1.);
                uv=vec2((position.x+1.)*.5,(1.-position.y)*.5); }`));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
            precision highp float; varying vec2 uv; uniform sampler2D pixels;
            void main() { gl_FragColor=vec4(texture2D(pixels,uv).bgr,1.); }`));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(program) || "shader linking failed");
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,3, 3,-1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.uniform1i(gl.getUniformLocation(program, "pixels"), 0);
        gl.disable(gl.DITHER);
        gl.viewport(0, 0, width, height);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL initialization failed");
        canvas.addEventListener?.("webglcontextlost", lose);
        return {
            backend: "webgl", canvas,
            // Upload only rows [from, to); the texture keeps the other rows.
            draw(bytes, from = 0, to = height) {
                if (closed || gl.isContextLost()) throw new Error("WebGL context lost");
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, width, to - from, gl.RGBA, gl.UNSIGNED_BYTE,
                    bytes.subarray(from * width * 4, to * width * 4));
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                return canvas;
            }, close,
        };
    } catch (error) { close(); throw error; }
}

export async function createWebGPUPresenter(width, height, onLost) {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error("WebGPU unavailable");
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter unavailable");
    const device = await adapter.requestDevice();
    let context, texture, closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        texture?.destroy();
        context?.unconfigure();
        device.destroy();
    };
    try {
        const canvas = surface(width, height);
        context = canvas.getContext("webgpu");
        if (!context) throw new Error("WebGPU canvas unavailable");
        const format = gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "opaque" });
        const shader = device.createShaderModule({ code: `
            struct Vertex { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
            @vertex fn vertex(@builtin(vertex_index) i:u32)->Vertex {
                let p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(-1.,3.),vec2f(3.,-1.))[i];
                var o:Vertex; o.pos=vec4f(p,0.,1.); o.uv=vec2f((p.x+1.)*.5,(1.-p.y)*.5); return o;
            }
            @group(0) @binding(0) var pixels:texture_2d<f32>;
            @fragment fn fragment(v:Vertex)->@location(0) vec4f {
                let p=vec2i(v.uv*vec2f(textureDimensions(pixels)));
                return vec4f(textureLoad(pixels,p,0).bgr,1.);
            }` });
        const pipeline = await device.createRenderPipelineAsync({
            layout: "auto", vertex: { module: shader, entryPoint: "vertex" },
            fragment: { module: shader, entryPoint: "fragment", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
        });
        texture = device.createTexture({ size: [width,height], format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: texture.createView() }] });
        device.lost.then(info => { if (!closed) onLost(`WebGPU device lost: ${info.reason}`); });
        device.addEventListener("uncapturederror", event => {
            event.preventDefault();
            if (!closed) onLost(`WebGPU error: ${event.error.message}`);
        });
        return {
            backend: "webgpu", canvas,
            fallbackAdapter: adapter.info?.isFallbackAdapter ?? null,
            draw(bytes, from = 0, to = height) {
                if (closed) throw new Error("WebGPU presenter closed");
                device.queue.writeTexture({ texture, origin: [0, from] }, bytes,
                    { offset: from * width * 4, bytesPerRow: width * 4 }, [width, to - from]);
                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({ colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    loadOp: "clear", storeOp: "store", clearValue: { r:0,g:0,b:0,a:1 },
                }] });
                pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
                device.queue.submit([encoder.finish()]);
                // Offscreen WebGPU canvases may not publish their current texture
                // to drawImage until presentation. Explicitly transfer its frame.
                return canvas.transferToImageBitmap ? canvas.transferToImageBitmap() : canvas;
            }, close,
        };
    } catch (error) { close(); throw error; }
}
