#!/bin/bash
# Stage the small web files and deploy the linuxwasm Worker.
# Needs Cloudflare auth: `wrangler login` once, or CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID)
# in the environment or in ~/.ssh/apienv/cloudflare.env.
# Usage: deploy.sh            stage + deploy
#        deploy.sh --dry-run  stage + bundle only
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${LINUXWASM_WORK:-/mnt/p3/codex-build/claude-fable-20261124}
mkdir -p "$work/tmp"
export TMPDIR=$work/tmp TMP=$work/tmp TEMP=$work/tmp WRANGLER_SEND_METRICS=false
[ -f ~/.ssh/apienv/cloudflare.env ] && { set -a; . ~/.ssh/apienv/cloudflare.env; set +a; }
wrangler=$here/../cloudflare/node_modules/.bin/wrangler
cd "$here"
node stage.mjs
if [ "${1:-}" = --dry-run ]; then
  exec "$wrangler" deploy --dry-run --outdir "$work/linuxwasm-dist"
fi
exec "$wrangler" deploy
