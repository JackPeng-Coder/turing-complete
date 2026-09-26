# Task 7 Report: 评分器 (`src/levels/grader.ts`)

**Status:** DONE_WITH_CONCERNS (one brief-vs-toolchain conflict found and resolved; see "Issues")

**Commit:** `a216998` — `feat(levels): add grader with gate/delay/tick metrics and star rating`

## What I implemented

`src/levels/grader.ts`, exactly as specified in the brief (78 lines, no deviation):

- `Metrics` — `{ gate, delay, tick }`.
- `GradeResult` — `{ passed, metrics, score, stars, failures, issues }`.
- `SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const`.
- `scoreOf(m)` — `gate*1 + delay*4 + tick*8`.
- `gateCost(graph, registry)` — sums `def.cost` over instances, guarding with `registry.has(inst.def)` because `registry.get` throws on an unknown id. Sources (`const_on/off`) and level connectors (`level_input/output`) all declare `cost: 0`, so they fall out for free rather than by id special-casing.
- `starsOf(m, spec, passed)` — `0` when not passed; `1` when passed and the level declares no `threeStar`; otherwise `3` iff every *declared* target is met (`<=`, so beating a target counts); `1` otherwise. There is no 2-star tier.
- `grade(graph, registry, spec)` — validates once, and if any issue has `severity: 'error'` short-circuits to `{ passed: false, metrics: {0,0,0}, score: 0, stars: 0, failures: [], issues }` without calling `delayOf` (which assumes a validated graph). Otherwise it runs the checks, reads the three metrics (`gateCost`, `delayOf`, `outcome.ticksUsed`) and combines them.

Wiring notes for the next task: the level output is bound as instance id `OUT` (or `OUT_<pinId>`), inputs as `IN_<pinId>` with the pin id taken from `spec.io` — `bindLevelIo` in `checks.ts` owns that convention, `grader.ts` does not touch it.

## What I tested and the results

1. **Focused file** — `test/levels/grader.test.ts`, the brief's 12 tests verbatim (except one fixture line, see "Issues"): **12/12 passed**.
2. **Full suite** — `pnpm test`: **102/102 passed** across 7 files (90 before this task + 12 new). No existing test changed behaviour.
3. **Build** — `pnpm build` (`tsc --noEmit && vite build`): clean.
4. **Six throwaway contract probes** (temp file, run, then deleted — not committed, verified absent from `git status`), all green:
   - `gateCost` skips an unknown def instead of throwing (`nand` + `nope` → 1).
   - `grade` on a warnings-only half-built circuit (`dangling-input` only) does not throw, returns a finite score and 0 stars.
   - `delayOf` excludes a sequential element from the combinational path: `IN_a → delay_line → nand` yields `delay 1`, `gate 1` (a storage element costs no delay; its cost shows up in the tick metric).
   - A partially declared target binds only what it declares: `threeStar: { gate: 2 }` with `delay 99, tick 9` still yields 3 stars; `gate: 3` yields 1.
   - `scoreOf` is exactly the documented weighted sum.
   - The tick metric is the check outcome's tick count: a `script` check reaching tick 3 on a 0-gate pass-through circuit gives `tick: 3`, `score: 24`.

## TDD Evidence

**RED** — `node pnpm.mjs test test/levels/grader.test.ts`, after writing only the test file:

```
 ❯ test/levels/grader.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/levels/grader.test.ts [ test/levels/grader.test.ts ]
Error: Cannot find module '../../src/levels/grader' imported from D:/Documents/turing-complete/test/levels/grader.test.ts
 ❯ test/levels/grader.test.ts:6:1

 Test Files  1 failed (1)
      Tests  no tests
```

This is the expected RED for a not-yet-created module: the suite could not be collected at all, so every one of the 12 expectations was unexecuted. (The brief's Step 2 predicts exactly this failure.)

**GREEN** — same command after implementing `src/levels/grader.ts`:

```
 ✓ test/levels/grader.test.ts (12 tests) 27ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**Second RED (build)** — `pnpm build`, with the brief's test file as written:

```
$ tsc --noEmit && vite build
test/levels/grader.test.ts(85,54): error TS2379: Argument of type '{ threeStar: undefined; id: string; ... }'
is not assignable to parameter of type 'LevelSpec' with 'exactOptionalPropertyTypes: true'.
Consider adding 'undefined' to the types of the target's properties.
  Types of property 'threeStar' are incompatible.
    Type 'undefined' is not assignable to type '{ readonly gate?: number; readonly delay?: number; readonly tick?: number; }'.
[ELIFECYCLE] Command failed with exit code 2
```

**GREEN (build)** — with the fixture line changed (below): `✓ built in 83ms`, exit 0.

## Files changed

| File | Change |
| --- | --- |
| `src/levels/grader.ts` | New — the grader, 78 lines, verbatim from the brief. |
| `test/levels/grader.test.ts` | New — the brief's 12 tests; one fixture line rewritten (see below). |

Nothing else was touched: no `package.json` change (zero runtime deps preserved), no change to `spec.ts`, `checks.ts`, `graph.ts`, `net.ts` or any earlier task's test.

## Issues

### 1. The brief's test fixture does not type-check (resolved; assertion kept)

The brief's `starsOf` "no targets" test passes `{ ...andSpec, threeStar: undefined }` to a parameter typed `LevelSpec`. The brief's own `src/levels/spec.ts` (Task 6) declares `threeStar?: { … }`, and this repo sets `"exactOptionalPropertyTypes": true`, under which an explicit `undefined` is **not** assignable to an optional property. Vitest transpiles without type-checking so the suite passed, but `pnpm build` failed with TS2379 as shown above — i.e. the brief's test could not coexist with the brief's mandated build gate.

Which side expresses the intent: the brief's prose is "A level with no `threeStar` targets yields 1 star when passed" — the intent is a *spec that declares no targets*, and the explicit `undefined` was only a way of writing that. So I kept the side that carries meaning and changed only the spelling of the fixture:

```ts
// brief:  { ...andSpec, threeStar: undefined }
const { threeStar: _targets, ...noTargetSpec } = andSpec;
expect(starsOf({ gate: 99, delay: 99, tick: 9 }, noTargetSpec, true)).toBe(1);
```

The strong assertion (`.toBe(1)`), the metrics object and the `passed: true` argument are unchanged; nothing is cast and nothing is weakened. The alternative — loosening `LevelSpec.threeStar` to `… | undefined` in Task 6's `spec.ts` — was rejected as a broader change to a shipped interface that would make the optional field's contract weaker for every consumer just to accommodate one test line.

### 2. `grade` relies on its dependencies' never-throw contract (non-blocking, flagged)

Per the brief, `grade` calls `runChecks` and `delayOf` without a `try/catch`. Both are documented and tested as never throwing for the three cases the design decision names (empty circuit, unknown def, unstable circuit), and the tests confirm all three produce a `GradeResult`. I did **not** add a catch-all, because that would silently turn programming errors into a legitimate-looking 0-star grade and would deviate from the mandated code. Residual risk to be aware of in a later phase: `runChecks` rethrows anything that is neither `UnstableCircuitError` nor `CircuitValidationError`, so if custom-component expansion later introduces such a path inside `compile`/`settle`, `grade` (called on every keystroke) would throw. Today no player-reachable input does this — `compile` references no `customComponents`, and every base def writes values of its declared width.

### 3. Minor observations (no action taken)

- The fatal-issue short circuit reports `metrics: { 0, 0, 0 }` and `score: 0` rather than the partial circuit's real gate count. Brief-mandated and defensible (an invalid circuit never earns a score), but it means `metrics.gate` is not the gate cost while errors are present.
- For a valid circuit `validateGraph` runs twice per `grade` (once here, once inside each `compile` in `runChecks`). Linear and irrelevant at chapter-1 sizes; worth remembering if `grade` is ever called on every keystroke of a very large circuit (the 50 000-instance `validateGraph` test takes ~0.6 s).
- Observational, from probe 2: with no `OUT` instance present in the graph, `bindLevelIo` reads the level output as 0, so a truth-table row that *expects* 0 is satisfied by simply not wiring an output. Not a grader defect (Task 6 binding behaviour), but level authors should ensure at least one row expects 1 — the AND fixture already does.

## Self-review

Read back the full diff against the brief line by line: `src/levels/grader.ts` is character-for-character the brief's Step 3 listing; `test/levels/grader.test.ts` differs from Step 1 by exactly the one fixture line documented above plus its explanatory comment. Checked that no state is mutated (`grade` reads the graph only), that `delayOf` is unreachable when error-severity issues exist, that `starsOf` returns only `0 | 1 | 3`, and that `git status` is clean with no temporary probe file left behind. Line endings match the repo (`i/lf w/lf`, same as the previously committed sources).
