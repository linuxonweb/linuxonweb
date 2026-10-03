from pathlib import Path
import os,json,subprocess
p=Path(__file__).parent;r=p.parent;env=os.environ.copy();env.update(CARGO_MANIFEST_DIR=str(p/'crate'),CARGO_PKG_VERSION='0.1.0',CARGO_PKG_VERSION_MAJOR='0',CARGO_PKG_VERSION_MINOR='1',CARGO_PKG_VERSION_PATCH='0',CARGO_PKG_VERSION_PRE='',CARGO_PKG_NAME='wgpu_bindings',MOZ_TOPOBJDIR=str(r/'obj-nightly'));raise SystemExit(subprocess.call(json.loads((p/'argv.json').read_text()),env=env,cwd=p/'crate'))
