# Cloudflare deployment

This Worker serves the existing Linux WebAssembly browser runtime, X server,
Aurora desktop, and Firefox guest image. `/` opens
`/linux/index.html?firefox=1`. Existing `/linux/`, `/desktop/`, and `/upstream/`
routes are preserved. The legacy desktop page is retained as-is; the working
Linux/Firefox experience is the `/linux/` page.

## Build and deploy

Use Node.js 22 or newer. From the repository root:

```sh
cd web/cloudflare
npm ci
npm run build
# With a Cloudflare account already authenticated:
npm run deploy
```

`npm run dev` stages the current local artifacts and starts Wrangler on port
4183. The original Node dev server on port 4180 is independent.

Wrangler can authenticate through `npx wrangler login` or a
`CLOUDFLARE_API_TOKEN` environment variable and `CLOUDFLARE_ACCOUNT_ID`.
The Worker name is `linuxonweb`; `workers.dev` is enabled. No R2 bucket or
other storage service is required. Deployment is a single Worker version
with its static asset collection.

When deploying through an authenticated Cloudflare connector instead of local
Wrangler credentials, register `generated/upload-manifest.json` with the
`assets-upload-session` API. Save its result plus `accountId` to a private
temporary JSON file, then run:

```sh
node upload-assets.mjs /tmp/upload-session.json /tmp/upload-completion.json
```

The uploader uses only the short-lived asset upload credential and never logs
it. Attach the completion JWT to the script upload's `assets.jwt`, use the
bundled `dist/worker.js` as `main_module`, bind `ASSETS`, and set
`assets.config.run_worker_first: true` and `html_handling: "none"`. Remove
the completion file after publication. Account-wide API tokens are not needed
by the upload script.

## Runtime assets and reproducibility

`stage-assets.mjs` uses an explicit allowlist of the Linux page, its browser
JavaScript modules and xterm dependencies, kernel, two guest archives, and
the legacy desktop runtime. It does not publish source trees, archive
backups, development tools, tests, or unrelated dependencies. The script
copies the exact currently installed local runtime bytes, including local
uncommitted fixes; it does not rebuild or modify guest artifacts.

Cloudflare limits individual static assets to 25 MiB. The two larger guest
archives are divided into content-addressed pieces of at most 20 MiB.
The Worker streams these pieces in order at the original archive URL, so
the browser runtime needs no changes and never sees a chunk manifest.
Complete downloads use native stream piping; processing each buffer in
JavaScript exceeded the production CPU budget for the Firefox archive.
Source changes during a file copy abort staging. Staging is deterministic
for a fixed set of source bytes.

Generated and ignored output:

- `public/`: only deployable files, each at most 20 MiB.
- `generated/asset-manifest.mjs`: public route, MIME type, size, SHA-256, and
  ordered storage parts, imported by the Worker.
- `generated/upload-manifest.json`: static asset paths, 32-character MD5
  content keys, and sizes for Cloudflare's direct upload API.
- `generated/build-report.json`: exact source paths, sizes, SHA-256 values,
  and packaging totals. Preserve this alongside deployment evidence to
  identify the exact kernel and guest images in a release.
- `dist/`: Wrangler's compiled Worker from `npm run build`.

Reproduce a release by restoring the source files with the SHA-256 values
in that release's report, using the committed package lock, and running
`npm run build`. See `../linux/PROVENANCE.md` and the repository's guest
packaging tools for guest build provenance. Generated payloads are large
and intentionally excluded from Git.

For the mobile-keyboard release, `node refresh-frontend.mjs` updates only
`index.html`, `main.js`, and `mobile-keyboard.mjs` in the existing staged
snapshot. It verifies and preserves the deployed `e726ede…` Firefox and
`beea582…` plain guest archives, even if another local task has rebuilt the
source images. Follow with `npx wrangler deploy --dry-run --outdir dist`
to bundle without restaging. This release-specific refresh intentionally
rejects a different archive baseline; ordinary `npm run stage` snapshots
the current local runtime instead.

## Hosting behavior

The Worker applies COOP, COEP, and CORP headers so browser workers can use
shared WebAssembly memory. It implements the existing `/dns` and `/tcp`
network bridge using Cloudflare DNS-over-HTTPS and outbound TCP sockets.
Cloudflare's platform restrictions on outbound TCP destinations still
apply; remote sites may independently reject datacenter traffic.

The manifest is authoritative: missing artifacts remain HTTP 404, and
private or unstaged repository files cannot be fetched. Root archive
responses use their original byte lengths and MIME types.

References: [static asset limits](https://developers.cloudflare.com/workers/platform/limits/),
[direct asset uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/),
[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).

## Mobile keyboard

Select a text field in the Linux display, then tap **Keyboard** in the top
toolbar. The device's native keyboard sends text through the guest's evdev
input device. The compact control row provides Esc, Tab, Ctrl, Alt, and Enter;
Ctrl and Alt apply to the next key. **Hide keyboard** dismisses the input.
Composition previews stay local until committed, and guest shutdown releases
modifiers and disables the control. Physical phone keyboard presentation is
browser-controlled; automated validation covers mobile focus/input events
and text reaching the guest, rather than a physical iOS/Android keyboard.

`release.json` records the deployed asset hashes and both hosting versions.
Always compare its archive hashes with the accepted local candidates; a local
guest rebuild does not update the hosted snapshot until staging and publication.
The existing Sites project streams this Worker's runtime, so a Worker asset
release updates new boots on the same public Sites URL without changing the
Sites proxy source.
