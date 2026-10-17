#!/bin/bash
set -euo pipefail
[[ $EUID -ne 0 ]] || { echo 'Launch as user a, not root.'; exit 2; }
variant=${1:?baseline or candidate}
run_name=${2:?unique run name}
[[ "$variant" == baseline || "$variant" == candidate ]] || exit 2
[[ "$run_name" =~ ^[a-zA-Z0-9-]+$ ]] || exit 2
[[ "${DISPLAY:-}" == :13 && -r "${XAUTHORITY:-}" ]] || { echo 'Set DISPLAY=:13 and XAUTHORITY to the persistent display authority.'; exit 2; }
repo=$(git rev-parse --show-toplevel)
[[ "${STARTUP_JIT_FULL:-0}" == 0 || "${STARTUP_JIT_FULL:-0}" == 1 ]] || exit 2
[[ "${STARTUP_JIT_FULL:-0}" != 1 || -n "${STARTUP_JIT_ARM:-}" ]] || exit 2
if [[ -n "${STARTUP_SAFETY_ARM:-}" ]]; then
  [[ -z "${STARTUP_JIT_ARM:-}" && "${STARTUP_JIT_FULL:-0}" == 0 ]] || exit 2
  [[ -n "${STARTUP_SAFETY_LABEL:-}" && -r "${STARTUP_SAFETY_BUNDLE:-}" && "${STARTUP_SAFETY_BUNDLE_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || exit 2
fi
base=/mnt/p3/codex-build/gpt6-launch-runtime12
export TMPDIR="$base/t" TMP="$base/t" TEMP="$base/t"
mkdir -p "$TMPDIR"
[[ $(findmnt -n -o FSTYPE --target "$base") == btrfs ]] || exit 2
[[ $(df -B1 --output=avail "$base" | tail -1) -gt 21474836480 ]] || exit 2
lane=$(node "$repo/tools/startup-benchmark/gpt6-codex-lane.mjs" "${STARTUP_CPUS:-4}")
read -r cpus cpu_affinity cpu_quota <<< "$lane"
output="$base/$run_name"
scratch="$base/t/$run_name"
mkdir -m700 "$output" "$scratch"
truncate -s 1536M "$output/storage.ext4"
mkfs.ext4 -q -F -m 0 "$output/storage.ext4" >"$output/mkfs.log" 2>&1
sudo -n mount -o loop,nosuid,nodev,noexec "$output/storage.ext4" "$scratch"
device=$(findmnt -n -o SOURCE --target "$scratch")
unit="gpt6-launch12-$run_name-$BASHPID"
invocation=''
cleanup() {
  if [[ -n "$invocation" && "$(systemctl --user show "$unit" -p InvocationID --value 2>/dev/null)" == "$invocation" ]]; then
    systemctl --user stop "$unit" || true
  fi
  if [[ "$(findmnt -n -o SOURCE --target "$scratch")" == "$device" ]]; then sudo -n umount "$scratch"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM INT
sudo -n chown "$(id -u):$(id -g)" "$scratch"
node --input-type=module - "$repo" "$output" "$scratch" "$variant" "$cpus" <<'JS' >"$output/config.json"
const [repo, output, scratch, variant, cpus] = process.argv.slice(2);
const { pathToFileURL } = await import('node:url');
const { jitCaptureBounds } = await import(pathToFileURL(`${repo}/tools/startup-benchmark/gpt6-codex-jit.mjs`));
const { fullSafetyPlan } = await import(pathToFileURL(`${repo}/tools/startup-benchmark/gpt6-codex-safety.mjs`));
const jitArm = process.env.STARTUP_JIT_ARM || undefined;
const jitFull = process.env.STARTUP_JIT_FULL === '1';
const safetyArm = process.env.STARTUP_SAFETY_ARM || undefined;
const configuration = { repo, output, scratch, cpus: Number(cpus), ramMiB: process.env.STARTUP_RAM_MIB === undefined ? undefined : Number(process.env.STARTUP_RAM_MIB), seconds: safetyArm ? 150 : jitArm ? jitCaptureBounds(jitFull).observationSeconds : 90, jitArm, jitFull, jitIdentity: process.env.STARTUP_JIT_IDENTITY === '1', trace: process.env.STARTUP_TRACE === '1', timing: process.env.STARTUP_TIMING === '1', workerPool: process.env.STARTUP_POOL === '1', display: process.env.DISPLAY, xauthority: process.env.XAUTHORITY, candidate: variant === 'candidate', receipt: process.env.STARTUP_RECEIPT || '/mnt/p3/codex-build/gpt6-launch12/freeze-receipt.json', safetyArm, safetyLabel: process.env.STARTUP_SAFETY_LABEL,
  safetyBundle: safetyArm ? { path: process.env.STARTUP_SAFETY_BUNDLE, sha256: process.env.STARTUP_SAFETY_BUNDLE_SHA256 } : undefined };
fullSafetyPlan(configuration);
console.log(JSON.stringify(configuration, null, 2));
JS
service_seconds=170
[[ "${STARTUP_JIT_FULL:-0}" != 1 ]] || service_seconds=590
[[ -z "${STARTUP_SAFETY_ARM:-}" ]] || service_seconds=190
printf '%s\n' "$unit" >"$output/unit.txt"
systemd-run --user --unit "$unit" --wait --pipe --collect \
  -p "CPUQuota=$cpu_quota" \
  -p "RuntimeMaxSec=$service_seconds" -p TimeoutStopSec=5 -p KillMode=control-group \
  -p LimitFSIZE=2147483648 -p LimitCORE=0 \
  --setenv="TMPDIR=$scratch" --setenv="TMP=$scratch" --setenv="TEMP=$scratch" \
  /usr/bin/taskset -c "$cpu_affinity" /home/a/.config/nvm/versions/node/v22.22.2/bin/node \
  "$repo/tools/startup-benchmark/gpt6-codex-browser.mjs" "$output/config.json" \
  >"$output/owner.log" 2>&1 &
client=$!
for ((attempt=0; attempt<50; attempt++)); do
  invocation=$(systemctl --user show "$unit" -p InvocationID --value 2>/dev/null || true)
  [[ -z "$invocation" ]] || break
  kill -0 "$client" 2>/dev/null || break
  sleep 0.1
done
printf '%s\n' "$invocation" >"$output/invocation.txt"
result=0
wait "$client" || result=$?
sudo -n du -sb "$scratch" >"$output/profile-size.txt"
findmnt --target "$scratch" >"$output/mount.txt"
printf 'Launch probe exited %s: %s\n' "$result" "$output/report.json"
exit "$result"
