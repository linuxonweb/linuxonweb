#!/usr/bin/env python3
"""Rebuild the Aurora picker, MIME-filter and prompt-bridge objects and relink the preserved working CA build.

Requires the archived Firefox object tree, compile_commands.json, target toolchain,
and the exact CA link command/response/object files recorded in Agents.md. This
never edits that source/object tree or the deployed initramfs.
"""
from pathlib import Path
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--objects", type=Path, required=True)
parser.add_argument("--baseline-ca", type=Path, required=True)
parser.add_argument("--libcxx-include", type=Path, required=True)
parser.add_argument("--xcb-include", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--wasm-opt", default="wasm-opt")
args = parser.parse_args()
obj, old, out = args.objects.resolve(), args.baseline_ca.resolve(), args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
entries = json.loads((obj / "clangd/compile_commands.json").read_text())
patches = Path(__file__).resolve().parent.parent / "firefox-patches"
units = [
    ("widget/gtk/nsFilePicker.cpp", "widget/gtk/Unified_cpp_widget_gtk2",
     "0005-wasm-aurora-file-picker.patch", ["nsFilePicker.cpp", "nsFilePicker.h"]),
    ("dom/html/HTMLInputElement.cpp", "dom/html/Unified_cpp_dom_html1",
     "0006-file-picker-mime-enumerator-fallback.patch", ["HTMLInputElement.cpp"]),
    ("xpcom/reflect/xptcall/md/unix/xptcall_wasm32.cpp",
     "xpcom/reflect/xptcall/md/unix/xptcall_wasm32",
     "0007-wasm-xptcall-prompt-arity.patch", ["xptcall_wasm32.cpp"]),
]
commands = []
for filename, unit, patchname, copies in units:
    entry = next(e for e in entries if e["file"].endswith(filename))
    source = Path(entry["file"])
    if not source.is_absolute():
        source = Path(entry["directory"]) / source
    sources = out / "source" / Path(filename).parent
    sources.mkdir(parents=True, exist_ok=True)
    for name in copies:
        shutil.copyfile(source.parent / name, sources / name)
    subprocess.run(["patch", "--batch", "-p1", "-d", str(out / "source"),
                    "-i", str(patches / patchname)], check=True)
    if Path(filename).name == "xptcall_wasm32.cpp":
        subprocess.run(["patch", "--batch", "-p1", "-d", str(out / "source"),
                        "-i", str(patches / "0008-wasm-xptcall-transfer-signatures.patch")],
                       check=True)
    output_unit = out / Path(unit).name
    if Path(unit).name.startswith("Unified_"):
        unified = (obj / (unit + ".cpp")).read_text()
        unified, count = re.subn(r'#include "[^\"]*/' + re.escape(Path(filename).name) + '"',
                                 '#include "' + str(sources / Path(filename).name) + '"', unified)
        assert count == 1
        output_unit.with_suffix(".cpp").write_text(unified)
    else:
        shutil.copyfile(sources / Path(filename).name, output_unit.with_suffix(".cpp"))
    command = shlex.split(entry["command"])
    assert command[1:4] == ["-o", "/dev/null", "-c"]
    command[2] = str(output_unit.with_suffix(".o"))
    command[-1] = str(output_unit.with_suffix(".cpp"))
    position = command.index("-I" + str(obj / "dist/system_wrappers")) + 1
    for include in (args.libcxx_include, args.xcb_include):
        assert include.is_dir(), include
        command[position:position] = ["-isystem", str(include.resolve())]
        position += 2
    commands.append((command, "compile-" + Path(unit).name, entry["directory"]))

def run(command, name, directory):
    (out / (name + "-command.txt")).write_text(shlex.join(command) + "\n")
    with (out / (name + ".log")).open("w") as log:
        env = os.environ.copy()
        env["TMPDIR"] = str(out)
        subprocess.run(command, cwd=directory, env=env, stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    print(name + " passed", flush=True)

for command, name, directory in commands:
    run(command, name, directory)
response = (old / "firefox-ca.list").read_text()
for _, unit, _, _ in units:
    original = "../../" + unit + ".o"
    assert response.count(original) == 1
    response = response.replace(original, str(out / (Path(unit).name + ".o")))
(out / "firefox-aurora.list").write_text(response)
command = shlex.split((old / "link-ca-command.txt").read_text())
command[command.index("@" + str(old / "firefox-ca.list"))] = "@" + str(out / "firefox-aurora.list")
command[command.index("-o") + 1] = str(out / "firefox-aurora-raw.wasm")
command.append("--strip-debug")
run(command, "link", obj / "browser/app")
run([args.wasm_opt, "--all-features", "--disable-compact-imports",
     "--pass-arg=max-func-params@23", "--fpcast-emu",
     str(out / "firefox-aurora-raw.wasm"), "-o", str(out / "firefox-aurora.wasm")],
    "fpcast", out)
run(["wasm-validate", "--enable-all", str(out / "firefox-aurora.wasm")], "validate", out)
print(out / "firefox-aurora.wasm")
