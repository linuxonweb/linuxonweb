#!/usr/bin/env python3
from pathlib import Path
import json,sys,difflib,re,subprocess
root=Path("/mnt/p6/build/firefox-nightly-musl-recovery-20261002"); src=root/'source/firefox-159.0a1'
changes={}
def replace(file,old,new):
 text=changes.get(file,(src/file).read_text())
 if text.count(old)!=1: raise RuntimeError(f'{file}: expected one replacement, got {text.count(old)} for {old!r}')
 changes[file]=text.replace(old,new,1)
def library(file,call,name,symbol=None):
 old=call+'\n'; new='if CONFIG["TARGET_CPU"] == "wasm32":\n    Library("'+name+'")\nelse:\n    '+call+'\n'
 for line in ['SHARED_LIBRARY_NAME = "'+name+'"',symbol]:
  if line:
   old+=line+'\n'; new+='    '+line+'\n'
 replace(file,old,new)
replace('browser/app/moz.build','if CONFIG["FUZZING_SNAPSHOT"] or CONFIG["AFLFUZZ"]:', 'if CONFIG["TARGET_CPU"] == "wasm32":\n    browser_linkage = "dependent"\nelif CONFIG["FUZZING_SNAPSHOT"] or CONFIG["AFLFUZZ"]:')
replace('toolkit/moz.configure','return target.os in ("WINNT", "OSX", "iOS", "Android")','return target.os in ("WINNT", "OSX", "iOS", "Android") or target.cpu == "wasm32"')
replace('toolkit/library/moz.build','    else:\n        GeckoSharedLibrary(name, output_category=output_category)','    elif CONFIG["TARGET_CPU"] == "wasm32":\n        Library(name)\n    else:\n        GeckoSharedLibrary(name, output_category=output_category)')
replace('toolkit/library/moz.build','    if name == "xul-real":','    if name == "xul-real" and CONFIG["TARGET_CPU"] != "wasm32":')
replace('toolkit/library/moz.build','    GeneratedFile(\n        "buildid.cpp", script="gen_buildid.py", inputs=["!build/%s.list" % libxul_list]\n    )','    if CONFIG["TARGET_CPU"] == "wasm32":\n        GeneratedFile("buildid.cpp", script="gen_buildid.py")\n    else:\n        GeneratedFile(\n            "buildid.cpp", script="gen_buildid.py", inputs=["!build/%s.list" % libxul_list]\n        )')
replace('toolkit/library/build/moz.build','if CONFIG["COMPILE_ENVIRONMENT"]:', 'if CONFIG["COMPILE_ENVIRONMENT"] and CONFIG["TARGET_CPU"] != "wasm32":')
library('config/external/gkcodecs/moz.build','GeckoSharedLibrary("gkcodecs")','gkcodecs','SYMBOLS_FILE = "gkcodecs.symbols"')
library('config/external/lgpllibs/moz.build','GeckoSharedLibrary("lgpllibs")','lgpllibs')
replace('widget/gtk/mozgtk/moz.build','SharedLibrary("mozgtk")','if CONFIG["TARGET_CPU"] == "wasm32":\n    Library("mozgtk")\nelse:\n    SharedLibrary("mozgtk")')
for name in ['codec','util']:
 file=f'media/ffvpx/libav{name}/moz.build'; text=(src/file).read_text()
 call=f"SharedLibrary('mozav{name}')"
 replace(file,call,f'if CONFIG["TARGET_CPU"] == "wasm32":\n    Library("mozav{name}")\nelse:\n    {call}')
 line=next(x for x in text.splitlines() if x.startswith('SYMBOLS_FILE ='))
 replace(file,line,'if CONFIG["TARGET_CPU"] != "wasm32":\n    '+line)
replace('toolkit/toolkit.mozbuild','DIRS += [\n    "/media/gmp-clearkey/0.1",\n]','if CONFIG["TARGET_CPU"] != "wasm32":\n    DIRS += [\n        "/media/gmp-clearkey/0.1",\n    ]')
for name in ['fake-cdm','gmp-plugin-openh264']:
 replace('dom/media/moz.build',f'    "{name}",\n','')
replace('dom/media/moz.build',']\n\nif CONFIG["MOZ_ANDROID_HLS_SUPPORT"]:', ']\n\nif CONFIG["TARGET_CPU"] != "wasm32":\n    DIRS += ["fake-cdm", "gmp-plugin-openh264"]\n\nif CONFIG["MOZ_ANDROID_HLS_SUPPORT"]:')
replace('dom/media/eme/moz.build','DIRS += ["clearkey"]','if CONFIG["TARGET_CPU"] != "wasm32":\n    DIRS += ["clearkey"]')
replace('toolkit/library/gen_buildid.py','def main(output, input_file):\n    with open(input_file) as fh:\n        objs = [l.strip() for l in fh.readlines()]','def main(output, input_file=None):\n    if input_file:\n        with open(input_file) as fh:\n            objs = [l.strip() for l in fh.readlines()]\n    else:\n        objs = []')
replace('security/moz.build','    GeckoSharedLibrary("nss")\n    # TODO: The library name can be changed when bug 845217 is fixed.\n    SHARED_LIBRARY_NAME = "nss3"','    if CONFIG["TARGET_CPU"] == "wasm32":\n        Library("nss")\n    else:\n        GeckoSharedLibrary("nss")\n        # TODO: The library name can be changed when bug 845217 is fixed.\n        SHARED_LIBRARY_NAME = "nss3"')
replace('security/moz.build','    SYMBOLS_FILE = "nss.symbols"','    if CONFIG["TARGET_CPU"] != "wasm32":\n        SYMBOLS_FILE = "nss.symbols"')
replace('security/moz.build','    gyp_vars["moz_fold_libs"] = 1','    gyp_vars["moz_fold_libs"] = 1\n    gyp_vars["wasm_static"] = int(CONFIG["TARGET_CPU"] == "wasm32")')
libs=['epoxy','Xi','Xrandr','Xcursor','Xcomposite','Xdamage','Xinerama','Xfixes','Xrender','Xext','X11','xcb','Xau','expat']
changes['toolkit/library/moz.build']+='\nif CONFIG["TARGET_CPU"] == "wasm32":\n    OS_LIBS += '+repr(libs)+'\n'
replace('toolkit/xre/gfxtest/moz.build','OS_LIBS += CONFIG["DL_LIBS"]','OS_LIBS += CONFIG["DL_LIBS"]\n\nif CONFIG["TARGET_CPU"] == "wasm32":\n    OS_LIBS += ["Xau"]')
patch=''.join(''.join(difflib.unified_diff((src/f).read_text().splitlines(True),t.splitlines(True),fromfile='a/'+f,tofile='b/'+f)) for f,t in changes.items())
(root/'patches/nightly-static-graph-0033-0034-0041.patch').write_text(patch)
print(json.dumps({'files':list(changes),'omissions':['security/manager/ssl/{builtins,ipcclientcerts,osclientcerts}/moz.build removed upstream; old dynamic-library graph absent'],'apply':('--apply' in sys.argv)},indent=2))
if '--apply' in sys.argv:
 for f,t in changes.items(): (src/f).write_text(t)
