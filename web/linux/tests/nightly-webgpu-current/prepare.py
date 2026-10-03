#!/usr/bin/env python3
"""Extract exact current schema, with source and vendor pins. No browser source writes."""
from pathlib import Path
import hashlib, json
SOURCE=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1')
TASK=Path('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003')
REV='4f4dc63098fae64a0e6d1d3dc6f4f328da8fd5c8'
s=(SOURCE/'gfx/wgpu_bindings/src/lib.rs').read_text()
# Whole enum definitions and their exact prerequisites; no hand-maintained ordinal subset.
imports=s[s.index('use wgpu_core_remote_types::binding_model'):s.index('pub mod client;')]
parts=[imports, 'use std::borrow::Cow;\n', s[s.index('#[repr(C)]\n#[derive(serde::Serialize, serde::Deserialize)]\npub struct AdapterInformation'):s.index('#[repr(C)]\npub struct FfiTextureViewDescriptor')], s[s.index('// Declare an ID type'):s.index('// Descriptor for creating an external texture as used by the server side.')], s[s.index('#[derive(serde::Serialize, serde::Deserialize)]\n#[repr(transparent)]\npub struct SurfaceFormat'):s.index('#[derive(serde::Serialize, serde::Deserialize)]\n#[repr(C)]\n#[derive(Copy, Clone, Debug)]\n#[cfg(target_os = "windows")]')], s[s.index('#[derive(serde::Serialize, serde::Deserialize)]\npub enum QueueWriteDataSource'):s.index('#[repr(C)]\npub struct FfiTexelCopyBufferLayout')], s[s.index('#[repr(C)]\n#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]\npub enum FfiErrorFilter'):]]
parts.append("#[derive(serde::Serialize,serde::Deserialize)] pub struct GPUError<'a>{pub message:Cow<'a,str>,pub r#type:wgt::error::ErrorType}\n")
# crate references in the selected source are retained: schema is included at crate root.
TASK.mkdir(exist_ok=True)
def struct(text,name):
 start=text.index('pub struct '+name)
 start=text.rfind('#[repr(C)]',0,start)
 end=text.index('{',text.index('pub struct '+name));depth=1;end+=1
 while depth:
  depth+=(text[end]=='{')-(text[end]=='}');end+=1
 return text[start:end]+'\n'
server=(SOURCE/'gfx/wgpu_bindings/src/server.rs').read_text()
client=(SOURCE/'gfx/wgpu_bindings/src/client.rs').read_text()
parts+=['use std::marker::PhantomData; pub enum nsACString {}\n',struct(s,'FfiSlice'),struct(s,'ByteBuf'),struct(client,'FfiBufferDescriptor')]
a=server.index('#[repr(C)]\npub enum BufferMapAsyncStatus');b=server.index('impl From<Result<(), BufferAccessError>>',a)
parts+=[server[a:b],struct(server,'BufferMapClosure')]
a=server.index('#[repr(C)]\n#[derive(Clone, Copy, Debug, Eq, PartialEq)]\npub enum HostMap');b=server.index('impl HostMap',a)
parts+=[server[a:b]]
TASK.joinpath('schema.rs').write_text(''.join(parts))
files=list((SOURCE/'gfx/wgpu_bindings').rglob('*'))
for crate in ['wgpu-core-remote','wgpu-core-remote-types','wgpu-types','naga-types']:
 files+=list((SOURCE/'third_party/rust'/crate).rglob('*'))
files+=[SOURCE/'Cargo.lock',Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/gfx/wgpu_bindings/wgpu_ffi_generated.h')]
pins=[{'path':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(set(files)) if f.is_file()]
assert REV in (SOURCE/'gfx/wgpu_bindings/Cargo.toml').read_text()
TASK.joinpath('source-pins.json').write_text(json.dumps({'revision':REV,'files':pins,'schemaSha256':hashlib.sha256(TASK.joinpath('schema.rs').read_bytes()).hexdigest()},indent=2)+'\n')
print('pinned',len(pins),'inputs; extracted exact current schema')
