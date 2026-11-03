#!/usr/bin/env python3
"""Remove only the exact name custom section; never rewrite another byte."""
import argparse, hashlib, json
from pathlib import Path
CHUNK=4*1024*1024
HEADER=b'\0asm\1\0\0\0'

def pin(path):
    with path.open('rb') as stream:
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    return dict(path=str(path.resolve()),bytes=path.stat().st_size,sha256=digest)

def uleb(stream,limit):
    value=0
    for index in range(5):
        if stream.tell()>=limit:raise ValueError('Truncated section integer')
        byte=stream.read(1)[0]
        value|=(byte&127)<<(7*index)
        if not byte&128:
            if value>0xffffffff:raise ValueError('Section integer overflow')
            return value
    raise ValueError('Section integer exceeds u32 encoding')

def section_index(path):
    size=path.stat().st_size;rows=[]
    with path.open('rb') as stream:
        if stream.read(8)!=HEADER:raise ValueError('Expected Wasm version 1')
        while stream.tell()<size:
            start=stream.tell();kind=stream.read(1)[0]
            length=uleb(stream,size);body=stream.tell();end=body+length
            if end>size:raise ValueError('Section extends beyond input')
            name=None
            if kind==0:
                count=uleb(stream,end)
                if count>1048576 or stream.tell()+count>end:raise ValueError('Invalid custom name')
                name=stream.read(count).decode('utf-8')
            rows.append(dict(id=kind,start=start,payloadStart=body,end=end,payloadBytes=length,customName=name))
            stream.seek(end)
    if not rows:raise ValueError('No sections')
    return rows

def copy_range(source,target,start,end):
    source.seek(start)
    while start<end:
        block=source.read(min(CHUNK,end-start))
        if not block:raise ValueError('Input shortened during copy')
        target.write(block);start+=len(block)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--expected-sha256',required=True);parser.add_argument('--receipt',type=Path,required=True)
    args=parser.parse_args();source=args.source.resolve(strict=True);output=args.output.resolve()
    if output==source or output.exists() or args.receipt.exists():raise ValueError('Fresh distinct outputs required')
    before=pin(source)
    if before['sha256']!=args.expected_sha256:raise ValueError('Source hash differs from retained raw')
    rows=section_index(source);removed=[r for r in rows if r['id']==0 and r['customName']=='name']
    if len(removed)!=1:raise ValueError('Exactly one name custom section is required')
    if sum(r['customName']=='llvm.func_attr.annotate.inline-me' for r in rows)!=1:raise ValueError('Expected inline-me section is missing or duplicated')
    cut=removed[0]
    with source.open('rb') as src,output.open('xb') as dst:
        copy_range(src,dst,0,cut['start']);copy_range(src,dst,cut['end'],before['bytes'])
    if pin(source)!=before:raise ValueError('Source changed during copy')
    after=pin(output)
    if after['bytes']!=before['bytes']-(cut['end']-cut['start']):raise ValueError('Output size mismatch')
    receipt=dict(kind='exact-name-custom-section-copy-v1',source=before,output=after,removed=cut,sectionCountBefore=len(rows),sourceTool=pin(Path(__file__)),independentParityPending=True,optimizerStarted=False,runtimeAcceptance=False)
    args.receipt.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(output=after,removedBytes=cut['end']-cut['start'],optimizerStarted=False,independentParityPending=True)))
if __name__=='__main__':main()
