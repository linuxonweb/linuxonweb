// Runs emitted GLSL unchanged in WebGL2. This does not implement the guest driver.
(() => {
  const resultNode = document.getElementById('result');
  const report = { pass: false, cases: [], native: {}, failures: [],
    scope: 'WebGL2 coordinate/shader proof only; no guest, WebGPU parity or physical GPU claim' };
  let assertions = 0;
  const check = (condition, message) => { assertions++; if (!condition) throw new Error(message); };
  const canvas = document.getElementById('target');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  const live = new Map();
  function create(kind, ...args) {
    const object = gl['create' + kind](...args);
    check(!!object, 'native ' + kind + ' allocation');
    live.set(object, kind);
    const counter = report.native[kind] ??= { created: 0, deleted: 0 };
    counter.created++;
    return object;
  }
  function release(object) {
    const kind = live.get(object);
    if (!kind) return;
    gl['delete' + kind](object); live.delete(object); report.native[kind].deleted++;
  }
  function shader(type, source) {
    const object = create('Shader', type);
    gl.shaderSource(object, source); gl.compileShader(object);
    check(gl.getShaderParameter(object, gl.COMPILE_STATUS), 'GLSL compilation: ' + gl.getShaderInfoLog(object));
    return object;
  }
  const positions = [[-.83, -.66], [.79, -.28], [-.17, .87]];
  const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const width = 73, height = 51, viewport = { x: 7, y: 5, width: 57, height: 39 };
  const scissor = { x: 10, y: 8, width: 49, height: 30 };
  function run(vertexName, fragmentName, layout) {
    const label = `${vertexName}/${fragmentName}/${layout}`;
    const vs = shader(gl.VERTEX_SHADER, SHADERS[vertexName]);
    const fs = shader(gl.FRAGMENT_SHADER, SHADERS[fragmentName]);
    const program = create('Program');
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    check(gl.getProgramParameter(program, gl.LINK_STATUS), 'program link: ' + gl.getProgramInfoLog(program));
    gl.detachShader(program, vs); gl.detachShader(program, fs); release(vs); release(fs);
    const texture = create('Texture'); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    const framebuffer = create('Framebuffer'); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'RGBA8 framebuffer');
    const vao = create('VertexArray'); gl.bindVertexArray(vao);
    const buffers = [];
    function attribute(location, values, components, stride, offset, existing) {
      const buffer = existing ?? create('Buffer');
      if (!existing) buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (values) gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, components, gl.FLOAT, false, stride, offset);
      return buffer;
    }
    if (layout === 'interleaved') {
      const values = positions.flatMap((p, i) => [...p, ...colors[i]]);
      const buffer = attribute(0, values, 2, 20, 0);
      attribute(1, null, 3, 20, 8, buffer);
    } else {
      // Deliberately configure color first; locations define the interface.
      attribute(1, colors.flat(), 3, 12, 0); attribute(0, positions.flat(), 2, 8, 0);
    }
    gl.disable(gl.DITHER); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program); gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    check(gl.getError() === gl.NO_ERROR && !gl.isContextLost(), label + ' WebGL error/context state');
    const transformed = positions.map(([x, y]) => vertexName === 'pair-b.vert' ? [x * .5 + .25, y * .75 - .1] : [x, y]);
    const triangle = transformed.map(([x, y]) => [viewport.x + (x + 1) * viewport.width / 2,
      viewport.y + (y + 1) * viewport.height / 2]);
    const [[ax, ay], [bx, by], [cx, cy]] = triangle;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const clipped = vertexName.startsWith('clip-');
    const weights = positions.map(([x]) => vertexName === 'perspective.vert' ? 1.5 + .5 * x : 1);
    let interior = 0, exterior = 0, skipped = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = x + .5, py = y + .5;
      const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
      const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
      const bary = [a, b, 1 - a - b];
      const insideScissor = x >= scissor.x && x < scissor.x + scissor.width &&
        y >= scissor.y && y < scissor.y + scissor.height;
      let expected;
      if (!clipped && insideScissor && Math.min(...bary) > .045) {
        const divisor = bary.reduce((sum, value, i) => sum + value / weights[i], 0);
        expected = bary.map((value, i) => Math.round(255 * value / weights[i] / divisor));
        if (fragmentName === 'pair-b.frag') expected.reverse();
        expected.push(255); interior++;
      } else if (clipped || !insideScissor || Math.min(...bary) < -.045) {
        expected = [0, 255, 0, 255]; exterior++;
      } else { skipped++; continue; }
      const offset = (y * width + x) * 4;
      check(expected.every((value, channel) => Math.abs(pixels[offset + channel] - value) <= (channel === 3 || expected[0] === 0 && expected[1] === 255 && expected[2] === 0 ? 0 : 2)),
        `${label} pixel ${x},${y}: ${pixels.slice(offset, offset + 4)} expected ${expected}`);
    }
    check(clipped ? interior === 0 && exterior === width * height : interior > 30 && exterior > 1500,
      label + ' meaningful coverage');
    gl.useProgram(null); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    for (const object of [...buffers, vao, framebuffer, texture, program]) release(object);
    check(live.size === 0, label + ' normal-path native ownership balanced');
    report.cases.push({ label, interior, exterior, skipped, rowFlip: false });
  }
  try {
    check(!!gl, 'WebGL2 context required');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    report.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    report.version = gl.getParameter(gl.VERSION);
    for (const vertex of ['pair-a.vert', 'pair-b.vert']) for (const fragment of ['pair-a.frag', 'pair-b.frag'])
      for (const layout of ['interleaved', 'separate']) run(vertex, fragment, layout);
    for (const vertex of ['clip-negative.vert', 'clip-far.vert', 'perspective.vert'])
      for (const layout of ['interleaved', 'separate']) run(vertex, 'pair-a.frag', layout);
    report.liveBeforeEmergencyCleanup = live.size;
    check(live.size === 0, 'all native resources released before emergency cleanup');
    report.pass = true;
  } catch (error) {
    report.failures.push(String(error.stack || error));
    report.liveBeforeEmergencyCleanup = live.size;
  } finally {
    for (const object of live.keys()) release(object);
    report.assertions = assertions;
    resultNode.textContent = JSON.stringify(report);
    document.title = report.pass ? 'WEBGL_COORDINATE_PASS' : 'WEBGL_COORDINATE_FAIL';
  }
})();
