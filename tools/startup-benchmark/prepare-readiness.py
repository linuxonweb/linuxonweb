#!/usr/bin/env python3
"""Add an observable keyboard/navigation gate to the unchanged GPU-check workload.
The fixture is test-only; Firefox/native/rootfs are unchanged. Existing desktop
extras remain byte-identical before the appended CPIO records. One gzip member
is produced so browser/kernel decompression rules cannot be confused.
"""
import argparse,copy,datetime,gzip,hashlib,importlib.util,json,pathlib,re,shutil,time
p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--nonce',required=True);p.add_argument('--base-dir',type=pathlib.Path);a=p.parse_args()
if not re.fullmatch('[a-z]{12,32}',a.nonce): raise ValueError('Nonce must be12–32lowercaseASCIIletters')
if a.output.exists(): raise ValueError('Fresh output required')
started=time.monotonic();start=datetime.datetime.now(datetime.timezone.utc).isoformat();repo=pathlib.Path(__file__).resolve().parents[2]
original=(repo/'tools/guest-rootfs/firefox-gpu-check/gpu-check.html').read_bytes()
script=r'''
<script>
(()=>{
 const nonce=NONCE_JSON;
 const signal=(phase,more={})=>console.error('LOW_READY '+JSON.stringify({schema:1,nonce,phase,epochMs:Date.now(),...more}));
 const panel=document.createElement('section');panel.id='linuxonweb-readiness';panel.style.cssText='position:fixed;left:18px;top:12px;z-index:2147483647;box-sizing:border-box;width:490px;padding:14px;border:3px solid #73f2c2;border-radius:8px;background:#082d2d;color:white;font:18px sans-serif';
 const label=document.createElement('label');label.textContent='Firefox readiness: type the exact nonce and press Enter';label.htmlFor='linuxonweb-readiness-input';
 const token=document.createElement('p');token.textContent=nonce;token.style.cssText='font:22px monospace;margin:8px 0;color:#ffe08a';
 const input=document.createElement('input');input.id=label.htmlFor;input.autocomplete='off';input.spellcheck=false;input.style.cssText='box-sizing:border-box;width:100%;font:22px monospace;color:#001b18;background:white;padding:5px;border:2px solid #00b48b';
 panel.append(label,token,input);document.body.append(panel);
 input.addEventListener('focus',()=>signal('focus',{value:input.value}));
 for(const type of ['keydown','keyup'])input.addEventListener(type,e=>signal(type,{key:e.key,code:e.code,repeat:e.repeat,eventTimeStamp:e.timeStamp,value:input.value}));
 input.addEventListener('input',()=>{if(input.value.length<=64)signal('input',{value:input.value});if(input.value===nonce)signal('typed',{value:input.value});});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&input.value===nonce){e.preventDefault();signal('navigate',{value:input.value});location.assign('file:///opt/firefox/gpu-check/readiness-complete.html?nonce='+nonce);}});
 const painted=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=input.getBoundingClientRect();signal('paint',{href:location.href,innerScreenX:window.mozInnerScreenX,innerScreenY:window.mozInnerScreenY,dpr:devicePixelRatio,input:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},webgl:typeof state==='object'?state.webgl:null});}));
 if(document.readyState==='complete')painted();else addEventListener('load',painted,{once:true});
})();
</script>
'''.replace('NONCE_JSON',json.dumps(a.nonce))
first=original+b'\n'+script.encode()
complete=('''<!doctype html><meta charset="utf-8"><title>READINESS COMPLETE</title><style>body{margin:35px;background:#073b2e;color:white;font:24px sans-serif}h1{color:#80ffd5}code{font-size:32px;display:block;padding:20px;border:2px solid #80ffd5}</style><h1>READINESS COMPLETE</h1><p>Native Firefox accepted the exact keyboard input and completed navigation.</p><code>'''+a.nonce+'''</code><script>const nonce='''+json.dumps(a.nonce)+''';requestAnimationFrame(()=>requestAnimationFrame(()=>{console.error('LOW_READY '+JSON.stringify({schema:1,nonce,phase:'complete',epochMs:Date.now(),href:location.href,title:document.title,value:document.querySelector('code').textContent}));}));</script>''').encode()
# A separate post-readiness field runs native repeat regressions after the
# usable navigation timestamp. It never changes the original GPU workload.
complete += r'''<p><label for="regression-input">Post-readiness keyboard regression</label></p><input id="regression-input" autocomplete="off" spellcheck="false" style="font:24px monospace;width:450px"><script>
(()=>{const input=document.querySelector('#regression-input');const signal=(phase,more={})=>console.error('LOW_READY '+JSON.stringify({schema:1,nonce,phase,epochMs:Date.now(),...more}));input.addEventListener('focus',()=>signal('focus',{value:input.value}));for(const type of ['keydown','keyup'])input.addEventListener(type,e=>signal(type,{key:e.key,code:e.code,repeat:e.repeat,eventTimeStamp:e.timeStamp,value:input.value}));input.addEventListener('input',()=>signal('input',{value:input.value}));requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=input.getBoundingClientRect();signal('regression-paint',{dpr:devicePixelRatio,innerScreenX:window.mozInnerScreenX,innerScreenY:window.mozInnerScreenY,input:{x:r.x,y:r.y,width:r.width,height:r.height}});}));})();
</script>'''.encode()
spec=importlib.util.spec_from_file_location('package_smoke',repo/'tools/guest-packages/make-smoke.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
entry=helper.entry;overlay=b''.join([entry('opt',mode=0o40755),entry('opt/firefox',mode=0o40755),entry('opt/firefox/gpu-check',mode=0o40755),entry('opt/firefox/gpu-check/gpu-check.html',first,0o100644),entry('opt/firefox/gpu-check/readiness-complete.html',complete,0o100644),entry('opt/firefox/defaults',mode=0o40755),entry('opt/firefox/defaults/pref',mode=0o40755),entry('opt/firefox/defaults/pref/readiness-test.js',b'// Isolated acceptance fixture; never publish.\npref("devtools.console.stdout.content", true);\n',0o100644),entry('TRAILER!!!',mode=0)]);overlay+=b'\0'*((-len(overlay))%512)
manifest=json.loads((repo/'web/linux/desktop-extras.cpio.json').read_text());base=(repo/'web/linux/desktop-extras.cpio').read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
if len(base)!=manifest['bytes'] or sha(base)!=manifest['sha256']:raise ValueError('Base extras identity differs')
raw=base+b'\0'*((-len(base))%4)+overlay;compressed=gzip.compress(raw,compresslevel=1,mtime=0)
if gzip.decompress(compressed)!=raw:raise ValueError('Compression roundtrip differs')
a.output.mkdir(parents=True)
(a.output/'desktop-extras.cpio').write_bytes(raw);(a.output/'desktop-extras.cpio.gz').write_bytes(compressed)
updated={**manifest,'bytes':len(raw),'sha256':sha(raw),'gzip':{'bytes':len(compressed),'sha256':sha(compressed)}}
(a.output/'desktop-extras.cpio.json').write_text(json.dumps(updated,indent=2)+'\n')
(a.output/'gpu-check-readiness.html').write_bytes(first);(a.output/'readiness-complete.html').write_bytes(complete)
report={'schema':1,'testOnly':True,'nonce':a.nonce,'start':start,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationSeconds':time.monotonic()-started,'originalGpuWorkloadSha256':sha(original),'gpuWorkloadPreservedPrefix':first.startswith(original),'baseExtrasSha256':sha(base),'extrasSha256':sha(raw),'compressedSha256':sha(compressed),'systemArchiveUnchanged':True,'nativeUnchanged':True,'acceptance':'Requires actual browser production boot, physical input/navigation and reviewed screenshots; not a standalone compiler check'}
(a.output/'readiness-fixture.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if a.base_dir:
 source=a.base_dir.resolve();base_manifest=json.loads((source/'boot-manifest.json').read_text());base_root=source/'initramfs-firefox.cpio.gz'
 def file_sha(path):
  with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
 if file_sha(base_root)!=base_manifest['assets']['firefox']['sha256']:raise ValueError('Base rootfs identity differs')
 spec=importlib.util.spec_from_file_location('cache_builder',repo/'tools/firefox-lifecycle/build-cache-image.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
 before=builder.records(base_root)
 dirs=[d for d in ('opt','opt/firefox','opt/firefox/gpu-check','opt/firefox/defaults','opt/firefox/defaults/pref') if d not in before]
 root_overlay=b''.join([*(entry(d,mode=0o40755) for d in dirs),entry('opt/firefox/gpu-check/gpu-check.html',first,0o100644),entry('opt/firefox/gpu-check/readiness-complete.html',complete,0o100644),entry('opt/firefox/defaults/pref/readiness-test.js',b'// Isolated acceptance fixture; never publish.\npref("devtools.console.stdout.content", true);\n',0o100644),entry('TRAILER!!!',mode=0)])
 archive=a.output/'initramfs-firefox.cpio.gz';raw_count=0
 with archive.open('xb') as out,gzip.GzipFile(filename='',fileobj=out,mode='wb',mtime=0,compresslevel=6) as gz,gzip.open(base_root,'rb') as src:
  while chunk:=src.read(1048576):gz.write(chunk);raw_count+=len(chunk)
  gz.write(bytes(-raw_count%4)+root_overlay)
 spec=importlib.util.spec_from_file_location('cache_builder',repo/'tools/firefox-lifecycle/build-cache-image.py');builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
 after=builder.records(archive)
 changed=[n for n,v in before.items() if n not in after or any(after[n][k]!=v[k] for k in ('mode','uid','gid','links','bytes','sha256'))]
 if changed!=['opt/firefox/gpu-check/gpu-check.html']:raise ValueError('Unexpected readiness base mutation: '+repr(changed))
 for n in ('init','opt/firefox/firefox','opt/firefox/browser/.purgecaches'):
  if after[n]!=before[n]:raise ValueError('Native/init/marker changed')
 digest=file_sha(archive);manifest=copy.deepcopy(base_manifest);manifest['version']='ready'+digest[:7];manifest['assets']['firefox'].update(bytes=archive.stat().st_size,sha256=digest,label='Isolated Firefox readiness fixture; not for publication')
 for kind in ('kernel','plain'):
  name=pathlib.PurePosixPath(manifest['assets'][kind]['url']).name;origin=source/name
  if not origin.is_file():origin=repo/'web/linux'/name
  if file_sha(origin)!=manifest['assets'][kind]['sha256']:raise ValueError('Companion identity differs')
  shutil.copyfile(origin,a.output/name)
 (a.output/'boot-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 report.update(rootfsSha256=digest,rootfsBytes=archive.stat().st_size,changedOriginalFiles=changed,contentStdoutTestPref=True,cacheGenerationRequirement='Use this exact composed rootfs as builder input; no readiness overlay after resource generation hash',end=datetime.datetime.now(datetime.timezone.utc).isoformat(),durationSeconds=time.monotonic()-started)
 (a.output/'readiness-fixture.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ('rootfsSha256','rootfsBytes','durationSeconds','nativeUnchanged')}))
