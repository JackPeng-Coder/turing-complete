# Task 8 report — chapter-2 levels 13–17 (scalar logic and counting)

**Status:** DONE_WITH_CONCERNS
**Base:** `e8ba629` · **Commit:** `746758a` — `feat(levels): add chapter-2 levels 13-17 and close the vacuity invariant`
**Worktree:** `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`)
**Scope actually touched:** `src/levels/content/ch2/batch1.ts` (new), `src/levels/content/ch2/index.ts` (new),
`test/levels/ch2-batch1.test.ts` (new), `test/levels/ch1-part1.test.ts`, `test/levels/ch1-part2.test.ts`
(the two vacuity loops only). `content/index.ts`, `src/core/`, `src/ui/`, `src/app/` and `src/levels/checks.ts`
are untouched, and `.superpowers/.../progress.md` is left modified (not committed), as instructed.

---

## 1. What each level is, and what its data comment claims

The source compendium fixes exactly three things per level — the name (zh/en), the position, and one line of
concept. Nothing else in these specs is sourced. Every level therefore carries a data comment split into
`SOURCED` and `AUTHORED`, and `test/levels/ch2-batch1.test.ts` fails if either marker is missing for a level
(§5). The file header adds that the parts the *brief* fixes (checker kinds, rewards) also count as `AUTHORED`,
so the rewards are never presented as the source's.

| # | id | io | checker | reference (measured) | `threeStar` | rewards |
|---|---|---|---|---|---|---|
| 13 | `ch2-13-odd-number-of-signals` | `a:4 → out:1` | `truth-table`, 16 rows | splitter + 3 XOR | `12 / 2 / 0` | `splitter maker const8` |
| 14 | `ch2-14-double-trouble` | `a,b,c,d:1 → out:1` | `constraint at-least 2` | `(a&b)\|(c&d)\|((a\|b)&(c\|d))` | `18 / 3 / 0` | — |
| 15 | `ch2-15-binary-racer` | `a:4 → out:3` | `truth-table`, 16 rows (generated) | splitter + 4 half-adder cells | `28 / 3 / 0` | `less_u` |
| 16 | `ch2-16-counting-signals` | `a,b,c,d:1 → out:3` | `truth-table`, 16 rows (generated) | the same tree without the splitter | `28 / 3 / 0` | `equal8` |
| 17 | `ch2-17-double-the-number` | `a:8 → out:8` | `truth-table`, 256 rows (generated) | splitter → maker, one slot up | `0 / 0 / 0` | `add8 mul8` |

`threeStar` numbers are in `gate / delay / tick` order. All five are **measured**, not chosen: the tests were
written and run with placeholder targets so the failures would print the real metrics, and a test now asserts
`level.threeStar` equals the reference's `grade()` metrics exactly, in both directions
(`three-star targets are the reference solutions own metrics`). All five levels are purely combinational and no
check in the batch ever ticks the clock, so `tick` is genuinely 0 on all five — stated for the same reason
chapter 1's combinational levels state it, and documented as such in the header comment.

### Level-by-level

**13 — ODD Number of Signals / 奇数个信号.** `SOURCED`: name, position (13th, first of chapter 2), concept
(an odd count of high signals reads high). `AUTHORED`: the four-bit width (**explicitly recorded as this
replica's choice, not the source's**, with the reasoning — 16 rows exhaust a nibble and a wide value is where
`splitter`/`maker` are met), the `a:4 → out:1` shape, the 16-row table via `truthTable`, the target, the
palette. The comment also carries a `KNOWN SEAM` paragraph — see §7.

**14 — Double Trouble / 成对的麻烦.** `SOURCED`: name, position, concept ("pairs"). `AUTHORED`: which pins the
rule ranges over and which pin it writes, the io, the target, the palette, and *why this rule*: `sum-equals`
reduces its sum modulo the output pin's width, so on this level's 1-bit `out` it would state parity (level
13's function), not "at least two". No reward, per the brief.

**15 — Binary Racer / 二进制速算.** `SOURCED`: name, position, and the fact that the source level of this name
is a **timed binary-reading minigame** — recorded as such, because the rebuild is a design decision.
`AUTHORED`: the rebuild into `a:4 → out:3` publishing the count of high bits in `a` (0–4, hence three bits),
the 16 generated rows, the target, the reward. The comment also states plainly that this makes the level's
function identical to level 16's, that the coincidence comes from the brief's own table, and what would change
if a saturating 4→3-bit quantizer was meant instead.

**16 — Counting Signals / 信号计数.** `SOURCED`: name, position, concept (adding four one-bit signals, the
half-adder idea). `AUTHORED`: the io, the generated rows, the target, the reward.

**17 — Double the Number / 加倍.** `SOURCED`: name, position, concept (a left shift by one bit is a doubling).
`AUTHORED`: the `a:8 → out:8` shape, the 256 generated rows (2⁸ — the first table in the game that cannot be
written by hand), the target, the rewards, and the decision that the reference is **wiring, not arithmetic**:
`splitter` → `maker` re-indexes the byte one slot up, so the target is the floor (0 gates, 0 delay) and what it
says is the lesson. The comment's claim that `add8(a, a)` also doubles, at 72 gates / 1 delay / one star, is
**measured by a test**, not asserted in prose.

Checker mechanics worth naming: rows for 15/16/17 are produced by `generateRows` (the brief's instruction) via a
small `valueRows(io, expected)` adapter, because `generateRows` is typed against a whole `LevelSpec` while
reading only `io`; level 13 uses `truthTable(io, perPin)`. No table is hand-rolled and none is left empty —
`rows` omitted or empty is the hard `missing-rows` failure, and the test asserts 16/16/16/256 non-empty rows
*and* that the inputs enumerated are exactly 0…2ⁿ−1 with no repeats.

---

## 2. What was tested, and the results

`test/levels/ch2-batch1.test.ts` — **58 tests**, all passing:

- **Shape**: five chapter-2 levels, indices 13–17, id convention, the exact io pins/widths from the brief,
  both-language names, non-empty brief/hint in both languages, the exact rewards per level, and level 14's rule
  equal to `{kind:'at-least', inputs:['a','b','c','d'], count:2, output:'out'}`.
- **Unlock chain**: every `allowedComponents` entry is unlocked at or before its level (chapter 1's rewards
  walked first, a level's own rewards added before its own palette is checked — the brief requires level 13 to
  list its own three rewards). A second test states it as "offers nothing from a later level" and pins that
  `mux8/delay8/reg8/counter8/ram8/and8/shift_l8` are unlocked nowhere in this batch.
- **Vacuity invariant** (the extension, also added to both chapter-1 loops): all five check kinds are handled
  and an unknown kind is refused rather than skipped.
- **The invariant is itself tested**: 11 synthetic vacuous levels (empty table, row with no expected output,
  empty script, script that expects nothing, constraint with no inputs, `at-least` count 0, `rounds: 0`,
  fractional `rounds`, no expectation for a pin, empty custom id, unknown kind) must all be rejected, and five
  sound checks of every kind must be accepted.
- **Tables**: row counts (16/16/16/256), exhaustive non-repeating enumeration, and explicit row values
  (parity of 0/1/3/7/15, counts of 0/5/7/15 and of four separate pins, doubles of 0/1/127/128/255).
- **Data comments**: each level's doc comment exists and contains both `SOURCED` and `AUTHORED`.
- **Reference solutions**: pass with `failures === []`, `passed === true`, `stars === 3`, and
  `threeStar === metrics` exactly (three separate describe blocks).
- **Palette**: every instance of every reference is a def the level offers.
- **Counterexamples**: one genuinely-failing circuit per level, asserted to be *graded and wrong*
  (`failures.length > 0`, `stars === 0`) rather than refused as a malformed graph — low-bit-instead-of-parity
  (13), `(a&b)|(c&d)` missing the cross pairs (14), `a & 7` truncation (15), the two-half-adders carry mistake
  (16), and a right shift instead of a left one (17).
- **Empty circuit** fails all five without throwing.
- **Level 17's alternative**: `add8(a, a)` with `cin` tied low passes all 256 rows, measures
  `{gate: 72, delay: 1, tick: 0}` and scores one star.
- **The level-13 seam** is pinned as data (see §7).

Full suite: **500 tests in 18 files, 0 failures** (baseline before this commit: 442; the new file contributes
58). `tsc --noEmit`: exit 0. `pnpm build`: exit 0.

`pnpm smoke` (Playwright) was not run: the plan requires it for tasks that change the UI, and this task
changes no `src/ui/` or `src/app/` file — chapter 2 is deliberately not wired into `LEVELS` yet (concern D), so
the shell the smoke test drives is byte-identical to what it drove before.

---

## 3. TDD evidence

Commands (from `D:\Documents\turing-complete\.worktrees\phase1`; `$NODE`/`$PNPM` abbreviate the runtime paths in §4):

1. **RED — the level data does not exist.** Test file written first, then
   `$NODE $PNPM test test/levels/ch2-batch1.test.ts` → exit 1, log `task-8-red-1-missing-module.txt`:

   ```
   ❯ test/levels/ch2-batch1.test.ts (0 test)
   Error: Cannot find module '../../src/levels/content/ch2/batch1' imported from .../test/levels/ch2-batch1.test.ts
   Test Files  1 failed (1)   Tests  no tests
   ```

   *Why expected*: the test is written against level data that has not been authored yet; nothing else can run
   until the module exists.

2. **RED — the targets are placeholders, so the run measures the metrics.** After writing the five levels with
   `threeStar: {gate: 0, delay: 0, tick: 0}`, `$NODE $PNPM test test/levels/ch2-batch1.test.ts` → exit 1,
   **9 failed | 47 passed**, log `task-8-red-2-measure-metrics.txt`:

   ```
   ch2-13: measured metrics={"gate":12,"delay":2,"tick":0}
   ch2-14: measured metrics={"gate":18,"delay":3,"tick":0}
   ch2-16: measured metrics={"gate":28,"delay":3,"tick":0}
   ch2-17: (passed at 0/0/0)
   and `states each level the brief describes`: expected +0 to be 1  (test/levels/ch2-batch1.test.ts:301)
   ```

   *Why expected*: the placeholders were deliberate, so the failures would report the references' real metrics —
   that is the measurement. Two further things came out of it: level 15's block was collapsed into level 16's in
   the output (same tree, same numbers, and its GREEN run confirms `28/3/0`), and **my own row expectation for
   `a = 3` was wrong** (`0b11` is two ones, so parity is 0). The level data was right and the generated table
   caught the test; the corrected line carries a comment saying so.

   The targets were then set to the measured values, producing `task-8-green-focused.txt` (58 passed).

3. **RED — the vacuity hole is real (mutation).** With the chapter-2 copy of the invariant temporarily reduced
   to the old two-branch shape (`if (kind !== 'truth-table' && kind !== 'script') continue;`), and the mutation
   reverted immediately afterwards (verified byte-identical to a backup),
   `$NODE $PNPM test test/levels/ch2-batch1.test.ts test/levels/ch1-part1.test.ts test/levels/ch1-part2.test.ts`
   → exit 1, **6 failed | 113 passed**, log `task-8-red-3-vacuity-hole.txt`:

   ```
   ❯ test/levels/ch2-batch1.test.ts (56 tests | 6 failed)
       × rejects a constraint with no inputs
       × rejects an at-least count every vector satisfies
       × rejects a fuzz check with rounds=0
       × rejects a fuzz check with no expectation for a pin
       × rejects a custom check with no id
       × rejects a check of a kind this kernel does not know
    ✓ test/levels/ch1-part1.test.ts (34 tests)
    ✓ test/levels/ch1-part2.test.ts (29 tests)
   ```

   *Why expected*: it reproduces the reviewer's finding exactly. Under the old shape all six vacuous checks
   pass, level 14 — whose only check is the `constraint` — passes the chapter-2 loop vacuously, and **both
   chapter-1 files stay green**, which is precisely why the hole was invisible.

4. **GREEN** — logs `task-8-green-focused.txt`, `task-8-green-full.txt`, `task-8-tsc.txt`, `task-8-build.txt`:

   ```
   focused: Test Files 1 passed (1)   Tests 58 passed (58)
   full:    Test Files 18 passed (18) Tests 500 passed (500)
   tsc:     exit 0
   build:   exit 0  (tsc --noEmit && vite build, 34 modules, built in 63ms)
   ```

---

## 4. Log files

All in `D:\Documents\turing-complete\.superpowers\sdd\2026-09-25-turing-complete-phase1\`, beside this report.
The runtime paths the commands used are
`C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` and
`...\dependencies\pnpm\bin\pnpm.mjs`.

| log | what it holds |
|---|---|
| `task-8-red-1-missing-module.txt` | RED 1 — the module does not exist yet |
| `task-8-red-2-measure-metrics.txt` | RED 2 — placeholder targets; prints every measured metric |
| `task-8-red-3-vacuity-hole.txt` | RED 3 — the mutation showing the old invariant pass vacuously |
| `task-8-green-focused.txt` | GREEN — `pnpm test test/levels/ch2-batch1.test.ts` (58) |
| `task-8-green-full.txt` | GREEN — `pnpm test` (500 in 18 files) |
| `task-8-tsc.txt` | `pnpm exec tsc --noEmit`, exit 0 (empty) |
| `task-8-build.txt` | `pnpm build`, exit 0 |
| `task-8-commit-msg.txt` | the commit message used |

Each log is the command's combined stdout+stderr; the vitest banner inside each shows the focused/full command
form actually run. The first `tsc`/`build` runs failed (see §6, findings 1–2) and were re-run green; the logs
hold the final green runs, and the failures are transcribed in §6 rather than kept as separate files.

---

## 5. Files changed

```
A  src/levels/content/ch2/batch1.ts         (412 lines — the five levels and their data comments)
A  src/levels/content/ch2/index.ts           (17 lines — CH2_LEVELS = [...CH2_BATCH1]; the batch join point)
A  test/levels/ch2-batch1.test.ts            (767 lines — 58 tests)
M  test/levels/ch1-part1.test.ts            (+56 lines — the vacuity loop only)
M  test/levels/ch1-part2.test.ts            (+56 lines — the vacuity loop only)
```

`5 files changed, 1308 insertions(+)`, none deleted; no chapter-1 level data or expectation was altered, and
every pre-existing test still passes unchanged.

---

## 6. Self-review findings

1. **`LevelIo` was imported from the wrong module.** The first `tsc --noEmit` failed with 12 errors: `checks.ts`
   exports a *runtime* `LevelIo` (the bound simulation) and `tables.ts` the *pin-shape* one. Vitest transpiles
   without typechecking, so the tests were green while the build was broken. Fixed by importing the type from
   `tables.ts` with a comment naming the trap; `tsc` and `build` are now clean.
2. **`node:fs` has no types in this project** (`tsconfig`'s `types` is `["vitest/globals"]`, and there is no
   `@types/node` or `*.d.ts`), so the comment test's import carries a documented
   `// @ts-expect-error -- no Node ambient types in this project's tsconfig`. It is one line rather than adding
   a project-wide types dependency, it is exercised at runtime by the test itself, and it fails loudly (TS2578,
   unused directive) if a later task adds Node types — at which point the directive should simply go.
3. **The `valueRows` shim.** `generateRows` is typed against a whole `LevelSpec` but reads only `io`, so levels
   15–17 hand it a spec-shaped value with empty strings and `checks: []` (documented at the function, "which is
   why `checks` is [] here and never on a level"). The cleaner fix — typing `generateRows` against `LevelIo`
   as `truthTable` already is — means editing `src/levels/checks.ts`, which this task may not touch.
4. **The vacuity invariant exists in three copies** (both chapter-1 loops inline, as instructed, plus the
   chapter-2 copy). Hoisting it into `test/fixtures/` would need a file outside the declared scope; the
   chapter-2 copy is the one that is self-tested, and each copy's comment names the other two so drift is
   visible. The chapter-1 copies' new branches are therefore not exercised by chapter-1 data (which has no
   `constraint`/`fuzz`/`custom` checks) — that is inherent, and RED 3 is what demonstrates the branches are
   load-bearing on data that does.
5. **`tick: 0` is included on all five targets**, matching all twelve chapter-1 levels, and is genuinely 0 for
   every solution here (no check in the batch ticks). If "only include a metric the level actually measures
   meaningfully" is read as excluding a metric that is always 0, deleting `tick` from the five `threeStar`
   objects and the equality test's expectation is the whole change — but that would then differ from chapter 1.
6. **The `threeStar === metrics` equality test is deliberately strict.** It enforces chapter 1's documented
   convention ("three-star target = the reference solution's own metrics"), so a later deliberate loosening
   must change the test as well. That is the intent, not an oversight.
7. **The comment test parses source text with a regex**, so it pins that the `SOURCED`/`AUTHORED` marker block
   exists and is attached to the right level — not that its prose is accurate. Accuracy is a review question;
   §1 is my account of what each comment claims.
8. **My first parity row expectation was wrong** (`a = 3` → 1; `0b11` is two ones, so 0). Caught by RED 2, fixed
   in the test, and the incidence is recorded in a comment at that line rather than quietly corrected.
9. **The `add8` claim in level 17's comment is now tested** (72 gates / 1 delay / 1 star) instead of asserted.

---

## 7. Concerns and open questions

**A. Level 13 is unbuildable for a first-time player (blocking the level, not the commit).** This is the one
thing I could not resolve inside my file scope, and I could not ask: `ask_user_question` is unavailable in this
session ("human interaction is unavailable while the calling agent is owned by another live agent"). The
reasoning, in full:

- Parity cannot be computed from `a` with chapter-1 parts. Every chapter-1 part has 1-bit pins, and
  `compile()` wires a connection at `Math.min(fromWidth, toWidth)` bits, so a wire from the 4-bit `IN_a.out` to
  any 1-bit input copies **bit 0 only** — bits 1–3 are unobservable. Parity is not a function of bit 0.
- The only part that can expose bits 1–3 is `splitter`, which is **level 13's own reward** (the brief says so,
  and its `allowedComponents` lists it, as required).
- `paletteDefsFor` (`src/app/progress.ts:108`) offers `level.allowedComponents` filtered by
  `unlockedComponents`, which is the rewards of **passed** levels plus the starter set. On a first attempt at
  level 13 nothing has unlocked `splitter`, so the palette cannot build any passing circuit.
- The plan's own unlock rule ("每一关用到的组件，必须在该关之前已经解锁（否则玩家卡死）") reads "unlocked **by**"
  rather than "strictly before" for rewards, so the *data* is consistent; it is the palette rule that is not.

Two fixes, both outside the files this task may touch, one line each:

1. **Preferred:** make the level being played also offer its own rewards (in `paletteDefsFor`, add
   `level.rewards?.components` to the unlocked set before filtering). I verified this changes **nothing** for
   chapter 1: no chapter-1 level lists its own reward in `allowedComponents`, so every chapter-1 palette is
   bit-identical. It also makes "unlocked at or before it" literally true, and it is what makes the brief's
   requirement ("level 13's `allowedComponents` must include `splitter`/`maker`/`const8` as its own reward")
   mean something at play time.
2. **Alternative:** move `splitter`, `maker`, `const8` to chapter-1 level 12's rewards and drop them from level
   13. That edits reviewed chapter-1 data and gives level 12 an unmotivated reward, but it needs no app change.

The level data, the checks and the tests are correct either way. The concern is playability, and it belongs to
Task 7 (which owns `src/app/progress.ts` and `content/index.ts`) or Task 12 (the unlock-chain validation).
`test/levels/ch2-batch1.test.ts`'s last describe block pins the current placement and says in its own comment
that it should be deleted if the rewards move.

**B. Levels 15 and 16 have the same function and the same targets.** The brief's table gives both a 3-bit count
("4 位量化成 3 位计数" and "4 个 1 位信号相加"), so `a:4 → out:3` popcount and `a,b,c,d:1 → out:3` count coincide,
as do their metrics (`28/3/0`). The levels still differ in I/O shape (a wide value that must be split first vs
four pins that arrive apart) and in what each hint teaches, and the coincidence follows from the brief rather
than from my choice — but it is the sort of thing a reviewer should rule on. If level 15 was meant as a
saturating 4→3-bit quantizer (`min(a, 7)`) or a truncation (`a & 7`) instead, the expectation function, the
reference, the target and the level comment are the only things that change; I chose the counting reading
because two independent sentences in the brief say "计数" (counting).

**C. Cross-task finding: `mem1` is unlocked by nothing.** The phase-1 ledger (line 107) records "`mem1` is a
chapter-1 level-8 reward (Phase 0 fact), so level 28's latch has a part to build with", and my task prompt
repeats it. In the shipped tree that is not so: chapter 1's rewards are `nand, not, and, or, nor,
[const_on const_off], [delay_line xor], and3, or3, xnor` — ch1-08 rewards `and3`, and `grep mem1 src/levels`
matches nothing. `mem1` is therefore in no level's palette and can never be unlocked, which is the same class
of defect as concern A and would surface at Task 11's level 28 if that level's reference needs it (its brief
does not mention `mem1`). Recommend confirming the intent before Task 11 rather than fixing here — `mem1` is
not offered anywhere in this batch, deliberately.

**D. Chapter 2 is not in `ALL_LEVELS` yet, by scope.** `src/levels/content/index.ts` (which `LEVELS` and
`LEVEL_ORDER` come from) is Task 7's file, and `ch1-part1.test.ts`'s `levelsOfChapter(2)).toEqual([])` may only
be touched for the vacuity loop — so `ch2/index.ts` exports `CH2_LEVELS` as the join point and nothing wires it
into the game yet. When Task 7 adds it, the five levels become reachable and `LEVEL_ORDER` becomes 17 ids.

**E. One thing I would ask for if I could:** whether concern A's fix (1) is approved, and whether level 15's
mechanic is the counting reading. Both are cheap to change now and expensive after the next three batches
follow this file's shape.

---
---

# Fix report — own-reward palettes, `mem1` reachability, and the whole-set buildability check

**Status:** DONE
**Base:** `746758a` · **Commit:** `9c8bf1d` — `fix(progress): offer a level its own rewards, and unlock mem1 from ch1-12`
(6 files changed, 583 insertions(+), 21 deletions(-); `test/levels/level-buildability.test.ts` is new)
**Worktree:** `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`)
**Scope actually touched:** `src/app/progress.ts` (Fix 1), `src/levels/content/ch1/part2.ts` (Fix 2 — the
`mem1` reward and its data comment only), `src/levels/content/ch2/batch1.ts` (level 13's comment only),
`test/app/progress.test.ts`, `test/levels/ch2-batch1.test.ts`, `test/levels/level-buildability.test.ts`
(new, Fix 3). `src/core/`, `src/ui/`, `src/levels/checks.ts`, `src/levels/content/index.ts` and the other
chapters' content are untouched; `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left
modified and **not** committed, as instructed.

This closes §7 concerns **A** (level 13 unplayable) and **C** (`mem1` unlocked by nothing) from the part above,
and adds the machine check that would have found both.

---

## F1. A level's own rewards are offered in its own palette

`paletteDefsFor` (`src/app/progress.ts`) now folds `level.rewards?.components` into the unlocked set before
filtering by `allowedComponents`:

```ts
const unlocked = new Set([
  ...unlockedComponents(progress, levels),
  ...(level.rewards?.components ?? []),
]);
return level.allowedComponents.filter((def) => unlocked.has(def));
```

The doc comment records the rule, the reason, and **the deliberate asymmetry**: a level's own reward is
offered to *build* with, but the palette stays bounded by that level's `allowedComponents`, so a part the
level does not offer stays out even once it is unlocked. The other half — a level may not offer a part no
level at or before it hands out — is not enforced in that function at all, because it is a property of the
level data; Fix 3 walks it.

`unlockedComponents` is deliberately **not** changed: a save must not gain parts from levels the player has
not passed. `test/app/progress.test.ts` pins that boundary (`does not treat an unpassed level own reward as
earned`).

### No chapter-1 palette changes — measured, not assumed

Both halves of the claim are asserted in `test/levels/level-buildability.test.ts` (`chapter 1 palettes are
unchanged by offering a level its own rewards`): no chapter-1 level lists its own reward, and every
chapter-1 reference solution draws only on parts an **earlier** level rewards (`unlockedComponents` of the
progress *before* the level).

Measured as well, by dumping every shipped level's palette under the old rule and the new one with a
temporary probe test (deleted before the commit):

```
$NODE $PNPM test test/levels/palette-dump.test.ts --silent=false
  task-8-fix-palette-before.txt / -after.txt / -diff.txt
```

| | result |
|---|---|
| chapter-1 palettes | **12 of 12 byte-identical** (0 differing lines) |
| `ch2-13` | gains `splitter`, `maker`, `const8` — its own rewards; this is the fix |
| `ch2-15` | gains `less_u`; `ch2-16` gains `equal8`; `ch2-17` gains `add8`, `mul8` — each level's own listed rewards |
| `ch2-14` | unchanged (it rewards nothing) |

So the change is provably a no-op for everything the game ships today (chapter 2 is not joined, §F3), and for
chapter 2 it changes exactly the levels whose own rewards they list.

## F2. `mem1` is reachable, from `ch1-12`

`ch1-12-binary-racer` now carries `rewards: { components: ['mem1'] }`, with the rationale in the level data
(chapter 1's last two levels rewarded nothing; chapter 2's latch level is built from a 1-bit memory; `mem1`
was defined in `core/defs/index.ts` and rewarded by no level, so it could never reach any palette; the
capstone is a plausible first home for "hold a bit").

`STARTER_COMPONENTS` is untouched — putting `mem1` there would show it in level 1's palette, which
contradicts the rule that a part appears only once a level needs it — and no new chapter-1 level was invented.

**Nothing scored moved**, verified three ways:

1. `grade()` / `gateCost()` / `scoreOf()` / `starsOf()` never read `rewards`: the only non-data readers of
   the field in `src/` are the two loops in `src/app/progress.ts` (`unlockedComponents`, `paletteDefsFor`).
2. Chapter 1's tests run **unchanged** and in the same numbers as before this commit: `ch1-part1.test.ts`
   34 tests, `ch1-part2.test.ts` 29 tests, both green.
3. Level 12's own palette is unchanged by the reward (it does not list `mem1`, and the palette is bounded by
   `allowedComponents`) — asserted on the shipped data in `level-buildability.test.ts`
   (`does not put mem1 in the capstone palette that rewards it`).

## F3. The machine check

**It is a new file: `test/levels/level-buildability.test.ts` (40 tests).** The alternative home,
`test/levels/ch2-batch1.test.ts`, owns chapter 2 only and is already 767 lines; the walk needs the whole
shipped set plus its own reference-solution map, and folding it in would have mixed "levels 13-17 are
correct" with "no level in the game is unbuildable".

It walks `LEVELS` / `LEVEL_ORDER` from `src/levels/index.ts` (never a hardcoded list) and calls
`paletteDefsFor` itself — the palette is never re-derived. For every shipped level, reached with every
**prior** level passed and the level itself untouched:

1. **the palette can build the reference** — every def instance in the level's reference solution is in
   `paletteDefsFor(progressBefore(index), SHIPPED, level)`;
2. **no level offers a part it has not earned** — every name in `allowedComponents` is a starter or rewarded
   by a level at or before it, and (the other direction, same walk) every name in the resulting palette is in
   `allowedComponents`.

Two more blocks name the two defects: `chapter 1 palettes are unchanged …` (§F1) and
`the latch part chapter 2 builds from is reachable` (a player who has finished chapter 1 owns `mem1`).

**Chapter 2 is not joined into `LEVEL_ORDER` yet** (assembly is a later task, and
`src/levels/content/index.ts` is not mine to edit). The shipped set is therefore
`LEVELS` + `CH2_LEVELS` filtered to ids not already in `LEVEL_ORDER`, which means the walk covers **17 levels
today**: chapter 1 (joined, reachable in the game) and chapter 2 levels 13-17 (shipped data, reachable only
through `CH2_LEVELS`). A test asserts a reference is filed for every id in that set, so a level cannot be
shipped without entering the walk. **When assembly lands**, `content/index.ts` appends `CH2_LEVELS`, the
filter drops to nothing and the same tests cover every joined id — including the later batches' levels 18-38
as each is added to `CH2_LEVELS`, which is what makes "level 28 has no latch part" a test failure rather than
a discovery: the moment level 28 lists `mem1`, check 2 requires that some level at or before it rewards it.

### The reference-solution copies, and why they cannot rot quietly

The walk has to hold a graph per level, and the graphs live in the per-chapter test files (`ch1-part1`,
`ch1-part2`, `ch2-batch1`). Those files are not in this task's scope, so the new file files its own copy of
all 17. The copy is anchored: a test grades every filed reference against the level it is filed under, so a
copy that stops being a solution fails loudly instead of silently weakening check 1. Hoisting the three maps
into `test/fixtures/` is the cleanup once assembly lands and the chapter-1 test files are in scope.

---

## RED → GREEN

Commands are the bundled runtime, run from the worktree (bare `pnpm` on this host's PATH is a broken
wrapper): `$NODE = …\dependencies\node\bin\node.exe`, `$PNPM = …\dependencies\pnpm\bin\pnpm.mjs`.

**RED 1 — the buildability walk (log `task-8-fix-red-buildability.txt`).** Written first, against the
unfixed tree:

```
$NODE $PNPM test test/levels/level-buildability.test.ts      → exit 1, 3 failed | 37 passed (40)
  × every shipped level can build its own reference solution > ch2-13-odd-number-of-signals
      ch2-13-odd-number-of-signals uses splitter, which its palette does not offer
      (palette: nand, not, and, or, nor, xor, xnor, and3, or3, const_on, const_off, delay_line,
       level_input, level_output)
  × the latch part chapter 2 builds from is reachable > hands mem1 to the player by the end of chapter 1
      mem1 is unlocked by no shipped level: expected false to be true
  × the latch part chapter 2 builds from is reachable > does not put mem1 in the capstone palette …
      expected [] to include 'mem1'
```

The 37 that pass are the point: every other shipped level's reference is buildable, and every provenance
check passes — the two defects are exactly the two the audit named, and level 13 is the only unbuildable
level in the game.

**RED 2 — the rule itself (`task-8-fix-red-progress.txt`).**

```
$NODE $PNPM test test/app/progress.test.ts                   → exit 1, 2 failed | 16 passed (18)
  × paletteDefsFor > offers a level its own rewards, before they are earned
  × paletteDefsFor > keeps a reward the level does not offer out of its palette
```

**GREEN (logs `task-8-fix-green-focused.txt`, `task-8-fix-green-full.txt`, `task-8-fix-tsc.txt`,
`task-8-fix-build.txt`, `task-8-fix-smoke.txt`):**

```
focused  $NODE $PNPM test test/levels/level-buildability.test.ts test/app/progress.test.ts \
                          test/levels/ch2-batch1.test.ts test/levels/ch1-part1.test.ts test/levels/ch1-part2.test.ts
         Test Files 5 passed (5)   Tests 179 passed (179)
         (progress 18, ch1-part1 34, ch1-part2 29, level-buildability 40, ch2-batch1 58)
full     $NODE $PNPM test                    Test Files 19 passed (19)  Tests 544 passed (544)
tsc      $NODE $PNPM exec tsc --noEmit       exit 0 (empty output)
build    $NODE $PNPM build                   exit 0 (tsc --noEmit && vite build, 34 modules, built in 57ms)
smoke    $NODE $PNPM smoke                   2 passed (4.9s)  — playwright, level 1 end to end
```

Full-suite arithmetic: 500 → 544 = +40 (the new file) +4 (`progress.test.ts`: 14 → 18).

| log | what it holds |
|---|---|
| `task-8-fix-red-buildability.txt` | RED 1 — level 13 unbuildable, `mem1` unreachable, 3 failed / 37 passed |
| `task-8-fix-red-progress.txt` | RED 2 — the two own-reward rules, 2 failed / 16 passed |
| `task-8-fix-palette-before.txt` | every shipped palette under the OLD rule (the probe's `--silent=false` output filtered to the `ch…` lines; unfiltered run in `…-before-raw.txt`) |
| `task-8-fix-palette-after.txt` | the same under the NEW rule (`…-after-raw.txt` unfiltered) |
| `task-8-fix-palette-diff.txt` | the diff: 0 chapter-1 lines, 4 chapter-2 lines — each gaining its own listed rewards |
| `task-8-fix-green-focused.txt` | GREEN — 179 tests in 5 files |
| `task-8-fix-green-full.txt` | GREEN — 544 tests in 19 files |
| `task-8-fix-tsc.txt` | `tsc --noEmit`, exit 0 (empty) |
| `task-8-fix-build.txt` | `pnpm build`, exit 0 |
| `task-8-fix-smoke.txt` | `pnpm smoke`, 2 passed |
| `task-8-fix-green-full-postcommit.txt` | re-run on the committed tree — see finding 6: a sibling task's untracked `ch2-batch2.test.ts` appeared mid-run |
| `task-8-fix-commit-msg.txt` | the commit message used |

---

## Existing tests and comments this fix had to change

Named here rather than buried, because each one was *wrong under the new rule* or *described the defect as
permanent*:

1. **`test/app/progress.test.ts`** — the old expectation `paletteDefsFor(emptyProgress(), levels, other)
   === ['level_input','level_output']` is exactly what Fix 1 changes: `other` lists the two parts it rewards,
   so its palette is now `['nand','not','level_input','level_output']`. The *filtering* assertion it carried
   is preserved with a new third fixture (`gated`, no rewards, offers `xor`, which nobody rewards), and the
   changed behaviour has its own named test. The fixture's header comment (about the brief conflict) is
   still accurate and untouched.
2. **`test/levels/ch2-batch1.test.ts`** — `the level-13 unlock seam` is renamed
   `level 13 is where the wide parts first appear`; its data assertion is unchanged and still true, but the
   comment now records that this is no longer a defect and what the fix was.
3. **`test/levels/ch2-batch1.test.ts`**, `reference solutions are buildable from the palette they are graded
   against` — assertion unchanged, with a `NOTE` added: it checks `allowedComponents`, not the palette, and
   that is precisely why it could not catch level 13. The palette version is in the new file.
4. **`src/levels/content/ch2/batch1.ts`**, level 13 — the `KNOWN SEAM` paragraph is replaced by the
   resolution (own rewards are offered; the rule and its asymmetry). `SOURCED`/`AUTHORED` markers are intact,
   so the marker test still holds.
5. `.superpowers/.../progress.md` — the controller's ledger, left modified and uncommitted.

Levels 15 and 16 keep sharing the popcount function and their expectations are untouched, as instructed.

---

## Self-review findings and remaining concerns

1. **The reference-solution copy in the new file is duplication** (17 graphs also kept by the per-chapter
   files that measured the targets). It is forced by this task's file scope and anchored by grading every
   copy, but a reviewer should know it is there: hoisting the three maps into `test/fixtures/level-solutions.ts`
   is the right cleanup and needs a file outside this task's declared scope.
2. **`mem1`'s old defect is not caught by a direct rule.** "Every def the registry ships must be rewarded
   somewhere" cannot be asserted today — most defs are deliberately unreleased (`mux8`, `delay8`, `reg8`,
   `counter8`, `ram8`, `and8`, `shift_l8`, …), and `ch2-batch1.test.ts` asserts several of them stay
   unreachable inside this batch. What Fix 3 does give is the rule that would have caught the *symptom*: the
   moment a level lists a part no level at or before it rewards, check 2 fails — which is what level 28's
   `mem1` would have done before Fix 2. On top of that the new file asserts `mem1` positively (a player who
   has finished chapter 1 owns it).
3. **Fix 1 changes four chapter-2 palettes** (13, 15, 16, 17 — each gains its own listed rewards). That is
   the rule working, but it is a wider behavioural change than "level 13 gets its splitter", so it is
   measured and tabulated in §F1 rather than described. None of those levels is reachable in the app yet
   (chapter 2 is unjoined), and chapter 1's twelve palettes are bit-identical, so no shipped-runtime
   behaviour changes; the smoke test confirms the app end to end.
4. **The walk models reachability as "prior in the shipped order"**, not by calling `isUnlocked`. For a
   strictly linear chain (`isUnlocked` needs the immediate predecessor passed, and the walk passes all of
   them) the two coincide; if a later chapter ever unlocks non-linearly, this helper is the place to revisit.
5. **Fix 2 hands `mem1` to a level whose reference does not use it.** That is deliberate — the reward exists
   for chapter 2, and a reward is not a score line — but it does mean chapter 1's capstone rewards a part its
   own palette does not offer. The asymmetry is asserted, not merely documented, in
   `level-buildability.test.ts`.
6. **A sibling task is working in this same worktree while I finished.** `test/levels/ch2-batch2.test.ts`
   (untracked, 39 KB, written 02:38:19) appeared *after* my full-suite run and imports
   `src/levels/content/ch2/batch2`, which does not exist yet, so a re-run of `pnpm test` on the committed tree
   reports `1 failed | 19 passed (20) files, 544 passed (544) tests`. That failure is not mine and I did not
   touch, commit or delete that file. The authoritative green run for this commit is
   `task-8-fix-green-full.txt` (02:37:01, **19 files / 544 tests passed**), taken on exactly the tree that was
   committed — 18 pre-existing files plus the new one, before the sibling's file existed. Anyone re-running the
   suite in this worktree now will see the sibling's RED, not a regression from this commit.
