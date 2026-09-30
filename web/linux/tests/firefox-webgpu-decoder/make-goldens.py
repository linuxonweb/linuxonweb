#!/usr/bin/env python3
"""Produce Firefox 128 WebGPU wire goldens from the real client code (W3).

Assembles an offline host-native Cargo workspace under
TASK/native-runN/ws containing verbatim copies of Firefox's
gfx/wgpu_bindings and xpcom/rust/nsstring, a stub static_prefs crate (only
read by server.rs, never called), and golden-harness/. Builds it against
Firefox's vendored third_party/rust with Firefox's Cargo.lock, runs it, and
writes the .bin goldens plus manifest.json into goldens/ in this directory.

Usage: make-goldens.py TASK_DIR RUN_NAME
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
FF = Path("/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/var/nix/"
          "builds/nix-721784-2625232085/build/firefox-128.14.0")
FF_LOCK_SHA256 = "3a72a0456cfe9ab0c2239852383a18c4a90a119c5dc684c0b56d513414114d3f"
CARGO = Path("/home/a/.cargo/bin/cargo")

STATIC_PREFS_TOML = """[package]
name = "static_prefs"
version = "0.1.0"
edition = "2018"
license = "MPL-2.0"

[dependencies]
nsstring = { path = "../../../../xpcom/rust/nsstring" }
"""
STATIC_PREFS_RS = """//! Harness-only stand-in for Gecko's generated static_prefs crate.
//! Only the three prefs read by gfx/wgpu_bindings/src/server.rs exist.
//! The golden harness never calls server code; these values are inert.
pub use nsstring::nsCString;
#[macro_export]
macro_rules! pref {
    ("dom.webgpu.wgpu-backend") => { $crate::nsCString::new() };
    ("dom.webgpu.testing.assert-hardware-adapter") => { false };
    ("dom.webgpu.hal-labels") => { false };
}
"""


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def tree_hash(root: Path) -> dict:
    return {str(p.relative_to(root)): sha256(p) for p in sorted(root.rglob("*")) if p.is_file()}


def check_storage(task: Path) -> dict:
    out = subprocess.run(["findmnt", "-n", "-o", "FSTYPE,SOURCE", "-T", str(task)],
                         check=True, capture_output=True, text=True).stdout.split()
    if out[0] in ("tmpfs", "ramfs") or str(task.resolve()).startswith(("/tmp", "/dev/shm")):
        sys.exit(f"refusing non-disk task dir {task}: {out}")
    free = shutil.disk_usage(task).free
    if free < 5 << 30:
        sys.exit(f"insufficient free space: {free}")
    return {"fstype": out[0], "source": out[1], "free_bytes": free}


def main() -> None:
    task = Path(sys.argv[1]).resolve()
    run = sys.argv[2]
    storage = check_storage(task)
    tmp = task / "tmp"
    tmp.mkdir(exist_ok=True)
    rundir = task / run
    if rundir.exists():
        sys.exit(f"{rundir} exists; preserve old runs and pick a new name")
    ws = rundir / "ws"
    ws.mkdir(parents=True)

    lock_src = FF / "Cargo.lock"
    if sha256(lock_src) != FF_LOCK_SHA256:
        sys.exit("Firefox Cargo.lock hash mismatch")

    shutil.copytree(FF / "gfx/wgpu_bindings", ws / "gfx/wgpu_bindings")
    shutil.copytree(FF / "xpcom/rust/nsstring", ws / "xpcom/rust/nsstring")
    sp = ws / "modules/libpref/init/static_prefs"
    (sp / "src").mkdir(parents=True)
    (sp / "Cargo.toml").write_text(STATIC_PREFS_TOML)
    (sp / "src/lib.rs").write_text(STATIC_PREFS_RS)
    shutil.copytree(HERE / "golden-harness", ws / "golden-harness",
                    ignore=shutil.ignore_patterns("target"))
    shutil.copy2(lock_src, ws / "Cargo.lock")

    # [patch.crates-io] from Firefox's top-level Cargo.toml, paths made absolute.
    ff_toml = tomllib.loads((FF / "Cargo.toml").read_text())
    lines = ["[workspace]", 'members = ["golden-harness"]', 'resolver = "2"', "",
             "[profile.release]", "opt-level = 1", "debug = false", 'panic = "abort"', "",
             "[patch.crates-io]"]
    for name, spec in ff_toml["patch"]["crates-io"].items():
        parts = []
        for k, v in spec.items():
            if k == "path":
                v = str(FF / v)
            parts.append(f'{k} = "{v}"')
        lines.append(f"{name} = {{ {', '.join(parts)} }}")
    for src, pkgs in ff_toml["patch"].items():
        if src == "crates-io":
            continue
        lines.append(f'\n[patch."{src}"]')
        for name, spec in pkgs.items():
            parts = [f'{k} = "{str(FF / v) if k == "path" else v}"' for k, v in spec.items()]
            lines.append(f"{name} = {{ {', '.join(parts)} }}")
    (ws / "Cargo.toml").write_text("\n".join(lines) + "\n")

    cfg_in = (FF / ".cargo/config.toml.in").read_text()
    head = cfg_in.split("# We explicitly exclude")[0]
    (ws / ".cargo").mkdir()
    (ws / ".cargo/config.toml").write_text(
        head + f'\n[source.vendored-sources]\ndirectory = "{FF / "third_party/rust"}"\n\n[net]\noffline = true\n')

    env = dict(os.environ)
    env.update({
        "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp),
        "CARGO_HOME": str(rundir / "cargo-home"),
        "CARGO_TARGET_DIR": str(rundir / "target"),
        "CARGO_NET_OFFLINE": "true",
        "PATH": f"{CARGO.parent}:{env.get('PATH', '')}",
    })
    with open(rundir / "build.log", "w") as log:
        r = subprocess.run([str(CARGO), "build", "--offline", "--release", "-p", "webgpu-golden-harness"],
                           cwd=ws, env=env, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode:
        sys.exit(f"build failed; see {rundir / 'build.log'}")
    exe = rundir / "target/release/webgpu-golden-harness"
    gout = rundir / "goldens"
    with open(rundir / "run.log", "w") as log:
        r = subprocess.run([str(exe), str(gout)], env=env, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode:
        sys.exit(f"harness failed; see {rundir / 'run.log'}")

    raw = json.loads((gout / "manifest-raw.json").read_text())
    for g in raw["goldens"]:
        g["sha256"] = sha256(gout / g["file"])
    rustc = subprocess.run([str(CARGO.parent / "rustc"), "-V"], capture_output=True, text=True, env=env).stdout.strip()
    manifest = {
        "schema": "firefox-webgpu-w3-goldens-v1",
        "firefox": "128.14.0esr",
        "wgpu_rev": "c7458638d14921c7562e4197ddeefa17be413587",
        "firefox_cargo_lock_sha256": FF_LOCK_SHA256,
        "wire": "bincode 1.3.3 serialize() (fixint, little-endian); same make_byte_buf path as Firefox",
        "producer": "golden-harness linked against verbatim gfx/wgpu_bindings, host-native " + rustc,
        "upstream_copies": {
            "gfx/wgpu_bindings": tree_hash(ws / "gfx/wgpu_bindings"),
            "xpcom/rust/nsstring": tree_hash(ws / "xpcom/rust/nsstring"),
        },
        "harness_main_sha256": sha256(ws / "golden-harness/src/main.rs"),
        "storage": storage,
        "run": run,
        "goldens": raw["goldens"],
        "ids": raw["ids"],
    }
    # Upstream copies must match the Firefox tree byte-for-byte.
    for rel, hashes in manifest["upstream_copies"].items():
        if hashes != tree_hash(FF / rel):
            sys.exit(f"copy of {rel} differs from Firefox tree")
    manifest["upstream_copies"] = {k: hashlib.sha256(json.dumps(v, sort_keys=True).encode()).hexdigest()
                                   for k, v in manifest["upstream_copies"].items()}
    (gout / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    dest = HERE / "goldens"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir()
    for g in raw["goldens"]:
        shutil.copy2(gout / g["file"], dest / g["file"])
    shutil.copy2(gout / "manifest.json", dest / "manifest.json")
    print(f"{len(raw['goldens'])} goldens -> {dest}")


if __name__ == "__main__":
    main()
