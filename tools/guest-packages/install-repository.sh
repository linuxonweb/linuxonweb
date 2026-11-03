#!/bin/sh
# Run from the repository root; the verified public directory contains no secrets.
set -eu
repo_root=$(pwd)
repo_dir=${1:-out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/public-repository}
case "$repo_dir" in /*) ;; *) repo_dir="$repo_root/$repo_dir";; esac
node_bin=$(command -v node)
systemd-run --user --unit=linuxonweb-astra-repository-20261103 --property="WorkingDirectory=$repo_root" --property=Restart=on-failure --property=RestartSec=5 --property=StartLimitIntervalSec=60 --property=StartLimitBurst=3 --property=MemoryMax=128M --setenv="LINUXONWEB_REPOSITORY_ROOT=$repo_dir" --setenv=LINUXONWEB_REPOSITORY_PORT=38100 "$node_bin" tools/guest-packages/repository-server.mjs
# The separately authorized route is read-only; the private desktop proxy is unchanged.
opentunnel route add 38100
