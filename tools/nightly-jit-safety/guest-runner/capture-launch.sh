#!/bin/busybox sh
# This exact file is installed in fresh persistent home before boot. No pipes
# or rotated logs: every inherited stdout/stderr fd refers to the same file.
set -e
label=$(cat /home/admin/nightly-jit-safety/active-label)
case "$label" in ''|*[!A-Za-z0-9_-]*) exit 97;; esac
[ "${#label}" -le 64 ] || exit 97
base=/home/admin/nightly-jit-safety/$label
[ -f "$base/session.json" ] && [ ! -e "$base/firefox-launch.json" ] || exit 97
# The packaged BusyBox sh is hush, which has no set -u. Verify actual
# errexit and required-variable expansion before using the capture wrapper.
probe=${base?}/shell-probe.txt
: > "$probe"
if /bin/sh -c 'set -u' >> "$probe" 2>&1; then exit 97; fi
if /bin/sh -c 'set -e; false; echo PBL_ERREXIT_BROKEN' >> "$probe" 2>&1; then exit 97; fi
printf 'PBL_SHELL_CONTROL errexitNonzero=pass\n' >> "$probe"
if /bin/sh -c 'set -e; unset pbl_required; : "${pbl_required?PBL_REQUIRED_UNSET}"; echo PBL_REQUIRED_BROKEN' >> "$probe" 2>&1; then exit 97; fi
printf 'PBL_SHELL_CONTROL requiredNonzero=pass\n' >> "$probe"
grep -q PBL_REQUIRED_UNSET "$probe" || { cat "$probe"; exit 97; }
if grep -q 'PBL_.*_BROKEN' "$probe"; then exit 97; fi
/bin/sh -c 'set -e; value=ok; : "${value?}"; echo PBL_SHELL_STAGE required-positive; raw=$(cat /proc/$$/stat); echo PBL_SHELL_STAGE proc-read; tail=${raw##*) }; set -- $tail; printf "PBL_SHELL_PROC fields=%s inheritedPGID=%s inheritedSID=%s raw=%s\n" "$#" "${3?}" "${4?}" "$raw"; [ "$#" -ge 20 ]; echo PBL_SHELL_STAGE proc-tail; setsid /bin/sh -c "exit 0"; echo PBL_SHELL_STAGE setsid; ulimit -c 0; echo PBL_SHELL_STAGE core-limit; ulimit -f 2048; echo PBL_SHELL_STAGE file-limit; cat /proc/$$/limits' >> "$probe" 2>&1
# Select the equivalent setting from actual kernel byte limits, not shell units.
if grep -q '^Max file size[[:space:]]*1048576[[:space:]]*1048576[[:space:]]*bytes[[:blank:]]*$' "$probe"; then file_blocks=4096
elif grep -q '^Max file size[[:space:]]*2097152[[:space:]]*2097152[[:space:]]*bytes[[:blank:]]*$' "$probe"; then file_blocks=2048
else exit 97; fi
grep -q '^Max core file size[[:space:]]*0[[:space:]]*0[[:space:]]*bytes[[:blank:]]*$' "$probe" || exit 97
printf 'PBL_SHELL_PROBE errexit=pass required=pass procTail=pass setsid=pass fileBlocks=%s\n' "$file_blocks" >> "$probe"
ulimit -c 0
ulimit -f unlimited # Normal Firefox profile/cache writes; capture reader enforces its independent2MiB span.
export PBLJIT_OBSERVE=1 PBLJIT_LOG=0
: > "$base/observer.stderr"
# Task AutoConfig invokes the same privileged runner after real browser startup.
setsid /bin/firefox --no-remote --new-instance -profile /home/admin/.mozilla/firefox/http1-profile about:blank >> "$base/observer.stderr" 2>&1 &
child=$!
case "${child?}" in ''|*[!0-9]*|0) exit 98;; esac
# setsid executes asynchronously. Capture the established session rather than
# racing its brief inherited group before setsid runs.
i=0
while :; do
  raw=$(cat /proc/$child/stat) || exit 98
  tail=${raw##*) }
  set -- $tail
  [ "$#" -ge 20 ] || exit 98
  if [ "$3" = "$child" ] && [ "$4" = "$child" ]; then
    printf '%s\n' "$raw" > "$base/firefox-start.stat"
    break
  fi
  i=$((i + 1))
  [ "$i" -lt 40 ] || exit 98
  sleep 0.05
done
cat /proc/$child/limits > "$base/firefox-limits.txt"
printf '{"kind":"actual-owned-firefox-launch-v1","label":"%s","pid":%s,"observerEnabled":"1","logBudget":"0"}\n' "$label" "$child" > "$base/firefox-launch.json"
status=0
wait "$child" || status=$?
# All exact process-group descendants, including zombies, must drain naturally.
# The host independently parses every retained raw stat and checks the owner.
i=0
while :; do
  : > "$base/firefox-group-terminal.txt"
  for item in /proc/[0-9]*/stat; do
    [ -r "$item" ] || continue
    IFS= read -r raw < "$item" 2>/dev/null || continue
    tail=${raw##*) }
    set -- $tail
    [ "$#" -ge 20 ] || exit 98
    [ "$3" = "$child" ] || continue
    printf '%s\n' "$raw" >> "$base/firefox-group-terminal.txt"
  done
  [ ! -s "$base/firefox-group-terminal.txt" ] && break
  i=$((i + 1))
  [ "$i" -lt 100 ] || break
  sleep 0.1
done
empty=false
[ ! -s "$base/firefox-group-terminal.txt" ] && empty=true
printf '{"kind":"actual-owned-firefox-exit-v1","pid":%s,"status":%s,"reaped":true,"naturalGroupEmpty":%s,"forced":false,"polls":%s}\n' "$child" "$status" "$empty" "$i" > "$base/firefox-exit.json"
exit "$status"
