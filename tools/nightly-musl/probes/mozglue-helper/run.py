from pathlib import Path
import os,json,subprocess
p=Path(__file__).parent;r=p.parent;env=os.environ.copy();env.update(json.loads((p/'actual-cc-env.json').read_text()));env.pop('CXXFLAGS',None);env.pop('CFLAGS',None)
env.update(MOZ_TOPOBJDIR=str(r/'obj-nightly'),MOZ_SRC=str(r/'source/firefox-159.0a1'),TARGET='wasm32-unknown-linux-musl',HOST='x86_64-unknown-linux-gnu',OUT_DIR=str(p/'out'),OPT_LEVEL='2',DEBUG='true',NUM_JOBS='4',CARGO_CFG_TARGET_ARCH='wasm32',CARGO_CFG_TARGET_OS='linux',CARGO_CFG_TARGET_ENV='musl',CARGO_CFG_TARGET_FEATURE='atomics,bulk-memory,mutable-globals,reference-types,sign-ext',CC_ENABLE_DEBUG_OUTPUT='1',CARGO_MANIFEST_DIR=str(r/'source/firefox-159.0a1/mozglue/static/rust'))
raise SystemExit(subprocess.call([str(p/'build-script-build')],env=env,cwd=env['CARGO_MANIFEST_DIR']))
