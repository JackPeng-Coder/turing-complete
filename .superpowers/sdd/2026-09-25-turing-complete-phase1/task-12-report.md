# Task 12 — chapter assembly and phase-1 end-of-phase verification

Worktree: `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`, base `650d19c`).
Scope: join chapter 2 into the shipped level list, extend the whole-set walks to it, add the
phase-level unlock-chain test, housekeeping, and full verification (tests / tsc / build / smoke).

**Status: DONE_WITH_CONCERNS.** Every task is complete and all four verification commands pass, but
three things need the controller's attention: three stale assertions inside the **chapter-1 test
files** had to be touched (section *Deviations*), the unlock-chain walk surfaced two
**spec-vs-level-data disagreements** (`ram8`, `switch`/`switch8`) that are reported rather than
exempted (section *Task 3*), and **another session is working in this same worktree** — its test
edits were briefly swept into my first commit attempt and were removed by amending (section *The
shared worktree*, and the commit is `e0e8a2d`, verified standalone).

---

## Task 1 — the assembled set

* `src/levels/content/ch2/index.ts` now exports `CH2_LEVELS` as all four batches in order:
  `[...CH2_BATCH1, ...CH2_BATCH2, ...CH2_BATCH3, ...CH2_BATCH4]`.
* `src/levels/content/index.ts` appends the chapter after chapter 1:
  `ALL_LEVELS = [...CH1_PART1, ...CH1_PART2, ...CH2_LEVELS]`. Nothing sorts or filters it
  afterwards, so `LEVEL_ORDER[n + 1]` really is level `n + 1`'s successor — the invariant
  `isUnlocked` (immediate predecessor) is written against.

**Assembled-set check (new tests, `test/levels/level-buildability.test.ts`,
`describe('the assembled set is chapter 1 then chapter 2, in order')`):**

| claim | assertion | result |
|---|---|---|
| whole set | `LEVELS.length === 38`, `LEVEL_ORDER.length === 38` | pass |
| no duplicate id | `new Set(LEVEL_ORDER).size === 38` | pass |
| chapter 2 whole & in order | `LEVELS.filter(chapter 2).map(id)` equals `CH2_LEVELS.map(id)` | pass |
| chapter 2 size | `26` levels | pass |
| indices contiguous + unique | `[13..38]` exactly, `new Set(indices).size === 26` | pass |
| chapter 1 first, only it | `12` levels, and `LEVEL_ORDER.slice(0, 12)` is those 12 ids | pass |

`test/levels/unlock-chain.test.ts` re-asserts the chapter-2 half independently (rule 4, below) and
`LEVEL_ORDER.slice(12)` equals `CH2_LEVELS.map(id)`.

## Task 2 — the buildability walk

`test/levels/level-buildability.test.ts`:

* **`NOT_JOINED_YET` removed — yes, it is gone.** It existed only to add chapter-2 levels that were
  shipped data but not in `LEVEL_ORDER`; with the chapter joined the filter matches nothing, so
  `SHIPPED` is now simply `LEVELS`. The header comment that described the pre-join state was
  rewritten to describe the joined one, and the join itself is now asserted (Task 1's block) instead
  of being implied by a sibling list.
* **The chapter-2 references were hoisted, not copied 22 more times.**
  `test/fixtures/ch2-references.ts` is new and holds all 26 chapter-2 reference circuits, moved
  verbatim out of the four batch test files, with `CH2_BATCH{1..4}_REFERENCES` (one map per batch)
  and `CH2_REFERENCES` (their union, in index order) exported alongside the four helpers the batch
  tests borrow (`bits`, `byteOrReference`, `byteNotReference`, `logicEngine`, plus
  `fullAdderReference` / `rippleAdderReference`, which those files measure directly).
  `test/levels/ch2-batch{1,2,3,4}.test.ts` import their own slice back as `solutions`, so all three
  per-batch blocks (`reference solutions pass with three stars`, `three-star targets are the
  reference solutions own metrics`, `reference solutions are buildable from the palette they are
  graded against`) still grade exactly their own levels. Chapter 1's twelve stay inline in the walk
  (this task may not edit the chapter-1 test files that own them), so the walk is now
  `{ ...12 chapter-1 circuits, ...CH2_REFERENCES }` — 38 entries, one per shipped level, held by
  the existing `files a reference solution for every shipped level` and
  `grades every filed reference against the level it is filed under` tests. **The walk was not
  weakened: it grew from 17 ids to all 38, with one definition per circuit instead of two copies
  that could drift.**
* **A third derived walk needed the same extension.** `test/levels/grader.test.ts` walks
  `LEVELS` and demands a reference circuit per shipped level; the join made it demand 26 more. It now
  uses `{ ...ch1Reference, ...CH2_REFERENCES }` for that one block (coverage 12 → 38; the
  chapter-1 frozen-metrics block is untouched). See *Deviations* — this file was not in the listed
  scope, but leaving it would have been a red suite.
* `test/levels/ch2-batch1.test.ts`'s `expect(CH2_LEVELS).toEqual([...CH2_BATCH1])` — a claim that the
  chapter was batch 1 alone — was rescoped to `CH2_LEVELS.slice(0, CH2_BATCH1.length)`, i.e. "this
  batch is the chapter's first slice"; the whole-chapter shape is the new unlock-chain test's.

## Task 3 — the unlock-chain test

New: `test/levels/unlock-chain.test.ts` (35 tests). It takes spec §3.3's chapter-2 list **from the
spec, not from the levels** (33 names, copied once — a list derived from the data could not fail),
and asserts:

1. **Rule 1** — for every chapter-2 level, every `allowedComponents` name is a starter or is
   unlocked by a level at or before it: **26/26 pass**. (At-or-before, not before: a level's own
   rewards are offered to build with, which is how level 13 gets the splitter it rewards.)
2. **Rule 2** — every component in §3.3's chapter-2 list is unlocked by **exactly one** level:
   **passes, with exactly the two ruled deviations and no others.**
   * `mem1` — exactly one unlocker, `ch1-12-binary-racer` (chapter 1, index 12), and **no**
     chapter-2 level rewards it. Pinned by its own test.
   * `decoder2` — **zero** unlockers, as ruled. It is registered and reachable, asserted directly:
     `registry.has('decoder2')`, `DECODER_DEF_IDS === ['decoder1','decoder2','decoder3']`, pins
     `sel:2 → out:4`, and `evaluate` driven over all four select values publishes `2**sel`
     (one-hot). Its siblings are each unlocked once: `decoder1` ← `ch2-25-1-bit-decoder`,
     `decoder3` ← `ch2-26-3-bit-decoder`.
   * **No component in the list is unlocked by zero (other than `decoder2`) or by two levels** —
     the rule `hands out every listed part at exactly one chapter-2 level, bar the rulings` reports
     offenders by name and its list is empty. There is no third exemption.
3. **Rule 3** — every component any shipped level offers (both chapters) is unlocked at or before
   the **first** level that lists it: **passes**, no component is offered before anything unlocks it.
4. **Rule 4** — chapter 2 is exactly 26 levels, indices 13–38, contiguous (`[13..38]`), unique by
   index and by id, and identical to the `CH2_LEVELS` join point with nothing in front of it:
   **passes**.

### Two findings (reported, not exempted)

Neither is a rule-2 violation — both are unlocked by exactly one level — but both are places where
the **level data disagrees with spec §3.3**, so each has its own named test that pins the fact and
fails if a *further* unnamed part appears or an unlock moves:

* **`ram8` is rewarded by a chapter-2 level and appears nowhere in §3.3.**
  `ch2-28-circular-dependency` rewards `ram8`; §3.3's chapter-2 row names 33 parts and no RAM, and
  `ram8` does not appear anywhere in the spec (its RAMs are `ram_prog` in ch3 and the `ram*` family
  in ch5). It is load-bearing rather than stray: level 28 does not list it, level 37 does, and
  `test/levels/level-buildability.test.ts` requires every offered part to be earned at or before the
  level — so if level 28 stopped rewarding it, level 37 would offer a part no level unlocks. Level
  28's own data comment rules on it explicitly ("`ram8` is this level's reward and is deliberately
  not in its palette … exactly as chapter 1's capstone rewards `mem1` without listing it").
  **Ruling needed:** add `ram8` to §3.3's chapter-2 row, or rename/re-site the part.
* **`switch`/`switch8` unlock at level 22; §3.3's prose (line 116) says level 32.**
  Both are rewarded exactly once, by `ch2-22-adding-bytes`, and level 32 (`ch2-32-bit-switch`)
  rewards nothing while offering `switch`. The data cannot follow the prose: level 22 lists both in
  its own palette and level 28's reference is built from two `switch` parts with `switch` in its
  palette, and a level may only offer what is unlocked at or before it. **Ruling needed:** correct
  §3.3's note to level 22, or move the reward (which would force level 22/28's palettes and level
  28's reference to change).

## Task 4 — housekeeping

* **`logs/` — nothing to delete.** There is no `logs/` directory at the worktree root (it does not
  exist, ignored or otherwise), `git ls-files logs` is empty, and no task report or brief in
  `.superpowers/sdd/2026-09-25-turing-complete-phase1/` references one. Nothing was removed.
* **`README.md`** now describes chapters 1–2 / 38 levels: "What works today (Phases 0–1)" with a
  chapter-2 bullet naming what the chapter teaches, the not-built list narrowed to chapters 3–7
  (OVERTURE and LEG CPUs, programming, assembly challenges, sandbox), the project-layout line
  (`content/ (38 levels: chapters 1–2)`), and the scope paragraph ("Phases 0–1 cover chapters 1–2
  (38 of the plan's 82 levels)"). No overstatement: nothing CPU/programming/sandbox is claimed.
* **`docs/superpowers/plans/2026-09-25-turing-complete-phase0.md` — the table was regenerated from
  the level data, not deleted.** Rows 86–99 (the chapter-1 summary table) were re-generated from
  `src/levels/content/ch1/*.ts` by a throwaway script that printed the rows from the same data the
  game reads, and spliced them in (13 lines changed, `git diff` shows exactly that block plus the
  table's own note). The old table contradicted the code in two ways, both fixed: the `gate`/`delay`
  target column predated the NAND re-pricing (row 6 `gate:2`→`4`, row 10 `gate:2`→`6`, row 11
  `gate:2`→`4`), and row 12's unlock column said `—` when the level rewards `mem1`. The column
  conventions are now stated above the table, prose notes were dropped in favour of machine-derived
  cells, and the note says the authoritative definition is always the level data, with
  `test/levels/level-buildability.test.ts` + `test/levels/unlock-chain.test.ts` as its machine check.

## Task 5 — end-of-phase verification

All four commands run from the worktree root; logs beside this report in `task-12-logs/`.

### `pnpm exec tsc --noEmit` → exit 0 · `task-12-logs/task-12-tsc.log`

```
### pnpm exec tsc --noEmit
```
(no diagnostics; empty output is the pass)

### `pnpm test` → exit 0 · `task-12-logs/task-12-full-suite.log` and `task-12-full-suite-final.log`

First run (shared worktree, before the other session committed):

```
 Test Files  24 passed (24)
      Tests  911 passed (911)
   Duration  2.61s (tests 41%, transform 32%, import 15%, environment 9%, worker 3%)
```

Final run (shared worktree at `8666ed2`, i.e. my commit plus the other session's follow-up):

```
 Test Files  23 passed (23)
      Tests  913 passed (913)
```

Per-file, for the files this task touched:

```
 ✓ test/levels/ch1-part1.test.ts (34 tests) 24ms
 ✓ test/levels/ch1-part2.test.ts (29 tests) 32ms
 ✓ test/levels/ch2-batch1.test.ts (58 tests) 139ms
 ✓ test/levels/ch2-batch2.test.ts (56 tests) 601ms
 ✓ test/levels/ch2-batch3.test.ts (68 tests) 1805ms
 ✓ test/levels/ch2-batch4.test.ts (126 tests) 426ms
 ✓ test/levels/grader.test.ts (66 tests) 754ms
 ✓ test/levels/level-buildability.test.ts (85 tests) 777ms
 ✓ test/levels/unlock-chain.test.ts (35 tests) 24ms
```

### My commit, verified standalone · `task-12-logs/task-12-commit-isolated.log`

Because the shared worktree carried another session's uncommitted work, `e0e8a2d` was also checked
out clean (`git worktree add --detach`, with `node_modules` junctioned) and verified on its own:

```
$ git rev-parse HEAD
e0e8a2d2440eb4ff5efeb96e0f1ab54e25d51734
$ git status --short          # empty: a clean checkout of exactly the commit
$ vitest run
 Test Files  23 passed (23)
      Tests  909 passed (909)
$ tsc --noEmit                # exit 0, no diagnostics
$ vite build
✓ built in 68ms
```

The temporary verification worktree was removed afterwards (`git worktree list` shows only the
repository and `phase1`).

### `pnpm build` → exit 0 · `task-12-logs/task-12-build.log`

```
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 39 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.42 kB │ gzip:  0.31 kB
dist/assets/index-BJi6Tn_M.css   2.31 kB │ gzip:  0.88 kB
dist/assets/index-Cx4ms12B.js   98.35 kB │ gzip: 34.54 kB

✓ built in 60ms
```

### `pnpm smoke` → exit 0 · `task-12-logs/task-12-smoke.log`

```
Running 5 tests using 1 worker

ok 1 test\smoke\ui.spec.ts:84:1 › level 1 is playable end to end and shows its epilogue (586ms)
ok 2 test\smoke\ui.spec.ts:107:1 › progress survives a reload and unlocks the next level (684ms)
ok 3 test\smoke\ui.spec.ts:139:1 › chapter 2 is reachable: level 13 opens once chapter 1 is passed (291ms)
ok 4 test\smoke\ui.spec.ts:173:1 › a chapter-2 level opens and grades end to end (1.2s)
ok 5 test\smoke\ui.spec.ts:212:1 › the last chapter-2 level opens: level 38 is reachable (269ms)

  5 passed (8.2s)
```

### Is the game actually playable end to end?

The smoke suite starts its own server (`pnpm build && pnpm preview --port 4173`), so these are real
browser runs against the built app. `test/smoke/ui.spec.ts` grew from 2 tests to 5; the two
chapter-1 tests are unchanged.

* **Level 13 is reachable — yes.** `chapter 2 is reachable: level 13 opens once chapter 1 is passed`
  seeds a save with levels 1–12 passed (via `addInitScript` + `STORAGE_KEY`, ids from `LEVEL_ORDER`),
  and the app resumes on level 13: the shell bar reads `2-13 奇数个信号`, the palette offers
  `位拆分器` (the splitter level 13 rewards — the part without which its 4-bit input cannot be read),
  the level's checker is mounted, the **map has all 38 tiles** with tile 13 enabled and tile 14
  disabled (linear unlocking survives the join), and clicking tile 13 opens the level.
  Evidence: `task-12-evidence/smoke-ch2-level13-open.png`.
* **Level 38 is reachable — yes.** `the last chapter-2 level opens: level 38 is reachable` seeds
  1–37 and resumes on level 38 (`2-38 计数器`): 38 map tiles, tile 38 enabled with text
  `38. 计数器`, opening it shows the board with the level's own palette (`8 位寄存器`) and its
  checker. Evidence: `task-12-evidence/smoke-ch2-level38-open.png`.
* **A chapter-2 level opens AND grades — yes.** `a chapter-2 level opens and grades end to end`
  resumes on level 31 (`1 位取反器`, one XOR), builds its reference solution with the mouse (two
  level inputs, an `异或门`, a level output, three wires), and the app reports
  **`全部用例通过`** with `门 4 · 延迟 1 · 拍 0` — matching that level's three-star target — and then
  the epilogue. Passing wrote progress for real: after dismissing it, the map shows a ★ on tile 31
  and tile 32 enabled.
  Evidence: `smoke-ch2-level31-parts-placed.png`, `smoke-ch2-level31-passed.png`,
  `smoke-ch2-unlocked-next.png`.

Screenshots were copied to `task-12-evidence/` (the run itself wipes `test-results/`).

---

## Deviations and things the controller should rule on

1. **Three stale assertions inside the CHAPTER-1 test files were edited — this needs a ruling.**
   Joining chapter 2 makes them false by construction, and they are statements about the *unjoined*
   chapter rather than about chapter 1:
   * `test/levels/ch1-part1.test.ts` — `expect(levelsOfChapter(2)).toEqual([])` (in `lists a chapter
     by number`) **deleted**, with a comment saying why and where chapter 2 is now asserted. The
     chapter-1 half of that test is unchanged.
   * `test/levels/ch1-part2.test.ts` — `expect(LEVEL_ORDER).toEqual([...CH1_PART1, ...CH1_PART2]
     .map(id))` **scoped** to `LEVEL_ORDER.slice(0, chapter1.length)`, mirroring the pattern
     `ch1-part1.test.ts` already uses for its own half (that file's comment says pinning the whole
     chapter's size "is not this file's business"). Order and ids of chapter 1 are still asserted
     exactly.
   * `test/levels/ch1-part2.test.ts` — `expect(levelsOfChapter(2)).toEqual([])` **deleted** the same
     way.
   **No chapter-1 level data, palette, reward, check or behaviour was touched** — the three sites
   are the "chapter 2 has not been joined yet" mirror, and the alternative was a permanently red
   suite. If the controller prefers, reverting these three sites and accepting three failing tests
   is a two-minute change; everything else stays green.
2. **`test/levels/grader.test.ts` was edited** (not in the listed scope). Its shipped-level walk is
   derived from `LEVELS` and demanded 26 more circuits the moment the join landed. It now merges
   `CH2_REFERENCES` into that one block. This strictly *extends* coverage (12 → 38 levels); the
   frozen chapter-1 metrics block is untouched.
3. **`test/levels/ch2-batch1.test.ts`** was edited beyond the hoist: its `CH2_LEVELS` equality
   assertion (a pre-assembly placeholder) was rescoped to the "first slice" claim.
4. **`test/core/registry.test.ts` is now redundant but still passes** — its walk is
   `[...LEVELS, ...CH2_LEVELS, ...CH2_BATCH2, ...CH2_BATCH3]`, which after the join lists chapter 2
   two to three times over. The assertions are set-union based, so it is green, and its own comment
   says the batch imports are "the one line to delete" once joined. Left alone as out of scope;
   worth a follow-up (it also never walked `CH2_BATCH4`, which the join now covers through
   `LEVELS`).
5. **Another session is working in this worktree** — see *The shared worktree* below. Its edits were
   left in place, its follow-up commit `8666ed2` sits on top of mine, and my commit contains none of
   its work.

## The shared worktree

Another session was editing `src/levels/content/ch2/batch2.ts`, `batch3.ts`, `src/core/defs/wide.ts`
and their tests *in this same worktree, concurrently with this task*. Two consequences:

* **The first commit attempt was contaminated and was caught by verification, not by reading.**
  `test/levels/ch2-batch2.test.ts` and `test/levels/ch2-batch3.test.ts` had the other session's
  in-flight edits in the working tree when I staged my own edits to those files, so the first commit
  (`a5939fa`) carried their tests for a level-data change (`full_adder` offered on level 22;
  `decoder3`'s own-reward scoring) that was **not** in the commit. Running the suite on a clean
  checkout of the commit — which is why that extra step was worth taking — failed exactly there:
  `expected [ 'nand', 'not', ... ] to include 'full_adder'`, 2 failed / 910 passed, and the two
  files' diffs against the un-contaminated reconstruction held 109 lines that are not mine.
* **Fixed by amending, without touching their work.** `test/levels/ch2-batch2.test.ts` and
  `ch2-batch3.test.ts` were rebuilt deterministically as *HEAD + my edits only* (the same hoist
  script re-run against `650d19c`'s copies, plus the import lines and batch 1's rescoped assertion),
  written into the index with `git update-index --cacheinfo` so the working tree kept their versions,
  and committed with `git commit --amend`. Batch 1's and batch 4's rebuilt copies came out
  byte-identical to what I had committed, which is the check that the reconstruction is faithful.
  The amended commit is **`e0e8a2d`**; their files remain modified-unstaged for them, and they have
  since committed their own work as `8666ed2` on top. The suite is green at both points.
* Everything in this report that quotes a verification number says which tree it came from: the
  logged four-command runs are the shared worktree, and the standalone numbers are `e0e8a2d` alone.

## Commit

`e0e8a2d` — `feat(levels): assemble chapter 2 and verify the phase end to end` — only this task's
files:
`src/levels/content/{index.ts,ch2/index.ts}`, `test/fixtures/ch2-references.ts` (new),
`test/levels/{ch2-batch1..4,level-buildability,grader,ch1-part1,ch1-part2}.test.ts`,
`test/levels/unlock-chain.test.ts` (new), `test/smoke/ui.spec.ts`, `README.md`,
`docs/superpowers/plans/2026-09-25-turing-complete-phase0.md` — 15 files, +1373/−770.
`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left modified and uncommitted, as
instructed, and so is every file belonging to the other session.

Artifacts beside this report:

| path | what |
|---|---|
| `task-12-logs/task-12-tsc.log` | `pnpm exec tsc --noEmit` (exit 0) |
| `task-12-logs/task-12-full-suite.log` | `pnpm test`, first run (24 files / 911 tests green) |
| `task-12-logs/task-12-full-suite-final.log` | `pnpm test`, final run at `8666ed2` (23 / 913 green) |
| `task-12-logs/task-12-build.log` | `pnpm build` (exit 0) |
| `task-12-logs/task-12-smoke.log` | `pnpm smoke` (5 passed) |
| `task-12-logs/task-12-commit-isolated.log` | `e0e8a2d` clean checkout: vitest 23/909, tsc 0, vite build 0 |
| `task-12-evidence/*.png` | the 8 smoke screenshots, incl. the 5 chapter-2 ones |

---

# Task 12b — the four phase-end rulings (spec §3.3 ×2, level 22's reference, level 32's comment)

Worktree `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`, base `698daa3`).
Commit **`5a113f0`** — `fix(levels): ship the four phase-end rulings on level 22 and spec 3.3` —
5 files, +217/−102, and they are **exactly** the five in-scope paths (staged by path, no `git add -A`);
`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left modified and uncommitted.

**Status: DONE.** All four rulings are applied, the suite is green at **915 passed / 23 files**,
`tsc --noEmit` and `pnpm build` both exit 0. One **out-of-scope** test file is now stale and needs a
follow-up (it still passes, but it pins the pre-ruling spec) — see *Concerns*.

## Fix 1 — §3.3's chapter-2 row: `ram8` added, and the row verified against the data

**What changed.** `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md` §3.3, the Ch2
row: `ram8` inserted after `mem1`, so the storage parts read
`` … `decoder3` `mem1` `ram8` `reg8` `counter8` `mux8` `switch8` … `` — 34 names, the rest of the row
untouched.

**How the row was verified** (per the brief: against the defs and the rewards, not the paragraph),
across the three sets that can disagree:

| set | source of truth | result |
|---|---|---|
| every def id the engine registers | `DEF_IDS` = `PHASE0_DEF_IDS` + `POST_PHASE0_DEF_IDS` + `WIDE_DEF_IDS` + `WIDE_STORAGE_DEF_IDS` + `DECODER_DEF_IDS` (`src/core/defs/index.ts`, `wide.ts`) | exactly one name absent from the table: **`ram8`**. `level_input` / `level_output` are also absent, deliberately — §3.3 line 118 calls them hidden plumbing that never enters the unlock system |
| every reward any level hands out | the 20 `rewards: { components: […] }` statements in `src/levels/content/ch1` and `ch2` | every rewarded id was already in a row except **`ram8`** (`ch2-28-circular-dependency`). **`full_adder` was already there** — it is the row's second name (line 104 begins `` `switch` `full_adder` `decoder1` … ``) |
| every id any chapter-2 level lists | the four batches' `allowedComponents` | nothing outside the row except `ram8` (listed by `ch2-37-little-box`) and the plumbing pair |

**So there is exactly one omission and it is `ram8`; there is no third omission.** The brief's
"Check — `full_adder`?" resolves to *no*: `523a7b9` registered the def and level 20 rewards it, and the
row already named it, so nothing was added for it.

**Two names in the row that no chapter-2 level rewards — neither deleted**, because both are
registered defs (the brief's report-don't-delete trigger is "no def **and** no reward"):

* **`mem1`** — chapter 2's latch level builds from it, but the data unlocks it at **chapter 1's
  capstone** (`ch1-12-binary-racer`, asserted by `unlock-chain.test.ts`), and §3.3's *Ch1* row does not
  name it while the Ch2 row does. The row is "components by unlock chapter", so this looks like a
  placement slip rather than an omission. No ruling covers it, so it was **left exactly as it was and
  reported here** — relocating it is a spec decision for the controller, not a data fix.
* **`decoder2`** — zero unlockers, by design and already pinned as a ruled deviation: the 2-to-4 form
  is registered and reachable but no level name introduces it, so no palette ever shows it. It belongs
  in the row precisely because the engine ships it as a chapter-2 part.

## Fix 2 — §3.3's `switch` note now says level 22, and records the cost

The original first sentence is kept verbatim (chapter 1 never needed conditional passing); the level
changes from 32 to 22 and the divergence is recorded in the spec itself:

> **关于 `switch`**：源资料把它列在第 1 章，但第 1 章 12 关没有任何一关需要条件通断。为了让「元件只在真正
> 用到时才出现」这条教学原则成立，`switch` 顺延到第 2 章，与 `switch8` 一起在第 22 关《8 位加法器》解锁
> ——那一关的逐位进位链需要条件通断（第 28 关的参考解也用到 `switch`），所以它在第 22 关第一次真正被需要，
> 比源资料里教这个元件的第 32 关早了十关。
>
> **这是一处相对源资料的实打实的偏离，代价记在这里**：源资料自己的第 32 关名为《1 位开关》（Bit
> Switch），是它教这个元件的地方；在本复刻里 `switch` 在第 22 关就已经交到玩家手里，因此第 32 关从
> 「首次登场」变成一次**再教**——它验证的是玩家能否把这个条件通断的行为搭出来（`and(a, on)` 与
> `switch` 在计分上完全同价），而不是介绍一个陌生的元件。关卡数据即以此为准。

## Fix 3 — level 22's reference is the eight-`full_adder` cascade; `threeStar` re-measured from it

All three circuits below were graded against `ch2-22-adding-bytes` by the level's own `fuzz` check
(256 rounds, seed `SEED_22`) — these are measurements, not restatements:

| circuit | where it lives now | gate | delay | tick | stars |
|---|---|---|---|---|---|
| eight `full_adder` instances, `cout`→`cin` chained (`rippleAdderReference`) | **the shipped reference** (`test/fixtures/ch2-references.ts`) | **72** | **8** | 0 | **3** |
| eight hand-built five-component adders (`handWiredAdderReference`) | documented alternative, still graded | 120 | 17 | 0 | 1 |
| one `add8` drop-in | **not legal here** — withheld from `allowedComponents` | 72 | 1 | 0 | 3 |

* **`threeStar` for `ch2-22-adding-bytes`: `{ gate: 120, delay: 17, tick: 0 }` → `{ gate: 72, delay: 8, tick: 0 }`.**
  The number was taken from the test that owns it rather than chosen: with the fixture swapped to the
  cascade and the target not yet re-measured, the focused run failed exactly as the brief said it
  would and named the measurement —
  `AssertionError: measured metrics={"gate":72,"delay":8,"tick":0}: expected { gate: 120, delay: 17, tick: +0 } to deeply equal { gate: 72, delay: 8, tick: +0 }`
  (`three-star targets are the reference solutions own metrics > ch2-22-adding-bytes`). That test now
  passes, i.e. `threeStar` equals the reference's measured metrics exactly.
* **The circuit, not a copy of it.** `rippleAdderReference()` is the cascade: two splitters, eight
  `full_adder` instances with each `fa<i>.cout` wired to the next `fa<i+1>.cin`, a maker packing the
  eight `fa<i>.sum` pins, then `OUT_out:8` / `OUT_cout:1` (`full_adder`'s output pins are `sum`/`cout`,
  so both edges of the chain spell their pin). The batch-2 test counts the instances (8 of them) before
  grading, so "the reference is the cascade" is asserted structurally as well as numerically.
* **The old reference is kept and graded, not deleted.** `handWiredAdderReference()` is the previous
  hand-wired chain; the fixture's header now records why one *former* reference lives in a file whose
  rule was "references only". The new test grades it: correct, passes, **one star** (120 > 72,
  17 > 8) — the target now separates the two correct constructions instead of being a number the
  cheaper one already satisfied.
* **Level 22's data comment was rewritten** to carry the source's `延迟 ≤ 35` as a reference value (as
  before), the measured cascade numbers, and the history: the hand-wired chain *was* the reference and
  *is now* a documented alternative; the old text's claim that "the drop-in is CHEAPER than the
  reference … the target therefore does not separate the two constructions" is gone, because it
  described a shipped target that a cheaper legal solution dominated. The module header's two notes
  that said the target "was NOT re-measured from the cascade" were corrected with it.
* **Level 21 is untouched.** `git diff -U0 698daa3..5a113f0 -- src/levels/content/ch2/batch2.ts` has
  hunks only in the module header (lines 31, 70, 76) and inside level 22 (473+ and the `threeStar`
  literal at 569): level 21's `allowedComponents` (no `full_adder`), its reference
  (`fullAdderReference`) and its `threeStar` of 15/3 are byte-identical, and its own protection test
  (`level 21's five-component construction is the reference it names`) still passes.

**Is the shipped reference now the best legal solution at that level? Yes, as far as I can construct
one.** The argument, with the metric's own prices:

* **Gates: 72 is the floor for this level's function.** The metric charges the registered `full_adder`
  9 NAND equivalents (`FULL_ADDER`, the constant that also prices `add8` as exactly eight of it), which
  is the NAND-minimal full adder. An eight-bit add with a carry-in and a carry-out needs a full
  adder's worth of logic at every one of the eight positions, so 8 × 9 = 72 is not merely what the
  cascade happens to measure — nothing below it can be correct. A hand-wired NAND ripple can at best
  *tie* on gates and is much worse on delay (each 9-NAND cell is several NAND deep, where the
  registered part is one delay unit).
* **Delay: 8 is one unit per cascade stage**, which is the minimum for a chain that must propagate a
  carry through eight positions. Any structure that computes a carry sooner (carry-lookahead,
  carry-select) needs extra components — carry-select on the top half alone is 12 adders = 108 gates —
  so it cannot stay inside the 72-gate target.
* **The one circuit that does beat it is not legal on this level:** `add8` (level 17's reward) has
  exactly this level's I/O and measures **72 gates / 1 delay** — it ties the target's gates and beats
  its delay by 7 units. Level 22's own palette rule withholds it (it would answer the level in one
  drop), so it is *unavailable* rather than *beaten*, and that distinction is now measured and on the
  record: the new test asserts `allowedComponents` does not contain `add8` **and** grades the drop-in
  at `{ gate: 72, delay: 1, tick: 0 }`, 3 stars. The data comment states both halves of that in the
  same sentence so no reader can read the target as "the best possible circuit".

## Fix 4 — level 32 records that the part is old news

`ch2-32-bit-switch`'s doc comment gained 13 lines (the whole `git diff -U0` hunk is
`@@ -662,0 +663,13 @@`, comment text only — checks, palette, `threeStar` and rewards are untouched):

> THE PART IS OLD NEWS BY THE TIME THIS LEVEL ARRIVES, and this comment is where that is recorded.
> The source teaches `switch` here — its own level 32 is literally named Bit Switch — but this replica
> slides the part from chapter 1 into chapter 2 (spec 3.3) and the level data unlocks it, with
> `switch8`, at level 22, the 8-bit adder whose ripple carry chain needs the conditional pass; level
> 28's reference is built from two of them. So the player has held `switch` for ten levels when this
> level opens, and level 32 is a RE-TEACH rather than an introduction: what it verifies is that the
> player can put the behaviour on the pins (`on` high passes `a`, `on` low holds 0) rather than that
> they can meet a new part.

## Covering tests (all green)

`test/levels/ch2-batch2.test.ts` (61 tests) is the file that owns level 22; `test/fixtures/ch2-references.ts`
is the single definition the batch test and the whole-set walk both grade. Per-test evidence:
`task-12-rulings-focused-batch2.log` (`--reporter=verbose`).

| test | what it holds to a number | result |
|---|---|---|
| `three-star targets are the reference solutions own metrics > ch2-22-adding-bytes` | `threeStar` **equals** the reference's measured metrics exactly | ✓ |
| `reference solutions pass with three stars > ch2-22-adding-bytes` | the cascade passes the fuzz check and scores 3 stars | ✓ |
| `reference solutions are buildable from the palette they are graded against > ch2-22-adding-bytes` | every instance of the reference is in `allowedComponents` (`full_adder` included) | ✓ |
| **new** `level 22's reference is the full_adder cascade… > files eight instances of the part as the reference, measured at 72 and 8` | counts 8 `full_adder` instances, grades 72/8/0, 3 stars, and `threeStar === metrics` | ✓ |
| **new** `… > grades the hand-wired chain it replaced at 120 and 17 -- correct, and one star` | the alternative is 120/17/0, passes, **1 star**, and is bigger than the reference on both metrics | ✓ |
| **new** `… > measures the one drop-in that would beat the reference, and shows the palette withholds it` | `add8` ∉ `allowedComponents`; the drop-in measures 72/1/0 and 3 stars | ✓ |
| renamed `level 22's target is the cascade's own measurement, and the source's 35 is not it` | measured delay ≤ the source's 35 **and** the exact 72/8/0 | ✓ |
| `plausible wrong circuits fail > ch2-22-adding-bytes` (eight half adders, no carry chain) | **still fails**, 0 stars — the level's counterexample is unchanged and still rejected | ✓ |
| `the fuzz levels name the round and the vector that failed > ch2-22-adding-bytes` | the failure is a real first-disagreement, not "somewhere" | ✓ |
| `test/levels/level-buildability.test.ts` (85 tests) | the buildability walk grades all 38 shipped references, level 22's new one included, against the palette the app computes | ✓ |
| `test/levels/ch2-batch4.test.ts` (126 tests) | level 32's comment markers plus its checks/palette/target (all unchanged) | ✓ |
| `test/levels/unlock-chain.test.ts` (35 tests) | `switch`/`switch8` unlock at level 22 — the fact Fix 2's spec text now agrees with | ✓ |
| level 21's block (`is five components…`, `records why the registered drop-in is withheld…`) | level 21's palette, reference and 15/3 target are as they were | ✓ |

## Commands and output

Run from the worktree root. The task's command lines work, but bare `node` on `PATH` is not the
runtime node (v24.18.0) and in this shell it mangles the argument vector — it tries to compile
`node.exe` itself (`MZ…` / `SyntaxError: Invalid or unexpected token`). The working form is the call
operator with full paths, which is what produced every log below:

```powershell
$node = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
& $node $pnpm test test/levels/ch2-batch2.test.ts
```

| command | exit | output (tail) | log |
|---|---|---|---|
| `… test test/levels/ch2-batch2.test.ts` (baseline, before any edit) | 0 | `Test Files 1 passed (1)` / `Tests 59 passed (59)` | — |
| `… test test/levels/ch2-batch2.test.ts` (after the fix) | 0 | `Test Files 1 passed (1)` / `Tests 61 passed (61)` | `task-12-rulings-focused-batch2.log` |
| `… test test/levels/ch2-batch2.test.ts test/levels/ch2-batch4.test.ts test/levels/level-buildability.test.ts` | 0 | `Test Files 3 passed (3)` / `Tests 271 passed (271)` | — |
| `… test` (full suite) | 0 | `Test Files 23 passed (23)` / `Tests 915 passed (915)` | `task-12-rulings-full-suite.log` |
| `… exec tsc --noEmit` | 0 | no diagnostics (empty log) | `task-12-rulings-tsc.log` |
| `… build` (`tsc --noEmit && vite build`) | 0 | `✓ 39 modules transformed` / `dist/assets/index-CDYedNPR.js 98.35 kB │ gzip: 34.54 kB` / `✓ built in 61ms` | `task-12-rulings-build.log` |

`915 = 913 (phase-end) + 1` from splitting the old level-22 drop-in block into two measured tests and
`+ 1` for the withheld-`add8` measurement; the suite was 913 before this task.

The full suite and build were re-run **after the last edit** (the fixture/comment wording), so the
green numbers above are the committed tree (`5a113f0`); `git status` after the commit is exactly
` M .superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`.

## Commit

`5a113f0` — `fix(levels): ship the four phase-end rulings on level 22 and spec 3.3` — 5 files:
`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`,
`src/levels/content/ch2/batch2.ts`, `src/levels/content/ch2/batch4.ts`,
`test/levels/ch2-batch2.test.ts`, `test/fixtures/ch2-references.ts` (+217/−102).
Nothing else was staged: no `src/core/`, `src/ui/`, `src/app/`, `src/levels/checks.ts`, no other level
batch, and `progress.md` is left modified.

## Concerns

1. **`test/levels/unlock-chain.test.ts` is now out of date and it is OUT OF SCOPE for this task**
   (the brief said "nothing else", so it was not touched). It still passes — it compares the level data
   against its own hard-copied list, never against the spec file — but it now pins the *pre-ruling*
   spec in three places: `CH2_COMPONENTS` is the 33-name list without `ram8`; the test at line 192
   asserts `extra === ['ram8']` under the title "chapter-2 rewards outside spec §3.3's list"; and its
   header (lines 31–36) plus the two findings' comments describe the `ram8` omission and the
   "§3.3's note says level 32" disagreement as live. Follow-up needed: add `ram8` to `CH2_COMPONENTS`,
   turn that assertion into `[]` (or delete it), and rewrite the header paragraph, the `ram8` test's
   comment and the `switch` test's title. Comments/expectations only; no behaviour and no level data.
2. **§3.3's `mem1` placements** (see Fix 1): the part is unlocked by chapter 1's capstone but named in
   the chapter-2 row and not the chapter-1 row. Left alone because no ruling covers it; the controller
   may want the pair of rows reconciled.
3. Nothing else. No wiring constraint or palette problem appeared when expressing the cascade: level
   22 already offered `full_adder` (level 20's reward, `698daa3`), and the buildability walk accepts the
   new reference as built from its own palette.

Artifacts beside this report:

| path | what |
|---|---|
| `task-12-rulings-full-suite.log` | `pnpm test` on `5a113f0`: 23 files / 915 tests green (exit 0) |
| `task-12-rulings-focused-batch2.log` | `… test test/levels/ch2-batch2.test.ts --reporter=verbose`: 61 tests, per-test names |
| `task-12-rulings-tsc.log` | `pnpm exec tsc --noEmit` (exit 0, empty) |
| `task-12-rulings-build.log` | `pnpm build` (exit 0, `✓ built in 61ms`) |

---

# Task 12c — the two consistency gaps: §3.3's `mem1` row, and the unlock-chain test now reads the spec

Worktree `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`, base `5a113f0`).
Commit **`901dda4`** — `fix(levels): spec 3.3 puts mem1 in chapter 1, and the unlock-chain test reads the spec`
— **2 files, +215/−113** (`docs/…-design.md` +4/−2, `test/levels/unlock-chain.test.ts` +211/−111), staged by
path and never with `git add -A`; `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` is left
modified and uncommitted. This closes Concern 1 and Concern 2 of Task 12b.

**Status: DONE.** Both fixes applied. Suite **918 passed / 23 files**, `tsc --noEmit` and `pnpm build` exit 0,
and the rewritten expectation is proved able to fail **four** ways — one of them the exact mutation the file
it replaced ran green under (measured, M1b below).

## Fix 1a — the whole table checked against the data, not against the brief

"The data" here is the 20 `rewards: { components: […] }` statements in
`src/levels/content/ch1/{part1,part2}.ts` and `src/levels/content/ch2/batch{1,2,3,4}.ts`, read through
`LEVELS` so the check sees what the app sees (a throwaway vitest file dumped the chapter-by-chapter reward
table; it was deleted before any run of the suite). Both directions per row: every name the row carries is
unlocked by a level of that chapter, and every component that chapter's levels unlock is named by the row.

| §3.3 row | names in the row | components that chapter's levels reward | verdict |
|---|---|---|---|
| Ch1 基础逻辑 | 13 — `const_on` `const_off` `nand` `not` `and` `or` `nor` `xor` `xnor` `and3` `or3` `delay_line` `mem1` (after the move) | 13 — `nand` `not` `and` `or` `nor` `const_on` `const_off` `delay_line` `xor` `and3` `or3` `xnor` `mem1` | **exact set equality, both directions** |
| Ch2 算术与存储 | 33 — `switch` … `decoder2` … `ram8` … `delay8` | 32 — every one of them named by the row | row ⊇ data; the one extra name is **`decoder2`**, below |
| Ch3 / Ch4 / Ch5 / Ch6 / Ch7 / 沙盒专用 | 6 / 0 / 5 / 4 / 5 / 10 | no levels exist | **not checkable**: this build ships 38 levels (12 + 26). Nothing to compare, so nothing is claimed |

Also measured, because rule 2's premise depends on it: **no rewarded component anywhere in the game is
unlocked by zero or by two levels** — the non-1 unlock list came back empty over all 38 levels, so the single
unlocker invariant held for every row name that is a reward before any edit was made.

**The one mismatch found and NOT fixed: `decoder2`.** §3.3's chapter-2 row names it and no level in the game
rewards it (`unlockersOf('decoder2') === []`) — the genuine spec-vs-data divergence that is still there after
`mem1` moves. It is the deliberate design note, not an error: chapter 2 teaches `decoder1` (level 25) and
`decoder3` (level 26), `decoder2` is the same generator one width up (`createDecoderDef(2)`), and it is
registered and reachable without ever becoming a palette entry. That ruling was already pinned by a test in
this file; the rewritten file now additionally asserts the spec still **names** it, so a future tidy-up of
§3.3 that deletes `decoder2` goes red instead of quietly removing the exemption's subject. Reported, left
alone.

Two more things the whole-table audit touched, neither of them a mismatch:

* `level_input` / `level_output` are starters, appear in no row, and §3.3's own I/O paragraph calls them
  `hidden` plumbing that never enters the unlock system (line 118). Deliberate.
* `const_on` / `const_off` are starters **and** chapter-1 rewards (level 6); the Ch1 row names them, which is
  where the data puts them.

## Fix 1b — `mem1` moved from the chapter-2 row to the chapter-1 row

```diff
-| Ch1 基础逻辑 | … `or3` `delay_line` |
-| Ch2 算术与存储 | `switch` … `decoder3` `mem1` `ram8` … `delay8` |
+| Ch1 基础逻辑 | … `or3` `delay_line` `mem1` |
+| Ch2 算术与存储 | `switch` … `decoder3` `ram8` … `delay8` |
```

`mem1` sits next to `delay_line` as the brief said, the chapter-2 row is otherwise byte-identical (`ram8`
stays, and it is now the row's only storage part between `decoder3` and `reg8`), and the row counts go
12 → 13 and 34 → 33.

**One addition beyond the literal row move, flagged for the controller:** a short `关于 mem1` note after the
`switch` note, in the document's own style, recording *why* a memory part is in the "基础逻辑" row — chapter
1's capstone (level 12《二进制速算》) hands it out so chapter 2's latch level (level 28《循环依赖》) has the
storage element its loop needs; chapter 1 needs it nowhere, and level 12's own palette does not list it.
Without it the moved row is an unexplained claim in a document whose other row-level deviations all carry a
note, and the next reader auditing the table would be right to suspect `mem1` was misplaced. It is prose
only; if the controller would rather the table change stand alone, it is one paragraph to drop.

## Fix 2 — the rewrite: **form (b)**, and why

**Chosen: (b).** The new test derives the expected set from the level data and asserts §3.3's chapter-2 row
**contains** it; rule 2 keeps walking the spec's row in the other direction and still fails on a part with
zero or two unlockers.

Why (b) rather than (a) (parse the row and assert the rewards equal it):

* **Equality would fail on the ruling.** The row deliberately names `decoder2`, which no level rewards, so
  set equality needs a carve-out — and a carve-out is a hand-maintained exception list, the same shape of
  artifact that hid `ram8` for a phase. Under (b) the row may legitimately be ahead of the data; nothing has
  to be exempted on this side at all.
* **(b) plus rule 2 is still set equality, with neither side restating the other.** The new containment
  assertion reads the data and fails if the spec forgot a rewarded part (the `ram8` bug class, and the
  direction the old file could not see). Rule 2 reads the spec row and fails if a name it carries has zero or
  two unlockers (the direction a "contains" check alone cannot see). Each assertion takes its expectation
  from one source and checks the other; neither contains a component list.
* **The parse is shallow on purpose, and I checked the brittleness rather than assuming it.** §3.3's rows are
  markdown table rows — one row per line by definition — and a row's components are its backticked tokens, so
  no plausible reflow of a cell can break it while leaving a table. Every shortfall is loud: a missing
  `### 3.3` heading, a missing row and a repeated label each throw with the label in the message, a truncated
  parse fails the containment assertion (the rewards it drops are rewards), and an over-broad parse fails
  rule 2 (names unlocked by nothing). The real trap is that the file has a **second** table whose first cells
  also begin `Ch1`/`Ch2` (the chapter-count table, lines 229–230) — which is why the parse is scoped to the
  `### 3.3` section instead of scanning the document, and why a duplicate label inside §3.3 throws.

## What the file asserts now (38 tests, was 35)

| test | state | what it holds |
|---|---|---|
| `reads a row for every chapter the table lists` | **new** | the parse found all eight rows (`Ch1`…`Ch7`, `沙盒专用`), and says in a comment that the later rows are read but not compared |
| `names every part a chapter-2 level hands out` | **new** | data → spec: all 32 chapter-2 rewards are named by the row (non-vacuity floor of 25 distinct rewards). **This replaces the deleted `extra === ['ram8']` assertion** — same question, answered from the spec instead of from a copy |
| `agrees with the chapter-1 row in both directions, mem1 included` | **new** | chapter 1's 13 rewards ⊆ the row, and every name in the row is unlocked by exactly one chapter-1 level |
| `walks the spec row itself, with no repeats and nothing dropped` | rewritten | the parsed row is ≥ 25 names and duplicate-free; the old `toHaveLength(33)` (a count copied from the spec) is gone |
| `hands out every listed part at exactly one chapter-2 level, bar the ruling` | kept, walks the **parsed** row | rule 2, unweakened: a name with 0 or 2 unlockers fails by name, and the one chapter-2 check still fails a name a chapter-1 level owns |
| `hands ram8 out at level 28, ahead of the level that builds from it` | renamed/rewritten | data-only now that the row carries `ram8`: the unlocker is `ch2-28-circular-dependency` and it precedes `ch2-37-little-box` |
| `unlocks switch and switch8 at level 22, ten levels before the source teaches them` | title + comment rewritten | the settled ruling: §3.3 says level 22, the level number deliberately differs from the source's level 32, which is a re-teach here. Still exactly one unlocker each |
| `unlocks mem1 at chapter 1 level 12, the row the spec puts it in` | rewritten | `ch1-12-binary-racer`, chapter 1, index 12, no chapter-2 level rewards it, **and** the spec agrees (`CH1_ROW` contains it, `CH2_ROW` does not) |
| `registers decoder2 and records that no level unlocks it -- the second ruling` | kept + one assertion | zero unlockers, registered, correct pin contract and one-hot decode for all four selects; **new:** `CH2_ROW` still contains `decoder2` |
| rules 1, 3 and 4 (26 + 1 + 2 tests) | untouched | palette-before-unlock, unlock-before-first-listing, 26 levels at 13–38 |

Rule 2 is **not weakened**: its two failure modes (a part unlocked by zero levels, a part unlocked by two) are
unchanged, and its exemption list *shrank* from two names to one — `mem1` is no longer in the row, so a
`mem1` reappearing there now fails instead of being skipped. M3 and M4 below measure both failure modes.

## Mutation proof

Each mutation was applied to the restored tree, run, and then reverted; the revert was confirmed with
`git status`/`git diff` between runs, and the tree after the last revert is the committed tree (the
post-commit runs are green). All four runs: **exit 1**.

| # | mutation | result | log |
|---|---|---|---|
| **M1** | spec §3.3: `` `ram8` `` deleted from the chapter-2 row | **red** — `names every part a chapter-2 level hands out` → `AssertionError: chapter-2 rewards spec §3.3's chapter-2 row does not name: expected [ Array(1) ] to deeply equal []` / `+ "ram8 (rewarded by ch2-28-circular-dependency)"` (1 failed / 37 passed) | `task-12-consistency-mutation-M1-spec-drops-ram8.log` |
| **M1b** | same mutation, run against the **old** 35-test file (`git show 5a113f0:…`, scratch path, deleted after) | **green, 35 passed** — the copy could not see a spec edit at all | `task-12-consistency-mutation-M1-old-test-stays-green.log` |
| **M2** | spec: `` `mem1` `` put back in the chapter-2 row | **red, 2 tests** — rule 2: `+ "mem1 is unlocked by ch1-12-binary-racer, which is chapter 1"`; and `unlocks mem1 …` → `expected [ 'switch', 'full_adder', …(32) ] to not include 'mem1'` | `task-12-consistency-mutation-M2-spec-readds-mem1.log` |
| **M3** | level data: `ch2-21-full-adder` rewards `full_adder` a second time | **red** — rule 2: `+ "full_adder is unlocked by 2 levels: ch2-20-half-adder, ch2-21-full-adder"` | `task-12-consistency-mutation-M3-level-double-reward.log` |
| **M4** | spec: chapter-2 row names `not16`, which no level rewards | **red** — rule 2: `+ "not16 is unlocked by 0 levels: no level"` | `task-12-consistency-mutation-M4-spec-names-unrewarded.log` |

M3 and M4 are the two cases the brief ruled rule 2 must still fail on (two unlockers, zero unlockers). M1 is
the case that would have gone unnoticed before; M1b is the measurement of *why*: the old file never imported
`readFileSync` and never opened the spec, so the only mutation it could see was one to the level data.

## Commands and output

Run from the worktree root. As in Task 12b, the brief's `node "…node.exe" "…pnpm.mjs"` form does not work in
this shell — bare `node` treats the node path as its script and dies on the PE header (`MZ…` /
`SyntaxError: Invalid or unexpected token`). The working form is the call operator with the two full paths:

```powershell
$node = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
& $node $pnpm test
```

| command | exit | output (tail) | log |
|---|---|---|---|
| `… test test/levels/unlock-chain.test.ts` | 0 | `Test Files 1 passed (1)` / `Tests 38 passed (38)` | `task-12-consistency-focused.log` |
| `… test test/levels/unlock-chain.test.ts --reporter=verbose` (post-commit) | 0 | `Tests 38 passed (38)`, every test named | `task-12-consistency-focused-verbose.log` |
| `… test` (full suite) | 0 | `Test Files 23 passed (23)` / `Tests 918 passed (918)` / `Duration 2.60s` | `task-12-consistency-full-suite.log` |
| `… test` (full suite, re-run on the committed tree) | 0 | `Test Files 23 passed (23)` / `Tests 918 passed (918)` | `task-12-consistency-full-suite-postcommit.log` |
| `… exec tsc --noEmit` | 0 | no diagnostics (empty log, 0 bytes) | `task-12-consistency-tsc.log` |
| `… build` (`tsc --noEmit && vite build`) | 0 | `✓ 39 modules transformed` / `dist/assets/index-CDYedNPR.js 98.35 kB │ gzip: 34.54 kB` / `✓ built in 59ms` | `task-12-consistency-build.log` |

**Test count: 915 → 918, and that is the rewrite's own arithmetic.** The three additions are the parse-shape
check, the data → spec containment test and the chapter-1 row test; nothing was removed except the
`extra === ['ram8']` assertion, which the containment test subsumes. The number of tests that actually check
unlock behaviour went up, not down: the two new row tests are the direction that had no coverage at all.

## Commit

`901dda4` — `fix(levels): spec 3.3 puts mem1 in chapter 1, and the unlock-chain test reads the spec` — 2 files,
exactly the two in scope: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md` (+4/−2) and
`test/levels/unlock-chain.test.ts` (+211/−111). Nothing else was staged — no `src/` file is in the commit, no
log or report file is tracked (`.superpowers/*` is gitignored except `progress.md`), and the one temporary
scratch test file used for M1b was deleted before the commit. `git status` after the commit is exactly
` M .superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`.

## Concerns

1. **The `关于 mem1` note is one paragraph more than the brief asked for** (see Fix 1b). Prose only, easy to
   drop; I added it because the moved row is otherwise an unexplained deviation in a document whose other
   deviations carry notes.
2. **`decoder2` remains a deliberate spec-vs-data divergence** and this task did not resolve it (it was
   reported, not fixed, per the brief). It is now pinned from both sides — the row must still name it, and it
   must still have zero unlockers — so it can only change on purpose.
3. **The table check covers chapters 1 and 2 only.** §3.3's Ch3–Ch7 and sandbox rows have no levels in this
   build, so they are read by the test and asserted to exist, but nothing compares them to data. When those
   chapters ship, the containment test is the place to extend; it is written per chapter and takes a row
   label, so the extension is two lines.
4. Nothing else. No level data changed in this task: `git diff` against `5a113f0` is clean for all of `src/`.

Artifacts beside this report:

| path | what |
|---|---|
| `task-12-consistency-mutation-M1-spec-drops-ram8.log` | M1: `ram8` deleted from §3.3 → red, `ram8 (rewarded by ch2-28-circular-dependency)` |
| `task-12-consistency-mutation-M1-old-test-stays-green.log` | M1b: the same mutation against the old 35-test file → **green** (the gap, measured) |
| `task-12-consistency-mutation-M2-spec-readds-mem1.log` | M2: `mem1` back in the chapter-2 row → red, rule 2's chapter check |
| `task-12-consistency-mutation-M3-level-double-reward.log` | M3: a second reward of `full_adder` → red, "unlocked by 2 levels" |
| `task-12-consistency-mutation-M4-spec-names-unrewarded.log` | M4: the row names `not16` → red, "unlocked by 0 levels" |
| `task-12-consistency-focused.log` / `-focused-verbose.log` | the rewritten file: 38 tests green (post-commit verbose run names each one) |
| `task-12-consistency-full-suite.log` / `-full-suite-postcommit.log` | 23 files / 918 tests green, before and after the commit |
| `task-12-consistency-tsc.log` / `task-12-consistency-build.log` | `tsc --noEmit` clean (0 bytes); `pnpm build` exit 0 |
| `task-12-consistency-commit-msg.txt` | the commit message, verbatim |

---

# Task 12d — the width-31 port guard: `1 << width` in `fitsWidth`

Scope: `src/core/signal.ts`, `test/core/signal.test.ts`, `test/core/defs-wide.test.ts` — and nothing else.
Commit `c830f50`.

## The bug, fixed

`src/core/signal.ts:18` (before):

```ts
if (width >= 32) return v <= 0xffff_ffff;
return v >= 0 && v < 1 << width;
```

`<<` converts both operands through int32, so `1 << 31` is `-2147483648` and the narrow arm read
`v < -2147483648` — false for every non-negative `v`. `assertWidth(v, 31)` rejected every 31-bit value,
`0` included; widths 1..30 and 32 never reached that expression. The fix, now at `src/core/signal.ts:37`:

```ts
if (width >= 32) return v <= 0xffff_ffff;
return v >= 0 && v < 2 ** width;
```

`2 ** 31` is exact in a double, and exact for every width this project admits (`MAX_PARAM_WIDTH` is 4096,
far below the 2^53 where doubles stop counting integers), so the narrow arm needs no special case. The
docstring above `fitsWidth` now records why the expression is `2 ** width` and why the fast path stays.

## The fast-path decision: **kept**

The `width >= 32` arm stays. Evidence is in `task-12d-audit-probe.log`, measured through the real modules:

- At **width 32** the arm is exactly equivalent to the general form for every valid value (integers
  0..0xffff_ffff): both accept all of them, both reject `0x1_0000_0000`. Measured:
  `width 32: 4294967295 accepted; 4294967296 threw`.
- It is **not redundant above 32**. `graph.ts:70` admits `params.width` up to `MAX_PARAM_WIDTH = 4096` and
  `net.ts`'s `effectiveWidth` resolves every pin of an instance from it, so widths above 32 do reach
  `assertWidth`. There the arm is the NUMBER writer's own limit: `setPort`'s number branch is
  `(v >>> i) & 1`, which carries at most 32 bits. Measured: `(2**32 >>> 32) & 1 = 0`, and that same loop for
  a 33-bit port given `2 ** 32` sets **0** bits — it would stage `0`, not `4294967296`. Dropping the arm
  would make the guard admit a value the writer silently mangles, which is the same class of defect as the
  one being fixed.
- Measured through the table: widths 32, 33 and 64 each accept `0xffff_ffff` and reject `2 ** 32`.
- The `Uint8Array` path is the documented carrier above 32 bits (`wide.ts`'s `PortValue` note) and is
  untouched: `assertWidth` still sizes it to `ceil(width / 8)`.

**One thing the arm does that the general form would not, reported and not changed:** it omits `v >= 0`, so
a negative number is still accepted at every width ≥ 32 — `setPort(base, 32, -1)` passes today and the table
reads back `255,255,255,255`, i.e. `-1` is silently reinterpreted as `0xffff_ffff` by the writer's
`ToUint32`. That is pre-existing behaviour on an arm this task did not have to touch, not a consequence of
the fix, and it is unreachable from level data: every shipped level pin is ≤ 8 bits, and that domain needs a
32-bit *level* pin, which `bindLevelIo` refuses to write unless the compiled width matches the declared one.
Closing it is one token (`v >= 0 && v <= 0xffff_ffff`) but changes accepted-input behaviour beyond the bug I
was given, so it is reported instead. The narrow arm keeps its `v >= 0`, and the new tests assert it.

## Tests added

`test/core/signal.test.ts` — a new `describe('assertWidth')`, 3 tests (16 → 19):

1. width 31 accepts `0`, `1`, `12345` and `2 ** 31 - 1`; rejects `2 ** 31` and `-1`;
2. width 32 accepts `0` and `0xffff_ffff`, rejects `0x1_0000_0000` — the values the fix had to leave alone;
3. **the sweep**: every width 1..32 asserts `0`, `1` and `2 ** width - 1` in and `2 ** width` out, each
   labelled with its width so a failure names the arm.

`test/core/defs-wide.test.ts` — one test (62 → 63) staging `div31`'s own result (`0x7fff_ffff`) through
`createSignalTable` at width 31 and reading it back as `Uint8Array([0xff,0xff,0xff,0x7f])`, plus the
`2 ** 31` refusal. This is the wide-def contract's missing half: the file's width loop already asserted what
`createWideDefs(31)` *returns*, and its comment recorded that staging the value was impossible. That comment
is updated, and the staging is now asserted rather than described.

## Mutation proof

M1 — the mutation the brief asks for, `2 ** width` back to `1 << width`
(`task-12d-mutation-1-lt-width-red.log`):

```
 FAIL  test/core/defs-wide.test.ts > the width generator > stages the 31-bit result the port guard used to reject
RangeError: value 2147483647 does not fit a 31-bit port width
 FAIL  test/core/signal.test.ts > assertWidth > accepts every value of a 31-bit port, zero included
AssertionError: expected [Function] to not throw an error but 'RangeError: value 0 does not fit a 31…' was thrown
 FAIL  test/core/signal.test.ts > assertWidth > bounds 0, 1 and 2 ** width - 1 in and 2 ** width out at every width 1..32
AssertionError: 0 at width 31: expected [Function] to not throw an error but 'RangeError: value 0 does not fit a 31…' was thrown
 Test Files  2 failed (2)
      Tests  3 failed | 79 passed (82)
```

Exactly the three new defences fail, and nothing else — which is also the measurement that no other width
was relying on the int32 behaviour. The fix was restored and verified by `git diff`
(`+  return v >= 0 && v < 2 ** width;`), then re-run green (`task-12d-focused-green-post-restore.log`,
82 tests).

M2 — the bound loosened to `v <= 2 ** width` (`task-12d-mutation-2-loose-bound-red.log`): `4 failed |
15 passed`, two of the four being the new rejection assertions (`signal.test.ts:141` and `:166`). So the
sweep's "rejects `2 ** width`" half has teeth rather than being decorative.

## Audit: the `1 << width` family across `src/`

Every one of the 23 `1\s*<<` grep hits in `src/` is accounted for below. Line numbers are post-fix.

| site | shift count | verdict |
|---|---|---|
| `core/signal.ts:37` (was :18) | `width` | **the bug — fixed** |
| `core/signal.ts:119` | `i & 7` (bit within a byte) | irrelevant: 0..7 |
| `core/signal.ts:174-175` | comment only | explains why `formatPort` uses `% 2 ** width`; now consistent with the guard |
| `core/net.ts:483,489` | `bit`, `bit & 7` | irrelevant: a bit index inside an already-sized port |
| `core/defs/index.ts:62,63` | `inputs` (gate arity) | irrelevant: `gate()` is called with 1, 2 and 3 only (lines 229-239), so `1 << inputs` ∈ {2,4,8} |
| `core/fields.ts:6` | `i` (bit index in `packBits`) | irrelevant: not a width shift; a 32-bit packer by design (`>>> 0`) with no `src/` caller |
| `core/fields.ts:18,29` | `width` | **real hole at 31 — see below** |
| `core/defs/wide.ts:114-116,127` | comments | describe the `maskOf` fix from `99a3dcd`; correct, but now half-stale (see Concerns) |
| `core/defs/wide.ts:880,957` | comments | no shift |
| `levels/tables.ts:15,45`, `levels/checks.ts:184,207` | `pin.width` | **authoring hazard, not reachable today — see below** |
| `levels/content/ch2/batch3.ts:471` | comment | no shift |
| `levels/content/ch2/batch3.ts:506,576` | `1 << (sel ?? 0)` | irrelevant: `sel` is 1-bit and 3-bit on those two levels, so the shift is 0..1 / 0..7 |

### `core/fields.ts:18,29` — the guard does **not** cover 31 (reported, not fixed)

`width >= 32 ? 0xffff_ffff : (1 << width) - 1` at width 31 evaluates to `-2147483649`, not `0x7fff_ffff`, and
the two uses fail differently (`task-12d-audit-probe.log`):

- `extractField` (line 18) is **accidentally correct**: the mask is only ever used as
  `(value >>> offset) & mask`, and `&` runs `ToInt32`, which maps `-2147483649` back to `0x7fff_ffff`.
  Measured: `extractField(2**31-1, 0, 31) = 2147483647`. (Its width-32 result is signed —
  `extractField(2**32-1, 0, 32) = -1` — a separate asymmetry, equally dormant.)
- `insertField` (line 29) is **broken at 31**: the same negative mask is compared arithmetically
  (`field < 0 || field > mask`), and every non-negative `field` is `> -2147483649`. Measured:
  `insertField(0, 0, 31, 0)`, `(…, 1)`, `(…, 2**30)` and `(…, 2**31-1)` all throw
  `RangeError: field N out of range for width 31`. Widths ≤ 30 and 32 are fine.
- **Reachability: none today.** Nothing in `src/` calls `extractField`, `insertField`, `packBits` or
  `unpackBits`; their only caller in the repo is `test/core/registry.test.ts:396-424`, which uses widths 2,
  6, 8, 24 and 32 — never 31. Reported rather than fixed because `fields.ts` is outside this task's file
  list.

### `levels/checks.ts:184,207` and `levels/tables.ts:15,45` — an authoring hazard, not reachable today

Paths traced: `tables.ts:8 enumerateInputs` is called only from `truthTable` (tables.ts:42), and
`checks.ts:176 enumerateInputs` only from `generateRows` (checks.ts:202). `PinSpec.width` is a bare `number`
(`levels/spec.ts:8`) with **no validation anywhere in the level layer**: `LEVELS` is a plain array
(`levels/index.ts:4`), and the only readers of `spec.io` are the enumeration itself, `bindLevelIo`'s
compiled-vs-declared comparison (`checks.ts:104-131`), the fuzz binding (`checks.ts:434-458`) and the UI
header/table (`ui/truthTable.ts`, `ui/board/interact.ts`). So a level *textually can* declare a wide pin;
none does — every `width:` literal in `src/levels/content/**` is 1, 2, 3, 4 or 8 (63 / 1 / 3 / 2 / 28
occurrences), and no `width:` literal anywhere in `src/` exceeds 8. Level data is compiled source, so no
document, save file or player action can introduce one; only editing level source can.

- **Input-pin masks (`checks.ts:184`, `tables.ts:15`) are unreachable in practice** for a second reason:
  both enumerate `2 ** bits` combinations where `bits` sums the input widths, allocating one object per row
  and pushing it into an array. A ≥ 31-bit input pin means ≥ `2 ** 31` rows: the loop cannot complete
  (hang/OOM) before any wrong row could be used — and at width 31 the mask would be accidentally right
  anyway (`&` → `ToInt32` → `0x7fff_ffff`).
- **Output-pin masks (`checks.ts:207`, `tables.ts:45`) have no such explosion** — the enumeration depends on
  the *inputs* alone, so with narrow inputs the mask runs on every row. They are therefore the reachable
  half *if* such an output pin is ever authored: at width 31 the mask is again accidentally correct; at
  **width 32** it is `(1 << 32) - 1 = -1`, so masking becomes a no-op and a too-wide expectation keeps its
  high bits; at **width 33+** it is `1 << 33 = 2` minus 1 = **1**, silently reducing every expected output
  to its low bit. No shipped level reaches either case.

Per the brief this is reported, not fixed: `src/levels/` was out of scope, the reachable case needs
hand-authored level source, and the repair (a `2 ** pin.width - 1` mask, which is what `maskOf` already
does) belongs with whoever owns the level layer's width contract.

## Commands and output

`$N` is `node "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"`, `$P` is
`"C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"`, run from the worktree.

| command | result | log |
|---|---|---|
| `$N $P test test/core/signal.test.ts` (before the edit) | 16 tests green — the baseline the additions land on | — |
| `$N $P test test/core/signal.test.ts test/core/defs-wide.test.ts` | **82 passed** (19 + 63), exit 0 | `task-12d-focused-green-post-restore.log` |
| M1: `2 ** width` → `1 << width` | **3 failed \| 79 passed**, exit 1 — the three new tests, named | `task-12d-mutation-1-lt-width-red.log` |
| M2: `<` → `<=` | **4 failed \| 15 passed**, exit 1 — includes two new rejection assertions | `task-12d-mutation-2-loose-bound-red.log` |
| `$N $P test` | **23 files / 937 tests passed**, exit 0 | `task-12d-full-suite.log` |
| `$N $P test` (post-commit) | **937 passed**, exit 0 | `task-12d-full-suite-postcommit.log` |
| `$N $P exec tsc --noEmit` | exit 0, 0-byte log | `task-12d-tsc.log` |
| `$N $P build` | exit 0 — `dist/index.html` 0.42 kB, `index-BJi6Tn_M.css` 2.31 kB, `index-PcCcIyv0.js` 98.61 kB | `task-12d-build.log` |
| audit probe (real modules, Node 24 type stripping) | the width-31/32/33/64 and `fields.ts` measurements quoted above | `task-12d-audit-probe.log`, script `task-12d-audit-probe.mjs` |

Test count: the brief's 933 baseline + 3 (`signal.test.ts` 16 → 19) + 1 (`defs-wide.test.ts` 62 → 63) =
**937**, which is what both full-suite runs report.

## Commit

`c830f50` — `fix(core): bound a narrow port with 2 ** width, not 1 << width` — 3 files, exactly the scope
given: `src/core/signal.ts` (+21/−2), `test/core/signal.test.ts` (+49), `test/core/defs-wide.test.ts`
(+31/−7). Staged by explicit path; no `git add -A`. `git status` after the commit is empty — the controller's
`progress.md` was neither touched nor staged, no log/report/probe file is in the commit (they live beside
this report, outside the repo tree), and `src/core/defs/wide.ts` and all of `src/levels/` are byte-identical
to `99a3dcd`.

## Concerns

1. **The fast path still admits negatives at width ≥ 32** — `setPort(base, 32, -1)` passes and reads back
   `0xffff_ffff`. Pre-existing, unchanged here, unreachable from shipped level data, but it is a real hole in
   the same guard and is now the only one left. One token to close (`v >= 0 && v <= 0xffff_ffff`); not taken
   because it changes accepted-input behaviour beyond the assigned bug.
2. **`src/core/defs/wide.ts:125-132` is now a false comment.** `maskOf`'s "RECORDED LIMITATION" paragraph
   still says `assertWidth(0, 31)` throws today and that the repair is blocked by file scope. Both halves are
   obsolete as of `c830f50`. `wide.ts` was outside my file list, so I left it; the parallel comment in
   `test/core/defs-wide.test.ts` (in scope) is updated. Two sentences for whoever owns that file next.
3. **`fields.ts:29 insertField` throws for every field at width 31**, and `extractField` at width 32 returns a
   signed result (`-1` for `0xffff_ffff`). Both dormant (no `src/` caller) and both outside this task's file
   list — reported, not fixed.
4. **The level layer has no pin-width cap at all.** Today's consequence is nil (no shipped pin exceeds 8, and
   level data is source rather than input), but a future level with a 32-bit *output* pin would get
   `(1 << 32) - 1 = -1` as its mask in `generateRows`/`truthTable` — a silently unmasked expectation — and 33+
   bits would mask every value to 1 bit. That is a level-layer contract decision, and `src/levels/` was out of
   scope here.
5. Nothing else. Every file outside the three in scope is unchanged.

# Task 12e — the width-32 fast path's missing sign check, and `maskOf`'s stale paragraph

Scope: `src/core/signal.ts`, `src/core/defs/wide.ts`, `test/core/signal.test.ts` — and nothing else.
Commit `5bce87a` — `fix(core): make the width-32 fast path reject negatives, and retire a stale note` —
3 files, +41/−9 (`src/core/signal.ts` +6/−1, `src/core/defs/wide.ts` +13/−8, `test/core/signal.test.ts`
+22/−0).
Worktree `D:\Documents\turing-complete\.worktrees\phase1`, branch `phase1`, parent `c830f50`.

## Item 1 — the fix

`src/core/signal.ts:41` (was `:36`). Before:

```ts
if (width >= 32) return v <= 0xffff_ffff;
return v >= 0 && v < 2 ** width;
```

After:

```ts
if (width >= 32) return v >= 0 && v <= 0xffff_ffff;
return v >= 0 && v < 2 ** width;
```

The fast path now carries the same sign half as the narrow arm, so `fitsWidth` is uniformly non-negative and
the function's two arms can no longer disagree about what a port may hold. The docstring above it gained one
paragraph recording *why* the half is not redundant on that arm: `setPort`'s number branch runs the value
through `ToUint32` (`(v >>> i) & 1`), so an admitted `-1` is not an error but `0xffff_ffff` — a negative
silently reinterpreted as a full unsigned port. Measured on the real module: **before**, task 12d's probe
shows the write accepted, with `setPort(32, -1) accepted today (the arm omits the sign check); getPort =
255,255,255,255` (`task-12d-audit-probe.log`); **after**, it throws `value -1 does not fit a 32-bit port
width` and the 32 slots stay 0 (`task-12e-audit-probe.log`, quoted below).

## Item 1b — the fast-path decision: **KEPT**, justification re-verified

I re-read `setPort` (`src/core/signal.ts:98-110`) rather than taking the previous task's word for it. The
number branch is:

```ts
for (let i = 0; i < width; i += 1) {
  table.slots[base + i] = (v >>> i) & 1;
}
```

`>>>` converts its left operand through `ToUint32`, so `(v >>> i) & 1` is 0 for every `i >= 32`, whatever
`v` is: the branch carries at most 32 bits. Widths above 32 are reachable — `graph.ts` admits `params.width`
up to `MAX_PARAM_WIDTH` = 4096 and `net.ts` resolves pin widths from it — so without the arm the guard would
be `v >= 0 && v < 2 ** width`, which at width 33 admits `2 ** 32` and the writer would stage **0** instead of
raising. That is precisely the "silently mangles what it admits" class this guard exists to prevent, so the
arm stays; only its sign half changed. The `Uint8Array` carrier above 32 bits is untouched (`assertWidth`
still sizes it to `ceil(width / 8)`).

Measured, not argued (`task-12e-audit-probe.log`, real modules via Node type stripping):

```
width 32: -1 threw; -2147483648 threw; 0 accepted; 4294967295 accepted; 4294967296 threw
width 33: -1 threw; -2147483648 threw; 0 accepted; 4294967295 accepted; 4294967296 threw
width 64: -1 threw; -2147483648 threw; 0 accepted; 4294967295 accepted; 4294967296 threw
(2**32 >>> 32) & 1 = 0  <- bit 32 of ANY number is 0
setPort's number branch for a 33-bit port given 2**32 writes 0 set bits -> would stage 0, not 4294967296
```

The accepted band is therefore unchanged at every width ≥ 32 (`0 .. 0xffff_ffff`); only the negative half of
the domain moved from "accepted as garbage" to "refused".

**No load-bearing negative caller.** The BLOCKED condition did not trigger: nothing in `src/` stages a
negative number at width 32 (or any other width) today. Two paths reach `setPort` with data that is not
produced by the guarded wide-def operators; neither relies on negatives being admitted:

- the level-IO write path (`levels/checks.ts:149-162`) gates every authored value through `fitsPort`
  (`checks.ts:63-72`), which delegates to this same `assertWidth` in a try/catch, so it inherits the fix:
  a negative row at width ≥ 32 is now refused at the gate rather than staged. It was never load-bearing,
  because every shipped pin is ≤ 8 bits, where the narrow arm's `v >= 0` always rejected negatives;
- every wide-def result passes through `u(value, w) = (value & maskOf(w)) >>> 0`
  (`defs/wide.ts:284-286`), so `and8`'s `~a` and `nand8`'s `~(a & b)` cannot leave a def negative.

The full suite (938 tests, including the width-31/32 def staging tests) is green with the sign check in
place, which is the empirical half of the same statement.

## Item 2 — the comment rewrite in `defs/wide.ts:125-137`

The old "RECORDED LIMITATION, NOT FIXED HERE" paragraph is gone. The new paragraph, three sentences, states
only what is true now:

- the `2 ** w - 1` form is **required**, not stylistic — `(1 << w) - 1` goes negative at `w = 31`, and a
  negative mask is what made a 31-bit port unstageable while the guard was still `v < 1 << width`;
- that matching guard in `core/signal.ts` **was fixed in the same phase** (`c830f50`, now
  `v >= 0 && v < 2 ** width`), so width 31 stages these masks normally and the limitation the paragraph used
  to record is **resolved** — `2 ** w - 1` remains the required form for the reason above;
- what is still genuinely limiting at the top of the range: `MAX_WIDE_WIDTH` = 32 together with the `number`
  carrier `maskOf` returns — `maskOf(32)` = `0xffff_ffff` is the widest mask any caller asks for and the
  widest value `fitsWidth` admits, so `w > 32` is the `Uint8Array` path's business.

Verified rather than asserted: `createWideDefs` clamps through `clampWidth` (`clampWidth(1e9)` = 32), so
every `maskOf` caller is `w ≤ 32`; probe: `div32(5, 0)` = `4294967295` = `maskOf(32)` and it stages at width
32 and reads back as four `0xff` bytes (the two `getPort` results print as `255,255,255,255` / `0,0,0,0`
because they are `Uint8Array`s).

Per the brief, one clause names the still-broken `(1 << width) - 1` pair — `core/fields.ts`'s `extractField` /
`insertField`, dormant, no `src/` caller — as recorded and not touched. `fields.ts` is byte-identical to
`c830f50`.

## Tests added

`test/core/signal.test.ts`, one new case at `:153` (`describe('assertWidth')`, 19 → 20 in that file):

```
rejects a negative value at width 32, so the fast path is non-negative too
  assertWidth(-1, 32) throws /does not fit a 32-bit port/     <- the new assertion
  assertWidth(-1, 33) throws                                  <- the same arm above 32
  assertWidth(0, 32), assertWidth(0xffff_ffff, 32) do not throw
  assertWidth(0x1_0000_0000, 32) throws
  table: setPort(base, 32, -1) throws, getPort(base, 32) = Uint8Array([0,0,0,0])
```

The table-level pair is there because the reported symptom was a *staged* value (`setPort` accepted and read
back `0xffff_ffff`), not merely a guard verdict; it asserts the refused write leaves the port at 0. Total:
937 → **938**.

## Mutation proof

M — the fast path reverted to exactly the pre-fix form (`task-12e-mutation-negatives-fast-path-red.log`):

```diff
-  if (width >= 32) return v >= 0 && v <= 0xffff_ffff;
+  if (width >= 32) return v <= 0xffff_ffff;
```

```
 ❯ test/core/signal.test.ts (20 tests | 1 failed) 15ms
 FAIL  test/core/signal.test.ts > assertWidth > rejects a negative value at width 32, so the fast path is non-negative too
AssertionError: expected [Function] to throw an error
 ❯ test/core/signal.test.ts:161:39
    161|     expect(() => assertWidth(-1, 32)).toThrow(/does not fit a 32-bit p…
 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
exit=1
```

Exactly the new test fails, and nothing else in the file: the new assertion is load-bearing and no other
test in `signal.test.ts` depended on negatives being admitted. (`toThrow` fails on the first `-1`
assertion, so the width-33 and table-level assertions in the same test were not separately exercised by this
mutation; the mutation that would exercise them is the same single-token change.)

Restored and verified byte-identical to the commit: `git status --short` empty, `git diff --stat` empty,
focused re-run green (`task-12e-focused-green-post-restore.log`, 83 passed). The commit was then amended
once for a comment-clause wording fix (naming `extractField` / `insertField`); `git diff dce2c36 5bce87a --
src/core/signal.ts test/core/signal.test.ts` is **empty**, so the mutation was proved against the exact
function and test text the final commit contains, and the amend touched only `wide.ts` comment lines.

## Commands and output

`$N` = `node "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"`, `$P` =
`"C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"`, run from the worktree.
All logs sit beside this report.

| command | result | log |
|---|---|---|
| `$N $P test test/core/signal.test.ts test/core/defs-wide.test.ts` | **83 passed** (20 + 63), exit 0 | `task-12e-focused-green.log` |
| M: fast path → `v <= 0xffff_ffff` | **1 failed \| 19 passed**, exit 1 — the new test, named | `task-12e-mutation-negatives-fast-path-red.log` |
| restore, then focused re-run | **83 passed**, exit 0; `git status` empty | `task-12e-focused-green-post-restore.log` |
| `$N $P test` | **23 files / 938 tests passed**, exit 0 | `task-12e-full-suite.log` |
| `$N $P exec tsc --noEmit` | exit 0, 0-byte log | `task-12e-tsc.log` |
| `$N $P build` | exit 0 — `dist/index.html` 0.42 kB, `index-BJi6Tn_M.css` 2.31 kB, `index-DDu0rbvR.js` 98.61 kB | `task-12e-build.log` |
| audit probe (real modules, Node type stripping) | the accept/reject matrix, the `2**32` truncation, width 31, `maskOf(32)` | `task-12e-audit-probe.log`, script `task-12e-audit-probe.mjs` |

Post-commit, on the final `5bce87a` tree: focused **83 passed** (`task-12e-focused-green-final.log`), full
suite **23 files / 938 tests passed** (`task-12e-full-suite-postcommit.log`), `tsc --noEmit` exit 0
(`task-12e-tsc-postcommit.log`, 0 bytes), `pnpm build` exit 0 (`task-12e-build-postcommit.log`).

## Commit

`5bce87a` — 3 files, exactly the scope given, staged by explicit path (never `git add -A`). `git show
--name-status HEAD` lists only `src/core/defs/wide.ts`, `src/core/signal.ts` and `test/core/signal.test.ts`;
`git status` after the commit is empty. The controller's ledger
`.worktrees/phase1/.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` **is tracked** in this
branch, and it is neither modified nor staged: it was clean before the work and is clean now, and it is not
in the commit. No log, probe or report file entered the repo — every task-12e artifact lives beside this
report under the main checkout's `.superpowers/sdd/` tree (gitignored by `.superpowers/sdd/.gitignore`).
`src/core/fields.ts`, `src/levels/**` and everything else are byte-identical to `c830f50`.

## Concerns

1. None open for the two items. The fast path is kept with its justification re-verified, and the comment now
   matches the code.
2. Carried forward, unchanged and untouched: `core/fields.ts`'s `extractField` / `insertField` remain
   dormant-broken at width 31 (`insertField` throws for every field; `extractField` is only accidentally
   right), now named in `maskOf`'s comment as deferred. The level layer's missing pin-width cap
   (`levels/checks.ts:184,207`, `levels/tables.ts:15,45`) is likewise still open — both were reported by
   task 12d and are out of this task's file scope.
3. The `v >= 0` half is now asserted at widths 32 and 33 only; widths above 33 go through the identical arm
   with no width-dependent term, and the probe measured 64 as well, so no separate test was added for them.

# Task 12f — the two prose claims the re-review held open

Worktree `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`, base `5bce87a`). Both
sentences were introduced by the 12b–12e wave and both are false. Comments and docs only: no circuit,
palette, target or check changed, so neither edit can move a grade. Commit `b8aca93`, two files, staged
by explicit path.

## Fix 1 — "nothing imports a batch directly except that batch's own test"

**Said** (`src/levels/content/ch2/batch4.ts:116-118`, before this commit):

> Nothing imports a batch directly except that batch's own test, which grades it against its own file.

**False, and measurable.** `ch2/index.ts` imports all four batches, the batch tests are cumulative, and
two whole-chapter tests go through the index:

| importer | imports | line |
|---|---|---|
| `src/levels/content/ch2/index.ts` | batches 1, 2, 3, 4 | 2-5 |
| `test/levels/ch2-batch1.test.ts` | batch 1 **and** `CH2_LEVELS` | 15-16 |
| `test/levels/ch2-batch2.test.ts` | batches 1, 2 | 15-16 |
| `test/levels/ch2-batch3.test.ts` | batches 1, 2, 3 | 15-17 |
| `test/levels/ch2-batch4.test.ts` | batches 1, 2, 3, 4 | 15-18 |
| `test/levels/level-buildability.test.ts` | `CH2_LEVELS` (`ch2/index.ts`) | 11 |
| `test/levels/unlock-chain.test.ts` | `CH2_LEVELS` (`ch2/index.ts`) | 13 |

**Now** (`batch4.ts:116-119`):

> Each batch test imports its own batch and every earlier one, and the two cross-cutting tests --
> `level-buildability.test.ts` and `unlock-chain.test.ts` -- reach the whole chapter through
> `ch2/index.ts`, the module that joins the four.

The load-bearing half of the paragraph — all four batches are joined, which is what makes chapter 2 the
26 levels at indices 13-38 — is untouched; only the false tail was replaced.

## Fix 2 — "a `switch` is one delay unit where the AND cell is two"

**Said** twice, once from the fix wave and once pre-existing:

- `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md:116`: "…因为 `switch` 只算一个延迟单位而 AND 单元算两个。"
- `src/levels/content/ch2/batch4.ts:430` (level 28's comment, pre-existing): "…because a `switch` is one delay unit where the AND cell is two…"

**The claim does not hold against the defs.** The two parts are metric-identical to the grader:

| def | `cost` (delay unit) | `gateCost` (NAND equivalents) | where |
|---|---|---|---|
| `and` | 1 | 2 = `AND` | `defs/index.ts:231`, `cost: 1` at `:77`, `AND = 2` at `:48` |
| `switch` (1-bit) | 1 | 2 = `w * AND` | `defs/wide.ts:671-687`, args `1, w * AND` at `:681-682` |
| `delay_line` | 0 | 0 (`?? cost`) | `defs/index.ts:280-298`, `cost: 0` at `:285` |

`gateCost()` sums `def.gateCost ?? def.cost` per instance (`levels/grader.ts:44-52`), and the delay metric
charges `cost` per node, so level 28's reference (`test/fixtures/ch2-references.ts:569-580`: `not`,
`switch`, `switch`, `or`, `delay_line`) and the AND/NOT/AND mux built from registered `and` parts are the
same five nodes — **8 NAND equivalents, 3 delay units, tick 4**, exactly this level's own `threeStar`
(`batch4.ts:480`). The old sentence's numbers hold only if "AND 单元" means a *hand-built* AND, i.e. a NAND
feeding a NOT: two components, 2 delay units, 2 NAND equivalents.

**Now**: doc line 116 and `batch4.ts:428-435` both state the tie and name the one construction the old
numbers do fit. The doc's next sentence (`:118`) already said `and(a, on)` 与 `switch` 在计分上完全同价,
so line 116 contradicted line 118; the two now agree. The doc's "真正第一次**需要** `switch` 的参考解"
became "第一次**用上** `switch`" for the same reason — see the next section.

## Does `switch` earn its place in level 28's reference? — reported, not papered over

**On the graded metrics, no.** Both `switch` instances are 1-bit (`value AND set`, and `d AND ~set`), the
registered `and` is on this level's palette (`GATES_1BIT`, `batch4.ts:128-141`, offered at `:456`), and the
two defs carry the same pair, so two `and` nodes would produce the identical 8/3/tick-4 circuit. `switch`
buys nothing here that `and` would not buy; the part is interchangeable, not cheaper.

What the data does support is why the reference reads as it does: the level's own hint names the part
("两个开关分别送出 value 与输出自己" / "pass value and the output through two Switches",
`batch4.ts:453-454`), and the twin loop at level 35 is hinted the same way (`batch4.ts:895-896`). That is a
naming and teaching choice — which is what the corrected prose says. Neither file now asserts a cost
advantage for `switch` anywhere.

`switch` is still genuinely load-bearing elsewhere in the chapter (its wide sibling `switch8` on level 22's
ripple chain, where an `and8` would need a splitter/maker to broadcast `on`), so this finding is scoped to
level 28's 1-bit reference. **No circuit, palette, target, check or fixture was touched** — the
interchangeability is reported for the controller, not fixed.

## Commands and output

`$N` = the runtime node, `$P` = the runtime pnpm, exactly as the brief documents; run from the worktree,
post-commit on `b8aca93`. Logs sit beside this report.

| command | result | log |
|---|---|---|
| `$N $P test` | **23 files / 938 tests passed**, exit 0 | `task-12f-full-suite.log` |
| `$N $P exec tsc --noEmit` | exit 0, 0-byte log | `task-12f-tsc.log` |
| `$N $P build` | exit 0 — `dist/index.html` 0.42 kB, `index-BJi6Tn_M.css` 2.31 kB, `index-DDu0rbvR.js` 98.61 kB | `task-12f-build.log` |

The suite, the typecheck and the build were also run against the identical pre-commit working tree with
the same results, which is what `batch4.ts` being a source file asked for.

## Commit

`b8aca93` — `docs(levels): correct the import claim in batch 4 and the switch note`. 2 files, exactly the
scope given, staged by explicit path (never `git add -A`): `src/levels/content/ch2/batch4.ts`,
`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`. `git status` after the commit lists
only the controller's ledger `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`, modified
and **not** staged, not in the commit, and untouched by this task.

## Concerns

1. `switch` is interchangeable with the registered `and` in level 28's reference, so it does not earn its
   place on either graded metric (section above). The prose now states the tie instead of claiming a cost
   advantage, and the circuit is untouched because the brief puts it out of scope.
2. This section is appended to the main checkout's copy of this report — the path the brief named and the
   file the 12b–12e sections are in. The worktree also holds a same-named, older report
   (`# Task 12 — final review wave (phase 1)`, 16 kB), which was **not** touched, so the two files still
   differ; worth knowing if anything reads the worktree copy.
3. Nothing else is open. No sentence in the corrected text rests on an unverified claim: the importer list
   and both def pairs are quoted with file and line above, and `def: 'switch'` appears in no filed
   reference before level 28 (`test/fixtures/ch2-references.ts:574-575` is the only fixture hit), which is
   why "the first reference to use it" survives as a fact where "the first to need it" did not.
