#!/bin/sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
node_bin=$(command -v node)
state=${LINUX_PROGRESS_STATE:?Set LINUX_PROGRESS_STATE to a private directory outside public source}
unit_prefix=${LINUX_PREVIEW_UNIT_PREFIX:-linuxonweb-astra-preview}
mkdir -p "$state" "$state/tmp"
chmod 700 "$state"
systemd-run --user --unit="${unit_prefix}-desktop" --collect --property=WorkingDirectory="$project" --property=MemoryMax=512M --setenv=LINUX_WEB_PORT=3000 --setenv=TMPDIR="$state/tmp" --setenv=TMP="$state/tmp" --setenv=TEMP="$state/tmp" "$node_bin" web/desktop/dev-server.mjs
systemd-run --user --unit="${unit_prefix}-progress" --collect --property=WorkingDirectory="$project" --property=MemoryMax=256M --setenv=LINUX_PROGRESS_PORT=38080 --setenv=LINUX_PROGRESS_UPSTREAM_PORT=3000 --setenv=LINUX_PROGRESS_STATE="$state" "$node_bin" web/desktop/progress/server.mjs
