# Aurora Files bridge for Firefox Wasm

`../firefox-patches/0005-wasm-aurora-file-picker.patch` routes the Wasm/X11
Firefox GTK picker to `/bin/aurora-files --picker-service`. Native Firefox is
unchanged. Init starts that resident service as the desktop user after X is up.
This avoids unsupported fork/exec paths and never delegates an upload to a host
browser picker: returned paths identify actual files in the Linux guest.

The service owns the X selection `_AURORA_FILE_PICKER_SERVICE`; Firefox creates
an unmapped request window on its own X connection. It sets
`_AURORA_FILE_PICKER_REQUEST` to `UTF8_STRING`, format 8, with trailing-NUL fields:

```
1\0mode\0initial-directory\0title\0default-filename\0filter-globs\0
```

Mode is `open`, `multiple`, `directory`, or `save`. The direct `ClientMessage`
`_AURORA_FILE_PICKER` uses format 32 and data `[request-window, 1, parent-window,
0, 0]`, with event mask zero. The service writes `_AURORA_FILE_PICKER_RESULT`
on that request window, also UTF8_STRING/8:

```
accept\0/absolute/path\0[/another/path\0...]
cancel\0
error\0message\0
```

Firefox polls every 100 ms without blocking its UI loop, bounds the property
read to 1 MiB, validates complete NUL framing, absolute paths, readable regular
files for uploads, directories for folder selection, and file multiplicity.
It creates normal `nsIFile`/file URIs so Gecko performs its ordinary upload read.
Errors, service selection loss and malformed replies resolve as cancellation.
Patch `0006-file-picker-mime-enumerator-fallback.patch` also checks failed/null
MIME extension enumerators during HTML `accept` filter setup, falling back to
the primary extension. This prevents a null dereference when a MIME provider
does not supply an enumerator; it is independent of the Aurora wire protocol.
This is a defensive fix: single/MIME and multiple HTML uploads both passed on
the original Aurora bridge after the isolated development server was stabilized.
Patch `0007-wasm-xptcall-prompt-arity.patch` extends the existing i32/pointer
XPT incoming stubs from eight to twelve arguments, matching the outgoing
invoker. Gecko's folder-upload confirmation has ten inputs plus a result
pointer and otherwise returns `NS_ERROR_NOT_IMPLEMENTED`; the repair restores
the actual confirmation dialog. Runtime evidence before this fix reported
`PromptCollection.sys.mjs:153: NS_ERROR_NOT_IMPLEMENTED [nsIPromptService.confirmExBC]`
after selecting a nonempty directory. Context, optional-argc, i64, and floating-point
signatures remain excluded. No confirmation is bypassed.
Firefox Close destroys the request window; the service dismisses the dialog.
Requests are isolated by X window ID. The service rejects concurrent requests
with a `busy` error. Save replacement returns Gecko's `returnReplace`; the
Files UI owns overwrite confirmation. Firefox's GTK default-extension property
was already unused; the supplied default filename is preserved as-is.

## Rebuild from the preserved working Firefox object tree

Run from the repo root (adjust cache paths if moved):

```sh
python3 web/linux/firefox-shims/build-aurora-file-picker.py \
  --objects /mnt/p6/project/linux/.cache/firefox-fresh-obj-20260924-071600 \
  --baseline-ca /mnt/p6/project/linux/.cache/gtk-icon-bypass-20260925/x11-detect \
  --libcxx-include /mnt/p6/project/linux/.cache/libcxx-wasm-abi-20260925/include/c++/v1 \
  --xcb-include /nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0/include \
  --output /mnt/p6/project/linux/.cache/aurora-picker-rebuild
```

The script copies and patches `nsFilePicker.cpp/.h` and `HTMLInputElement.cpp`,
compiles the GTK2 and DOM HTML1 unified units plus `xptcall_wasm32.cpp`, and
reuses the working CA link response with exactly those three objects replaced. It preserves the existing
16 MiB stack and shared-memory ABI, runs Binaryen fpcast emulation, and validates
Wasm. No class data members are added,
so previously compiled factory allocations remain ABI-compatible. Source,
objects, runtime archives and the deployed kernel remain untouched. The result
is `OUTPUT/firefox-aurora.wasm`; commands and logs are retained beside it.

The existing CA/profile, TinyX keyboard, bundled-font, and devpts init overlay
must be preserved when packaging. Test the candidate on an isolated server
before replacing the live archive. `web/linux/tests/file-picker.html` exercises
actual guest file bytes, multiple files, folder selection, cancellation and a
save link. A valid Wasm module alone is not sufficient runtime verification.
