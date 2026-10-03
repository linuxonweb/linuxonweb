#!/usr/bin/env python3
from pathlib import Path
import sys,json,hashlib,difflib
root=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');name='gfx/wgpu_bindings/src/server.rs';p=root/'source/firefox-159.0a1'/name;old=p.read_text();new=old
native='all(target_arch = "wasm32", target_os = "linux", target_env = "musl")'
linux='#[cfg(target_os = "linux")]'
assert new.count(linux)==23
exports=['wgpu_vkimage_create_with_dma_buf','wgpu_vksemaphore_create_signal_semaphore']
for i,fn in enumerate(exports):
 pattern=linux+'\npub extern "C" fn '+fn
 assert new.count(pattern)==1
 new=new.replace(pattern,'__NATIVE_EXPORT_GUARD_'+str(i)+'__\npub extern "C" fn '+fn)
new=new.replace(linux,'#[cfg(all(target_os = "linux", not('+native+')))]')
new=new.replace('#[cfg(not(target_os = "linux"))]','#[cfg(any(not(target_os = "linux"), '+native+'))]')
for i,fn in enumerate(exports):
 new=new.replace('__NATIVE_EXPORT_GUARD_'+str(i)+'__',linux)
 start=new.index('pub extern "C" fn '+fn);begin=new.index('{',start);depth=1;end=begin+1
 while depth:
  if new[end]=='{':depth+=1
  elif new[end]=='}':depth-=1
  end+=1
 body=new[begin+1:end-1]
 args='global, device_id, width, height' if i==0 else 'global, queue_id'
 value='DMABufInfo::default()' if i==0 else 'VkSemaphoreHandle(0)'
 fallback='\n    // The compiled native Wasm HAL has no Vulkan interop backend.\n    #[cfg('+native+')]\n    {\n        let _ = ('+args+');\n        unsafe { *out_fd = -1; }\n        return '+value+';\n    }\n    #[cfg(not('+native+'))]\n    {'+''.join('    '+line+'\n' for line in body.strip('\n').splitlines())+'    }\n'
 new=new[:begin+1]+fallback+new[end-1:]
patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name));(root/'patches/nightly-wgpu-bindings-native-interop.patch').write_text(patch)
(root/'status/wgpu-bindings-native-interop-port.json').write_text(json.dumps({'source':name,'before_sha256':hashlib.sha256(old.encode()).hexdigest(),'after_sha256':hashlib.sha256(new.encode()).hexdigest(),'linux_positive_guards':23,'linux_negative_guards':1,'preserved_exports':exports,'applied':'--apply' in sys.argv,'scope':'Exact native Linux/musl/Wasm Empty HAL excludes Vulkan dma-buf/shared-texture/semaphore interop; preserves two Linux C++ ABI exports with invalid-result/fd=-1 failure contracts, general WebGPU server and other targets'},indent=2)+'\n')
if '--apply' in sys.argv:p.write_text(new)
else:
 diagnostic=root/'wgpu-bindings-interop-preflight';diagnostic.mkdir(exist_ok=True);(diagnostic/'server.rs').write_text(new)
print(json.dumps({'applied':'--apply' in sys.argv,'guards':24,'preserved_exports':exports}))
