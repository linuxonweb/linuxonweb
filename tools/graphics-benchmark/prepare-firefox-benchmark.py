#!/usr/bin/env python3
"""Derive one fixed WebGL2 cube workload from the existing GPU check page.
Only desktop extras are extended; the Firefox/system archive is unchanged.
"""
import argparse,pathlib,json,hashlib,gzip,sys,importlib.util,time
sys.dont_write_bytecode=True
p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False);started=time.time()
repo=pathlib.Path(__file__).resolve().parents[2];source=repo/'tools/guest-rootfs/firefox-gpu-check/gpu-check.html';original=source.read_text();page=original
start=page.index('function fpsMeter(api) {');end=page.index('\nfunction startWebGL',start)
instrument=r'''// Fixed scene timing. Rendering geometry/shaders are unchanged from the GPU check.
const gpuCheckBenchmark=window.gpuCheckBenchmark={done:false,pass:false,pending:false,kind:'existing cube WebGL2 end-to-end',settings:{width:320,height:240,warmupMs:10000,sampleMs:20000,webglVersion:2,webgpu:false,media:false},intervals:[],errors:[],browser:browserIdentity,hardwareConcurrency:navigator.hardwareConcurrency};
let firstFrame=null,measurementStart=null,lastFrame=null;
function recordBenchmarkFrame(now){
 if(firstFrame===null){firstFrame=now;gpuCheckBenchmark.firstFrameEpochMs=Date.now();}
 if(now-firstFrame<gpuCheckBenchmark.settings.warmupMs)return;
 if(measurementStart===null){measurementStart=now;lastFrame=now;gpuCheckBenchmark.sampleStartEpochMs=Date.now();return;}
 gpuCheckBenchmark.intervals.push(now-lastFrame);lastFrame=now;
 if(now-measurementStart>=gpuCheckBenchmark.settings.sampleMs){gpuCheckBenchmark.sampleEndEpochMs=Date.now();gpuCheckBenchmark.pending=true;}
 if(gpuCheckBenchmark.intervals.length>4096){gpuCheckBenchmark.errors.push('frame sample bound exceeded');gpuCheckBenchmark.pending=true;}
}
function finishGpuBenchmark(gl,canvas){
 const result=gpuCheckBenchmark,px=new Uint8Array(4);gl.readPixels(canvas.width/2,canvas.height/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
 result.finalPixel=Array.from(px);result.glError=gl.getError();result.webglState=state.webgl;
 result.wallElapsedMs=result.sampleEndEpochMs-result.sampleStartEpochMs;result.sampleStartUTC=new Date(result.sampleStartEpochMs).toISOString();result.sampleEndUTC=new Date(result.sampleEndEpochMs).toISOString();
 result.width=canvas.width;result.height=canvas.height;result.elapsedMs=lastFrame-measurementStart;result.sampleFrames=result.intervals.length;result.fps=result.sampleFrames*1000/result.elapsedMs;
 const sorted=result.intervals.slice().sort((a,b)=>a-b),quantile=p=>sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1))];
 result.frameMs={min:sorted[0],p50:quantile(.5),p95:quantile(.95),p99:quantile(.99),max:sorted[sorted.length-1],mean:result.elapsedMs/result.sampleFrames};
 const bins=[8,16.7,25,33.4,50,100,200,500,1000,Infinity];result.histogram=bins.map(limit=>({upToMs:Number.isFinite(limit)?limit:null,count:0}));for(const dt of result.intervals){const i=bins.findIndex(limit=>dt<=limit);result.histogram[i].count++;}
 result.renderer=Array.from(document.querySelectorAll('#webgl-info tr'),tr=>Array.from(tr.cells,td=>td.textContent.trim()).join(': '));
 result.pass=state.webgl==='ok'&&result.glError===gl.NO_ERROR&&px[0]+px[1]+px[2]>150&&result.width===320&&result.height===240&&result.sampleFrames>=20&&!result.errors.length;
 result.pending=false;result.done=true;const {intervals,...summary}=result;const serialized=JSON.stringify(summary);console.log('GPUCHECK_BENCH '+serialized);console.error('GPUCHECK_BENCH '+serialized);
 const panel=document.createElement('pre');panel.id='gpu-check-benchmark-summary';panel.style.cssText='position:fixed;z-index:9999;left:12px;right:12px;top:12px;margin:0;padding:16px;background:#071419;color:#efffff;font:16px/1.35 monospace;white-space:pre-wrap;border:2px solid #65efc4;max-height:85vh;overflow:auto';
 panel.textContent='GPUCHECK_BENCH '+(result.pass?'PASS':'FAIL')+' | WebGL2 cube 320 x 240 | 10s warmup / 20s sample\n'+
 'FPS '+result.fps.toFixed(4)+' | frames '+result.sampleFrames+' | elapsed '+result.elapsedMs.toFixed(3)+'ms\n'+
 'Frame ms: p50 '+result.frameMs.p50.toFixed(3)+' | p95 '+result.frameMs.p95.toFixed(3)+' | p99 '+result.frameMs.p99.toFixed(3)+' | max '+result.frameMs.max.toFixed(3)+'\n'+
 'UTC '+result.sampleStartUTC+' to '+result.sampleEndUTC+' | wall '+result.wallElapsedMs+'ms\n'+
 'Correctness: glError '+result.glError+' | pixel '+result.finalPixel.join(',')+' | state '+result.webglState+' | cpus '+result.hardwareConcurrency+'\n'+result.renderer.join('\n')+'\n'+result.browser.userAgent;
 document.body.append(panel);
 document.getElementById('webgl-fps').textContent=result.fps.toFixed(2)+' measured fps · p50 '+result.frameMs.p50.toFixed(2)+'ms · p95 '+result.frameMs.p95.toFixed(2)+'ms';
 document.title='GPUCHECK_BENCH '+(result.pass?'PASS':'FAIL');
}
function fpsMeter(api) {
  const el=document.getElementById(`${api}-fps`);let frames=0,windowFrames=0,windowStart=performance.now();
  return function frame(){frames++;windowFrames++;gpuCheckFrames[api]=frames;const now=performance.now();if(api==='webgl')recordBenchmarkFrame(now);if(now-windowStart>=1000){el.textContent=`${frames} frames · ${(windowFrames*1000/(now-windowStart)).toFixed(1)} fps`;windowFrames=0;windowStart=now;}return frames;};
}
'''
page=page[:start]+instrument+page[end:]
webgl_start=page.index('function startWebGL(');webgl_end=page.index('async function startWebGPU(',webgl_start);webgl=page[webgl_start:webgl_end]
anchor='    requestAnimationFrame(safeDraw);';assert webgl.count(anchor)==1;webgl=webgl.replace(anchor,'    if (gpuCheckBenchmark.pending) { finishGpuBenchmark(gl, canvas); return; }\n'+anchor);page=page[:webgl_start]+webgl+page[webgl_end:]
page=page.replace('checkVideoCodecs().catch(error => { badge("media", "warn", "Unknown"); console.log("GPUCHECK media error=" + String(error.message || error)); });','badge("media", "warn", "skipped for matched benchmark");')
import re
page,n=re.subn(r'const only = [^\n]+;', 'const only = "webgl";', page);assert n==1
assert page.count('width="320" height="240"')==2
html=a.output/'gpt6-astra-graphics-firefox-benchmark.html';html.write_text(page)
# Keep base extras byte-for-byte and append a tiny newc archive overriding one file.
spec=importlib.util.spec_from_file_location('package_smoke',repo/'tools/guest-packages/make-smoke.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
entry=helper.entry;overlay=b''.join([entry('opt',mode=0o40755),entry('opt/firefox',mode=0o40755),entry('opt/firefox/gpu-check',mode=0o40755),entry('opt/firefox/gpu-check/gpu-check.html',page.encode(),0o100644),entry('TRAILER!!!',mode=0)]);overlay+=b'\0'*((-len(overlay))%512)
base=(repo/'web/linux/desktop-extras.cpio').read_bytes();manifest=json.loads((repo/'web/linux/desktop-extras.cpio.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
assert len(base)==manifest['bytes'] and sha(base)==manifest['sha256']
compressed=None
if 'gzip' in manifest:
 compressed=(repo/'web/linux/desktop-extras.cpio.gz').read_bytes();assert len(compressed)==manifest['gzip']['bytes'] and sha(compressed)==manifest['gzip']['sha256']
raw=base+b'\0'*((-len(base))%4)+overlay;gz=(compressed+gzip.compress(overlay,compresslevel=1,mtime=0)) if compressed is not None else gzip.compress(raw,compresslevel=1,mtime=0)
assert gzip.decompress(gz)==raw
(a.output/'desktop-extras.cpio').write_bytes(raw);(a.output/'desktop-extras.cpio.gz').write_bytes(gz)
updated={**manifest,'bytes':len(raw),'sha256':sha(raw),'gzip':{'bytes':len(gz),'sha256':sha(gz)}};(a.output/'desktop-extras.cpio.json').write_text(json.dumps(updated,indent=2)+'\n')
report={'testOnly':True,'source':str(source),'sourceSha256':sha(original.encode()),'page':str(html.resolve()),'pageSha256':sha(page.encode()),'baseExtrasSha256':manifest['sha256'],'baseExtrasGzipSha256':manifest.get('gzip',{}).get('sha256'),'overlaySha256':sha(overlay),'manifest':{k:v for k,v in updated.items() if k!='members'},'seconds':time.time()-started,'settings':{'width':320,'height':240,'warmupMs':10000,'sampleMs':20000,'webglVersion':2,'webgpu':False,'media':False},'systemArchiveUnchanged':True}
(a.output/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
