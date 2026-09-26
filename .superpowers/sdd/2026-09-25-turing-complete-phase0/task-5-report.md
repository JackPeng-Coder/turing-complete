# Task 5 report — 展开与仿真内核（`src/core/net.ts`、`src/core/errors.ts`）

- **Status:** DONE_WITH_CONCERNS（kernel is green; one deliberate design deviation from the
  brief's snippet, and several brief-vs-brief contradictions had to be resolved. Full
  evidence below.)
- **Commit:** `2648a4e feat(core): add netlist compiler and edge-triggered simulator`
  (3 files, 848 insertions; baseline `f35213b`)
- **Verification:** focused file 19/19, full suite **75/75**, `pnpm build` clean.

## What I implemented

### `src/core/errors.ts` (40 lines)
Brief Step 1 verbatim: `UnstableCircuitError` (`iterations`, `blame`, name set) and
`CircuitValidationError` (`issues`, name set), plus doc comments explaining when each is
raised. No other changes.

### `src/core/net.ts` (466 lines)
Public surface (all of it used or verbatim from the brief):

- `SETTLE_LIMIT = 512`.
- `Netlist`: `instanceCount`, `expandedCount`, `slotCount`, `drive`, `refs`,
  `inputBase(key)`, `outputBase(key)`, `instanceIds()`, `instanceDefs()`, `outputKeys()`.
  The brief names two different shapes for this interface (its header lists
  `expandedCount` + `instanceDefs()`, its Step 4 code has `instanceCount` + `instanceIds()`
  + `outputKeys()`); I implemented the union so Task 6 compiles against either spelling.
- `compile(graph, registry)`: fails on error-severity issues only, sizes the signal table
  from the circuit, allocates one slot per pin bit, resolves every input pin's driver slot,
  and ties the netlist to its private storage through a module-level `WeakMap`.
- `Simulation`: `reset()`, `settle()`, `tick()`, `read(base, width)`, `write(base, width, v)`,
  `tickCount`, `net` (+ `registry`).
- `delayOf(graph, registry)`: Kahn topological order + one relaxation pass.

Decisions that differ from the brief's Step 4 snippet, each forced by a defect that the
brief's own tests expose (empirical evidence in the RED section):

1. **`drive` starts at the identity, not at a shared zero slot.** Every unwired input pin
   therefore reads *its own* zero-initialised slot. The brief's shared `zeroSlot` makes all
   unwired inputs read one slot, so writing one of them writes all of them, and it also
   allocates an extra slot inside `compile` — which breaks the brief's own
   `slotCount === 3` assertion (it produced 4). Identity keeps `slotCount` equal to the
   pin bits and lets a level drive an unwired input directly.
2. **`inputBase(key)` returns the pin's *driver* slot** (its own slot when unwired, the
   driving output pin when wired). Task 6's `bindLevelIo` reads a level output through
   `net.inputBase('OUT.in')`; with the brief's own-slot version that read can only ever see
   0, because nothing writes an input pin's own slot once it is wired.
3. **Explicit table capacity** (`capacityFor`): exact pin-bit requirement + 25 % headroom,
   minimum 64. Task 2's ledger note is right — 20,000 two-input gates need 60,000 slots and
   the default 65,536 overruns on the first three-input gate. `alloc` still throws a named
   `RangeError` if the estimate were ever wrong.
4. **`settle()` evaluates every def that has an `evaluate`, storage elements included**,
   passing `this.#state[i]` as the third argument (and `undefined` for combinational defs),
   and **leaves a pin alone when the def produced no value for it**. Both halves are
   load-bearing: skipping sequential defs contradicts the storage contract the task fixed in
   Task 3, and publishing `out[p] ?? 0` for a def that writes nothing destroys
   `level_input`, which the level checker drives from outside.
5. **The sweep is parallel (Jacobi), not in-place (Gauss-Seidel).** All instances are
   evaluated against the values committed by the previous sweep; results are staged and
   committed together. Two reasons: an in-place sweep lets a ring of two inverters
   "converge" to a self-consistent-looking 1/0 pair and be reported **stable** (proved
   empirically below — the brief's own unstable-loop test does not throw under Gauss-Seidel),
   and a parallel sweep's result cannot depend on the order instances happen to sit in the
   document. Cost: `iterations` is the combinational depth, so a *purely combinational* chain
   deeper than ~511 gate levels would exhaust the cap and be misreported as unstable. That is
   unreachable in Phase 0 (the deepest chapter-1 reference solution is depth 4) and the 512
   cap is the spec's own number, but it is recorded below as a forward note.
6. **Change detection compares bits, not `PortValue`s.** The brief's local `portsEqual`
   cannot equate a number with the byte-array form of the same value (a 12-bit pin reads
   back as `Uint8Array`), so a stable wide circuit reports a change on every sweep and blows
   up as `UnstableCircuitError` after 512 iterations. Verified by a test that fails on the
   value-form comparison and passes on the bit comparison. Task 2's deferred
   `valuesEqual` asymmetry stays deferred for `checks.ts`; the kernel does not depend on it.
7. **Internals in a `WeakMap`** instead of a symbol property set with
   `Object.defineProperty`; same "netlist was not produced by compile()" error, no hidden
   field on a public object.
8. **`delayOf` details:** edges into *and* out of storage elements are dropped, so a
   storage node is a fresh source worth 0 on both sides (the brief only handled the source
   side and let a sequential *target* inherit the incoming delay — harmless today because
   every storage def costs 0, but wrong as soon as a storage def has a nonzero cost); the
   brief's `graph.instances[i]!.def && registry.get(...)` double lookup is replaced by one
   `registry.has` guard that degrades to cost 0 instead of throwing out of a metrics
   function; and the claim that "pure feedback loops were already rejected by validateGraph"
   is false (it emits a **warning**), so termination on a loop is real behaviour with a test.

## What I tested and the results

`test/core/net.test.ts` — 19 tests, all passing:

| Group | Tests |
|---|---|
| `compile` | one slot per pin bit (`slotCount === 3`); `refs` maps to the origin instance; invalid graph throws `/invalid/i`; signal table sized past the 65,536 default (16,500 × `and3` = 66,000 slots) and settles |
| `Simulation` | NAND truth table (all four rows); chain propagation in one `settle`; unwired input reads 0; cross-coupled-NAND ring throws `UnstableCircuitError` with `iterations === SETTLE_LIMIT` and the loop in `blame`; `delay_line` held loop publishes on the edge; **delay line holds its sampled value when its input changes** (restored — see below); externally driven `level_input` output survives a settle; level I/O by pin name (drive `IN_A`/`IN_B`, read through `OUT.in`) for all four AND rows; a feedback loop that a storage element breaks settles and toggles once per tick; a wide (12-bit) pin with a different read-back form settles instead of oscillating; `reset` clears state and `tickCount` |
| `delayOf` | longest path sums gate costs with sources free; a storage element breaks the path; a 30-stage diamond ladder (2^30 paths) returns 60 in microseconds; a combinational loop terminates and contributes no depth |

Full suite: **75 passed / 75** (was 56 before this task). `pnpm build` (`tsc --noEmit && vite build`): clean.

Test-file deviations from the brief, all preserving the stated intent:

- The brief's Step 2 probe (`expect(slotOf).toBeDefined()`) was not kept; the final Step 6
  block replaced it permanently, as the brief's own Step 6 instructs.
- Step 6's `propagates through a chain of gates` assertion corrected `0 → 1` and the wrong
  trailing comment deleted, as instructed.
- Step 6's `throws UnstableCircuitError for a combinational feedback loop` fixture **could
  not throw** even after fixing its wiring, so it was repaired (see concerns): the free
  input of both NANDs is now tied to `const_on`, making each gate an inverter.
- The plan's (but not the brief's) timing test `a delay line holds its sampled value when
  its input changes` was restored — it is the test that pins the storage contract, and the
  brief's Step 6 block had dropped it while still calling it the most important timing test
  in the phase.
- Added coverage the brief had none of: `delayOf` (a graded metric, previously untested),
  the table-capacity requirement, the Task 6 level-I/O binding path, and wide-pin read-back.

## TDD evidence

**RED 1 — the module does not exist** (`pnpm test test/core/net.test.ts`, Step 3 expectation
"无法解析 `../../src/core/net`"):

```
❯ test/core/net.test.ts (0 test)
FAIL  test/core/net.test.ts [ test/core/net.test.ts ]
Error: Cannot find module '../../src/core/net' imported from D:/Documents/turing-complete/test/core/net.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**RED 2 — the brief's own Step 4 snippet cannot pass the brief's own Step 6 tests.** I
transcribed the snippet literally (only adapting `evaluate(scratch, out, { tick })` to
Task 3's shipped 4-argument signature, which the snippet predates) and ran the final test
file against it: **7 failed | 9 passed (16)**. Every failure is a defect, not a test bug:

| Failing test | Observed | Root cause in the brief's code |
|---|---|---|
| `allocates one slot per bit of every pin` | `expected 4 to be 3` | the shared `zeroSlot` is allocated inside `compile`, inflating `slotCount` |
| `sizes the signal table … 65,536 default` | `RangeError: signal table is full: need 65537 slots, capacity is 65536` | default capacity, no explicit sizing |
| `evaluates a NAND for every input combination` | `nand(1,1): expected 1 to be +0` | writes to an unwired input pin are ignored: every unwired input reads the shared zero slot |
| `propagates through a chain of gates in one settle` | `expected +0 to be 1` | same shared-zero-slot cause (both writes went to dead slots) |
| `throws UnstableCircuitError for a combinational feedback loop` | `expected function to throw an error, but it didn't` | in-place (Gauss-Seidel) evaluation finds the spurious fixed point (1,0) of a two-inverter ring |
| `a delay line holds its sampled value when its input changes` | `expected +0 to be 1` | `out[p] ?? 0` publishes 0 for `level_input`, whose no-op `evaluate` writes nothing, so the clock edge samples 0 |
| `keeps an externally driven output (level_input) through a settle` | `expected +0 to be 1` | same as above — this is the exact path Task 6's `bindLevelIo`/`writeInput` uses |

**Two targeted discrimination checks** (temporary edits, both reverted; the committed file
contains only the final code):

- Replacing the bit comparison with the brief's value-form `portsEqual` makes the wide-pin
  test fail with `UnstableCircuitError: circuit did not settle after 512 iterations` on a
  stable 12-bit pass-through.
- The Gauss-Seidel result above is the second: with the corrected fixture (free inputs tied
  high) the loop still did not throw under in-place evaluation.

**GREEN** — final implementation:

```
 ✓ test/core/net.test.ts (19 tests) 108ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

```
 ✓ test/smoke/sanity.test.ts (1 test)   ✓ test/core/signal.test.ts (16 tests)
 ✓ test/core/registry.test.ts (24 tests) ✓ test/core/net.test.ts (19 tests)
 ✓ test/core/graph.test.ts (15 tests)
 Test Files  5 passed (5)      Tests  75 passed (75)
```

```
$ pnpm build      # tsc --noEmit && vite build
✓ built in 31ms
```

## Files changed

| File | Change |
|---|---|
| `src/core/errors.ts` | new, 40 lines (brief Step 1 verbatim + comments) |
| `src/core/net.ts` | new, 466 lines |
| `test/core/net.test.ts` | new, 342 lines (19 tests) |

`package.json` untouched — zero runtime dependencies. No temporary artifacts left in the
tree (`git status` is clean); the brief-literal transcription was overwritten before commit
and never staged.

## Self-review findings

- Re-read the committed diff: no `TEMP`/`TODO` markers, no dead code, comments are English
  and each non-obvious decision carries its reason.
- `#readInputs` truncates the scratch to the instance's pin count, so a 1-input gate can
  never read a value left behind by a 3-input gate. `settle()` clears the stage at entry, so
  a value staged by an aborted sweep cannot be committed later.
- `#publishState` maps state byte *p* to output pin *p*; only correct for one 1-bit output
  per state byte (`delay_line`, `mem1`). Already flagged in Task 3's ledger as the Phase 1
  publish-hook item; the doc comment repeats it rather than hiding it.
- `blame` is the whole circuit's origin ids, not just the loop — matches the brief, and the
  editor can narrow it later using `validateGraph`'s `feedback-loop` warning.
- Two spots where "throw" is louder than the brief: a malformed staged value throws
  `RangeError` from `assertWidth` (a def bug, not a circuit bug), and a netlist not produced
  by `compile` throws instead of crashing later.
- Reviewed the one inefficiency I introduced deliberately: `settle()` starts each *call* with
  an O(#output pins) stage clear, not each sweep, so the hot loop stays allocation-free for
  1-bit pins (no `Uint8Array` per read, no per-sweep array churn).

## Issues and concerns

1. **Design deviation — parallel (Jacobi) settle.** Deviation from the plan's phrasing
   "反复遍历所有元件（依赖顺序）… 写输出" (spec §, kernel section). I judged it necessary: the
   plan's own unstable-loop tests require a ring of inverters to be *detected*, and the
   in-place ordered sweep provably cannot detect a two-inverter ring. It also removes any
   dependence on document order. **Consequence to know about:** `SETTLE_LIMIT` now bounds
   combinational *depth*, not worst-case passes, so a purely combinational chain deeper than
   511 gates would raise `UnstableCircuitError` despite being acyclic. Chapter 1's deepest
   reference solution is depth 4; if a Phase 1 CPU level ever got that deep, the fix is a
   topological evaluation order (single pass for the acyclic part) or a larger cap — not a
   weaken-the-error change.
2. **The brief's unstable-loop fixture cannot throw, under any faithful kernel.**
   `nand(x, 0) = 1` for every `x`, so two cross-coupled NANDs with their free inputs
   unwired hold (1,1) — a genuine fixed point, stable under every evaluation scheme. I tied
   the free inputs high (each gate becomes an inverter) to preserve the test's stated intent.
   **This is the same defect in Task 6's plan fixtures** (`docs/.../2026-09-25-turing-complete-phase0.md`
   lines 2262–2272 and 2970–2978, both expecting `failures.some(f => f.reason === 'unstable')`):
   Task 6 must apply the same fix or those two assertions cannot pass against a correct kernel.
3. **Task 6 interface notes (verified against the plan's `checks.ts` code, not assumed):**
   - `net.inputBase('OUT.in')` returns the *driver* slot, so `bindLevelIo`'s
     `readOutput` sees the circuit's value; `net.outputBase('IN_<pin>.out')` is unchanged.
   - `level_input.evaluate` writes nothing, and the sweep leaves such pins alone, so
     `writeInput` + `settle()` (no tick) is the supported drive path.
   - `level_input.out` is declared width 1 in `BASE_DEFS`, so a future multi-bit level input
     cannot be driven through it (`write` would throw on the width). All Phase 0 level pins
     are 1-bit, and Task 9 already ruled multi-bit outputs become 4 × 1-bit pins.
   - Task 6's `andSolution()`-shaped fixture works end to end — I test that exact shape.
4. **Brief/plan count drift (cosmetic):** the brief's Step 5 says "3 passed" (the Step 2
   sketch has 4 tests) and Step 7 says "8 passed" (the Step 6 block has 9, the plan's has 10);
   the plan says 9. My file has 19 because it also covers `delayOf`, the capacity requirement,
   and the Task 6 binding path. The brief's Step 4 snippet also does not typecheck against
   Task 3's shipped 4-parameter `evaluate` signature, and its `settle()` skips sequential defs
   — the opposite of what this task's instructions say the corrected snippet should do.
5. **Minor, out of scope:** `validateGraph` has no `duplicate-id` check, so two instances with
   the same id collide silently in `compile`'s pin-name maps (they would also collide in
   `validateGraph`'s own `byId`). `addInstance`/`nextId` make it unreachable through the
   editor; worth a future `IssueCode` if documents can be imported.
