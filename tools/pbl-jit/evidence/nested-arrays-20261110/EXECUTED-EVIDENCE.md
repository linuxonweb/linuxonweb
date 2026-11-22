# Executed host evidence, preserved separately from the final candidate

The compiler in `host-1-exact-source-and-fixtures.tar.gz` has SHA256
`510906f035ed50da59f954f95ce799295292253caabc8f54776992babfffe3f6`.
All twelve source assets were recovered only after matching every byte hash
recorded before host-1 ran. Archive readback matches the source manifest and
every retained emitted fixture. This archive includes the first runner's known
sparse-array oracle bug and reproduces that failed whole-suite attempt; it is
not labelled a fully passing packet.

ASan/UBSan compilation and emission passed with empty stderr. The original
baseline passed 1,969 checks; the numeric nested suite passed 2,702 checks across
184 cases. The first array runner timed out after its unchanged 20-second limit.
A separate bounded trace identifies the final visited case as output index
2,147,483,647: the oracle traversed a huge sparse array after correct bailout.

The corrected oracle used sparse own keys and length, retaining full interpreter
resumption for huge and negative indices. Against exactly these retained emitted
modules, it passed 12,896 checks across 86 cases, five modules and six compiler
rejections in `array-oracle-2-owner-command.log`. That direct Node invocation did
not independently pin the revised runner before launch; the receipt and editing
history establish the executed correction, while the archive preserves only the
fully hash-matched first packet. Do not treat the archive's original runner as
that corrected runner.

These are host emitter/oracle results. They do not establish actual final159
bytecode eligibility, native Firefox execution, GC acceptance, or performance.
The final shared proof-walker source and its later strict resource failure are
recorded separately in the final candidate report. Earlier successful receipts
must never be relabelled as acceptance of that later source.
