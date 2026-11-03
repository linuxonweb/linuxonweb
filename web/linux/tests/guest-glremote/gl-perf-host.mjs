// Direct WebGL2 version of gl-perf.c. Same 64x64 triangle/UBO work, operation
// counts, fresh 320x240 surface/readback, warmup and measurement durations.
const pause=()=>new Promise(r=>setTimeout(r,0));
self.onmessage=async({data})=>{
 const pooled=data?.pooled===true;
 const report={done:false,pass:false,errors:[],samples:[],settings:{canvas:[64,64],surface:[320,240],draws:100,warmupMs:500,samples:3,sampleMs:1000,readbackIncluded:true,stats:false,texturePooling:pooled}};
 const canvas=new OffscreenCanvas(64,64);
 const gl=canvas.getContext('webgl2',{alpha:true,depth:true,stencil:false,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
 try{
  if(!gl)throw Error('WebGL2 unavailable');
  const info=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);report.version=gl.getParameter(gl.VERSION);
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  const p=gl.createProgram();
  gl.attachShader(p,shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision mediump float;uniform vec4 tint;layout(std140) uniform Colors{vec4 base;};out vec4 color;void main(){color=base+tint;}'));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  const ubo=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,ubo);gl.bufferData(gl.UNIFORM_BUFFER,new Float32Array([0,.5,0,1]),gl.STATIC_DRAW);gl.uniformBlockBinding(p,gl.getUniformBlockIndex(p,'Colors'),2);gl.bindBufferBase(gl.UNIFORM_BUFFER,2,ubo);gl.useProgram(p);const tint=gl.getUniformLocation(p,'tint');gl.viewport(0,0,64,64);
  const pixel=new Uint8Array(4),image=new Uint8Array(320*240*4);let ringTex=[null,null],ringFb=[null,null],status;
  function checkDraw(){const target=[252,128,0,255];if(pixel.some((v,i)=>Math.abs(v-target[i])>2))throw Error('draw pixel mismatch '+pixel);}
  for(let sample=-1;sample<3;sample++){
   const start=performance.now();let frames=0;
   while(performance.now()-start<(sample<0?500:1000)){
    gl.clear(gl.COLOR_BUFFER_BIT);for(let k=0;k<100;k++){gl.uniform4f(tint,k/100,0,0,0);gl.drawArrays(gl.TRIANGLES,0,3);}gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);frames++;
   }
   const ms=performance.now()-start;checkDraw();if(sample>=0)report.samples.push({workload:'draw100-read1',sample,frames,ms,frameMs:ms/frames});await pause();
  }
  gl.clearColor(.25,.5,.75,1);
  for(let sample=-1;sample<3;sample++){
   const start=performance.now();let frames=0;
   while(performance.now()-start<(sample<0?500:1000)){
    const slot=frames&1;if(ringFb[slot])gl.deleteFramebuffer(ringFb[slot]);if(ringTex[slot]&&!pooled)gl.deleteTexture(ringTex[slot]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.drawArrays(gl.TRIANGLES,0,3);gl.getError();const fresh=!pooled||!ringTex[slot];if(fresh)ringTex[slot]=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,ringTex[slot]);if(fresh)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,320,240,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.getError();
    ringFb[slot]=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,ringFb[slot]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ringTex[slot],0);status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);gl.clear(gl.COLOR_BUFFER_BIT);gl.readPixels(0,0,320,240,gl.RGBA,gl.UNSIGNED_BYTE,image);frames++;
   }
   const ms=performance.now()-start;if(status!==gl.FRAMEBUFFER_COMPLETE||image.subarray(0,4).some((x,i)=>Math.abs(x-[64,128,191,255][i])>2))throw Error('surface readback mismatch');if(sample>=0)report.samples.push({workload:'surface320-readback',sample,frames,ms,frameMs:ms/frames});await pause();
  }
  const err=gl.getError();if(err!==gl.NO_ERROR)throw Error('final WebGL error '+err);report.pass=true;
 }catch(e){report.errors.push(String(e));}
 finally{gl?.getExtension('WEBGL_lose_context')?.loseContext();report.done=true;self.postMessage(report);self.close();}
};
