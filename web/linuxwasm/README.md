# linuxwasm Worker

Cloudflare Worker serving the LinuxOnWeb dev tree (same URL layout as
`web/desktop/serve.mjs`). It is separate from the `linuxonweb` Worker in
`web/cloudflare/`.

- Small files (`web/desktop`, `web/linux`, minus tests, candidates and opt-in
  precompile artifacts) are staged into `public/` by `stage.mjs` and uploaded as
  Worker static assets (25 MiB per-file limit).
- The guest packages in `release-files.mjs` are not uploaded. Each request is
  streamed from `https://github.com/$RELEASE_REPO/releases/latest/download/<name>`
  (`RELEASE_REPO` is set in `wrangler.jsonc`). Range and HEAD are supported.
- `/dns` and `/tcp` are the guest network proxy copied from `web/cloudflare/worker.mjs`.

## Publishing new packages

Create a new release on `linuxonweb/linuxonweb` that contains all seven files
from `release-files.mjs` and mark it latest. `boot-manifest.json` and
`desktop-extras.cpio.json` pin the sha256 of the others, so they must come from
the same build. The site switches over on the next page load, with no Worker
redeploy. Before marking a release latest, boot it through a production browser
(AGENTS.md release gate).

```
gh release create build-<id>-<date> -R linuxonweb/linuxonweb --latest \
  boot-manifest.json vmlinux.wasm initramfs.cpio initramfs-firefox.cpio.gz \
  desktop-extras.cpio.json desktop-extras.cpio desktop-extras.cpio.gz
```

## Deploying the Worker

Redeploy only when the small web files or the Worker change:

```
web/linuxwasm/deploy.sh --dry-run   # stage + bundle
web/linuxwasm/deploy.sh             # needs wrangler login or CLOUDFLARE_API_TOKEN
```

Local test: `cd web/linuxwasm && node stage.mjs && ../cloudflare/node_modules/.bin/wrangler dev --port 8789`.
