#!/usr/bin/env python3
"""Independently verify a name-only deletion using WABT headers and byte comparisons."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
CHUNK=4*1024*1024
HEADER=b'\0asm\1\0\0\0'


def pin(path):
    with path.open('rb') as stream:
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    return dict(path=str(path.resolve()),bytes=path.stat().st_size,sha256=digest)


def inspect(path,log):
    argv=['/usr/bin/wasm-objdump','-h',str(path)]
    result=subprocess.run(argv,capture_output=True,text=True,timeout=20)
    log.write_text(result.stdout+result.stderr)
    if result.returncode:raise ValueError('WABT header inspection failed')
    rows=[];previous=8
    pattern=r'^\s*(\w+) start=0x([0-9a-f]+) end=0x([0-9a-f]+) \(size=0x([0-9a-f]+)\)(?: (.*))?$'
    for line in result.stdout.splitlines():
        match=re.fullmatch(pattern,line)
        if not match:continue
        kind,body,end,length,description=match.groups();body=int(body,16);end=int(end,16);length=int(length,16)
        if not previous<body<=end or end-body!=length:raise ValueError('Invalid WABT section envelope')
        rows.append(dict(kind=kind,start=previous,payloadStart=body,end=end,payloadBytes=length,description=description or ''))
        previous=end
    if not rows or previous!=path.stat().st_size:raise ValueError('WABT section inventory incomplete')
    return rows,dict(argv=argv,returncode=result.returncode,log=pin(log))


def range_digest(stream,start,end):
    stream.seek(start);digest=hashlib.sha256()
    while start<end:
        block=stream.read(min(CHUNK,end-start))
        if not block:raise ValueError('Truncated section during independent comparison')
        digest.update(block);start+=len(block)
    return digest.hexdigest()


def compare_sections(source,target,before,after):
    if before['end']-before['start']!=after['end']-after['start']:raise ValueError('Retained section envelope size differs')
    source.seek(before['start']);target.seek(after['start']);left=before['end']-before['start'];digest=hashlib.sha256()
    while left:
        count=min(CHUNK,left);a=source.read(count);b=target.read(count)
        if len(a)!=count or a!=b:raise ValueError('Retained section envelope or payload differs')
        digest.update(a);left-=count
    return digest.hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('candidate',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--expected-sha256',required=True)
    args=parser.parse_args();source=args.source.resolve(strict=True);candidate=args.candidate.resolve(strict=True)
    if source==candidate:raise ValueError('Distinct original and candidate inputs required')
    args.output.mkdir(exist_ok=False);before_pin=pin(source);after_pin=pin(candidate)
    if before_pin['sha256']!=args.expected_sha256:raise ValueError('Original raw hash differs')
    before,c1=inspect(source,args.output/'raw-headers.log');after,c2=inspect(candidate,args.output/'candidate-headers.log')
    removed=[r for r in before if r['kind']=='Custom' and r['description']=='"name"']
    if len(removed)!=1:raise ValueError('Exactly one original name section required')
    if any(r['kind']=='Custom' and r['description']=='"name"' for r in after):raise ValueError('Candidate still contains name section')
    keep=[r for r in before if r is not removed[0]]
    if len(after)!=len(keep):raise ValueError('A different number of sections was removed')
    if after_pin['bytes']!=before_pin['bytes']-(removed[0]['end']-removed[0]['start']):raise ValueError('Unexpected file length delta')
    parity=[]
    with source.open('rb') as src,candidate.open('rb') as dst:
        if src.read(8)!=HEADER or dst.read(8)!=HEADER:raise ValueError('Wasm header differs')
        for left,right in zip(keep,after):
            if any(left[k]!=right[k] for k in ['kind','payloadBytes','description']):raise ValueError('Independent section inventory differs')
            digest=compare_sections(src,dst,left,right)
            parity.append(dict(kind=left['kind'],description=left['description'],originalStart=left['start'],candidateStart=right['start'],bytes=left['end']-left['start'],sha256=digest,envelopeAndPayloadIdentical=True))
        removed_hash=range_digest(src,removed[0]['start'],removed[0]['end'])
    inline=[r for r in parity if r['kind']=='Custom' and r['description']=='"llvm.func_attr.annotate.inline-me"']
    if len(inline)!=1:raise ValueError('Expected inline-me section is missing or duplicated')
    if pin(source)!=before_pin or pin(candidate)!=after_pin:raise ValueError('Inputs changed during independent verification')
    receipt=dict(kind='wabt-independent-name-section-parity-v1',passNameOnlyParity=True,source=before_pin,candidate=after_pin,headerIdentical=True,removed=dict(**removed[0],bytes=removed[0]['end']-removed[0]['start'],sha256=removed_hash),sectionCountBefore=len(before),sectionCountAfter=len(after),preservedSections=parity,everyOtherSectionEnvelopeAndPayloadIdentical=True,inlineMePreserved=inline[0],commands=[c1,c2],verifier=pin(Path(__file__)),wabt=pin(Path('/usr/bin/wasm-objdump')),optimizerStarted=False,runtimeAcceptance=False)
    path=args.output/'result.json';path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(passNameOnlyParity=True,candidate=after_pin,preservedSections=len(parity),removedBytes=receipt['removed']['bytes'],receipt=pin(path),optimizerStarted=False)))
if __name__=='__main__':main()
