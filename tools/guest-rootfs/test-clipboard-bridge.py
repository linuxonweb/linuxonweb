#!/usr/bin/env python3
"""Small native X11 integration test of the same clipboard bridge C source."""
import argparse
import base64
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time

p=argparse.ArgumentParser();p.add_argument('--binary',type=Path,required=True);p.add_argument('--scratch',type=Path,required=True);a=p.parse_args()
a.scratch.mkdir(parents=True,exist_ok=True)
processes=[]
with tempfile.TemporaryDirectory(prefix='clip-',dir=a.scratch) as tmp:
    sockpath=str(Path(tmp)/'bridge.sock')
    r,w=os.pipe()
    xvfb=subprocess.Popen(['Xvfb','-displayfd',str(w),'-screen','0','320x240x24','-nolisten','tcp'],pass_fds=[w],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(xvfb);os.close(w)
    try:
        import select
        if not select.select([r],[],[],5)[0]:raise RuntimeError('Xvfb startup timed out')
        number=os.read(r,32).decode().strip();os.close(r);env=dict(os.environ,DISPLAY=':'+number)
        bridge=subprocess.Popen([str(a.binary.resolve()),'--unix',sockpath],env=env,stdout=subprocess.DEVNULL);processes.append(bridge)
        for _ in range(100):
            if Path(sockpath).exists():break
            time.sleep(.02)
        def request(op,kind=0,data=b''):
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
                s.settimeout(12);s.connect(sockpath);s.sendall(struct.pack('<IBBHI',0x31504c43,op,kind,0,len(data))+data)
                def read(n):
                    b=b''
                    while len(b)<n:
                        part=s.recv(n-len(b))
                        if not part:raise RuntimeError('short reply')
                        b+=part
                    return b
                magic,status,k,reserved,n=struct.unpack('<IBBHI',read(12));body=read(n)
                assert magic==0x31504c43 and reserved==0 and n<=16*1024*1024
                return status,k,body
        def xread(target):return subprocess.run(['xclip','-selection','clipboard','-out','-target',target],env=env,capture_output=True,check=True,timeout=8).stdout
        def xown(target,data,selection='clipboard'):
            proc=subprocess.Popen(['xclip','-quiet','-selection',selection,'-in','-target',target],env=env,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(proc)
            proc.stdin.write(data);proc.stdin.close();time.sleep(.1)
            return proc
        assert request(2)[0]==1
        text='Hello Linux 🐧\n世界\n'.encode();assert request(1,1,text)==(0,1,b'');assert xread('UTF8_STRING')==text;assert request(2)==(0,1,text)
        targets=xread('TARGETS');assert b'UTF8_STRING' in targets
        large=('large UTF8 🐧\n'*18000).encode();assert request(1,1,large)==(0,1,b'');assert xread('UTF8_STRING')==large
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=')
        assert request(1,2,png)==(0,2,b'');assert xread('image/png')==png;assert request(2)==(0,2,png)
        xown('UTF8_STRING',text);assert request(2)==(0,1,text)
        xown('UTF8_STRING',large);assert request(2)==(0,1,large)
        xown('image/png',png);assert request(2)==(0,2,png)
        assert request(3)==(0,2,png)
        primary=xown('UTF8_STRING',text,'primary');assert request(3)==(0,1,text);assert request(2)==(0,2,png)
        primary.terminate();primary.wait(timeout=3);assert request(3)==(0,2,png)
        xown('image/png',png,'primary');assert request(3)==(0,2,png)
        assert request(1,2,b'bad')[0]==1;assert request(7)[0]==1
        print('PASS: X11 UTF8/PNG, both directions, retained ownership, INCR in/out, targets, PRIMARY preference/fallback, invalid requests')
    finally:
        for proc in reversed(processes):
            if proc.poll() is None:proc.terminate()
            try:proc.wait(timeout=3)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
