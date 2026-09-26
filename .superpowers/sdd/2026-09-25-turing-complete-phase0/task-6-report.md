# Task 6 report — 关卡规格与验证器 (`src/levels/spec.ts`, `src/levels/checks.ts`)

Commit: `111de70 feat(levels): add level spec, level IO binding and check runners` (parent `bda84a9`)
Branch: `master`. 3 files, +739 lines.

## 0. Preflight: the brief file did not exist

`D:\Documents\turing-complete\.superpowers\sdd\2026-09-25-turing-complete-phase0\task-6-brief.md`
was **absent**; the directory contained briefs for tasks 1–5 only. I generated it from the plan
with the repo's own tool:

```
& pwsh -NoProfile -File tools\sdd\task-brief.ps1 docs\superpowers\plans\2026-09-25-turing-complete-phase0.md 6
→ wrote ...\task-6-brief.md: 678 lines
```

So the brief I followed is the plan's `## Task 6` section, verbatim, plus the corrections in the
dispatch. `.superpowers/sdd/` is gitignored, so the generated brief is not part of the commit.

## 1. What I implemented

### `src/levels/spec.ts` (89 lines, plan-verbatim)
The level data vocabulary: `LocalizedText`, `PinSpec`, `TruthRow`, `TruthTableCheck`,
`ScriptStep`, `ScriptCheck`, `ConstraintRule` (`sum-equals` | `at-least`), `ConstraintCheck`,
`LevelCheck`, `LevelSpec`, `CheckFailure` (with the `reason` union incl. `missing-rows`),
`CheckOutcome` (with `ticksUsed`).

### `src/levels/checks.ts` (326 lines)
- `bindLevelIo(sim, net, spec): LevelIo` — binds named level pins to slots by the **connector
  instance id** convention: `IN_<pinId>` (`level_input`) for inputs, `OUT` (single output) /
  `OUT_<pinId>` (multi-output, with an `OUT.in` fallback) for outputs. Widths come from
  `pin.width`, never a hard-coded 1. Inputs are driven through
  `net.outputBase('IN_<pin>.out')` (writing through `inputBase` of a wired pin would target the
  driver's slot and be overwritten on the next sweep); outputs are read through
  `net.inputBase('OUT…​.in')`, which is the **driver** slot after Task 5's fix. A pin the
  circuit does not contain is skipped, so `writeInput` no-ops and `readOutput` returns 0.
- `runChecks(graph, registry, spec): CheckOutcome` — **one `compile` + one `Simulation` per
  check**, reused for every row. Truth-table rows, constraint enumeration and script steps all
  drive inputs into a fresh `io.reset()`. Never throws for a bad circuit: `compile` failures
  become an `invalid` failure up front, and `UnstableCircuitError` (which surfaces at the first
  `reset()`/`settle()`, not at construction) / `CircuitValidationError` are caught around the
  settle-driving calls and recorded as `unstable` / `invalid` failures. Anything else rethrows.
- `enumerateInputs`, `generateRows`, `countTicksUsed`, `export { formatPort }` as the plan
  specifies.
- A truth-table check with **no rows** is a hard failure (`reason: 'missing-rows'`), and — see
  §4 deviation 4 — so is a single row with no expected outputs.

## 2. What I tested

`test/levels/checks.test.ts`, 15 tests, all passing:

| Area | Tests |
|---|---|
| truth-table failure modes | empty circuit (no throw, fails); corrected unstable cross-coupled-NAND fixture (`unstable`, no throw); `missing-rows` for an omitted/empty `rows`; `missing-rows` for a row with no outputs; `invalid` for an unbuildable circuit (unknown def) with no throw |
| truth-table discrimination | AND-from-NAND+NOT passes all 4 rows; NAND-without-inverter fails row `(0,0)` with `inputs/expected/actual` = `{a:0,b:0}` / `{out:0}` / `{out:1}`; unwired `level_output` fails |
| generated rows | `generateRows` builds 4 rows that the correct solution passes and the NAND-only circuit fails |
| multi-output binding | half adder with `OUT_sum` + `OUT_carry` passes; an unwired `OUT_carry` fails |
| script | `const_on` → `delay_line` high at tick 2 passes with `ticksUsed === 2` (and `countTicksUsed` agrees); bare `const_on` fails the extra tick-0-low assertion |
| constraint | `sum-equals` accepts XOR (half-adder sum), rejects OR |

Commands and results:
- `pnpm test test/levels/checks.test.ts` → **15 passed**
- `pnpm test` → **6 files, 90 passed** (baseline before this task: 75)
- `pnpm build` → `tsc --noEmit` clean, `vite build` ✓

## 3. TDD evidence

### RED 1 — no implementation (module missing)
```
$ pnpm test test/levels/checks.test.ts
 ❯ test/levels/checks.test.ts (0 test)
 Error: Cannot find module '../../src/levels/checks' imported from .../test/levels/checks.test.ts
 Test Files  1 failed (1)      Tests  no tests
```

### RED 2 — conflict: the plan's `IN_A` fixture cannot bind (plan line 2300–2304)
Scratch test, plan-verbatim fixture (`addInstance(g, 'level_input', 0, 0, 'IN_A')`) while
`andSpec.io.inputs` are `a` / `b`, run against a plan-verbatim implementation:
```
A failures: [{"check":"truth-table","inputs":{"a":1,"b":1},"expected":{"out":1},"actual":{"out":0},"tick":0,"reason":"mismatch"}]
 FAIL  A: the plan-verbatim IN_A fixture cannot pass its own level
 AssertionError: expected false to be true
```
Why: `bindLevelIo` composes `IN_${pin.id}` = `IN_a`, so `writeInput('a')` finds no slot and
silently no-ops; both NAND inputs stay 0 for every row, so the "AND" outputs `nand(0,0)→1→not→0`
and only the `(1,1)` row is wrong. The plan's own Step 6 assertion
`expect(runChecks(andSolution(), …).passed).toBe(true)` is unsatisfiable with those ids.

### RED 3 — conflict: `evaluateRule`'s raw sum cannot satisfy the plan's own test
```
B failures: [{"check":"constraint","inputs":{"a":1,"b":1},"expected":{"out":2},"actual":{"out":0},"tick":0,"reason":"mismatch"}]
 FAIL  B: sum-equals vs a 1-bit half adder output
```
After correcting the fixture ids but leaving `evaluateRule` plan-verbatim, the full file was:
```
 ❯ test/levels/checks.test.ts (12 tests | 1 failed)
   × accepts a half adder sum built from XOR
 AssertionError: expected false to be true
```
Why: the row `a=1,b=1` makes `sum-equals` want `out = 2`, but `out` is a declared **1-bit** pin,
which can only hold 0/1 — no circuit, including the correct XOR the test demands, can satisfy it.

### RED 4 — conflict: `pnpm build` rejects the plan's `failure()` signature
```
$ pnpm build
src/levels/checks.ts(276,3): error TS2375: Type '{ … reason: "mismatch" | … | undefined; }' is
not assignable to type 'CheckFailure' with 'exactOptionalPropertyTypes: true'.
[ELIFECYCLE] Command failed with exit code 2.
```
Why: `reason?: …` makes `CheckFailure['reason']` include `undefined`, and
`exactOptionalPropertyTypes` forbids writing a possibly-`undefined` value to an optional property.

### RED 5 — the added row guard is a real assertion
With the new guard temporarily disabled (`&& false`):
```
 FAIL  > refuses a truth-table row that declares no output to compare
 AssertionError: expected true to be false
```
i.e. a correct AND solution "passed" a check that asserted nothing. Restored, it passes.

### GREEN
```
$ pnpm test test/levels/checks.test.ts
 ✓ test/levels/checks.test.ts (15 tests) 51ms
 Test Files  1 passed (1)      Tests  15 passed (15)

$ pnpm test
 ✓ test/smoke/sanity.test.ts (1)   ✓ test/core/signal.test.ts (16)
 ✓ test/core/registry.test.ts (24) ✓ test/levels/checks.test.ts (15)
 ✓ test/core/net.test.ts (19)      ✓ test/core/graph.test.ts (15)
 Test Files  6 passed (6)      Tests  90 passed (90)

$ pnpm build
✓ built in 49ms
```

## 4. Conflicts and deviations (all deliberate, all with evidence above)

1. **Fixture ids `IN_A`/`IN_B` → `IN_a`/`IN_b`** (the plan's own tests, 4 sites). The prose
   contract is `IN_<引脚名>` with the pin's *exact* id, and the ids are `a`/`b`. Three
   independent pieces of plan evidence agree with the contract, not the fixture: Task 8's
   `build()` generates `` `IN_${node.name}` `` from node names `'a'`, `'b'`, `'b3'`…; Task 8's
   level-1 hint says "实例名必须是 IN_a 和 IN_b"; Task 9's 4-output level wires `OUT_out3`…
   `OUT_out0`. The plan itself warns at line 2315 that the hand-written id must be written
   correctly. Kept the strong assertion (`passed === true`) and fixed the fixture.
2. **`sum-equals` reduces the sum modulo the output pin's width** (new `outputWidth()` helper,
   `evaluateRule(rule, inputs, width)`). This is the side that expresses the prose intent ("half
   adder sum", a pinned 1-bit output); the raw sum is unrepresentable in the declared pin. Both
   plan assertions are kept unchanged — XOR passes, OR still fails.
3. **`failure()` takes `NonNullable<CheckFailure['reason']>`.** Narrowest fix for RED 4; the
   public `CheckFailure` shape is unchanged. The alternative TS suggests (adding `| undefined` to
   the property) would weaken the interface, so I fixed the producer instead.
4. **Added a row-level `missing-rows` guard.** `compare()` returns "no mismatch" when `expected`
   has no keys, so an authored row `{ inputs, outputs: {} }` passed every circuit — the same
   hazard the Lead ruled on for an empty `rows` array, one level down. Scoped to truth-table
   rows, reuses the existing `missing-rows` reason, with its own test (RED 5). Revertable in one
   hunk if the Lead considers it out of scope.
5. **Test-file import fix:** added `type Graph` to the `src/core/graph` import, which the plan's
   corrected `andSolution(): Graph` needs (`tsc --noEmit` would otherwise fail TS2304).
6. **5 extra tests beyond the plan's 10** (15 total), no plan assertion weakened: `invalid`
   outcome, row guard, `generateRows` coverage, `countTicksUsed` assertion, and 2 multi-output
   tests pinning the `OUT_<pinId>` half of the convention that Task 9's level 12 depends on.

## 5. Files changed

- `src/levels/spec.ts` (new, 89 lines) — plan-verbatim.
- `src/levels/checks.ts` (new, 326 lines) — plan-verbatim except deviations 2, 3, 4.
- `test/levels/checks.test.ts` (new, 324 lines) — the plan's 10 tests with fixture fix 1, plus 5.
- Nothing else; `package.json` untouched (zero runtime dependencies preserved).

## 6. Self-review findings (not changed)

- `compare()`'s inverted return (true = mismatch) is plan-verbatim; I added a doc comment rather
  than renaming a private helper away from the plan.
- `'missing-io'` is still never produced (`createSim` only emits `unstable`/`invalid`) — kept per
  the ledger ruling "leave `missing-io` (used by `AttemptFail`)", but note that `AttemptFail`'s
  `missing-io` member is currently unreachable.
- **Residual vacuity gaps I did not guard**, because the reason vocabulary has no honest member
  and the plan mandates no guard: a level with `checks: []`, and a `script` check with
  `steps: []`, both pass every circuit. Recommend the Lead decide (a) whether a `missing-steps`
  reason should be added, and (b) whether a check-less level should be a hard failure.
- `enumerateInputs`/`generateRows` use `1 << pin.width` and `>>> offset`, so they are 32-bit
  bound. Unreachable in Phase 0 (every pin is width 1); forward note for the wide-port phase,
  alongside Task 2's deferred `valuesEqual` item.
- Script semantics: a step that omits an input drives **0** rather than holding the previous
  value. Unobservable in Phase 0 (levels 7–8 have no inputs), but a real gap for future
  multi-input scripted levels.
- `bindLevelIo`'s multi-output fallback to `OUT.in`: for a >1-output level that has no
  `OUT_<pinId>` connector but does have an `OUT`, every output pin would bind to the same slot.
  Unreachable in Phase 0; Task 9's level 12 creates `OUT_out0..OUT_out3`.
- `generateRows`, `countTicksUsed` and the `export { formatPort }` re-export have no Phase 0
  consumer. All are plan-mandated exports; the first two are now covered by tests, and
  `formatPort` is covered in `test/core/signal.test.ts`.
- Confirmed the "one compile per check" property by construction (`createSim` is called once per
  `spec.checks` entry, never per row), which is what Task 7's tick metric and level-12's 16-row
  table depend on.

## 7. Issues / concerns for the Lead

1. **The brief was missing** — I regenerated it from the plan (§0). If the intent was a
   pre-amended brief file with content the plan no longer holds, this task was implemented
   against the plan instead; the plan's Task 6 section does contain the two corrections named in
   the dispatch (fixed unstable fixture, `missing-rows`) plus the `IN_<pinId>` convention.
2. **Conflict 1 (`IN_A`) affects the plan, not just my test**: Task 7's `andSpec` fixture (plan
   line 2914) uses the same `IN_A`/`IN_B` ids and asserts a 3-star pass, so Task 7 will trip the
   identical RED unless its fixture is corrected the same way. Recommend fixing the plan before
   dispatching Task 7.
3. **Conflict 2 (`sum-equals`) is a semantics change to a public rule**: if the Lead intended
   `sum-equals` to mean "the output pin must hold the exact sum" (and therefore a `sum-equals`
   constraint is only legal on a wide output pin), the correct fix is instead to reject the rule
   at level-authoring time. No Phase 0 level uses `constraint` (level 12 uses a generated
   truth-table), so this is currently unobservable in shipped content.
4. My 15 tests replace the plan's expected count of 10 (plan Step 7 predicts "10 passed"); the
   plan's own Step 5 also predicts "2 passed" for a 3-test block, so those numbers were already
   drifting.

## Fix round 1

Commit: `4e1da35 fix(levels): absorb RangeError and reject unpinnable level inputs` (parent
`a216998`). 3 files, +108/-4. Branch `master`, working tree clean.

Scoped re-review findings: (1, Important) an exception could still escape `runChecks`, and
(2, documentation) the `TruthTableCheck.rows` doc comment stated the opposite of the enforced
behaviour. Both fixed in this round; nothing else from the ledger was touched.

### What changed

**Finding 1a — `writeInput` validates against the pin width before writing** (`src/levels/checks.ts`)

New private predicate `fitsPort(value, width)`, and `bindLevelIo`'s `writeInput` now returns
early when the value cannot be represented on the pin's **declared** width, so it never reaches
`Simulation.write` -> `setPort` -> `assertWidth`:

```ts
function fitsPort(value: number, width: number): boolean {
  try {
    assertWidth(value, width);
    return true;
  } catch {
    // `assertWidth` throws RangeError and nothing else; a value that does not
    // fit is data, not a bug.
    return false;
  }
}
```

Behaviour: **reject the write, do not clamp or mask it.** The pin keeps the zero default that
`reset()` established, which is the same "reads 0" behaviour `writeInput` already had for a pin
the circuit does not contain, so a bad authored value adds no new failure mode. Deterministic and
documented in the comment at the call site.

The predicate delegates to the kernel's exported `assertWidth` instead of re-deriving the bounds:
`fitsWidth` is not exported, and a local copy of `value >= 0 && value < 2 ** width` could drift
from the signal table's own rules (e.g. a future negative/two's-complement encoding) and silently
reject values the kernel would accept. One source of truth, by construction: everything rejected
here is exactly what would have thrown.

**Finding 1b — `RangeError` absorbed as `'invalid'`** (`src/levels/checks.ts`)

`runChecks`'s catch clause is now
`else if (e instanceof CircuitValidationError || e instanceof RangeError)`, still mapped to the
existing `'invalid'` reason. No reason-union member was added; `CheckFailure['reason']` in
`spec.ts` is unchanged.

**Finding 2 — `TruthTableCheck.rows` doc comment** (`src/levels/spec.ts`)

Rewritten to state the enforced behaviour: omitting `rows`, or passing an empty array, is a hard
`missing-rows` failure -- **not** "exhaustively enumerate every input combination" -- because a
table with no expectations would compare nothing and pass every circuit ever built, plus a pointer
that `generateRows` is how rows are *produced*. Swept `src/` for other comments claiming
enumeration on omission: none remain (`grep exhaustiv|enumerat` -> only the new comment, the
`enumerateInputs` identifier and `generateRows`' own "builds rows by enumerating" doc, which is
the different, legitimate thing). `enumerateInputs`/`generateRows` are unchanged and still covered
by the existing `generateRows` test; they have a real Task 8 role.

No `src/core/*` file was touched, no dependency or `package.json` change, and no existing
assertion was weakened.

### Covering tests — `test/levels/checks.test.ts`

New `describe('runChecks / malformed level data')`, 5 tests (the suite goes 102 -> 107):

| Test | Pins |
|---|---|
| `it.each([2, 0.5, -1, NaN])` "rejects an unpinnable authored input value (%s) instead of throwing" (4 tests) | truth-table row `{ inputs: { a: <bad>, b: 1 }, outputs: { out: 1 } }` on the 1-bit `a` pin: `runChecks` must not throw, `passed === false`, `reason === 'mismatch'`, `actual === { out: 0 }`. The `'mismatch'` + `{out: 0}` assertions are what pin *reject* over *clamp*: with the guard removed but the catch kept, the same spec degrades to `reason: 'invalid'` and the test fails |
| "classifies a RangeError raised inside a check as an invalid failure" (1 test) | Fix 1b. With `writeInput` guarded no authored value can reach `assertWidth`, so a test registry adds a `boom` def whose `evaluate` throws `RangeError`: `runChecks` must not throw and must report an `'invalid'` failure. Injection fixture, labelled as such in the test |

### Evidence

Command form (node/pnpm are not on PATH; `bare pnpm` is broken):

```
$node = 'C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
& $node $pnpm test test/levels/checks.test.ts
```

**RED — the new tests, before the fix.** The catch still rethrew `RangeError`, so the new cases
fail exactly on the escaped exception:

```
 ❯ test/levels/checks.test.ts (20 tests | 5 failed) 40ms
   ✓ runChecks / truth-table (5)
   ❯ runChecks / malformed level data (5)
     × rejects an unpinnable authored input value (2) instead of throwing 12ms
     × rejects an unpinnable authored input value (0.5) instead of throwing 2ms
     × rejects an unpinnable authored input value (-1) instead of throwing 1ms
     × rejects an unpinnable authored input value (NaN) instead of throwing 2ms
     × classifies a RangeError raised inside a check as an invalid failure 2ms
   ✓ truth-table discrimination (3)
   ✓ generateRows (1)   ✓ multi-output binding (2)   ✓ script check (2)   ✓ constraint check (2)

 FAIL  test/levels/checks.test.ts > runChecks / malformed level data > rejects an unpinnable authored input value (2) instead of throwing
AssertionError: expected [Function] to not throw an error but 'RangeError: value 2 does not fit a 1-…' was thrown
+ Received:
"RangeError: value 2 does not fit a 1-bit port width"
  (also, per case:)
"RangeError: port value must be an integer, got 0.5"
"RangeError: value -1 does not fit a 1-bit port width"
"RangeError: port value must be an integer, got NaN"
"RangeError: injected: value 2 does not fit a 1-bit port width"

 Test Files  1 failed (1)
      Tests  5 failed | 15 passed (20)
```

**Discrimination checks (each half mutated separately, then restored).** With the catch kept but
the `fitsPort` guard disabled (`if (false && !fitsPort(...))`):

```
 ❯ test/levels/checks.test.ts (20 tests | 4 failed)
     × rejects an unpinnable authored input value (2) instead of throwing
     × rejects an unpinnable authored input value (0.5) instead of throwing
     × rejects an unpinnable authored input value (-1) instead of throwing
     × rejects an unpinnable authored input value (NaN) instead of throwing
      Tests  4 failed | 16 passed (20)
```

i.e. half (a) is pinned independently: without it the bad value is still absorbed, but as
`'invalid'` with no `reads 0` semantics. With the guard kept and `RangeError` removed from the
catch:

```
 ❯ test/levels/checks.test.ts (20 tests | 1 failed)
     × classifies a RangeError raised inside a check as an invalid failure
      Tests  1 failed | 19 passed (20)
```

**GREEN — focused file, after the fix:**

```
 ✓ test/levels/checks.test.ts (20 tests) 23ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

**GREEN — full suite** (`& $node $pnpm test`):

```
 ✓ test/smoke/sanity.test.ts (1 test) 8ms
 ✓ test/core/signal.test.ts (16 tests) 32ms
 ✓ test/core/registry.test.ts (24 tests) 41ms
 ✓ test/levels/grader.test.ts (12 tests) 41ms
 ✓ test/levels/checks.test.ts (20 tests) 58ms
 ✓ test/core/net.test.ts (19 tests) 308ms
 ✓ test/core/graph.test.ts (15 tests) 548ms
 Test Files  7 passed (7)
      Tests  107 passed (107)
```

**`& $node $pnpm build`** (`tsc --noEmit && vite build`):

```
✓ 4 modules transformed.
dist/index.html                0.33 kB │ gzip: 0.26 kB
dist/assets/index-Cunev-bE.js  0.76 kB │ gzip: 0.48 kB
✓ built in 60ms
```

Diff: `src/levels/checks.ts` +34/-2, `src/levels/spec.ts` +11/-1,
`test/levels/checks.test.ts` +63/-1. No other file touched.

### Forward note (not changed, not in the review findings)

`bindLevelIo` takes the pin width from `spec.io` while the connector def's own pin is what the
signal table allocated (`level_input.out` and `level_output.in` are both width 1). A level that
declared `width: 2` for such a pin would still write past that slot; the validation added here
uses the declared width, as the finding specified. Unreachable in Phase 0 (every level pin is
1-bit) and untouched by this round -- recorded only so Task 9's wide-port successor sees it.
