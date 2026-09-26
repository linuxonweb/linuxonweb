#!/usr/bin/env python3
"""Fetch a small pinned Dawn allowlist and run its unmodified C-header generator.

No clone, package installation, native Dawn build, driver or deployment. Requires
Python 3, Jinja2 and MarkupSafe already installed. Output must be on disk.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

DAWN = "c3d35d65fb2f087c425ba20050c5ff03d32f1114"
ANGLE = "c2fbfadacf8679abe316941d1ac5310f6c1645a1"
DEPENDENCIES = {"Jinja2": "3.1.6", "MarkupSafe": "3.0.3"}
FILES = (
    "LICENSE", "generator/dawn_json_generator.py", "generator/generator_lib.py",
    "generator/webgpu_docs_utility.py", "generator/templates/api.h",
    "generator/templates/dawn_proc_table.h", "generator/templates/BSD_LICENSE",
    "generator/templates/dawn/wire/client/api.h", "src/dawn/dawn.json",
    "include/webgpu/webgpu.h",
)
OUTPUTS = (
    "include/dawn/webgpu.h", "include/dawn/dawn_proc_table.h",
    "include/dawn/wire/client/webgpu.h",
)


def git_hash(kind, data):
    return hashlib.sha1(kind.encode() + b" " + str(len(data)).encode() + b"\0" + data).hexdigest()


def disk_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    fs = subprocess.check_output(["findmnt", "-n", "-o", "FSTYPE", "-T", str(path)], text=True).strip()
    if fs in ("tmpfs", "ramfs") or path == Path("/tmp") or Path("/tmp") in path.parents:
        raise RuntimeError(f"disk-backed output required: {path} ({fs})")
    if shutil.disk_usage(path).free < 64 * 1024 * 1024:
        raise RuntimeError("at least 64 MiB free disk space required")
    return fs


class PinnedRepo:
    def __init__(self, repo, commit, root):
        self.repo, self.commit, self.root = repo, commit, root
        self.trees, self.records, self.bytes = {}, [], 0
        commit_data = self.api("commits/" + commit)
        if commit_data["sha"] != commit:
            raise RuntimeError("commit identity mismatch")
        self.tree = commit_data["tree"]["sha"]
        (root / "commit.json").write_text(json.dumps(commit_data, indent=2) + "\n")

    def get(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "linuxonweb-pinned-header-gate", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        self.bytes += len(data)
        if len(data) > 2 * 1024 * 1024 or self.bytes > 8 * 1024 * 1024:
            raise RuntimeError("bounded fetch size exceeded")
        return data

    def api(self, path):
        return json.loads(self.get(f"https://api.github.com/repos/google/{self.repo}/git/{path}"))

    def tree_entries(self, sha):
        if sha not in self.trees:
            value = self.api("trees/" + sha)
            if value.get("truncated") or value["sha"] != sha:
                raise RuntimeError("invalid or incomplete tree")
            entries = value["tree"]
            ordered = sorted(entries, key=lambda e: (e["path"] + ("/" if e["type"] == "tree" else "")).encode())
            raw = b"".join(e["mode"].lstrip("0").encode() + b" " + e["path"].encode() + b"\0" + bytes.fromhex(e["sha"]) for e in ordered)
            if git_hash("tree", raw) != sha:
                raise RuntimeError("Git tree hash mismatch")
            self.trees[sha] = value
        return self.trees[sha]["tree"]

    def fetch(self, path):
        sha = self.tree
        parts = Path(path).parts
        for i, name in enumerate(parts):
            entry = next(e for e in self.tree_entries(sha) if e["path"] == name)
            if entry["type"] != ("blob" if i == len(parts) - 1 else "tree"):
                raise RuntimeError("unexpected path type")
            sha = entry["sha"]
        if entry["mode"] not in ("100644", "100755"):
            raise RuntimeError("nonregular input")
        url = f"https://raw.githubusercontent.com/google/{self.repo}/{self.commit}/{path}"
        data = self.get(url)
        if git_hash("blob", data) != sha or len(data) != entry["size"]:
            raise RuntimeError("Git blob identity mismatch: " + path)
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        self.records.append({"path": path, "url": url, "gitBlob": sha, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})

    def provenance(self):
        return {"repository": self.repo, "commit": self.commit, "rootTree": self.tree,
                "treeObjects": self.trees, "files": self.records, "networkBytes": self.bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    fs = disk_directory(out)
    if any(out.iterdir()):
        parser.error("use a fresh empty output directory")
    tmp = out / "tmp"
    tmp.mkdir()
    os.environ["TMPDIR"] = str(tmp)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    deps = {name: importlib.metadata.version(name) for name in DEPENDENCIES}
    if deps != DEPENDENCIES:
        raise RuntimeError(f"generator dependencies must match {DEPENDENCIES}; found {deps}")
    repos = []
    for name, commit, files in (("dawn", DAWN, FILES), ("angle", ANGLE, ("DEPS",))):
        root = out / name
        root.mkdir()
        repo = PinnedRepo(name, commit, root)
        for file in files:
            repo.fetch(file)
        repos.append(repo.provenance())
    if DAWN not in (out / "angle/DEPS").read_text():
        raise RuntimeError("ANGLE DEPS does not contain expected Dawn pin")
    (out / "sources.json").write_text(json.dumps(repos, indent=2) + "\n")
    generated = out / "generated"
    expected = out / "expected-outputs.txt"
    expected.write_text("\n".join(OUTPUTS) + "\n")
    cmd = [sys.executable, str(out / "dawn/generator/dawn_json_generator.py"),
           "--dawn-json", str(out / "dawn/src/dawn/dawn.json"), "--targets", "headers",
           "--template-dir", str(out / "dawn/generator/templates"),
           "--output-dir", str(generated), "--expected-outputs-file", str(expected)]
    (out / "generate-command.json").write_text(json.dumps(cmd, indent=2) + "\n")
    with (out / "generate.log").open("w") as log:
        subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
    outputs = [{"path": p, "bytes": (generated / p).stat().st_size,
                "sha256": hashlib.sha256((generated / p).read_bytes()).hexdigest()} for p in OUTPUTS]
    report = {"pass": True, "scope": "official generated headers only; no driver or guest execution",
              "filesystem": fs, "python": sys.version, "dependencies": deps,
              "dawn": DAWN, "angle": ANGLE, "generated": outputs}
    (out / "headers.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
