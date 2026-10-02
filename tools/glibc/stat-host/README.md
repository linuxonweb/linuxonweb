These controls run the real GNU public stat/stat64 functions through volatile
table calls in native Wasm and FPCAST23i64. Only the Linux statx transport is
synthetic. An independent JS UAPI fixture supplies inode/size/block counts
beyond32 bits, timestamps beyond2038 and before1900, nonzero nanoseconds and
device numbers at Linux encoding boundaries. Error cases leave output/canaries
unchanged and exercise GNU errno handling and negative-fd short circuit.

The linked15 objects are nine immutable GNU stat units, genuine public-header
references, actual GNU errno/errno-location/memset, genuine GNU-make makedev
and this owned probe. No stubs or unresolved-symbol suppression are used.
GNU sources/headers/compiler attempts and exact executable bytes are pinned.
This is synthetic conversion acceptance; real guest semantics remain separate.

Use a new ext4 task under /mnt/p6/build with all TMPDIR/TMP/TEMP/cache there.
Copy stat's config with only GLIBC_TASK changed; create object compiler/lower/
warnings links to the exact verified immutable compiler. Run build.py under
the frozen finite supervisor, then test.mjs with native and FPCAST modules plus
a new result path. Freeze only after both terminal build/test groups are empty.
Keep freezer output/supervision proof outside the immutable task.
