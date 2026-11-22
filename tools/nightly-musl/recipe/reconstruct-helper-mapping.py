#!/usr/bin/env python3
"""Reconstruct the exact historical helper object from a verified wrapped object.

No compiler or protected historical artifact is used. Exact independent object
and archive hashes are mandatory; this is not a new native compilation.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
sys.path.insert(0,str(REPO/'tools/nightly-jit-safety'))
from owned_paths import task_root, scoped_path
sys.path.insert(0, str(REPO/'tools/nightly-jit-prep'))
from input_closure import read_pinned
spec=importlib.util.spec_from_file_location('preflight',REPO/'tools/nightly-jit-prep/rebuild-preflight.py')
preflight=importlib.util.module_from_spec(spec);spec.loader.exec_module(preflight)
spec=importlib.util.spec_from_file_location('dependencies',HERE/'replay-native-dependencies.py')
dependencies=importlib.util.module_from_spec(spec);spec.loader.exec_module(dependencies)
SOURCE_SHA='cf9f7592186c95dbe9589d8e86bd86fd724b8f06f9c539826ca3a3707c621e97'
WRAPPED_SHA='d9109125a1b3cd0c0d4e0c42dfd0ba6c68f3b4fc4e4d0a5ff079cc93c885ff3a'
OBJECT_SHA='bae2a8cc8dd968036e4cecec8dfbdc218923e5a6a8594f89baceb0cdd874e755'
ARCHIVE_SHA='ce9bde472373b4d7d09555954006b94b3c0a8137d341d51d689371fb8e2c7561'
# Independent review covers this exact historical preparation, not arbitrary
# mutable receipt claims. A new prepared tree needs a new reviewed identity.
PREPARATION_SHA='9facb1ee3c8fc27af2d75d0954cbd342b8c1dd374900f3ae0494cf94d7a40a90'


def need(ok,message):
    if not ok:raise ValueError(message)


def digest(data):return hashlib.sha256(data).hexdigest()


def uleb(data,index):
    value=shift=0;start=index
    while True:
        need(index<len(data) and shift<35,'invalid ULEB32')
        byte=data[index];index+=1;value|=(byte&127)<<shift
        if not byte&128:return value,index,index-start
        shift+=7


def encoded(value,width):
    result=[]
    for index in range(width):
        result.append((value&127)|(128 if index<width-1 else 0));value>>=7
    need(value==0,'ULEB32 width insufficient')
    return bytes(result)


def string(data,index):
    size,start,width=uleb(data,index);end=start+size
    need(end<=len(data),'truncated Wasm name')
    return data[start:end].decode(),end,index,width


def sections(data):
    need(data[:8]==b'\0asm\x01\0\0\0','not a Wasm v1 object')
    index=8;rows=[]
    while index<len(data):
        kind=data[index];size,start,width=uleb(data,index+1);end=start+size
        need(end<=len(data),'truncated Wasm section')
        name,body=(None,start)
        if kind==0:name,body,_,_=string(data,start)
        rows.append(dict(kind=kind,name=name,length=index+1,width=width,start=start,body=body,end=end,payload=data[start:end]))
        index=end
    return rows


def reconstruct(data):
    need(len(data)==5849 and digest(data)==WRAPPED_SHA,'wrapped object identity mismatch')
    originals=sections(data);linking=[r for r in originals if r['name']=='linking']
    need(len(linking)==1,'one linking section required');section=linking[0]
    version,index,_=uleb(data,section['body']);need(version==2,'linking version changed')
    patches=[];renamed=[];symbol_sections=0
    while index<section['end']:
        kind=data[index];size,start,width=uleb(data,index+1);end=start+size
        need(end<=section['end'],'linking subsection escaped')
        if kind==8:
            symbol_sections+=1;count,cursor,_=uleb(data,start)
            for _ in range(count):
                kind=data[cursor];cursor+=1;flags,cursor,_=uleb(data,cursor)
                if kind in (0,2,4,5):
                    symbol_index,cursor,_=uleb(data,cursor)
                    if not flags&0x10 or flags&0x40:
                        name,cursor,offset,field_width=string(data,cursor)
                        if name in ('__wrap_shm_open','__wrap_shm_unlink'):
                            need(kind==0 and not flags&0x10,'rename only defined function symbols')
                            replacement=name.removeprefix('__wrap_').encode()
                            patches.append((offset,cursor,encoded(len(replacement),field_width)+replacement))
                            renamed.append(dict(before=name,after=replacement.decode(),functionIndex=symbol_index,flags=flags))
                elif kind==1:
                    name,cursor,_,_=string(data,cursor)
                    if not flags&0x10:
                        for _ in range(3):unused,cursor,_=uleb(data,cursor)
                elif kind==3:unused,cursor,_=uleb(data,cursor)
                else:raise ValueError('unexpected symbol kind')
            need(cursor==end,'symbol table boundary mismatch')
            patches.append((index+1,start,encoded(size-14,width)))
        index=end
    need(symbol_sections==1 and {r['before'] for r in renamed}=={'__wrap_shm_open','__wrap_shm_unlink'} and len(renamed)==2,'exact two symbols required')
    patches.append((section['length'],section['start'],encoded(len(section['payload'])-14,section['width'])))
    result=data
    for start,end,replacement in sorted(patches,reverse=True):result=result[:start]+replacement+result[end:]
    need(len(result)==5835 and digest(result)==OBJECT_SHA,'reconstruction is not the historical object')
    unchanged=[]
    after=sections(result);need(len(originals)==len(after),'section count changed')
    for a,b in zip(originals,after):
        need((a['kind'],a['name'])==(b['kind'],b['name']),'section order changed')
        if a['name']!='linking':
            need(a['payload']==b['payload'],'non-linking bytes changed')
            unchanged.append(dict(kind=a['kind'],name=a['name'],sha256=digest(a['payload']),bytes=len(a['payload'])))
    return result,renamed,unchanged


def verify_prepared_linkage(build, unwrapped, wrapped_archive, expected_sha=PREPARATION_SHA):
    build = task_root(Path(build))
    preparation_path = build / 'preparation.json'
    raw, _ = read_pinned(preparation_path, {
        'bytes': preparation_path.stat().st_size, 'sha256': expected_sha, 'owned': True})
    preparation = json.loads(raw)
    need(preparation['output'] == str(build) and preparation['preparationComplete'] is True,
         'preparation receipt does not bind this completed preparation')
    prepared_source = task_root(Path(preparation['source']))
    changes_path = build / 'source-changes.json'
    changes_pin = preparation['sourceChanges']
    need(changes_pin['path'] == str(changes_path), 'source-changes receipt escaped prepared build')
    changes_raw, _ = read_pinned(changes_path, dict(changes_pin, owned=True))
    changes = json.loads(changes_raw)
    linkage = []
    for path in [prepared_source/'defs.mk', prepared_source/'linuxonweb-build/adapters/defs.mk']:
        rows = [row['after'] for row in changes if row['after']['path'] == str(path)]
        need(len(rows) == 1, 'one pinned source-change record required for each defs file')
        payload, _ = read_pinned(path, dict(rows[0], owned=True))
        text = payload.decode('utf-8')
        anchor = 'ifneq ($(filter firefox plugin-container xpcshell,$(notdir $(PROGRAM))),)'
        need(text.count(anchor) == 1, 'browser program guard changed')
        before, inside = text.split(anchor)
        need('OS_LIBS += '+str(unwrapped) in before, 'helper archive not in original outer graph')
        need('OS_LIBS := $(filter-out '+str(unwrapped)+',$'+'(OS_LIBS))' in inside,
             'browser must remove helper archive')
        need('OS_LIBS += '+str(wrapped_archive) in inside, 'browser wrapped archive must remain')
        linkage.append(rows[0])
    return linkage, {'preparation': {'path': str(preparation_path), 'bytes': len(raw), 'sha256': expected_sha},
                     'sourceChanges': changes_pin,
                     'scope': 'Static linkage assertion for the exact independently reviewed defs bytes; no executed helper or browser acceptance.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dependencies',type=Path,required=True)
    parser.add_argument('--prepared-build',type=Path,required=True)
    parser.add_argument('--historical-receipt',type=Path,required=True)
    parser.add_argument('--verify-linkage-only', action='store_true', help='read-only check of the exact reviewed preparation and defs')
    args=parser.parse_args();root=task_root(args.dependencies.resolve(strict=True));build=task_root(args.prepared_build.resolve(strict=True))
    out=scoped_path(root,root/'native-mapping-link',fresh=not args.verify_linkage_only)
    linkage, linkage_binding = verify_prepared_linkage(build, out/'libnightly-native-mapping.a',
                                                      root/'native-mapping-wrapped-shm/libnightly-native-mapping.a')
    if args.verify_linkage_only:
        print(json.dumps({'helperOnlyLinkage': True, 'readOnly': True, 'compiled': False,
                          'helperLinkageFiles': linkage, 'linkageBinding': linkage_binding,
                          'guestRuntimeAcceptance': False}, indent=2))
        return
    historical=json.loads(args.historical_receipt.read_text())
    for suffix,size,sha in [('mmap-shim.c',15049,SOURCE_SHA),('mmap-shim.o',5835,OBJECT_SHA),('libnightly-native-mapping.a',6106,ARCHIVE_SHA)]:
        rows=[r for r in historical['pins'] if r['path'].endswith('/native-mapping-link/'+suffix)]
        need(len(rows)==1 and rows[0]['bytes']==size and rows[0]['sha256']==sha,'independent historical pin changed')
    wrapped=root/'native-mapping-wrapped-shm/mmap-shim.o';wrapped_archive=root/'native-mapping-wrapped-shm/libnightly-native-mapping.a'
    source=root/'inputs/mmap-shim.c';need(preflight.digest(source)==SOURCE_SHA,'source identity mismatch')
    wrapped_archive_before=preflight.pin(wrapped_archive);result,renamed,unchanged=reconstruct(wrapped.read_bytes())
    env=dict(os.environ);env.update(preflight.parse_environment((root/'recipe/environment.sh').read_text()));env.pop('LD_LIBRARY_PATH',None)
    inputs=json.loads((root/'inputs.json').read_text());ar=env['AR']
    need(preflight.digest(ar)==inputs['tools']['AR']['sha256'],'archive tool identity changed')
    validator=shutil.which('wasm-validate',path=env['PATH']);nm=shutil.which('llvm-nm',path=env['PATH'])
    need(validator is not None and nm is not None,'validation tools unavailable')
    out.mkdir(mode=0o700);(out/'tmp').mkdir();(out/'cache').mkdir()
    for name in ('TMPDIR','TMP','TEMP'):env[name]=str(out/'tmp')
    env['XDG_CACHE_HOME']=str(out/'cache')
    obj=out/'mmap-shim.o';obj.write_bytes(result);shutil.copyfile(source,out/'mmap-shim.c');archive=out/'libnightly-native-mapping.a'
    commands=[]
    for name,argv in [('validate-object',[validator,'--enable-all',str(obj)]),('archive',[ar,'crs',str(archive),str(obj)]),('defined-symbols',[nm,'--defined-only',str(archive)]),('undefined-symbols',[nm,'--undefined-only',str(archive)])]:
        child=subprocess.run(argv,env=env,capture_output=True,text=True,timeout=30)
        (out/(name+'.log')).write_text(child.stdout+child.stderr)
        commands.append(dict(name=name,argv=argv,exitCode=child.returncode,log=preflight.pin(out/(name+'.log'))))
        need(child.returncode==0,'validation command failed: '+name)
    need(archive.stat().st_size==6106 and preflight.digest(archive)==ARCHIVE_SHA,'historical archive identity mismatch')
    members=dependencies.ar_members(archive.read_bytes());need(len(members)==1 and members[0]==('mmap-shim.o',result),'archive member changed')
    symbols={line.split()[-1] for line in (out/'defined-symbols.log').read_text().splitlines() if len(line.split())>=3}
    need({'mmap','munmap','mremap','msync','mprotect','madvise','posix_madvise','shm_open','shm_unlink','lowland_mmap_refresh'}<=symbols,'required helper symbols missing')
    need(not {'__wrap_shm_open','__wrap_shm_unlink'}&symbols,'wrapped symbols remained')
    need(preflight.pin(wrapped_archive)==wrapped_archive_before and preflight.digest(wrapped)==WRAPPED_SHA,'wrapped browser input changed')
    report=dict(kind='exact-historical-helper-mapping-reconstruction-v1',passArtifactReconstruction=True,compiled=False,helperOnlyLinkage=True,nativeIntegrationReady=False,guestRuntimeAcceptance=False,fullJitAcceptance=False,recipe=preflight.pin(Path(__file__)),historicalReceipt=preflight.pin(args.historical_receipt),source=preflight.pin(source),wrappedObject=preflight.pin(wrapped),wrappedBrowserArchive=wrapped_archive_before,object=preflight.pin(obj),archive=preflight.pin(archive),renamedSymbols=renamed,unchangedSections=unchanged,importsUnchanged=True,codeUnchanged=True,relocationsUnchanged=True,helperLinkageFiles=linkage,linkageBinding=linkage_binding,commands=commands,tools=[preflight.pin(p) for p in [ar,validator,nm]])
    (out/'reconstruction.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['passArtifactReconstruction','compiled','helperOnlyLinkage','object','archive','nativeIntegrationReady','guestRuntimeAcceptance']},indent=2))


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print(json.dumps({'passArtifactReconstruction':False,'compiled':False,'error':str(error)}),file=sys.stderr);raise SystemExit(1)
