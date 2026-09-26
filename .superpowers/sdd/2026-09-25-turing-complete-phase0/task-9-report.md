# Task 9 report — 第 1 章第 7–12 关内容

Status: **DONE_WITH_CONCERNS** (all gates green; four brief-vs-test conflicts resolved and
reported below, plus one design note for the controller)

Commit: `ae41b06 feat(levels): add chapter 1 levels 7-12 with reference solutions` (tree clean)

## Note on the brief

`task-9-brief.md` **does not exist** in `.superpowers/sdd/2026-09-25-turing-complete-phase0/`
(the directory holds briefs 1–8 and reports 1–8 only). I implemented Task 9 from the plan's
own Task 9 section, `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md:3608-4026`,
which contains the same code blocks, level table and reference topologies, and treated the
dispatch prompt's "Interfaces from earlier tasks" + "Design decisions already made" sections
as authoritative where they differ. Two of the plan's Task 9 amendments recorded in
`progress.md:73` were already present in the plan text (the tick-0/1 low assertion for level 8
and `delay` 2 for level 11); the rest of the conflicts below are new.

## What I implemented

- **`src/levels/content/ch1/part2.ts`** — `CH1_PART2`, six levels, indices 7–12, all copy
  original and verbatim from the plan (zh + en name/brief/hint), each with one check that has
  rows or steps, a `threeStar` target and (except 11–12) a reward.
- **`src/levels/content/index.ts`** — `ALL_LEVELS = [...CH1_PART1, ...CH1_PART2]`, which is what
  `src/levels/index.ts`'s `LEVELS`/`LEVEL_ORDER`/`getLevel`/`levelsOfChapter` export.
- **`test/levels/ch1-part2.test.ts`** — 29 cases mirroring Task 8's structure: structure/order,
  component gating over the *whole* chapter, "every check has something to compare", six
  reference solutions at 3 stars, "reference solutions are buildable from the palette they are
  graded against", five plausible wrong circuits, empty circuit fails all six levels, and the
  whole-chapter registry assertions.
- **`test/levels/ch1-part1.test.ts`** — scoped its two registry assertions to part 1's half
  (necessary; see conflict 3).

Levels as shipped (metrics = the reference solution's actual `grade()` metrics):

| id | check | reference topology | target | metrics | reward |
|---|---|---|---|---|---|
| `ch1-07-always-on` | truth-table, 1 row | `const_on` → `OUT` | 0/0/0 | 0/0/0 | `delay_line`, `xor` |
| `ch1-08-second-tick` | script, 4 steps | `const_on` → `delay_line` → `delay_line` → `OUT` | 0/0/**3** | 0/0/3 | `and3` |
| `ch1-09-xor-gate` | truth-table, 4 rows | `n1=nand(a,b)`, `n2=nand(a,n1)`, `n3=nand(b,n1)`, `n4=nand(n2,n3)` → `OUT` | 4/3/0 | 4/3/0 | `or3` |
| `ch1-10-bigger-or-gate` | truth-table, 8 rows | `or(a,b)=o1`, `or(o1,c)=OUT` | 6/4/0 | 2/2/0 | `xnor` |
| `ch1-11-bigger-and-gate` | truth-table, 8 rows | `and(a,b)=a1`, `and(a1,c)=OUT` | 4/2/0 | 2/2/0 | — |
| `ch1-12-binary-racer` | truth-table, 16 rows, 4 output pins | `b3→OUT_out3`, `b2→OUT_out2`, `b1→OUT_out1`, `b0→OUT_out0` | 0/0/0 | 0/0/0 | — |

Level 12 uses per-pin `OUT_<pinId>` instance names (`OUT_out3`…) and `IN_<pinId>` inputs, never
the bare-`OUT` fallback; that the reference passes all 16 rows proves every pin is bound to its
own signal (an unbound pin would read 0 and fail the row where its bit is 1).

## Conflicts found, and which side I implemented

Each was reproduced as a failing test **before** any fix.

**1. Level 8's palette offered `delay_line`, which no earlier level unlocks (RED).**
`ch1-08` lists `delay_line` in `allowedComponents`, but part 1's rewards are
`nand, not, and, or, nor, const_on, const_off` and nothing in the plan ever rewards
`delay_line`. The gating rule ("a level may only offer parts an earlier level rewarded", enforced
by Task 8's test and by Task 10's palette derivation) and the level-8 data cannot both hold.
*Implemented:* the gating rule — `ch1-07` now rewards `['delay_line', 'xor']`. Level 7 is level
8's only predecessor, so it is the only place the unlock can come from; this is the same shape as
the Task 8 ruling that seeded `const_on`/`const_off` as starters because level 1 had no
predecessor. `xor` stays at level 7 (see note 1 in Concerns).

**2. Level 8's three-star `tick: 2` was unearnable (RED: `metrics={"gate":0,"delay":0,"tick":3}`
— 1 star).** The mandated corrected script check asserts the output at ticks 0, 1, 2 **and 3**,
and `ticksUsed` is the highest tick the check drives, which is monotonic and independent of the
circuit — so *every* graded circuit reports `tick: 3`. A target of 2 could never be met.
*Implemented:* fixed the **target** to 3, exactly as the task instructs for an unreachable
target, and kept the strong 4-step assertion. What actually pins the two-tick lesson is the
check: the last step is the "…and stays high from tick 2 onward" assertion, and a one-delay-line
circuit is still low at tick 2 and fails (asserted by the wrong-circuit test). Dropping the
tick-3 step to rescue the number 2 was the alternative; rejected because it deletes the
persistence assertion the design decision explicitly calls for.

**3. Step 4 (wire `content/index.ts`) breaks Task 8's own registry test (RED).**
`ch1-part1.test.ts` asserted `LEVEL_ORDER` equals part 1's six ids and
`levelsOfChapter(1)` equals `[1..6]`; after appending part 2 these become 12-element
expectations. *Implemented:* scoped those two assertions with
`LEVEL_ORDER.slice(0, CH1_PART1.length)` / `levelsOfChapter(1).slice(0, CH1_PART1.length)` — the
same strictness about order and ids (part 1 must be the chapter's prefix), without pinning the
chapter's total size, which is not part 1's business. `ch1-part2.test.ts` owns the
whole-chapter assertions (`LEVEL_ORDER` = all 12 ids, `levelsOfChapter(1)` = indices 1..12,
`getLevel` resolves both halves). This required touching a file outside the brief's two-file
list; nothing was deleted or weakened.

**4. Two expectation lambdas in the plan do not compile (RED: `tsc` TS18048 ×2, TS2322 ×4),
so the plan's own `pnpm build` gate could not pass.** `noUncheckedIndexedAccess` makes an input
record lookup `number | undefined`: bitwise `a ^ b` is rejected, and `({ b3 }) => b3` is not a
`number`. *Implemented:* the level's own prose — `(a === b ? 0 : 1)` for "high when the inputs
differ" and `b3 ?? 0` for the nibble forward (an absent bit reads low). The generated truth
tables are byte-for-byte the same, and the `?? 0` is a no-op at runtime.

No engine, kernel, fixture or grader file was touched: this is data + tests only, as the
"level content is data" constraint requires.

## TDD evidence

### RED 1 — the plan's data vs its own test

```
$ node .../node.exe .../pnpm.mjs test test/levels/ch1-part2.test.ts
 ❯ test/levels/ch1-part2.test.ts (29 tests | 5 failed) 53ms
 FAIL  ... > chapter 1 levels 7-12 > gates every part behind a component unlocked earlier
 AssertionError: ch1-08-second-tick offers locked component delay_line:
                 expected false to be true // Object.is equality
 FAIL  ... > reference solutions pass with three stars > ch1-08-second-tick
 AssertionError: metrics={"gate":0,"delay":0,"tick":3}: expected 1 to be 3
 FAIL  ... > the chapter 1 registry > orders the whole chapter by level id
 FAIL  ... > the chapter 1 registry > resolves a level from either half of the chapter
   Error: unknown level: ch1-07-always-on
 FAIL  ... > the chapter 1 registry > lists chapter 1 as all twelve levels
   AssertionError: expected [ 1, 2, 3, 4, 5, 6 ] to deeply equal [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …(2) ]
 Test Files  1 failed (1)
      Tests  5 failed | 24 passed (29)
[exit code: 1]
```

Why these failed: (a) the gating walk starts from the four-member starter set and finds
`delay_line` unrewarded before level 8; (b) the reference solution passes all four steps but
reports `tick: 3 > 2`, so `starsOf` returns 1 — the target, not the circuit, was wrong;
(c)–(e) `content/index.ts` had not been wired yet, which is exactly what Step 4 changes.

### RED 2 — after wiring `content/index.ts`

```
$ node .../pnpm.mjs test
 ❯ test/levels/ch1-part1.test.ts (34 tests | 2 failed)
 ❯ test/levels/ch1-part2.test.ts (29 tests | 2 failed)
 FAIL  ch1-part1.test.ts > the level registry > orders chapter 1 by level id
   AssertionError: expected [ 'ch1-01-crude-awakening', …(11) ] to deeply equal [ …(5) ]
 FAIL  ch1-part1.test.ts > the level registry > lists a chapter by number
   AssertionError: expected [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …(2) ] to deeply equal [ 1, 2, 3, 4, 5, 6 ]
 FAIL  ch1-part2.test.ts > … > gates every part behind a component unlocked earlier
 FAIL  ch1-part2.test.ts > reference solutions pass with three stars > ch1-08-second-tick
 Test Files  2 failed | 7 passed (9)
      Tests  4 failed | 166 passed (170)
[exit code: 1]
```

### RED 3 — the build gate

```
$ node .../pnpm.mjs build
src/levels/content/ch1/part2.ts(123,53): error TS18048: 'a' is possibly 'undefined'.
src/levels/content/ch1/part2.ts(123,57): error TS18048: 'b' is possibly 'undefined'.
src/levels/content/ch1/part2.ts(214,27): error TS2322: Type 'number | undefined' is not assignable to type 'number'.
src/levels/content/ch1/part2.ts(215,27): error TS2322: …
src/levels/content/ch1/part2.ts(216,27): error TS2322: …
src/levels/content/ch1/part2.ts(217,27): error TS2322: …
[ELIFECYCLE] Command failed with exit code 2.
```

### GREEN

```
$ node .../pnpm.mjs test test/levels/ch1-part2.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)

$ node .../pnpm.mjs test          # full suite, from a clean tree, after the commit
 Test Files  9 passed (9)
      Tests  170 passed (170)     # 141 baseline + 29 new

$ node .../pnpm.mjs build
✓ built in 75ms                   # tsc --noEmit && vite build
```

Exact metrics per level were verified with a throwaway probe (deleted before commit), e.g.
`ch1-08 … passed=true stars=3 metrics={"gate":0,"delay":0,"tick":3}`,
`ch1-09 … passed=true stars=3 metrics={"gate":4,"delay":3,"tick":0}` (exactly the target, so the
4-NAND route earns 3 stars), `ch1-11 … metrics={"gate":2,"delay":2,"tick":0}` (delay exactly at
the corrected target of 2). Unlocked set after the whole chapter:
`and, and3, const_off, const_on, delay_line, level_input, level_output, nand, nor, not, or, or3,
xnor, xor` — every part any level offers.

## Files changed

| File | Change |
|---|---|
| `src/levels/content/ch1/part2.ts` | new, 230 lines — levels 7–12 |
| `src/levels/content/index.ts` | appends `CH1_PART2` to `ALL_LEVELS` |
| `test/levels/ch1-part2.test.ts` | new, 217 lines — 29 cases |
| `test/levels/ch1-part1.test.ts` | registry assertions scoped to part 1's half (conflict 3) |

## Self-review findings

- Read the full diff (`git show HEAD`) against the plan's Step 2/3/4 code and checked each
  reference topology against its truth table through the grader (the oracle), not by hand.
- Every part2 level has ≥1 check with ≥1 row/step (structurally asserted), so none passes
  vacuously — the `checks: []` hazard recorded in `progress.md:310`.
- Gating is validated over the **whole** chapter, not just part 2: level 8's `delay_line` and
  levels 9–11's gates come from part 1, so a part-2-only walk would silently pass a locked
  palette. `STARTER_COMPONENTS` is duplicated from part 1's test with a pointer comment; see
  Concerns.
- Empty circuits fail (not throw) on all six levels, including the script level and the
  multi-output level; the four wrong circuits are rejected for behavioural reasons (verified
  that each fails on a row/step a correct circuit passes), not for wiring errors.
- Level 12's four output pins are each exercised: 16 rows and a pass-through reference mean a
  pin that fell back to a shared `OUT` or read 0 could not pass.
- No `package.json`, engine, kernel, fixture or grader edits; source is UTF-8, comments English.

## Concerns / issues

1. **`ch1-09`'s palette offers `xor`, so the level is solvable with one part** (probe:
   `ch1-09 single-xor-part: passed=true stars=3`). Kept verbatim because part 1 ships exactly the
   same convention — level 6 (the NOR level) offers `nor`, which level 5 rewards — and because the
   brief's palette is explicit data. Worth a controller ruling: if the XOR lesson must be built
   from NANDs, remove `'xor'` from `ch1-09`'s `allowedComponents` (a one-line data change; the
   gating walk stays green) or move the `xor` reward to level 9's own rewards.
2. **Level 8's `threeStar.tick = 3` no longer expresses latency**, only "the check drives three
   ticks". The latency bound lives in the check. If the star system ever prices latency (rather
   than check length) for script levels, this target should be revisited — `ticksUsed` is not a
   circuit property here.
3. **`STARTER_COMPONENTS` is duplicated** in `ch1-part1.test.ts` and `ch1-part2.test.ts`.
   `progress.md:386` says Task 10 exports the real constant for the palette; when it lands, both
   tests should import it so the palette and the gating tests cannot drift.
4. Levels 11 and 12 reward nothing. Correct for this slice (nothing follows level 12 in Phase 0
   and level 12's palette only needs parts unlocked by level 10), but Task 10's
   `unlockedComponents` derivation will therefore be unchanged by the last two levels.
5. `test/levels/ch1-part1.test.ts` is outside the brief's stated file set — the brief's Step 4
   makes its two registry assertions unsatisfiable, so some edit there was unavoidable; see
   conflict 3 for why this was the smallest one.
