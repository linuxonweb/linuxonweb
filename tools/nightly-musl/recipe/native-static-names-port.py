"""Separate bundled-library symbols for native static Linux/Wasm linking."""
from pathlib import Path
import difflib,hashlib,json,subprocess,sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R=Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
S=T/'source/firefox-159.0a1'
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
 d=json.loads(p.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):assert d['state']=='completed' and d['pgid'] not in groups,p
changes={}
def replace(path,old,new):
 text=changes.get(path,(S/path).read_text());assert text.count(old)==1,(path,old)
 changes[path]=text.replace(old,new,1)
native='CONFIG["OS_ARCH"] == "Linux" and CONFIG["TARGET_CPU"] == "wasm32"'
replace('media/libsoundtouch/src/moz.build','    SOURCES += ["/config/external/rlbox/rlbox_thread_locals.cpp"]',
        '    # The native static browser already owns this shared RLBox TLS storage.\n    if not ('+native+'):\n        SOURCES += ["/config/external/rlbox/rlbox_thread_locals.cpp"]')
replace('ipc/chromium/src/third_party/moz.build',"    if CONFIG['OS_TARGET'] != 'Android':",
        "    if CONFIG['OS_TARGET'] != 'Android' and not ("+native+'):\n        # Native musl already provides epoll_create/ctl/wait.')
header='media/libsoundtouch/src/RLBoxSoundTouchFactory.h'
replace(header,'// Exposed C API that is used by RLBox','''// Exposed C API that is used by RLBox
#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
#  define MOZ_SOUNDTOUCH_CLEAR NightlySoundTouchClear
#else
#  define MOZ_SOUNDTOUCH_CLEAR Clear
#endif''')
replace(header,'void Clear(soundtouch::SoundTouch* mTimeStretcher);','void MOZ_SOUNDTOUCH_CLEAR(soundtouch::SoundTouch* mTimeStretcher);')
replace('media/libsoundtouch/src/RLBoxSoundTouchFactory.cpp','void Clear(SoundTouch* mTimeStretcher)','void MOZ_SOUNDTOUCH_CLEAR(SoundTouch* mTimeStretcher)')
replace('media/libsoundtouch/src/RLBoxSoundTouch.cpp','invoke_sandbox_function(Clear,','invoke_sandbox_function(MOZ_SOUNDTOUCH_CLEAR,')
header='media/libpng/pnglibconf.h'
original=(S/header).read_text()
changes[header]=original+'\n#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)\n#  include "NightlyPngStaticNames.h"\n#endif\n'
replace('media/libpng/moz.build',"Library('mozpng')",'if '+native+':\n    EXPORTS += ["NightlyPngStaticNames.h"]\n\n'+"Library('mozpng')")
newfiles={
 'media/libpng/NightlyPngStaticNames.h':(R/'adapters/NightlyPngStaticNames.h').read_bytes(),
 'gfx/cairo/cairo/src/NightlyCairoStaticNames.h':(R/'adapters/NightlyCairoStaticNames.h').read_bytes(),
 'gfx/cairo/cairo/src/defs.mk':(R/'adapters/cairo-static/defs.mk').read_bytes(),
}
for p in newfiles:assert not (S/p).exists(),p
backup=T/'static-names-preflight'
assert not backup.exists()
patch=''.join(''.join(difflib.unified_diff((S/p).read_text().splitlines(True),text.splitlines(True),fromfile='a/'+p,tofile='b/'+p)) for p,text in changes.items())
if '--apply' in sys.argv:
 backup.mkdir()
 for path,text in changes.items():
  b=backup/path;b.parent.mkdir(parents=True,exist_ok=True);b.write_bytes((S/path).read_bytes());(S/path).write_text(text)
 for path,data in newfiles.items():(S/path).write_bytes(data)
 (R/'patches/nightly-native-static-names.patch').write_text(patch)
report=dict(claim='Native static namespace and single-owner graph preparation; actual component rebuild and final link acceptance required',changes=[dict(path=str(S/p),backup=str(backup/p),updated_sha256=hashlib.sha256(text.encode()).hexdigest()) for p,text in changes.items()],newfiles=[dict(path=str(S/p),sha256=hashlib.sha256(data).hexdigest()) for p,data in newfiles.items()],ownedGroupsEmpty=True,applied='--apply' in sys.argv,guestAcceptance=False,releaseAcceptance=False)
out=T/'status/native-static-names-port-run1.json';assert not out.exists();out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(changed=len(changes),added=len(newfiles),applied=report['applied'])))
