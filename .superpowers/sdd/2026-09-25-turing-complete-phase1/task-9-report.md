# Task 9 report — chapter-2 levels 18–22 (batch 2)

**Status:** DONE (with three documented design decisions I could not put to you — see
*Open questions* at the end; the question tool refused with "human interaction is unavailable
while the calling agent is owned by another live agent", so I decided, documented and flagged
them rather than blocking).

**Commit:** `2a6f141` — `feat(levels): add chapter-2 levels 18-22, the byte operators and the adders`

**Files changed (only these two):**

| File | Lines | State |
|---|---|---|
| `src/levels/content/ch2/batch2.ts` | 523 | new |
| `test/levels/ch2-batch2.test.ts` | 996 | new |

`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left modified and **not**
committed, as instructed. Nothing in `src/core/`, `src/ui/`, `src/app/`, `src/levels/checks.ts`,
`batch1.ts`, `ch2/index.ts` or `content/index.ts` was touched, and neither were the three files
the concurrent agent owns.

---

## 1. The five levels

| # | id | io | checker | rewards | `threeStar` (measured) | score |
|---|---|---|---|---|---|---|
| 18 | `ch2-18-byte-or` | `a:8` `b:8` → `out:8` | fuzz, seed `0x1808`, 256 rounds | `and8 or8 nand8 nor8` | gate 24, delay 1, tick 0 | 28 |
| 19 | `ch2-19-byte-not` | `a:8` → `out:8` | fuzz, seed `0x1908`, 256 rounds | `xor8 xnor8 not8` | gate 8, delay 1, tick 0 | 12 |
| 20 | `ch2-20-half-adder` | `a:1` `b:1` → `sum:1` `carry:1` | truth-table, 4 rows | `full_adder` | gate 6, delay 1, tick 0 | 10 |
| 21 | `ch2-21-full-adder` | `a:1` `b:1` `cin:1` → `sum:1` `cout:1` | truth-table, 8 rows | `neg8` | gate 15, delay 3, tick 0 | 27 |
| 22 | `ch2-22-adding-bytes` | `a:8` `b:8` `cin:1` → `out:8` `cout:1` | fuzz, seed `0x2208`, 256 rounds | `switch switch8` | gate 120, delay 17, tick 0 | 188 |

Every target is the reference solution's own metrics measured by `grade()`, and the test block
`three-star targets are the reference solutions own metrics` fails if a level's `threeStar` and its
reference's measurement differ in either direction. All five levels are purely combinational, so
`tick` is 0 on every target for the reason batch 1 states.

### Reference solutions (the circuits the targets are measured from)

* **18** — `splitter` ×2 → eight 1-bit `or` → `maker`: 8 × 3 = **24** gates, depth **1**.
  The level's own reward `or8` measures 24 / 1 on the same basis, so the target is the floor for
  both and does not privilege either construction. A test grades the drop-in and asserts it ties.
* **19** — `splitter` → eight `not` → `maker`: 8 × 1 = **8** gates, depth **1**. `not8` ties, and so
  does `nand8(a, a)` (a NAND cell is 1 per bit, not 2 — see self-review). What the target *does*
  separate is `nor8(a, a)` (`~(a|a)`, 32 gates, 1 star); both halves are asserted.
* **20** — `xor(a,b)` + `and(a,b)`: **6** gates, depth **1**. Both are standard cells (XOR 4, AND 2).
* **21** — `xor, and, xor, and, or` — the five-component full adder: 4+2+4+2+3 = **15** gates,
  depth **3**.
* **22** — eight of those in a ripple chain: 8 × 15 = **120** gates; the carry path is 3 gates to
  reach the first carry and 2 per bit after that, so the delay is `3 + 2 × 7` = **17**.

### Counterexamples (graded-and-wrong, not malformed)

| # | counterexample | where it first fails |
|---|---|---|
| 18 | `and8(a, b)` — the byte operator next door | round 0, `{a:136, b:177}`: expected `out=185`, actual `128` |
| 19 | `a` wired straight through — the NOT never applied | round 0, `{a:152}`: expected `out=103`, actual `152` |
| 20 | `sum = or(a,b)`, `carry = and(a,b)` | row `(1,1)`: expected `{sum:0, carry:1}`, actual `{sum:1, carry:1}` |
| 21 | the half adder again, `cin` present but unread | row `(0,0,1)`: expected `{sum:1, cout:0}`, actual `{sum:0, cout:0}` |
| 22 | eight half adders, no carry chain (`out = a ^ b`, `cout = bit 7 of a & b`) | round 0, `{a:40, b:72, cin:1}`: expected `{out:113, cout:0}`, actual `{out:96, cout:0}` |

All three fuzz counterexamples disagree on the **very first drawn vector** at these seeds. The
fuzz non-vacuity test does not rely on that luck: it captures the kernel's own vector sequence
through the level's own expectation functions, recomputes the first disagreeing round from the
counterexample's behaviour, and asserts that the failure record's `round`, `inputs`, `expected`,
`actual` and `detail` are that round's — plus that exactly one record exists (the checker stops at
the first bad round) and that the captured sequence has exactly `firstBad + 1` entries.

---

## 2. Source fidelity, level by level

The compendium fixes names, order and a one-line concept; everything else is this replica's design.
Each level carries a `SOURCED` / `AUTHORED` data comment (`batch1.ts`'s format), the test file
asserts both markers are present on every level, and two extra assertions require the source's two
achievement notes to be quoted verbatim in the comments they belong to.

* **18 Byte OR / 8 位或** — SOURCED: name (both languages), position, concept (byte-wide OR).
  AUTHORED: the `a:8 b:8 → out:8` shape, the fuzz seed/pin maps/expectation, the four rewards, the
  target. It is the game's first `fuzz` level because 2^16 input pairs cannot be rows.
* **19 Byte NOT / 8 位非** — SOURCED: name, position, concept. AUTHORED: shape, fuzz seed, the
  **masked** expectation (load-bearing: `~a` is a negative int32, and the kernel refuses an
  unfitting expectation rather than masking it), the three rewards, the target.
* **20 Half Adder / 半加器** — SOURCED: name, position, concept (sum and carry). AUTHORED: shape
  (two output pins ⇒ `OUT_sum` / `OUT_carry`), the four generated rows, the target, the reward.
  The id says `half-adder` and the reward does not, which is the brief's decision and spec §3.3's
  chapter-2 list.
* **21 Full Adder / 全加器** — SOURCED: name, position, concept, **and the achievement
  "仅用 5 个蓝色元件"**. AUTHORED: shape, eight rows, target, `neg8` reward, palette.
  **Mapping:** this replica has no blue-component system (those are custom/blueprint components, a
  later phase), so the achievement is re-expressed as the measured `threeStar.gate` of the circuit
  it names — the five-component full adder, **15** NAND equivalents at depth 3. The test asserts
  the reference is exactly `['xor','and','xor','and','or']` *and* that it measures 15/3, so the
  mapping is measured, not claimed. The comment is explicit that 5 is a component count and 15 a
  NAND-equivalent count — the source's number is not the target.
* **22 Adding Bytes / 8 位加法器** — SOURCED: name, position, concept, **and the achievement
  "延迟 ≤ 35"**. AUTHORED: shape, fuzz seed + both expectation functions, the two rewards, palette,
  and the target. **The source's 35 is recorded in the comment as its reference value and is not
  the target:** `threeStar.delay` is the reference solution's own measured **17** (`3 + 2 × 7`
  carry path). 17 ≤ 35, so there is no discrepancy to report — but the comment says plainly that
  the two numbers are different metrics on different circuits, and that if the measurement had come
  out above 35 the target would still carry the measurement. The test asserts both facts
  (`delay ≤ 35` and `delay === 17`).

---

## 3. What was tested, and the results

The test file is 996 lines / 56 tests, modelled on `ch2-batch1.test.ts`, with these blocks:

1. ids, indices, chapters, names (both languages), non-empty briefs/hints;
2. exact pin shapes;
3. the unlock walk — every `allowedComponents` entry is unlocked at or before its level, walking
   chapter 1 and batch 1 first (rewards added before the level's own palette, which is what lets a
   level offer the parts it teaches);
4. the negative half of that rule — nothing later than this batch is offered (`mux8 delay8 reg8
   counter8 ram8 less_s shift_* ashr8 rot_l8 div8 decoder1..3` are all still locked);
5. vacuity: every level has a check that compares something (the five-branch invariant, `fuzz`
   branch included);
6. truth tables: 4 and 8 rows, exhaustive, no repeats, plus five hand-checked rows per level;
7. fuzz authoring: fixed non-zero integer seeds, exactly 256 rounds, distinct seeds, pin maps that
   name every pin and nothing else;
8. **256 varying, reproducible vectors** — the level's own captured sequence has 256 entries, is
   identical across two runs, and has >100 distinct vectors (only a degenerate PRNG misses that);
9. the expectation functions *are* the named operators (OR, masked NOT, add-with-carry, on 13
   hand-picked vectors);
10. rewards exactly as the brief assigns them;
11. palette claims (splitter/maker present where the level is wired; no wide part on the 1-bit
    levels; `add8`/`full_adder` absent from level 22; `full_adder` absent from level 21);
12. `SOURCED`/`AUTHORED` markers per level, plus the two verbatim achievement quotes;
13. references pass with 3 stars; targets equal measurements; references use only palette parts;
14. counterexamples: graded-and-wrong (`failures.length > 0`, `stars === 0`) and, for 20/21 and the
    three fuzz levels, failing at the *specific* row/round with the specific vector;
15. empty circuit fails every level without throwing;
16. the two source achievements measured (5 components ⇒ 15/3; measured delay 17 ≤ 35);
17. the byte operators' own rewards tie the hand-built references (18: `or8`; 19: `not8` and
    `nand8(a,a)` tie at 8/1, `nor8(a,a)` is 32/1 and one star).

### Results (logs beside this report)

| Run | Log | Result |
|---|---|---|
| focused, RED | `task-9-logs/task-9-vitest-red.log` | suite failed to load: `Cannot find module '../../src/levels/content/ch2/batch2'`, 0 tests |
| focused, first GREEN attempt | `task-9-logs/task-9-vitest-focused-1.log` | 51 passed / **5 failed** — the measurement corrections below |
| focused, final | `task-9-logs/task-9-vitest-focused.log` | **56 passed / 56** |
| full suite | `task-9-logs/task-9-vitest-full.log` | **600 passed / 600** (20 files) |
| `tsc --noEmit` | `task-9-logs/task-9-tsc.log` | exit 0, no diagnostics (the log carries the command, the working directory and the exit code, because a clean run prints nothing) |
| `pnpm build` | `task-9-logs/task-9-build.log` | exit 0, `vite v8.3.1`, 34 modules, built in 56 ms |
| measurement scratchpad | `task-9-logs/task-9-measurements.log` | per-level metrics + counterexample per-round records (source of §1's tables) |

### TDD evidence

`test/levels/ch2-batch2.test.ts` was written first and run against a worktree with no
`batch2.ts`: RED is the module-resolution failure above (test file at
`test/levels/ch2-batch2.test.ts:16`). Only then did I write the level data. The first GREEN
attempt failed five tests, and those failures *were* the measurement:

* `three-star targets … ch2-22-adding-bytes` and the delay test: I had written `delay: 24` from my
  own arithmetic; the kernel measured **17**. The metric is the authority, so the data now carries
  17 and the comment explains the real path (3 gates to the first carry, 2 per bit after).
* the level-19 tie test: I had claimed `nand8(a, a)` costs 16; it measures **8** (one NAND per
  bit), i.e. it ties. The comment and the test now say so, and the test demonstrates the
  separation `nor8(a, a)` (32 → one star) instead of a separation that does not exist.
* `offers nothing from a later level`: my walk checked each palette *before* adding that level's own
  rewards, so batch 1's level 13 failed on `splitter`. `batch1.ts`'s own copy adds rewards first;
  mine now does too.
* the achievement-marker test: `延迟 ≤ 35` was wrapped across two comment lines, so the verbatim
  assertion could not find it. The comment was rewrapped.

---

## 4. Self-review findings

1. **Two of my pre-test numbers were wrong and the tests caught both** (delay 24 → 17; `nand8`
   16 → 8). Nothing in the data is now taken from arithmetic: three `threeStar` blocks are proved
   equal to `grade()`'s measurement, and the arithmetic in the comments was corrected to match.
2. **A dead code block removed before commit:** I had first appended three `_SEED_*_IS_A_FUZZ_CHECK`
   constants "to type-check the fuzz data". They duplicated the check data (precisely the drift the
   file's own comments rail against) and the discriminated union already type-checks the inline
   literals. Deleted.
3. **Cardinality/style cleanups:** `IO_A8_OUT8` reformatted to the project's line width; the
   five-assertion L22 expectation block collapsed into an `added(a, b, cin)` helper; a
   loop-invariant seed check moved out of its loop.
4. **Cross-references checked:** level 21 no longer says "the part is offered at level 22" (it is
   not — that was a stale sentence from an earlier draft), and the module note, level 20's comment
   and level 21's comment now agree on where `full_adder` is and is not offered.
5. **The level-13 seam does not extend to this batch:** `splitter`/`maker`/`const8` are level 13's
   own rewards, and under linear unlocking a player at level 18 has passed 13–17, so their palette
   is complete. The unlock walk proves it rather than asserting it.
6. **Palette sizes** are 25 / 28 / 15 / 14 / 23 entries; the two 1-bit levels offer only 1-bit parts
   (batch 1's level-14 call: an eight-bit part has nothing to attach to).
7. `pnpm test` was run after the last edit; the scratchpad file used for the measurement log was
   deleted afterwards and `git status` shows only the controller's ledger modified.

---

## 5. Open questions, decisions and concerns

**I could not ask.** `ask_user_question` returned "human interaction is unavailable while the
calling agent is owned by another live agent". The three questions I had prepared are below with
the decision I took and its cost. They matter because three later batches inherit the conventions.

**(a) May a level offer its own reward? I took yes.** Batch 1 does exactly that (level 13 offers
`splitter/maker/const8`; levels 15–17 offer their own rewards), and the brief's line "A level's own
reward is offered in its own palette, so a level may use the part it teaches" reads as the
convention. Consequence: level 18 can be solved with one drop-in `or8` (24/1) and level 19 with one
`not8` (8/1) — *at exactly the score the hand-built circuit measures*, so the target is unaffected;
I grade both constructions in tests to make that explicit rather than hiding it. Level 22's own
rewards (`switch`/`switch8`) cannot answer it. If you want the lesson to be mandatory at 18/19,
removing `'or8'` and `'not8'` from those two palettes is a two-token change; references, targets
and tests stay valid.

**(b) `full_adder` is not a registered component.** It is level 20's reward as the brief fixes, and
`src/core/defs/index.ts` has no such def (the id appears only in the design spec, the plan and now
this file). `src/core/` is out of my scope, so I: keep the reward; list it in level 20's own palette
(it is level 20's reward, it attaches to 1-bit pins, and a full adder with `cin` tied low is 9 gates
against that level's 6, i.e. a one-star alternative like level 17's `add8(a,a)`); and **withhold it
from levels 21 and 22**, where a drop-in (9/1 at 21; 72/8 for eight of them at 22) is a *better*
answer than the circuit each level teaches and would make the target loose. The module note, level
20's comment and level 21's comment all record this, and name what the task that registers the def
must decide: where it is offered, and whether level 22's target is re-measured from the
eight-instance cascade. This is the one place where I knowingly deviate from the brief's sentence
"奖励是 `full_adder`，玩家下一关就要用": offering it on level 21 would answer that level in one
row and void its five-component achievement, so I read "used next" as "used where cascading is the
lesson" and left it withheld there too until the def exists.

**(c) `add8` at level 22: withheld.** Level 17 unlocked it, it has *exactly* level 22's I/O shape,
and one instance measures 72 gates / 1 delay — the level would be a single drop, and the source's
own "延迟 ≤ 35" achievement would be vacuous. `allowedComponents` is a curated palette, not
"everything unlocked": batch 1 already excludes `mem1` everywhere, and level 14 excludes the wide
family on pin-width grounds. Everything else the player owns that could attach is offered
(`less_u equal8 mul8 neg8 switch switch8`), including parts no combination of which adds two bytes.

**Other concerns:**

1. **`allowedComponents` can name an unregistered part** (level 20's `full_adder`). Today that is
   invisible: `paletteDefsFor` intersects with the unlocked set and `ui/palette.ts` filters with
   `registry.has`. If a later task adds a lint that every palette entry must be a registered def,
   it will flag level 20 — resolving it means deciding (b) first.
2. **Not assembled.** `src/levels/content/ch2/index.ts` and `content/index.ts` are out of scope for
   this task, so levels 18–22 are reachable only through `batch2.ts` (exactly how batch 1 was
   before it was appended) and are not yet playable in the GUI.
3. **Cross-task coupling.** My unlock test walks `CH1_PART1`, `CH1_PART2` and `CH2_BATCH1`, so if
   the concurrent agent's edits to `progress.ts` or `ch1/part2.ts` remove or move a reward this
   batch's palettes depend on (`nand not and or nor xor xnor and3 or3 delay_line` from chapter 1;
   `splitter maker const8 less_u equal8 add8 mul8` from batch 1), my test fails loudly rather than
   silently. Their edits were not present in this worktree when I ran the suite.
4. **The source's 35 and my 17 are not the same quantity** (different simulation metrics), and the
   comment says so in as many words; I mention it here so a reviewer does not read "17 ≤ 35" as a
   proof of anything beyond "the replica's targeted solution is inside the source's reference
   value".

---

# full_adder registration — the part level 20 rewards

**Status:** DONE

**Commit:** `523a7b9` — `feat(defs): register the full_adder that level 20 rewards`

This is the follow-up to §5(b) and concern 1 above: the def §5(b) was blocked on now exists, and
the lint concern 1 predicted ("if a later task adds a lint that every palette entry must be a
registered def, it will flag level 20") is now a test.

**Files changed (only these three):**

| File | Change |
|---|---|
| `src/core/defs/index.ts` | +89 — the `full_adder` def, its id in `DEF_IDS`, its registration in `BASE_DEFS`, a note in the GATE COST table |
| `src/core/defs/wide.ts` | +10 / −3 — `FULL_ADDER` exported (was module-private); two comments updated |
| `test/core/registry.test.ts` | +136 — 4 tests: truth table, registration, and the two halves of the registry guard |

No level data was touched. Level 20's `rewards` and `allowedComponents` are byte-identical to what
batch 2 shipped, `full_adder` was **not** added to any other level's palette (level pacing is a
later task's call), and the concurrent agent's `src/levels/content/ch2/batch3.ts` / test file were
never opened. `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left modified and
not committed.

## 1. The def

| id | inputs | outputs | category | cost | gateCost | sequential | stateBytes |
|---|---|---|---|---|---|---|---|
| `full_adder` | `a:1` `b:1` `cin:1` | `sum:1` `cout:1` | `logic1` | 1 | 9 | `false` | 0 |

`sum = a XOR b XOR cin`; `cout` is the majority of the three (high when at least two are high).
Name: 全加器 / Full Adder. Semantics are two lines of `evaluate` (`o[0] = a ^ b ^ cin`,
`o[1] = a + b + cin >= 2 ? 1 : 0`) with the pin values normalised to 0/1 the way `gate()` does,
so an unwired pin reads 0.

It is written out as a literal rather than built by the file's `gate()` helper, because that helper
produces exactly one output pin named `out` from a single-output table and this part has two named
outputs the level data addresses by name. Both facts are in the def's comment.

**Placement.** In `BASE_DEFS` it sits with the other 1-bit gates, after `or3`. Its id is registered
through a new tuple, `POST_PHASE0_DEF_IDS = ['full_adder'] as const`, spread into `DEF_IDS` between
`PHASE0_DEF_IDS` and `WIDE_DEF_IDS` — **no reordering** of any existing list. I checked the ordering
question the brief raised: `DEF_IDS` order is *not* load-bearing. `DEF_IDS` is only spread into the
`DefId` type (exported from `defs/index.ts` and referenced nowhere else in `src/`) and read by two
test files (`registry.test.ts`, `defs-wide.test.ts`); the palette's order comes from `BASE_DEFS`
insertion order through `registry.all()`.

## 2. The `gateCost: 9` claim: REUSED, not duplicated

**Reused.** `wide.ts:168` defines `const FULL_ADDER = 9` with the whole 9-NAND cell spelled out in
the comment above it — module-private, so it could not be imported as it stood. It is now
`export const FULL_ADDER = 9`, and the def's field is `gateCost: FULL_ADDER`. There is exactly one
literal `9` in `src/` for this construction, and three things derive from it: the registered
`full_adder`, `add8` (`w * FULL_ADDER`), and `createWideDefs(1)`'s `add1` (already pinned at 9 by
`defs-wide.test.ts`). The `wide.ts` basis note and the `FULL_ADDER` doc comment say why it is
exported.

I did not take the number on trust even though it was already used for `add8`: before reusing it I
transcribed the cell from `wide.ts`'s comment (`x1 = NAND(a,b)`; `x2/x3/s1` = `a XOR b`;
`s2/s3/s4/sum` = that XOR `cin`; `cout = NAND(x1, s2)`) and evaluated all eight input combinations
against independently written `a ^ b ^ cin` and majority predicates. All eight rows matched and the
cell is exactly 9 NANDs. (Scratch run, not committed — the table is in §3's truth-table test.)

A test pins the composition rather than the same literal twice:
`expect(r.get('add8').gateCost).toBe(8 * (def.gateCost ?? 0))` — editing the shared constant moves
both, editing one number alone cannot satisfy it.

## 3. Tests (TDD: RED recorded first)

The four tests were written before the def. RED is `task-9-logs/task-9-full-adder-red.log`:
**4 failed / 25 passed**, and the four failures are the four tests:

| Test | RED failure |
|---|---|
| `prices every 1-bit gate on the NAND-equivalent basis, explicitly` | `Error: unknown component: full_adder` |
| `registers full_adder as a 1-bit gate on the same 9-NAND cell as add8` | `expected [ 'const_on', 'const_off', …(42) ] to include 'full_adder'` |
| `evaluates the full adder over all eight input combinations` | `Error: unknown component: full_adder` |
| guard: `names only registered defs in rewards.components` | `[ "ch2-20-half-adder rewards full_adder" ]` |

Then the def, then GREEN (below). The tests:

1. **Truth table, all 8 combinations, both outputs.** The 8 rows are written out as literals in the
   vector order the file's one-output tables use (`a` is bit 0, so `index = a + 2b + 4cin`), not
   computed from the def; each row is `[sum, cout]`. Both outputs are asserted per row.
2. **Registration.** `full_adder ∈ DEF_IDS`; `category === 'logic1'`; `cost === 1`;
   `gateCost === 9` plus the `add8 === 8 ×` identity; `sequential === false`; `stateBytes === 0`;
   pin ids and widths as `id:width` pairs (`a:1 b:1 cin:1` → `sum:1 cout:1`); the localized name.
3. **Guard, rewards.** Every id in every shipped level's `rewards.components` resolves in the
   registry; all offenders are collected and reported in one assertion, and the test proves it
   reached the relevant levels (below).
4. **Guard, palettes.** The same walk over `allowedComponents`.

**Guard placement.** No such test existed anywhere: I searched the whole `test/` tree for
reward/palette registry checks (`rewards`, `DEF_IDS`, `allowedComponents`) across its 20 vitest
suites, the Playwright smoke spec and the shared fixture. The closest is
`test/levels/level-buildability.test.ts`, which walks rewards as *string sets* for unlock ordering
and never consults the registry, and `test/levels/ch2-batch2.test.ts:452`, which asserts the level-20
reward equals the literal `['full_adder']` — the two rules that let the hole stand. So the guard is
new (not a second copy of anything) and lives in `test/core/registry.test.ts`, as scoped. I extended
rather than duplicated where I could: the existing pricing test's `NAND_EQUIVALENTS` map gains
`full_adder: 9`, and that test's `byCategory('logic1')` equality then holds the new gate to a stated
count (comment updated from "nine" to "ten").

**Test 4 is past the brief's letter, deliberately.** The brief asks for `rewards.components`;
`ui/palette.ts:37` filters palette ids through `registry.has`, so an unregistered *palette* entry
is dropped just as silently, and the live defect had both halves at once — level 20 both rewards
`full_adder` and lists it in its own palette. It also anticipated exactly this (`batch2.ts:51`).
It costs nothing extra: both halves fail on the same level data.

**Non-vacuity, the part that matters.** `LEVELS` is chapter 1 and `CH2_LEVELS` is
`[...CH2_BATCH1]` — level 20 is in neither, so a walk over those two alone would have passed while
the defect stood. Both guard tests therefore name the unjoined `CH2_BATCH2` explicitly and assert
`full_adder` was seen (level 20 is its only source). The comment says the `CH2_BATCH2` import is the
line to delete when the batch is appended to `CH2_LEVELS`, at which point the walk picks it up with
no other edit.

**The guards bite (mutation check).** Temporarily renaming the def's id to `full_adder_MUTANT` made
both guard tests fail with `ch2-20-half-adder rewards full_adder` and
`ch2-20-half-adder offers full_adder` (`task-9-logs/task-9-full-adder-mutation-guard.log`). The
mutation was reverted before commit; `git diff` carries no trace of it.

## 4. Commands and results

All commands run from `D:\Documents\turing-complete\.worktrees\phase1` with
`node …/dependencies/node/bin/node.exe …/dependencies/pnpm/bin/pnpm.mjs` (bare `pnpm` is a broken
wrapper).

| Run | Command | Log | Result |
|---|---|---|---|
| baseline, before any edit | `… pnpm test` | `task-9-logs/task-9-full-adder-baseline.log` | **600 passed / 600** (20 files) — the starting point, so the delta below is unambiguous |
| focused, RED | `… pnpm test test/core/registry.test.ts` | `task-9-logs/task-9-full-adder-red.log` | **4 failed / 25 passed** (the four new tests) |
| focused, GREEN | `… pnpm test test/core/registry.test.ts` | `task-9-logs/task-9-full-adder-focused.log` | **30 passed / 30** (1 file) |
| full suite, GREEN | `… pnpm test` | `task-9-logs/task-9-full-adder-full.log` | **604 passed / 604** (20 files): +4 = the four new tests, nothing else moved |
| typecheck | `… pnpm exec tsc --noEmit` | `task-9-logs/task-9-full-adder-tsc.log` | exit 0, no diagnostics (empty log — a clean run prints nothing) |
| build | `… pnpm build` | `task-9-logs/task-9-full-adder-build.log` | exit 0; `tsc --noEmit` then `vite v8.3.1`, 34 modules, built in 75 ms; `dist/assets/index-UuAdtK6E.js` 60.35 kB |
| guard mutation | `… pnpm test test/core/registry.test.ts -t "names only registered defs"` | `task-9-logs/task-9-full-adder-mutation-guard.log` | exit 1: 2 failed / 28 skipped, naming level 20 in both halves |

The last three runs above were made after the last edit to any of the three files, so the logs
describe the committed content. `dist/` is gitignored, and the built bundle contains the new id
(`full_adder` appears in `dist/assets/index-*.js`), so the part reaches the app and not just the
tests. `git status` after the commit shows only the controller's ledger modified.

## 5. Concerns and notes

1. **The guard will meet batch 3 before a def does.** `CH2_LEVELS` is the join point, and the guard
   picks up any batch appended to it. Batch 3 (levels 23–27) is designed to reward `decoder1` and
   `decoder3` — ids no def declares today. If that batch is joined before its decoders are
   registered, this guard fails loudly and names them: the same defect class, on a def that belongs
   to a later defs task, not to level data. I deliberately did **not** import `batch3.ts` directly
   (it does not exist in this worktree, another agent owns it, and importing it would make today's
   suite depend on their in-flight state) — so nothing here fails today.
2. **Level 20's palette entry now resolves, which is a behaviour change** (the intended one). A
   player at level 20 can drop in the 9-gate `full_adder` with `cin` unwired against the level's
   6-gate half-adder reference: a one-star alternative, exactly what `batch2.ts`'s level-20 comment
   says it is ("a one-star alternative like level 17's `add8(a,a)`"). Levels 21 and 22 still
   withhold the part, so the cascading lesson there is untouched. Whether level 20 should offer it
   at all — its own reward, listed in its own palette — is the level-pacing decision §5(b) handed
   forward, and this task did not pre-empt it.
3. **§5(b)'s other open item is untouched:** level 22's three-star target is still measured from
   the hand-built cascade, not from eight dropped-in `full_adder`s (which the palette does not
   offer). Re-measuring is a later task's call.
4. **Naming.** `full_adder` follows the level data's spelling (`rewards: { components:
   ['full_adder'] }`), and the def's `zh` name matches level 21's level name (全加器) rather than
   coining a second translation.
