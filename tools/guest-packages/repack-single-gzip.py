#!/usr/bin/env python3
"""Repack a candidate as one gzip stream for browser DecompressionStream support."""
import argparse,copy,gzip,hashlib,json,pathlib,zlib
q=argparse.ArgumentParser();q.add_argument('--candidate',type=pathlib.Path,required=True);q.add_argument('--out',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=False);old=a.candidate/'initramfs-firefox.cpio.gz';new=a.out/old.name;before=json.loads((a.candidate/'package.json').read_text());manifest=json.loads((a.candidate/'boot-manifest.json').read_text());h=hashlib.sha256();decoded=0
with old.open('rb') as f:old_sha=hashlib.file_digest(f,'sha256').hexdigest()
if old_sha!=manifest['assets']['firefox']['sha256']:raise ValueError('candidate archive hash mismatch')
with gzip.open(old,'rb') as src,new.open('wb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',filename='',mtime=0,compresslevel=6) as dst:
 while data:=src.read(1048576):h.update(data);decoded+=len(data);dst.write(data)
decoder=zlib.decompressobj(31);after_hash=hashlib.sha256();output_bytes=0
with new.open('rb') as f:
 while block:=f.read(1048576):
  data=decoder.decompress(block);after_hash.update(data);output_bytes+=len(data)
  if decoder.unused_data:raise ValueError('more than one compressed member')
 tail=decoder.flush();after_hash.update(tail);output_bytes+=len(tail)
if not decoder.eof or h.hexdigest()!=after_hash.hexdigest() or decoded!=output_bytes:raise ValueError('decoded rootfs identity mismatch')
with new.open('rb') as f:new_sha=hashlib.file_digest(f,'sha256').hexdigest()
manifest['assets']['firefox'].update(bytes=new.stat().st_size,sha256=new_sha);manifest['version']=hashlib.sha256(json.dumps(manifest['assets'],sort_keys=True).encode()).hexdigest()[:12];(a.out/'boot-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');report=copy.deepcopy(before);report.update(archiveSha256=new_sha,bytes=new.stat().st_size,version=manifest['version'],format='one gzip member containing the unchanged concatenated newc archives',originalGzipPrefixPreserved=False,originalCpioPrefixPreserved=True,decodedRootfsUnchanged=True,decodedRootfsSha256=h.hexdigest(),decodedRootfsBytes=decoded,sourceCandidateArchiveSha256=old_sha,gzipMembers=1,packageRuntimeAccepted=False,runtimeAccepted=False,releaseGatesPending=['actual Chromium DecompressionStream and full frontend boot','normal desktop package commands through actual frontend']);report['browserCompatibilityRepair']='Chrome rejects concatenated gzip members; decoded CPIO sequence is byte-identical to the accepted native package/reboot fixture.';(a.out/'package.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ('archiveSha256','bytes','version','decodedRootfsSha256','decodedRootfsBytes','gzipMembers','initUnchanged','nativeFirefoxUnchanged')}))
