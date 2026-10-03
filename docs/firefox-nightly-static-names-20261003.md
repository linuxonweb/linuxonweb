# Nightly native static-library namespaces — 2026-10-03

The native Linux/musl Wasm browser links both Firefox's bundled PNG, Cairo and
Pixman and GTK's static copies. ELF normally separates these library symbols;
the static Wasm link exposes duplicate strong definitions. Namespace only the
actual collisions: 12 PNG symbols, 939 Cairo symbols and 81 Pixman symbols.
Other targets retain their original names and build behavior.

PNG and Pixman publish their small native namespace headers through their
normal exported configuration/public headers, so implementations and callers
agree. Cairo preincludes its namespace header using COMPUTED_CFLAGS and
COMPUTED_CXXFLAGS in a local defs.mk adapter. The first attempt used legacy
CFLAGS/CXXFLAGS that this build does not consume. Run37 corrected this, rebuilt
44 actual Cairo objects and eliminated all 939 Cairo collisions.

Two other static-link repairs give duplicate state/functions one owner. The
native browser retains the existing common RLBox TLS object and omits the
SoundTouch duplicate. Its SoundTouch Clear entry point receives a distinct
name. musl supplies epoll_create/ctl/wait; the native build omits Chromium's
duplicate epoll_sub.c while retaining its other epoll implementation.

mozgtk intentionally overrides XShmQueryExtension to return False. A native
static wrapper preserves that behavior without a duplicate X11 symbol.
--wrap=XShmQueryExtension applies only to firefox, plugin-container and
xpcshell. Actual make dry-link commands confirm that Firefox receives the
wrapper and gfxtest does not; a successful browser link is still pending.

Run38 stopped at its 20-minute build bound without compiler errors, after 168
existing objects were naturally rebuilt. All 3,011 expected native graph
objects remain present and the 552 earlier inttypes dependencies are complete.
Its successful Rust refresh changes 522 archive member names through Cargo's
crate fingerprints. Comparing every member's SHA256, size and native Wasm magic
with multiplicity proves all 7,101 member contents are unchanged. The initial
name-equality audit failed; the content audit establishes the precise difference.
The corrected independent build-boundary review passes 4,161 predicates.

The later scoped pixman, cairo and mozgtk target-objects phases all succeed
with four jobs, terminal/reaped handles and empty owned process groups. Actual
native object symbol inspection passes 161 predicates: 15 PNG, 44 Cairo and
31 Pixman objects contain every renamed implementation and have no remaining
strong-symbol overlap with their installed GTK counterpart libraries. The
SoundTouch, epoll, XShm wrapper and single TLS-owner inputs also pass. These
component builds establish link-input repairs, not full-browser acceptance.

Evidence is tools/nightly-musl/evidence/native-static-names.json. Its pinned
root reports live in /mnt/p6/build/firefox-nightly-musl-root-review-20261002:
static-names-review-run4.json (bafa1140449bfab1a84f1dcaa63100916dcedc8146ea77032276a9877cd0ffb7)
and full-boundary-run38-review-run2.json
(88c1b78e937f3b9c1a3f630d9c71bc49c87b81bc3392cdc81c2ca003a10ef64c).
Source backups, original failed Cairo flag evidence and all build outputs remain
preserved under the recovery task. Patch helpers are one-time applications to
the recorded pre-packet source; do not rerun them on this corrected tree.

Continue the natural shared Pixman-header dependency rebuild, then finish
linking and accepting the complete Nightly baseline. The separate full PBL/JIT
build, guest JIT acceptance, Firefox GPU acceptance and both authorized Sites
releases remain pending. Public v10 is unchanged.
