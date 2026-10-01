# Sourced by tools/zink/link-wasm32.sh and tools/glgears/build-glgears.sh.
# B2c: Mesa override objects. Each tools/zink/patches/*.patch is a minimal hunk
# on one Mesa source file. The file is copied from the pinned Mesa tree, patched,
# and compiled with the exact ninja command of the original object (from
# compile_commands.json, depfile flags stripped). The object is linked ahead of
# the archives, so the unpatched archive member is never pulled. The Mesa
# source tree and ninja tree stay unmodified.
# usage: mesa_overrides MESA_SRC NINJA_BUILD_DIR OUT_DIR  -> fills array OVR
mesa_overrides() {
  local M=$1 BD=$2 OD=$3 P SRC BN CMD rc
  OVR=()
  for P in "$(dirname "${BASH_SOURCE[0]}")"/patches/*.patch; do
    [ -f "$P" ] || continue
    SRC=$(sed -n 's|^+++ b/||p' "$P" | head -1); BN=$(basename "$SRC"); BN=${BN%.*}
    mkdir -p "$OD/override/$BN" "$OD/obj"; cp "$M/$SRC" "$OD/override/$BN/" || return 1
    (cd "$OD/override/$BN" && patch -p0 --no-backup-if-mismatch "$(basename "$SRC")" < "$P") > "$OD/patch-$BN.log" 2>&1 \
      || { echo "== patch $P failed" | tee -a "$OD/steps.log"; return 1; }
    CMD=$(/usr/bin/python3 -c "import json,sys;print(next(e['command'] for e in json.load(open(sys.argv[1])) if e['file'].endswith('/'+sys.argv[2])))" \
      "$BD/compile_commands.json" "$SRC") || return 1
    CMD=$(printf '%s' "$CMD" | sed -e "s| -MD -MQ [^ ]* -MF [^ ]*||" -e "s| -o [^ ]* -c [^ ]*$| -o $OD/obj/ovr-$BN.o -c $OD/override/$BN/$(basename "$SRC")|")
    printf '%s\n' "$CMD" > "$OD/cc-ovr-$BN.command.txt"
    (cd "$BD" && eval "$CMD") > "$OD/cc-ovr-$BN.log" 2>&1; rc=$?
    echo "== cc-ovr-$BN rc=$rc" | tee -a "$OD/steps.log"; [ $rc -eq 0 ] || return 1
    OVR+=("$OD/obj/ovr-$BN.o")
  done
}
