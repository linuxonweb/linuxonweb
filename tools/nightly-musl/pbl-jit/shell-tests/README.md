# JS-shell stress tests for the run-time tiers

Run each file in the wasm JS shell once with all tiers off
(`PBLIC=0 PBLBC=0 PBLJIT=0`), once with defaults, and once with
`PBLBC_HITS=2`. The `ST ` / `ST2 ` lines must be identical in every mode and
equal to the `.expected` file; the last line (`ST end 1111` / `ST2 end 1111`)
proves the run did not hang.

- `tier-stress.js`: mixed tier coverage; section g runs `relazifyFunctions()`
  (a compacting GC) under a long method-tier activation. It hung before the
  global lexical environment was reloaded at each GetGName.
- `compaction-stress.js`: shrinking GCs and relazification while method-tier,
  IC and loop-tier code is live on the stack (globals, callee chains, shape
  guards, constructors, arrays, for-of, closures, try/catch).

`arguments.js` has no `.expected` file: its whole stdout must be identical
across the three modes (tiers off, defaults, `PBLBC_HITS=2`).
