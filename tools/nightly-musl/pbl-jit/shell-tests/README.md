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

`arguments.js`, `checkops.js`, `iterops.js`, `trampentry.js`, `funcall.js`, `funapply.js` and `nest.js` have no `.expected` file: their whole stdout must be identical
across the three modes (tiers off, defaults, `PBLBC_HITS=2`).

`getters.js` and `getters2.js` (direct scripted-getter calls: receivers, realms,
compartments, Debugger, generator/async getters, GC, exceptions, getter
recursion) must give identical stdout in four modes: tiers off, `PBLBC_GETTER=0`,
defaults and `PBLBC_HITS=2`. In defaults the `PBLBC funcall:` stats line (printed
when `PBLBC_HITS` is set or `PBLBC_LOG` > 0) must show `getter_direct` > 0.

`deep.js` (deep recursion through f.call/f.apply, near-full stack plus native
recursion, generators, eval) must complete with identical stdout in defaults and
`PBLBC_HITS=2`. With tiers off or `PBLBC_FUNCALL=0 PBLBC_FUNAPPLY=0` it still loses
the browser thread: scripts that run in the C++ interpreter (tiers off rejects
scripts containing Throw; every script's first 10 calls are cold) nest
uncounted. Known limitation, not a regression.

`generators.js` (generators, async functions, for-of/spread over generators,
return/throw into generators, try/finally, yield*, recursion, early close) must
give identical stdout (same as node) in tiers off, defaults, `PBLBC_HITS=2`,
`PBLBC_RESUME=0 PBLBC_SYMBOL=0` and `PBL_GENRESUME=1 PBLBC_HITS=2`.

`supercall.js` (`super(...)` in derived constructors: multi-level chains,
base/derived return values, double/missing super, arrows, Reflect.construct
newTargets incl. bound/proxy/native, built-in and null/bound/proxy/function
superclasses, superclass change, exceptions, spread, recursion depth 200, eval)
must give identical stdout in four modes: tiers off, defaults, `PBLBC_HITS=2`
and `PBLBC_SUPERCALL=0`.
