#!/usr/bin/env python3
"""W4b adapter_pack_info goldens from the real Firefox 128 Rust types.

Reuses the W3 workspace recipe (web/linux/tests/firefox-webgpu-decoder/
make-goldens.py: verbatim gfx/wgpu_bindings + nsstring copies, static_prefs
stub, Firefox [patch] table, vendored offline sources, Cargo.lock hash check)
but builds pack-info-harness/ instead and writes to THIS directory's
goldens/ -- the W3 goldens are never touched.

restrict_limits and its constants are extracted verbatim from
gfx/wgpu_bindings/src/server.rs into the harness (restrict.rs), so the goldens
use the exact upstream clamping.

Usage:
  make-pack-info-goldens.py TASK_DIR RUN_NAME [SEED_TARGET_DIR]
  make-pack-info-goldens.py --verify TASK_DIR RUN_NAME FILE...   (reuse a built run)
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tomllib

sys.dont_write_bytecode = True  # do not leave __pycache__ next to the W3 script
from pathlib import Path

HERE = Path(__file__).resolve().parent
W3 = HERE.parent / "firefox-webgpu-decoder" / "make-goldens.py"
spec = importlib.util.spec_from_file_location("w3_make_goldens", W3)
w3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w3)
FF, CARGO = w3.FF, w3.CARGO


def extract_restrict(server_rs: str) -> str:
    start = server_rs.index("pub const MAX_BUFFER_SIZE: wgt::BufferAddress")
    fn = server_rs.index("fn restrict_limits(limits: wgt::Limits) -> wgt::Limits {", start)
    end = server_rs.index("\n}\n", fn) + 3
    return ("// Extracted verbatim from gfx/wgpu_bindings/src/server.rs by make-pack-info-goldens.py.\n"
            "#[allow(dead_code)]\n" + server_rs[start:end])


def env_for(task: Path, rundir: Path) -> dict:
    tmp = task / "tmp"
    env = dict(os.environ)
    env.update({
        "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp),
        "CARGO_HOME": str(rundir / "cargo-home"),
        "CARGO_TARGET_DIR": str(rundir / "target"),
        "CARGO_NET_OFFLINE": "true",
        "PATH": f"{CARGO.parent}:{env.get('PATH', '')}",
    })
    return env


def verify(task: Path, run: str, files: list[str]) -> None:
    rundir = task / run
    exe = rundir / "target/release/webgpu-pack-info-harness"
    r = subprocess.run([str(exe), "verify", *files], env=env_for(task, rundir))
    sys.exit(r.returncode)


def main() -> None:
    if sys.argv[1] == "--verify":
        return verify(Path(sys.argv[2]).resolve(), sys.argv[3], sys.argv[4:])
    task = Path(sys.argv[1]).resolve()
    run = sys.argv[2]
    seed = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    storage = w3.check_storage(task)
    (task / "tmp").mkdir(exist_ok=True)
    rundir = task / run
    if rundir.exists():
        sys.exit(f"{rundir} exists; preserve old runs and pick a new name")
    ws = rundir / "ws"
    ws.mkdir(parents=True)
    if w3.sha256(FF / "Cargo.lock") != w3.FF_LOCK_SHA256:
        sys.exit("Firefox Cargo.lock hash mismatch")

    shutil.copytree(FF / "gfx/wgpu_bindings", ws / "gfx/wgpu_bindings")
    shutil.copytree(FF / "xpcom/rust/nsstring", ws / "xpcom/rust/nsstring")
    sp = ws / "modules/libpref/init/static_prefs"
    (sp / "src").mkdir(parents=True)
    (sp / "Cargo.toml").write_text(w3.STATIC_PREFS_TOML)
    (sp / "src/lib.rs").write_text(w3.STATIC_PREFS_RS)
    shutil.copytree(HERE / "pack-info-harness", ws / "pack-info-harness", ignore=shutil.ignore_patterns("target"))
    server_rs = (FF / "gfx/wgpu_bindings/src/server.rs").read_text()
    (ws / "pack-info-harness/src/restrict.rs").write_text(extract_restrict(server_rs))
    shutil.copy2(FF / "Cargo.lock", ws / "Cargo.lock")

    ff_toml = tomllib.loads((FF / "Cargo.toml").read_text())
    lines = ["[workspace]", 'members = ["pack-info-harness"]', 'resolver = "2"', "",
             "[profile.release]", "opt-level = 1", "debug = false", 'panic = "abort"', "",
             "[patch.crates-io]"]
    for name, spec_ in ff_toml["patch"]["crates-io"].items():
        parts = [f'{k} = "{str(FF / v) if k == "path" else v}"' for k, v in spec_.items()]
        lines.append(f"{name} = {{ {', '.join(parts)} }}")
    for src, pkgs in ff_toml["patch"].items():
        if src == "crates-io":
            continue
        lines.append(f'\n[patch."{src}"]')
        for name, spec_ in pkgs.items():
            parts = [f'{k} = "{str(FF / v) if k == "path" else v}"' for k, v in spec_.items()]
            lines.append(f"{name} = {{ {', '.join(parts)} }}")
    (ws / "Cargo.toml").write_text("\n".join(lines) + "\n")
    head = (FF / ".cargo/config.toml.in").read_text().split("# We explicitly exclude")[0]
    (ws / ".cargo").mkdir()
    (ws / ".cargo/config.toml").write_text(
        head + f'\n[source.vendored-sources]\ndirectory = "{FF / "third_party/rust"}"\n\n[net]\noffline = true\n')

    if seed and seed.is_dir():  # copy (never hardlink) the W3 build cache to save compile time
        subprocess.run(["cp", "-a", str(seed), str(rundir / "target")], check=True)
    env = env_for(task, rundir)
    with open(rundir / "build.log", "w") as log:
        r = subprocess.run([str(CARGO), "build", "--offline", "--release", "-p", "webgpu-pack-info-harness"],
                           cwd=ws, env=env, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode:
        sys.exit(f"build failed; see {rundir / 'build.log'}")
    exe = rundir / "target/release/webgpu-pack-info-harness"
    gout = rundir / "goldens"
    with open(rundir / "run.log", "w") as log:
        r = subprocess.run([str(exe), "gen", str(gout)], env=env, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode:
        sys.exit(f"harness failed; see {rundir / 'run.log'}")

    raw = json.loads((gout / "manifest-raw.json").read_text())
    files = []
    for g in raw["goldens"]:
        g["bin_sha256"] = w3.sha256(gout / g["bin"])
        files.append(g["bin"])
        if "payload" in g:
            g["payload_sha256"] = w3.sha256(gout / g["payload"])
            files.append(g["payload"])
    for rel in ("gfx/wgpu_bindings", "xpcom/rust/nsstring"):
        if w3.tree_hash(ws / rel) != w3.tree_hash(FF / rel):
            sys.exit(f"copy of {rel} differs from Firefox tree")
    rustc = subprocess.run([str(CARGO.parent / "rustc"), "-V"], capture_output=True, text=True, env=env).stdout.strip()
    manifest = {
        "schema": "firefox-webgpu-w4b-pack-info-goldens-v1",
        "firefox": "128.14.0esr",
        "wgpu_rev": "c7458638d14921c7562e4197ddeefa17be413587",
        "firefox_cargo_lock_sha256": w3.FF_LOCK_SHA256,
        "server_rs_sha256": w3.sha256(FF / "gfx/wgpu_bindings/src/server.rs"),
        "restrict_rs_sha256": w3.sha256(ws / "pack-info-harness/src/restrict.rs"),
        "harness_main_sha256": w3.sha256(ws / "pack-info-harness/src/main.rs"),
        "wire": "bincode 1.3.3 serialize() of wgpu_bindings::AdapterInformation<String>; None = serialize(&0u64)",
        "check": "real bincode::deserialize::<AdapterInformation<String>> (strict, no trailing), field-equal via "
                 "repr(C) mirror, re-serialize byte-equal",
        "producer": "pack-info-harness linked against verbatim gfx/wgpu_bindings, host-native " + rustc,
        "storage": storage,
        "run": run,
        "goldens": raw["goldens"],
    }
    (gout / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    dest = HERE / "goldens"
    dest.mkdir(exist_ok=True)
    for f in files:
        shutil.copy2(gout / f, dest / f)
    shutil.copy2(gout / "manifest.json", dest / "manifest.json")
    print(f"{len(raw['goldens'])} goldens -> {dest}")


if __name__ == "__main__":
    main()
