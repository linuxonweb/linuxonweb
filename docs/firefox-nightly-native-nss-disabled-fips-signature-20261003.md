# Native disabled-FIPS function signature — 2026-10-03

The real NSS header declares `sftk_FIPSEntryOK(PRBool rerun)`, but its
`NSS_FIPS_DISABLED` fallback defined a function without arguments. Native Wasm
requires exact function signatures. wasm-ld accepted the old link with a
signature mismatch warning and substituted an `unreachable` stub.

The narrow Linux/Wasm hook gives only that fallback the declared argument and
ignores it. It continues to return `CKR_DEVICE_ERROR`; FIPS stays disabled.
The enabled branch is byte-identical, and preprocessing with the Wasm selector
disabled produces identical old/new output.

Using the actual generated Nightly compiler flags, the patched object has
signature `(i32)->i32`; the original-source control has `()->i32`. A caller
includes the real `softoken.h`. The patched link has no signature mismatch,
validates, and returns error 48 for arguments 0, 1 and -1. The original control
validates but its caller traps at `signature_mismatch:sftk_FIPSEntryOK`.
These controls establish this fallback's ABI and policy, without TLS, FIPS or
browser acceptance.

[Evidence](evidence/firefox-nightly-native-nss-disabled-fips-signature-20261003.json)
pins original bytes, the recipe adapter and patch, actual compiler commands,
objects, modules, validator logs, execution and other-platform controls.
The independent Run55 binary/Rust copies remain in the task's
`run55-before-native-runtime-rebuild/manifest.json`. The genuine ordinary
Run56 rebuild is separate; program acceptance must reject every function
signature mismatch and audit the rebuilt Rust archive's native runtime owners.
