"""Package the tested Firefox chrome-font overlay atop the evdev-keyboard archive.

The source archive and OpenSans font are hash-guarded. This modifies init and
adds two root files; the init script installs the font outside Fontconfig's
scan paths and enables the narrowly scoped userChrome stylesheet.
"""
from pathlib import Path
import argparse
import gzip
import hashlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('base_archive', type=Path)
parser.add_argument('font_ttf', type=Path)
parser.add_argument('output_archive', type=Path)
args = parser.parse_args()
src = args.base_archive
dst = args.output_archive
assert src.resolve() != dst.resolve()
font = args.font_ttf.read_bytes()
css = Path(__file__).with_name('userChrome.css').read_bytes()
assert hashlib.sha256(font).hexdigest() == 'c53aceea2dcf5b4098099c0c4d0a061d17e178a049317b42a422b1a9f7f8eb59'
assert hashlib.file_digest(src.open('rb'),'sha256').hexdigest() == 'e3b194e6c4c6aa144c4b57d3d06f3b9ee3d8c351bfba6284d9f9aa3423f363cc'
assert font[:4] in (b'\0\1\0\0', b'OTTO')

def entry(out,name,data):
 name=name.encode()+b'\0'
 fields=[123456,0o100644,0,0,1,0,len(data),0,0,0,0,len(name),0]
 h=b'070701'+b''.join(f'{n:08x}'.encode() for n in fields)
 assert len(h)==110
 out.write(h);out.write(name);out.write(b'\0'*((-(110+len(name)))%4));out.write(data);out.write(b'\0'*((-len(data))%4))
def copy_n(inp,out,n):
 while n:
  d=inp.read(min(n,1048576));assert d;out.write(d);n-=len(d)
replaced=[]
with gzip.open(src,'rb') as inp,gzip.open(dst,'wb',compresslevel=6) as out:
 while True:
  h=inp.read(110);assert len(h)==110 and h[:6]==b'070701'
  sz=int(h[54:62],16);nl=int(h[94:102],16);name=inp.read(nl);pad=inp.read((-(110+nl))%4)
  path=name.rstrip(b'\0').decode()
  if path=='TRAILER!!!':
   entry(out,'lowland-OpenSans-Regular.ttf',font)
   entry(out,'lowland-userChrome.css',css)
   out.write(h);out.write(name);out.write(pad);copy_n(inp,out,sz+(-sz)%4)
   break
  if path=='init':
   data=inp.read(sz);inp.read((-sz)%4)
   assert data.count(b'user_pref("network.http.http3.enable", false);')==1
   data=data.replace(b'user_pref("network.http.http3.enable", false);',b'user_pref("network.http.http3.enable", false);\nuser_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);')
   old=b'  chown -R 1000:1000 /home/admin/.mozilla/firefox/http1-profile\n'
   new=b'''  mkdir -p /opt/firefox/fonts /home/admin/.mozilla/firefox/http1-profile/chrome
  cp /lowland-OpenSans-Regular.ttf /opt/firefox/fonts/OpenSans-Regular.ttf
  cp /lowland-userChrome.css /home/admin/.mozilla/firefox/http1-profile/chrome/userChrome.css
  chown -R 1000:1000 /opt/firefox/fonts /home/admin/.mozilla/firefox/http1-profile
'''
   assert data.count(old)==1
   data=data.replace(old,new)
   h=h[:54]+f'{len(data):08x}'.encode()+h[62:]
   out.write(h);out.write(name);out.write(pad);out.write(data);out.write(b'\0'*((-len(data))%4))
   replaced.append((path,sz,len(data)))
  else:
   out.write(h);out.write(name);out.write(pad);copy_n(inp,out,sz+(-sz)%4)
assert replaced and len(replaced)==1
print('candidate',dst,'size',dst.stat().st_size,'sha',hashlib.file_digest(dst.open('rb'),'sha256').hexdigest(),'changed',replaced,'font',len(font),'css',len(css))
