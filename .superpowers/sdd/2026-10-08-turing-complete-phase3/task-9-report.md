# Task 9 report — 章节装配与既有断言更新

**Status: DONE**
**Commit:** `docs(levels): register chapter 4 and refresh every pinned count` (14 files, listed in §2)

## 1. What the task was

Register the seven chapter-4 levels T7/T8 delivered (`50`–`56`), hold every pinned count and
pinned test to the new shape (13/26/10/**7** = **56**), close the T8 reviewer's registration
hand-off (`custom: lock` / `custom: maze` were imported only by tests, so a browser session would
have graded levels 54 and 56 as `missing-check`), and sync the named documentation sentences.

Baseline before this task: `pnpm test` **47 files / 1470 tests**, all green.

## 2. File-by-file, with the pinned number before → after

### Registration (new + wired)

| File | Change |
|---|---|
| `src/levels/content/ch4/index.ts` **(new)** | `CH4_LEVELS = [...CH4_BATCH1, ...CH4_BATCH2]` plus the two side-effect imports `../../custom/lock` / `../../custom/maze` (see §3). Mirrors `ch2/index.ts` / `ch3/index.ts`; the module comment records that the chapter is two batches, that the reference programs live in `test/fixtures/ch4-references.ts`, and that the board is the level's own. |
| `src/levels/content/index.ts` | `...CH4_LEVELS` appended before `.sort((a, b) => a.index - b.index)` (still sorted by `index`). Header: "chapter 3 (40-49)" → "chapter 4 (50-56)"; the "chapter 2 … chapter 3 repeated the mistake" note gains chapter 4 as the third data point. |
| `src/levels/campaign.ts` | Seven rows appended, global 50–56, zh/en verbatim from the brief's table (proved by `campaign-shape.test.ts`, which compares id / chapter / index / both names exactly). Header: "Chapters 4-7 (levels 50-93) … covers the 49 levels of chapters 1-3" → "Chapters 5-7 (levels 57-93) … covers the 56 levels of chapters 1-4". |

### Pinned tests

| File | Pinned number | before → after |
|---|---|---|
| `test/levels/campaign-shape.test.ts` | chapter shape | `[1,2,3] → [13, 26, 10]` ⇒ `[1,2,3,4] → [13, 26, 10, 7]` |
| | chapter count in two test titles + header | three chapters / `1..49` ⇒ four chapters / `1..56` |
| `test/levels/unlock-chain.test.ts` | total level count (chapter-2 block) | `49` ⇒ `56` |
| | chapter-3 block ("at the end of the game") | `expect(LEVEL_ORDER).toHaveLength(49)` ⇒ `expect(LEVEL_ORDER.slice(49)).toEqual(CH4_LEVELS…)`; the block is retitled "…with chapter 4 following it" and its comment now records that the bounded `slice(39, 49)` is what kept it honest. The `slice(39, 49)` assertion itself was already bounded and did not change. |
| `test/levels/level-buildability.test.ts` | `LEVELS`/`LEVEL_ORDER` lengths | `49` ⇒ `56` (three assertions + describe/test titles) |
| | `LEVEL_ORDER.slice(39)` (unbounded, chapter-3 span) | ⇒ `slice(39, 49)`, **plus** `slice(49)` for chapter 4 — the "`slice(39)` boundary" the brief pins |
| | chapter span blocks | new `keeps chapter 4 whole, in index order…` (7 levels, 50–56 contiguous and unique, `CH4_LEVELS` vs the game's order) |
| | `REFERENCE_SOLUTIONS` | `Record<string, () => Graph>` ⇒ `Record<string, FiledReference>` where `FiledReference = (() => Graph) | { program: string }`; `...CH4_REFERENCES` spread in whole. **No existing entry changed.** `solutionFor(id)` ⇒ `referenceFor(level)` returning `{ graph, player? }`; chapter 4's graph comes from `graphFromBoard(level.id, level.board)` (the level's own board — no second circuit is filed anywhere). |
| | header comments | 49 → 56, "BOTH CHAPTERS" → every chapter joined, "TWO PLACES" → "THIS FILE AND THREE FIXTURES" |
| `test/levels/grader.test.ts` | reference union | `ch1Reference` + `CH2_REFERENCES` + `CH3_REFERENCES` ⇒ **+ `CH4_REFERENCES`**, typed `(() => Graph) | { program: string }`; `referenceOf(level)` reads the graph from `level.board` and passes `{ text: program }` as `grade`'s fourth argument. Test names "reference circuit" → "reference"; "covers all 49 ids" → "all 56 ids". |
| `test/ui/ide.test.ts` | "leaves every shipped level without an editor" | This test went **red** on registration (chapter 4 is the programming chapter: all seven levels mount the editor). It now walks both directions over `LEVELS`: no editor on chapters 1–3, editor on every chapter-4 level. Same walk, same non-vacuity floor (`LEVELS.length > 40`), original intent kept and made two-sided. **Not named by the brief** — see §6. |
| `test/smoke/ui.spec.ts` | map-tile count | `49` ⇒ `56` in **five** places (dev-mode enabled tiles, chapter-2 map, chapter-2 capstone, chapter-3 map, level 49's map) |
| | "49 is the last level" claims | the `?dev=1` comment ("The last level opens") now says level 49 is chapter 3's last, not the game's; the level-49 test title `the last level opens…` ⇒ `chapter 3 ends with a level that mounts its program check: level 49`, with the comment noting chapter 4 follows. Assertions unchanged (still level 49, `.nth(48)`). |

### New test

`test/levels/ch4-registration.test.ts` **(new)** — see §3.

### Documentation (pointwise)

| File | before → after |
|---|---|
| spec `§12` | new blockquote line: **阶段 3 已完成（2026-10-10）** … (the brief's "阶段表加一行") |
| spec `§5.3` | "第 1–3 章共 49 关已实现" → "第 1–4 章共 56 关已实现"; Ch4 row `未交付` → `已交付（阶段 3）`; "第 4–7 章的阶段划分…" → "第 5–7 章…" **(not named — see §6)** |
| spec `§1.1` | "第 1–3 章 49 关已实现" → "第 1–4 章 56 关已实现" **(not named — see §6)** |
| `RESEARCH.md §3` | the brief's exact substitution: "**第 4–7 章（尚未实现）** … 44 关（7+26+7+4 …）… §5 的第 4–7 章" → "**第 4 章 7 关已实现（2.x 基线），剩余第 5–7 章 37 关** … 37 关（26+7+4 …）… §5 的第 5–7 章" |
| `RESEARCH.md §5` | "已实现内容（第 1–3 章 49 关）" → "（第 1–4 章 56 关）"; "尚未实现的第 4–7 章 … §5 的第 4–7 章表" → "第 5–7 章 … 第 5–7 章表" **(not named — see §6)** |
| `README.md` | heading `(Phases 0–2)` → `(Phases 0–3)`; new Chapter 4 bullet (7 levels, 50–56); "Chapters 4–7 (programming and the assembly IDE, …)" → "Chapters 5–7 (the LEG CPU, …)"; layout block line "content/ (49 levels: chapters 1–3)" → "(56 levels: chapters 1–4)" (**layout block itself untouched** — same nine entries); "Phases 0–2 cover chapters 1–3, which is 49 of … 93" → "Phases 0–3 cover chapters 1–4, which is 56 …"; "remaining chapters 4–7" → "5–7" |
| `AGENTS.md` | "Chapters 1-3 (49 levels) are built; chapters 4-7 (44 levels)" → "Chapters 1-4 (56 levels) are built; chapters 5-7 (37 levels)"; "before planning chapter 4" → "chapter 5"; layout line "content/ (chapters 1-3 so far)" → "(chapters 1-4 so far)" |

## 3. The registration choice (T8 hand-off) and the test that proves it

**Choice: side-effect imports in `src/levels/content/ch4/index.ts`** (`import '../../custom/lock'`,
`import '../../custom/maze'`), **not** self-imports inside `src/levels/custom/index.ts`.

Why: `lock.ts` / `maze.ts` import `registerCustomCheck` from `custom/index.ts` and call it at
module top level. If `custom/index.ts` imported them, the edges would form a genuine runtime cycle,
and the checkers' top-level `registerCustomCheck(...)` would run while `custom/index.ts` was still
being evaluated — **before** its `const checkers = new Map()` line — so the very first import of
the level set would die with a TDZ `ReferenceError` (`Cannot access 'checkers' before
initialization`), for every entry point. On the content path the edges run one way
(`content/ch4/index.ts` → `custom/lock.ts` → `custom/index.ts`, which imports nothing at runtime —
its `checks` imports are type-only and erased), so the registry is fully constructed before a
checker registers into it. The set of checkers that ship is still decided by the level set that
names them, exactly as `custom/index.ts` documents.

**The test: `test/levels/ch4-registration.test.ts`.** It imports **no checker**. Its level source is
`ALL_LEVELS` from `src/levels/content/index.ts` (the game's own join), and it grades levels 54 and
56 with `grade(graphFromBoard(level.id, level.board), registry, level, { text: reference.program })`
using `CH4_REFERENCES`. It asserts (a) each level ships exactly one `custom:<id>` check and (b) the
grade has **no** failure reason `missing-check`, no failures at all, and `passed === true`.

**The test has teeth — proven, not asserted.** With the two import lines temporarily commented out,
the same file produced exactly the T8 defect:

```
× grades ch4-54-code-breaker's reference through the lock checker instead of missing-check
  AssertionError: … reason":"missing-check","detail":"no custom check is registered under id \"lock\""
× grades ch4-56-the-maze's reference through the maze checker instead of missing-check
  … "no custom check is registered under id \"maze\""
Test Files  1 failed (1) / Tests  2 failed | 1 passed (3)
```

The imports were restored immediately; the final run is 3/3 green. This is also the proof that a
fresh browser session grades 54/56 correctly: the test imports the same module graph the app does,
in its own isolated module registry (`vitest` isolates per file), and it is the only importer of the
checkers in that graph.

## 4. `test/levels/testcases.test.ts` (brief ruling 6)

**Verified green with chapter 4 registered, unchanged.** Its count walk skips any level with more
than one check, which is 50/51/52/53/55 (two `program` checks each); `testCases` returns
`{ kind: 'none' }` for a `program` level, so even the skipped walk has nothing to assert. The two
`custom` levels (54, 56) have exactly one check and return `{ kind: 'none', reason: 'custom' }`,
which the file already permits. No assertion in it had to change.

## 5. Test evidence

| Command (bundled node + `pnpm.mjs`) | Result |
|---|---|
| `pnpm test` (baseline, before any edit) | 47 files / **1470** tests green |
| `vitest run test/levels/ch4-registration.test.ts` (after registering, before the side-effect imports) | 2 failed (`missing-check` for `lock` and `maze`), 1 passed — the RED proof in §3 |
| `vitest run …ch4-registration.test.ts` (imports restored) | 3/3 green |
| `vitest run campaign-shape unlock-chain level-buildability grader ide testcases ch4-registration` | 7 files / 278 tests green |
| `pnpm test` (final) | 48 files / **1495** tests green (+1 file, +25 tests) |
| `pnpm build` (`tsc --noEmit && vite build`) | green, 70 modules, `dist/assets/index-DBNYoyGm.js` 216.76 kB / 73.85 kB gzip |
| `pnpm smoke` (Playwright, after registration landed) | **20 passed** (25.1 s) |

`pnpm smoke` was run after every source change; the only edits after it were documentation, one
comment in `level-buildability.test.ts` and a local variable in `test/ui/ide.test.ts` — none of
which is in the served bundle or the smoke spec, so the smoke result stands for the committed tree.

## 6. Deviations from the brief's file list (and why)

Three files outside the brief's list had to change; one of them changes an assertion.

1. **`test/ui/ide.test.ts`** — **was red** after registration: "leaves every shipped level without
   an editor" walked all shipped levels and asserted `levelExpectsProgram(level) === false`, which
   was true for chapters 1–3 and is false for chapter 4 by design. Rewritten as the two-sided walk
   (chapters 1–3 no editor, chapter 4 editor). Original intent and the whole-set walk are kept.
2. **`test/levels/level-buildability.test.ts`** — named by the brief, but the `LEVEL_ORDER.slice(39)`
   assertion in its "puts chapters 1 and 2 first" test was the actual unbounded `slice(39)` the
   brief's step 3 names; it is now `slice(39, 49)` + `slice(49)`.
3. **Pointwise doc counts the brief did not name** but which the registration made false, in the same
   files/sections it did name: spec `§1.1` and `§5.3` (49 → 56; Ch4 `未交付` → `已交付（阶段 3）`),
   `RESEARCH.md §5` ("已实现内容（第 1–3 章 49 关）" → 56; "尚未实现的第 4–7 章" → 第 5–7 章). No prose
   was restructured and no other section was touched.

**Deliberately left alone** (flagged for the controller rather than silently edited, because the
brief restricted doc/test edits to named sentences and numbers):

- `test/levels/program-check.test.ts:623` — "49 of them declare a `source` and no `from`" and
  `:770` — "49 shipped levels declare neither field". Both are now stale (56 levels ship; level 50
  declares `format: 'bytes'` and chapter 4's checks declare `from: 'player'`). A correct fix needs
  a sentence rewrite, not a number swap, which is outside "定点更新".
- `README.md`'s interface/behaviour sections and all dated plans
  (`docs/superpowers/plans/**`) are untouched, including the phase-3 plan that contains this task's
  own text.

## 7. Surprises

- **A second red test nobody listed.** `test/ui/ide.test.ts`'s "leaves every shipped level without an
  editor" was the only failure outside the five pinned files — it assumed no shipped level grades a
  player program, which is exactly what chapter 4 changes. Together with the smoke spec's
  "level 49 is the last level" comments, that is two files whose prose encoded "49 is the end".
- **The `custom` hand-off was invisible to every existing test.** `test/levels/ch4-batch1.test.ts`
  and `ch4-batch2.test.ts` import `custom/lock` / `custom/maze` themselves (deliberately), so
  registration changed nothing for them; the full suite was green *with the checkers unregistered*
  in the content path. The dedicated, checker-free test in §3 is the only thing that can see it.
- **The `slice(39)` boundary was real.** `level-buildability.test.ts` compared an unbounded
  `LEVEL_ORDER.slice(39)` against chapter 3; chapter 4 landing turned it red exactly as the comment
  above its sibling predicted.
- **No test count assertions were hidden by the multi-check skip.** Chapter 4's `custom` levels are
  single-check and still return `{ kind: 'none' }`, so `testcases.test.ts` needed no change at all.
- Line-endings: the six files I edited that are CRLF in this worktree (`README.md`, the spec,
  `grader.test.ts`, `level-buildability.test.ts`, `unlock-chain.test.ts`, `ui.spec.ts`) keep CRLF
  in the worktree; `.gitattributes` (`* text=auto eol=lf`) stores them as LF, and no line-ending
  churn appears in the diff.
