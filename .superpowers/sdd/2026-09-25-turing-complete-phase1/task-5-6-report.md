# Task 5+6 report — the `fuzz` and `custom` checkers

**Status: DONE** (one small follow-up noted for Task 8's content tests, see Concerns)

Worktree: `D:\Documents\turing-complete\.worktrees\phase1`, branch `phase1`.
Commit: **`e61d556` feat(levels): add the fuzz and custom checkers** (on top of
`3fc19cf`, which the controller landed in this worktree while I was working —
every RED/GREEN/full run below was made after it, so all evidence covers the
committed state).

Implemented as one change because both kinds add a variant to the same
`LevelCheck` union and both were delivering the same lesson: **a check that
compares nothing must not pass**. Both new kinds now fail loudly, with the
specifics, and neither can throw out of `runChecks` / `grade()`.

---

## 1. What was implemented

### `fuzz` — random vectors from a seeded PRNG (`src/levels/checks.ts`, `spec.ts`)

`{ kind: 'fuzz'; seed: number; rounds?: number; inputs; outputs }`.

* `inputs: Record<pinId, (sample: FuzzSample) => number>` — pure functions of
  the drawn sample, one per input pin, returning the value to drive.
* `outputs: Record<pinId, (inputs: FuzzVector) => number>` — pure functions of
  the driven vector, one per output pin, returning the expected value.
* Both maps must name **every** pin of the level and nothing else. A missing
  name, an unknown name and a non-function are `invalid` failures. This mirrors
  `truthTable`'s refusal to leave an output pin out, but as a *recorded* failure
  rather than a thrown `Error`: level data is untrusted and `grade()` runs on
  every board edit.
* Each round drives its vector through the existing `runRow` (reset, write,
  settle, read) at tick 0, exactly like a truth-table row; `ticksUsed` stays 0.
* **First failing round only.** The generator is lazy and the loop `break`s on
  the first failure: no later round can change the verdict, a wrong circuit
  normally disagrees on round 0, and the cap allows thousands of rounds —
  recording them all would put thousands of identical rows in the panel.
* The mismatch record carries the round in a **new `CheckFailure.round`** field
  (0-based), the driven vector in `inputs`, the per-pin expectation in
  `expected`, the circuit's values in `actual`, and a new
  **`CheckFailure.detail`** line (`round 7 of 128 (seed 24293)`). `round` is its
  own field rather than a key smuggled into `inputs`, because the failure panel
  renders `inputs` pin by pin.
* `detail` also names what a numeric record cannot: which pin returned a value
  that does not fit it, that an authored function threw, that a custom id is not
  registered, that an outcome was malformed.
* **Nothing is masked.** An input value that does not fit its pin is `invalid`
  rather than being silently dropped by `writeInput` (which would have compared
  the circuit against a vector it never saw); an expectation that does not fit
  its pin is `invalid` rather than being reduced modulo the width. An 8-bit sum
  is written `(a + b) & 0xff`.
* A throwing authored function (input or output) becomes an `invalid` failure
  naming the round, never an escaped `TypeError`.

**Wide expectations (the question the brief left open).** One whole number per
pin, whatever the pin width — the same value `LevelIo.readOutput` reads back,
which converts a byte-array port to a number (good to 2^53). So an 8-bit sum is
`(a + b) & 0xff`, a carry is `((a + b) >> 8) & 1`, and a 32-bit pin compares as
a plain number, with no packing and no byte arrays in level data. Documented on
`FuzzCheck.outputs` in `spec.ts`.

### The PRNG (my own, deterministic)

xorshift32, seeded from `check.seed` and from nothing else:

```ts
let state = (seed >>> 0) || 0x9e37_79b9;
state = (state ^ (state << 13)) >>> 0;
state = (state ^ (state >>> 17)) >>> 0;
state = (state ^ (state << 5)) >>> 0;
```

* The seed is coerced with `>>> 0`; a non-integer seed (or a missing one) is an
  `invalid` failure rather than a silent coercion.
* xorshift32's only fixed point is 0, so an all-zero seed is remapped to the
  golden-ratio odd constant. Without that, `seed: 0` would drive one vector
  `rounds` times while claiming to fuzz — mutation A proves the test catches it.
* Per round, in `spec.io.inputs` **declaration order** (never `Object.keys`
  order), each pin draws `next() % 2 ** width`, so a draw is already inside its
  pin's width and the natural input function `(sample) => sample.a ?? 0` always
  produces a drivable value. A pin wider than 32 bits can only use 32 bits of
  the stream; nothing this phase builds is wider than eight.
* Same seed ⇒ same vectors, proven across two independent constructions (two
  freshly built circuits, two freshly built specs) *and* pinned as literal
  golden vectors for seed `0x1234`.

### `rounds` default and cap

* `DEFAULT_FUZZ_ROUNDS = 64` — exported constant. Omitted `rounds` runs exactly
  64 rounds (asserted by counting calls, not by timing).
* `FUZZ_ROUNDS_CAP = 4096` — exported constant, a hard clamp, so no level data
  can hang the editor. `rounds: 10_000_000` runs exactly 4096 rounds (asserted
  by counting).
* Measured cost, `--reporter=verbose` (`task-5-6-green-focused-verbose.txt`):
  64 rounds ≈ 1 ms, 4096 rounds (8-bit level) 26 ms. That is the whole basis for
  the cap number: the worst case a level author can ask for is ~26 ms per fuzz
  check per board edit.
* `0`, a negative number, a fraction and `NaN` are **not** clamped: they are a
  hard `missing-vectors` failure (`expected {rounds: 1}` / `actual {rounds: 0}`,
  plus a `detail` line). A check that runs no rounds compares nothing — the
  `missing-rows` lesson.
* Same reason (`missing-vectors`) for the other vacuous shapes: a level with no
  input pins, a level with no output pins, an empty `inputs` map, an empty
  `outputs` map. Precedence is deliberate and documented in `planFuzz`: vacuity
  is reported before malformed declarations.

### `custom` — a registry, not inline code (`src/levels/custom/index.ts`)

```ts
export type CustomChecker = (io: LevelIo, spec: LevelSpec) => CheckOutcome;
registerCustomCheck(id: string, checker: CustomChecker): void
unregisterCustomCheck(id: string): boolean
getCustomCheck(id: string): CustomChecker | undefined
customCheckIds(): readonly string[]
```

* `{ kind: 'custom'; id: string }` in level data; the implementation lives in
  code, looked up by id in the module's `Map`. **The shipped table is empty, by
  design** — chapter 2 needs no custom checker, and shipping an uncalled one
  would be dead code. Chapter 3 registers its own by importing a module that
  calls `registerCustomCheck` for its side effect.
* Registration validates its arguments (non-empty string id, function body) and
  is idempotent: last registration wins, because Vite re-evaluates a
  self-registering module on every HMR edit and throwing on the second
  evaluation would break the dev server instead of catching anything.
* **An unregistered id is a hard `missing-check` failure** (`expected {id: 1}` /
  `actual {id: 0}` + detail naming the id). So is a function inlined in level
  data: the kernel refuses to call it ("custom check inlined a function in level
  data; name a registered id instead") and the test asserts the function was
  never called. Same for an empty/non-string id.
* **Outcome adoption.** `ticksUsed` is merged with `Math.max` (a checker owns
  its ticks — it is the only thing that knows how far it drove the circuit).
  Failure records are adopted **verbatim** (they are the checker's report; the
  kernel does not re-stamp `check`) via a loop, not `push(...)`, so a checker
  returning more records than the spread limit cannot raise a `RangeError`.
  `passed: false` with no records synthesizes one on the checker's behalf;
  `passed: true` alongside records fails safe (records kept, plus a record
  saying why). A `passed: true` / `failures: []` outcome passes — that is the
  checker's verdict.
* **Structural validation before adoption**: an object with boolean `passed`, an
  array `failures`, a non-negative integer `ticksUsed`, and each record shaped
  like a `CheckFailure` (string `check`, object `inputs`/`expected`/`actual`,
  finite `tick`, and a `reason` — when present — from the known union). Any
  violation is a recorded `invalid` failure naming the problem; the malformed
  records are *not* adopted, because the failure panel reads them.
* **A checker that throws becomes a recorded failure**, with `unstable` when the
  escaped error is the kernel's `UnstableCircuitError` (a checker calling
  `io.sim.settle()` on an oscillating circuit) and `invalid` otherwise —
  including non-`Error` throws. Unlike the outer `catch` (which still rethrows
  unknown kernel errors), this branch rethrows nothing: a checker's crash is the
  level's failure.

**How a custom checker reports ticks (the question the brief left open).** It
returns `ticksUsed` in the `CheckOutcome`, and `runChecks` folds it into the run
with `Math.max`, so `grade().metrics.tick` and the star rating see it. A crash's
failure record instead reports `io.sim.tickCount` — where the checker had got
to. Deliberately *not* overridden with the sim's counter: the escape hatch's
whole point is that the checker reports its own measurement, and a checker that
probes a circuit clock by clock may legitimately report fewer ticks than it
drove. (Consequence in Concerns.)

### The dispatch is now exhaustive

The `script` branch was the fall-through. It is now an explicit
`if (check.kind === 'script')`, and a final guard records an `invalid` failure
for any unknown kind (`unknown check kind "mystery"; this kernel cannot run it`).
That matters beyond tidiness: **before this change a `fuzz` or `custom` check
reached `check.steps` and threw `TypeError: check.steps is not iterable` out of
`runChecks`** — the Phase-0 escape-on-every-edit class of bug, which RED 2
captures in full.

---

## 2. What was tested, and the results

New file `test/levels/fuzz-custom.test.ts` (717 lines, **47 tests** — 21 `fuzz` +
26 `custom` as vitest counts the parameterised cases; the 20/27 split this
section was first written with was wrong, though its total was not. Fix round 1
takes the file to 862 lines / 67 tests, §8). I used the pre-approved separate
file because `checks.test.ts` (533 lines, four areas already) would have grown
past 850 lines. Every test goes through a real `LevelSpec` and a real compiled
circuit via `runChecks`/`grade` — no internal helper is imported or called
directly (nothing new is exported for testing except the two round constants and
the registry, and those are the level-facing API).

`fuzz` (21 tests at `e61d556`, 22 after fix round 1): correct 8-bit adder (`add8`,
8-bit `out` + 1-bit `carry`) passes, `ticksUsed` 0, `grade()` passes · wrong
circuit fails with exactly one failure, whose round is *independently recomputed*
as the first round whose vector disagrees, whose `inputs` is that round's vector,
and whose `expected`/`actual` are the per-pin values · same seed ⇒ identical
vector sequences across two independent constructions (and the sequence varies) ·
different seeds differ · golden first vectors for `0x1234` · `seed: 0` still
varies · default is exactly `DEFAULT_FUZZ_ROUNDS` · cap clamps to exactly
`FUZZ_ROUNDS_CAP` · `rounds` of 0 / -1 / 2.5 / NaN ⇒ `missing-vectors` (both
`runChecks` and `grade`) · empty `inputs` / empty `outputs` / no input pins ⇒
`missing-vectors` · missing pin function and unknown pin name ⇒ `invalid` ·
unpinnable input value ⇒ `invalid` naming pin and value · unpinnable expectation
⇒ `invalid` with the raw value in `expected` · throwing authored function ⇒
`invalid` naming the round · unstable circuit ⇒ `unstable` with `round: 0` in the
record.

**Correction (fix round 1, §8).** The list above originally ended the vacuity
shapes with "no output pins". That guard is real (`planFuzz`'s
`spec.io.outputs.length === 0` branch) but it had no test, so this section
claimed coverage that did not exist. The test was added in fix round 1, next to
its no-input-pins sibling, and each now asserts its own `detail` line so the two
cannot pass for each other's reason. Nothing else in this section changed.

`custom` (26 tests at `e61d556`, 39 after fix round 1): registry ships empty · a
registered checker is called once with `(io, spec)` and its outcome adopted (it
drives the level's pins itself, ticks twice, and `grade().metrics.tick` is 2) ·
its failure records adopted verbatim against a wrong circuit · unregistered id ⇒
`missing-check` (through both entry points) · inlined function refused, never
called · throwing checkers (`Error`, `TypeError`, `RangeError`) ⇒ `invalid`,
`grade()` does not throw · `UnstableCircuitError` ⇒ `unstable` · 13 malformed
outcomes (undefined, null, string, number, array, missing/non-boolean `passed`,
non-array `failures`, negative/fractional `ticksUsed`, null record, record missing
`actual`, unknown `reason`) ⇒ `invalid` with a case-specific fragment of the
reason, `grade()` does not throw · contradictory outcome (passed + records) fails
safe · failure-without-record gets a synthesized record · truth-table + fuzz +
custom in one spec all pass · unknown check kind ⇒ `invalid`, not a `TypeError`.

Results: **47/47 focused**, **422/422 full suite (17 files)** — `pnpm test`,
`pnpm exec tsc --noEmit` (clean) and `pnpm build` (vite ok) all exit 0. (Fix
round 1: 67/67 focused, 442/442 full, same three commands clean — §8.)

---

## 3. TDD evidence

**RED 1 — `task-5-6-red-1-load.txt`.** Command:
`node <node.exe> <pnpm.mjs> test test/levels/fuzz-custom.test.ts` with the
complete test file and no implementation.

```
❯ test/levels/fuzz-custom.test.ts (0 test)
 FAIL  test/levels/fuzz-custom.test.ts
Error: Cannot find module '../../src/levels/custom/index' imported from .../fuzz-custom.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

*Why expected:* the registry module, the `FuzzCheck`/`CustomCheck` variants and
the round constants did not exist yet, so the tests could not even load. This is
a real RED, but a thin one.

**RED 2 — `task-5-6-red-2-behaviour.txt`.** To make the RED behavioural, I then
added only the type union in `spec.ts`, the registry module (empty table) and the
two exported numeric constants — leaving `runChecks` untouched. Same command:

```
❯ test/levels/fuzz-custom.test.ts (44 tests | 43 failed) 36ms
TypeError: check.steps is not iterable          (repeated for every fuzz/custom test)
AssertionError: expected [Function] to not throw an error but
                'TypeError: check.steps is not iterable' was thrown
 Test Files  1 failed (1)
      Tests  43 failed | 1 passed (44)
```

*Why expected:* this is the defect the task is about. The dispatch fell through
to the script branch for both new kinds, so every fuzz and custom check threw
`TypeError: check.steps is not iterable` straight out of `runChecks` — and out
of `grade()`, i.e. on every board edit and keystroke. The single passing test is
"ships no custom checks of its own" (the empty registry is observable on its
own), which is correct. All 43 failures point at code that did not exist yet;
none of them was fixed by touching a test.

**GREEN — `task-5-6-green-focused.txt`, `task-5-6-green-full.txt`,
`task-5-6-tsc.txt`, `task-5-6-build.txt`.** After implementing the two branches
in `runChecks` (and the guard for unknown kinds):

```
 ✓ test/levels/fuzz-custom.test.ts (47 tests) 55ms     Test Files 1 passed, Tests 47 passed
 Test Files  17 passed (17)                            Tests 422 passed (422)
 tsc --noEmit: no output, exit 0
 vite build: ✓ built in 63ms
```

Two test-side adjustments were needed during the first GREEN run and are worth
stating plainly: the golden-vector test had placeholder values (filled in from
the first observed sequence — it is an explicit characterization pin, not a
derivation), and one `it.each` case threw a `RangeError` whose message the
assertion did not match.

**Mutation checks** (the project's "the reference must pass, the counterexample
must fail" rule). Six mutations were applied to the final `src/levels/checks.ts`,
run, and reverted byte-for-byte (SHA-256 verified identical before/after). Each
was caught by a named test:

| Mutation | Guards removed | Caught by |
|---|---|---|
| A `task-5-6-mutation-A-seed0.txt` | xorshift32 zero-seed remap | `varies the vectors for seed 0 …` (1) |
| B `task-5-6-mutation-B-rounds0.txt` | `rounds <= 0` refusal | `refuses a fuzz check with rounds=0/-1 …` (2) |
| C `task-5-6-mutation-C-malformed.txt` | custom outcome validation | all 13 malformed-outcome cases |
| D `task-5-6-mutation-D-rethrow.txt` | absorbing a checker's throw | 3 throwing checkers + `UnstableCircuitError` (4) |
| E `task-5-6-mutation-E-missing-check.txt` | unregistered-id refusal | `fails an unregistered id with missing-check …` (1) |
| F `task-5-6-mutation-F-round-dropped.txt` | the `round` field of a fuzz mismatch | `reports the failing round, its input vector, …` (1) |

Mutation C initially caught only 12 of 13 and exposed a weak assertion: the
malformed cases asserted `detail` contained `"malformed"`, which the checker's
own id (`malformed-…`) satisfied by accident. The table now carries a
case-specific fragment per row, and the re-run caught 13/13.

---

## 4. Log files (all in `.superpowers/sdd/2026-09-25-turing-complete-phase1/`)

| File | Contents |
|---|---|
| `task-5-6-red-1-load.txt` | RED 1: complete test file, no implementation (module-load failure) |
| `task-5-6-red-2-behaviour.txt` | RED 2: 43/44 failing behaviourally, `check.steps is not iterable` |
| `task-5-6-green-focused.txt` | GREEN focused: 47/47 |
| `task-5-6-green-focused-verbose.txt` | per-test timings (the 64 vs 4096 round measurement) |
| `task-5-6-green-full.txt` | GREEN full suite: 17 files, 422/422 |
| `task-5-6-tsc.txt` | `tsc --noEmit`, empty, exit 0 |
| `task-5-6-build.txt` | `pnpm build` (tsc + vite), exit 0 |
| `task-5-6-mutation-*.txt` | the six mutation runs, each with its failing tests |
| `task-5-6-commands.txt` | every command as run, in order |
| `task-5-6-commit-msg.txt` | the commit message |

---

## 5. Files changed (commit `e61d556`)

* `src/levels/spec.ts` (+94/-2) — `FuzzSample`, `FuzzVector`, `FuzzCheck`,
  `CustomCheck`, the widened `LevelCheck` union, `CheckFailure.round`,
  `CheckFailure.detail`, and the `'missing-vectors' | 'missing-check'` reasons.
* `src/levels/checks.ts` (+706/-20) — `DEFAULT_FUZZ_ROUNDS`,
  `FUZZ_ROUNDS_CAP`, `fitsPin`, `describeValue`, `describeError`, `numericOnly`,
  `unfitDetail`, `createFuzzRandom`, `planFuzz`, `fuzzVectors`, `failureIssue`,
  `outcomeIssue`, the `fuzz` and `custom` branches, the `script` branch made
  explicit, the unknown-kind guard, and `round`/`detail` in the `failure()`
  helper.
* `src/levels/custom/index.ts` (new, 73 lines) — the registry.
* `test/levels/fuzz-custom.test.ts` (new, 717 lines) — 47 tests.
* **Not touched:** `src/core/`, `src/ui/`, `src/app/`, `src/levels/content/`,
  `src/levels/grader.ts`, `src/levels/tables.ts`, `test/levels/checks.test.ts`.
  `.superpowers/.../progress.md` is left modified and uncommitted, as required.

---

## 6. Self-review findings (and what I did about each)

1. **The `script` branch was a silent fall-through** for any kind it did not
   know — the mechanism of the RED 2 defect. Made explicit, with a final
   unknown-kind guard that records an `invalid` failure. (Test: "fails loudly on
   a check kind this kernel does not know".)
2. **`seed: 0` was a silent degeneracy** in xorshift32 (a fixed point: one
   vector repeated `rounds` times). Remapped, and a test now pins it (mutation A
   proves the test bites).
3. **A weak assertion** in the malformed-outcome table (the id substring made
   `"contains malformed"` pass for the wrong reason) — caught by mutation C,
   fixed with per-case fragments.
4. **`push(...records)` could exceed the spread limit** for a checker returning
   a very large failure list — replaced with a loop (the same `RangeError`
   family as the Phase-0 defect).
5. **`describeValue` could itself throw** on a hostile/buggy object with a
   throwing `toString` while *building* a malformed-outcome failure — wrapped,
   and arrays now read as `an array of N` instead of `''`.
6. **`FuzzPlan & { kind: 'plan' }` was an awkward intersection** in
   `fuzzVectors`' signature — split into named `FuzzRun` / `FuzzIssue`.
7. **A wrong assertion of my own** in the new unstable-circuit test: the spec
   used the two-output check against the one-output level, which the new pin
   validation correctly rejected as `invalid`. That was the test being wrong
   (and a nice incidental confirmation that the pin-agreement check works);
   fixed by using the adder level.
8. **Message wording**: first drafts left 8 lines over 108 characters; `src/`
   has none (and no line-trailing `+` concatenation anywhere). Messages were
   shortened, and the two "does not fit its pin" sentences share one
   `unfitDetail` helper. `checks.ts` now has no line over 108.
9. **`round`/`detail` are attached only when present** — `exactOptional
   PropertyTypes` rejects an explicit `undefined` on an optional property, so
   `failure()` builds the record with conditional spreads.
10. Verified `import type { LevelIo } from '../checks'` in the registry is a
    type-only cycle (erased at runtime) and that `vite build` bundles cleanly.

---

## 7. Concerns and handoffs

1. **Task 8–11's content tests need a `fuzz` clause.** `ch1-part1.test.ts` and
   `ch1-part2.test.ts` have a "gives every level a check with something to
   compare" loop that knows only `truth-table` and `script`. Chapter 2's level
   tests should extend it (`rounds` a positive integer, every pin named) or the
   invariant will quietly not cover the new kinds. I did not touch those files
   (out of scope).
2. **The UI does not render `detail` (or `round`) yet.** `src/ui/truthTable.ts`
   shows `inputs`/`expected`/`actual` per pin, so a fuzz mismatch reads as a
   normal row (and a fuzz *malformed-check* failure reads as a row of zeros).
   The specifics are in the record and in the test output; showing `detail`
   would be a small, separate UI change (out of scope here). The reason strings
   are new, and the UI does not branch on reasons, so nothing regressed.
3. **The cap is a clamp, not an error.** A level asking for 10^7 rounds silently
   gets 4096. I chose that over refusing because over-cap is a performance
   guard, not a fail-open: the check still runs and still fails a wrong circuit.
   The alternative (a hard failure) would make such a level unpassable. If the
   controller prefers loud, this is a one-line change plus a test.
4. **A custom checker that always returns `passed: true` passes its level.** The
   kernel cannot tell that from a checker whose analysis succeeded. Reviewing
   custom checkers is part of reviewing the levels that name them; the kernel's
   contribution is refusing unregistered ids, malformed outcomes and crashes.
5. **Custom tick counts are trusted** (see §1) — a checker that under-reports
   `ticksUsed` under-reports its level's tick metric. I judged the checker to be
   the authority on its own measurement; if the controller disagrees, folding in
   `Math.max(io.sim.tickCount)` is a one-line change (I left the reasoning in a
   comment at the adoption site).
6. **`custom` has no shipped implementation and therefore no chapter-2 level
   exercises it end to end.** That is what ruling 8 asked for; the mechanism is
   covered by test-local fakes, including one that really drives the kernel's
   `LevelIo` (write, settle, read, tick) rather than returning a canned verdict.

---

## 8. Fix round 1 — report

**Status: DONE.** Commit **`e8ba629` fix(levels): close the fuzz/custom review
gaps**, on top of `0179378` (the controller landed its review/rulings ledger in
this worktree mid-round; every run below was made after it, and the change is
against `e61d556`). Worktree `D:\Documents\turing-complete\.worktrees\phase1`,
branch `phase1`. Four fixes and one documentation sentence; nothing the review
ratified changed — over-cap `rounds` still clamps silently, and a custom checker
still owns its `ticksUsed`.

### 8.1 What changed

**Fix 1 — the missing `outputs: []` test.** `planFuzz`'s "level has no output
pins" branch was real but untested, and §2 claimed it. Added
`refuses a fuzz check on a level with no output pins to compare against` next to
the no-input-pins case, and gave its sibling a `detail` assertion so the two
vacuity shapes cannot pass for each other's reason. §2 above is corrected in
place. (The guard itself is unchanged: this fix is a test, not behaviour.)

**Fix 2 — option (a): make the `custom` doc true.** `failureIssue` and
`outcomeIssue` now take the `LevelSpec` and validate each adopted failure record
*against the level*, not only for its own shape:

* every key of `inputs`, `expected` and `actual` must name a pin of `spec.io`
  (inputs ∪ outputs — the record is the checker's own report, so it may name a
  pin it drove as well as one it read);
* every value must be a finite number;
* the pre-existing checks (object shape, string `check`, finite `tick`, known
  `reason`) are unchanged.

A violation is a recorded `invalid` failure naming the field, the pin and the
value, and the record is not adopted. Before, the three fields were only checked
to be objects: an unknown pin id rendered as zeros beside the real pins, and a
`NaN` or a string rendered as whatever `String()` makes of it — a visibly wrong
row instead of a failed check. The two functions have exactly one caller
(`outcomeIssue`, in the `custom` branch), where `spec` was already in scope, so
nothing else changed shape. `custom` is symmetric with `fuzz` now: neither can
put a value the level cannot express into a failure record. Widths are
deliberately *not* checked — the brief's spec was "finite numbers", and an
out-of-range but finite number still renders and still fails loudly, so only
unrenderable data is refused.

**Fix 3 — `FAILURE_REASONS` derived, not duplicated.** `spec.ts` exports the
tuple (`export const FAILURE_REASONS = [ … ] as const`) and
`export type FailureReason = (typeof FAILURE_REASONS)[number]`;
`CheckFailure['reason']` is that type. `checks.ts` imports the array and its
hand-copied `readonly string[]` is gone. Same seven strings, same order, same
runtime shape; `FailureReason` is additive, so no other file changed. A reason
can no longer exist in the union but not in the array — which would have made
every checker using it report "malformed".

**Fix 4a — element-level guard.** The loop is now `for (const entry of
spec.checks)` and opens with:

```ts
if (!isRecord(entry) || typeof entry.kind !== 'string') {
  failures.push(unreadableCheckFailure(entry));
  continue;
}
const check: LevelCheck = entry;
```

so the first read of a `kind` happens after the guard — including the
`'error' in created` push, which sits outside the loop's `try` and reads `kind`
through `failure()`. A `null`/`undefined`/number/string entry, or one whose
`kind` is not a string, is a recorded `invalid` failure whose `detail` names what
was found (`check entry is null, expected an object with a kind` /
`check entry has kind=7, expected a string kind`). The record's own `check` field
states `'(none)'` (a cast, with a comment): it is typed as the union of kinds
this kernel knows, and this is exactly the case where level data named none of
them.

**Fix 4b — `outcomeIssue` inside the checker's `try`.** The call moved from after
the `catch` to inside it, so an outcome whose `passed` / `failures` / `ticksUsed`
accessor throws is recorded by the `custom` branch's own handler
(`invalid`, `custom check "x" threw TypeError: …`) instead of being rethrown by
the outer `catch` (which rethrows everything that is not an
`UnstableCircuitError`, a `CircuitValidationError` or a `RangeError`).
Boundary, stated rather than papered over: the validation reads each field once,
so an accessor that returns a good value and throws on a *later* read still
escapes — that needs getters whose behaviour changes between reads
(§8.5.3).

**The `CustomChecker` doc sentence.** `custom/index.ts` now says in as many words
that the returned tick count feeds the star rating and is therefore reviewed
together with the checker. The same block's failure-record bullet states what is
enforced (the level's pin ids, finite numbers) instead of what was hoped for.

### 8.2 Tests

`test/levels/fuzz-custom.test.ts`: **47 → 67 tests** (717 → 862 lines), 20 new,
all of them through `runChecks`/`grade` on a real `LevelSpec` and a real compiled
circuit, as the first 47 are. Grouping as vitest counts it: `runChecks / fuzz` 22,
`runChecks / custom` 39, `runChecks / unreadable check entries` 6 (new group).

| Fix | Tests added |
|---|---|
| 1 | `refuses a fuzz check on a level with no output pins to compare against`, plus a `detail` assertion on the no-input-pins sibling |
| 2 | 3 rows in the malformed-outcome table: unknown pin id, string value, `NaN` value |
| 3 | `adopts a failure record whose reason is %s` × 7 — one per `FAILURE_REASONS` entry, so the list that validation reads and the union the type declares are exercised together |
| 4a | `records a failure for … instead of throwing` × 5 (`null`, `undefined`, a number, a string, a non-string `kind`) + `guards the element before the no-circuit failure, which reads its kind too` |
| 4b | `records a failure when an outcome accessor for %s throws` × 3 (`passed`, `failures`, `ticksUsed`) |

The 4a ordering test pins the reviewer's exact point: its spec declares an input
pin four bits wide against an eight-bit pin in the circuit, so `createSim`
returns `missing-io` and the `'error' in created` push *is* taken — with a `null`
check entry. The guard therefore has to precede that push, not merely precede the
dispatch. (That the push really is taken, rather than the throw merely moving
into the `try`, was checked with a throwaway probe: the same spec shape with a
`script` check reports `missing-io` as its failure reason. The probe file was
deleted, not committed; the tree is clean.)

### 8.3 Evidence

**RED — `task-5-6-fix1-red.txt`.** The tests were written first. The first run
was a module-load failure (`TypeError: FAILURE_REASONS is not iterable`; fix 3's
export did not exist yet), so fix 3's export was added and the run repeated to
get a behavioural RED:

```
 ❯ test/levels/fuzz-custom.test.ts (66 tests | 11 failed) 441ms
       Tests  11 failed | 55 passed (66)
```

Those 11: the 3 new malformed-outcome rows (adopted instead of refused), the 3
hostile-accessor cases (a `TypeError` escaped `runChecks`), and the 5 unreadable-
entry cases (a `TypeError` out of `runChecks` for the `null`/`undefined` entries,
the wrong message for the rest). The no-output-pins test passed on that first
behavioural run, which is the point of fix 1: the guard was there, the test was
not.

**Mutation A — `task-5-6-fix1-mutation-A-element-guard.txt`.** The new element
guard was disabled (`if (false && …)`), the focused suite re-run, and the guard
restored byte-for-byte (SHA-256 `ACDB1034…04CB` identical before and after):

```
 FAIL  … > runChecks / unreadable check entries > records a failure for a null entry …
 FAIL  … > records a failure for an undefined entry …
 FAIL  … > records a failure for a number …
 FAIL  … > records a failure for a string …
 FAIL  … > records a failure for an entry whose kind is not a string …
 FAIL  … > guards the element before the no-circuit failure, which reads its kind too
      Tests  6 failed | 61 passed (67)
```

**GREEN.** `task-5-6-fix1-green-focused.txt`,
`task-5-6-fix1-green-focused-verbose.txt`, `task-5-6-fix1-green-full.txt`,
`task-5-6-fix1-tsc.txt`, `task-5-6-fix1-build.txt`:

```
 pnpm test test/levels/fuzz-custom.test.ts → Test Files 1 passed (1) | Tests 67 passed (67)        exit 0
 pnpm test                                → Test Files 17 passed (17) | Tests 442 passed (442)  exit 0
 pnpm exec tsc --noEmit                   → no output (log is 0 bytes)                            exit 0
 pnpm build                               → ✓ 34 modules transformed, built in 59ms               exit 0
```

These four logs were regenerated after the commit, on the clean tree at
`e8ba629` (`git status --porcelain` empty before and after), so they are
post-commit evidence rather than a dirty-tree run.

Exact commands, run from the worktree with the bundled runtime and each
command's combined stdout+stderr redirected (`*>`) to its log file:

```
& $node $pnpm test test/levels/fuzz-custom.test.ts
& $node $pnpm test
& $node $pnpm exec tsc --noEmit
& $node $pnpm build
```

`$node` = `C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`,
`$pnpm` = `…\dependencies\pnpm\bin\pnpm.mjs`. The `pnpm` on `PATH` is broken in
this image (its shim points at an empty `@pnpm/exe` directory), so the bundled
runtime is what every run above used — the same one round 1 used.

### 8.4 Files changed (commit `e8ba629`, on top of `0179378`)

* `src/levels/checks.ts` (+73/−21) — the element guard, `unreadableCheckFailure`,
  `failureIssue`/`outcomeIssue` taking `spec` and validating pins and values,
  `FAILURE_REASONS` imported from `spec.ts`, the `outcomeIssue` call moved inside
  the `try`.
* `src/levels/spec.ts` (+29/−14) — the `FAILURE_REASONS` tuple, `FailureReason`,
  and `CheckFailure['reason']` derived from it.
* `src/levels/custom/index.ts` (+7/−4) — the enforcement bullet, plus the
  star-rating sentence.
* `test/levels/fuzz-custom.test.ts` (+145) — the 20 tests above.
* **Not touched:** `src/ui/`, `src/core/`, `src/levels/content/`,
  `src/levels/grader.ts`, `src/levels/checks.test.ts`. `checks.ts` is 1133 lines
  now (was 1081); the file split is still recorded elsewhere and was not done
  here.

### 8.5 Self-review findings

1. `outputs: []` was indeed absent from the test file while `inputs: []` was
   present; the fix adds the test rather than editing the claim away, because the
   guard is real and a test is what keeps it real.
2. `entry.kind` narrows `entry` in a way TypeScript will not carry through the
   rest of the loop, hence the explicit `const check: LevelCheck = entry;` — a
   widening, not a cast, and the diff below it is untouched.
3. The residual 4b case: the branch's *later* reads (`result.ticksUsed`,
   `result.passed`, `result.failures`) are second reads of properties
   `outcomeIssue` already read. For plain data that is the same value; for a
   getter that changes between reads it is not, and that one still escapes. Left
   in, and written down, rather than defended against speculatively.
4. `describeValue` is reused for the new messages, so a hostile entry cannot make
   the *description* of the entry throw (round 1 §6.5's fix).
5. No line in any of the four changed files exceeds 108 characters (checked for
   the whole of `src/`: the only longer lines are pre-existing ones in files this
   round did not touch).
6. The `custom` reason table is a single `it.each` over the exported array, so if
   a reason is ever added to `FAILURE_REASONS` the suite gains a case for it
   automatically — the derivation in fix 3 is what makes that the same list the
   validator uses.

### 8.6 Concerns and handoffs

§7 stands, with these two notes for the next reader:

1. `'(none)'` in `unreadableCheckFailure`'s `check` field is the only failure
   record the kernel builds whose `check` is not a real kind. If the panel ever
   renders `failure.check`, that string is what it will show for an unreadable
   entry.
2. The three 4b tests cover accessors that always throw. An outcome whose getters
   are hostile only on a second read is the residual case in §8.5.3.

