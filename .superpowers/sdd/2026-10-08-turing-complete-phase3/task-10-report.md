# Task 10 report — 阶段收尾（实现半边）

Scope: three small, disjoint changes. `.superpowers/**` untouched except this report; no phase
record written; no `src/` change.

Commits (in the required order, staged by explicit path only):

| SHA | Subject |
| --- | --- |
| `ddfc60e` | `test(smoke): grade chapter 4's first level end to end` |
| `8f1b678` | `docs: correct the last stale counts and the chapter-5 wording` |

## Job 1 — the chapter-4 browser smoke case

`test/smoke/ui.spec.ts:799` (doc comment from `:781`), one new test:
`chapter 4 grades a hand-written program: level 50`. Reused the level-49 pattern exactly —
`seedProgress(page, 49)` (the level-49 case with `seedProgress(page, 48)`) so the resume point is the
chapter's first level, then the real walk: dismiss the briefing, open the map, assert all 56 tiles and
that tile 49 is enabled, click it, dismiss the **second** briefing the tile raises, and then:

- assert the editor is the byte reader's (`aria-label` = `二进制程序编辑器`, from `ui/ide.ts`'s
  `LABELS.bytes`) — level 50 is the hand-written-machine-code level, and that label is how the app
  says so;
- `fill()` the five reference lines. They are inlined rather than imported (the spec is a browser
  walk and the fixture is the batch tests' module). **Byte-identity with
  `test/fixtures/ch4-references.ts`'s `CH4_REFERENCES['ch4-50-punchcard-programming']` was verified
  programmatically** — a node one-liner extracted the fixture's `program` block and the spec's array
  and compared the two joined texts (`byte-identical: true`, 5 lines each);
- click the level's 测试 button — `.ide-test`, the bench's own transport button, which on a program
  level calls `onTest` → `ensurePlayerRun()` → `toggleTest()` → `startTest()` → `finishTest()`
  (`src/main.ts:807`). `testCases()` reports `{ kind: 'none' }` for a `program` check, so the grade is
  one synchronous step: no run to watch, nothing to poll;
- assert the pass the way the existing spec does: `.truth-table h2` = `全部用例通过`,
  `.shell-metrics` contains `总开销`, `.ide-bytes` = `B10582409F` (the image the text became — the
  same five bytes the level's own hint names), and the result dialog says `关卡完成` and `程序关卡`
  (`levelKind` derives that from `checks[0].kind`), which is chapter 4's own kind of level;
- assert progress was written: `继续`, then the map — tile 49 carries `★` and tile 50 is enabled.

Screenshot: `test-results/smoke-ch4-level50-program.png`, `-passed.png`.

### Blocker check (as instructed)

No production change was needed. Level 50 is reached exactly as level 49 is, and the bench, the byte
editor, the `.ide-test` handler and the grade all already exist at `e1e6e5a`.

## Job 2 — the two stale comments (`test/levels/program-check.test.ts`, comments only)

No assertion touched; `git diff` shows only comment lines.

- `:623` — the "49 of them declare a `source` and no `from`" sentence now names the split:
  chapters 1-3 are the 49 levels that predate the option and **every `program` check among them**
  declares a `source` and neither `from` nor `format`; chapter 4's seven levels are the other side —
  each declares `from: 'player'` and no `source`.
- `:773` — the "49 shipped levels declare neither field" sentence gets the same treatment: the 49
  levels of chapters 1-3 declare neither field on any `program` check they ship, and chapter 4's
  seven declare `from: 'player'` (and a `format` with it).

**One deliberate wording deviation, flag it.** The brief's wording was "49 levels (chapters 1–3)
declare `source` and neither `from` nor `format`". That is not literally true as a per-level count:
only **four** of those 49 levels ship a `program` check at all (`ch3-43`, `ch3-45`, `ch3-46`,
`ch3-47` — all with `source`, no `from`/`format`; the other 45 have no program check, and chapters 1-2
have none), which is what `rg "kind: 'program'" src/levels/content` shows (4 hits in `ch3/`, 14 in
`ch4/`). I therefore kept the requested split and the 49/7 numbers but attached "declares a `source`"
to the program checks rather than to all 49 level objects. If the controller prefers the sentence
verbatim, say so and I will reword — but verbatim it would assert something a reader can disprove in
one grep.

## Job 3 — one README sentence

`README.md:59`: "Chapters 5–7 (the **LEG** CPU, …)" → "(the **Symphony** CPU, …)". The 2.x dossier
(`GAME_RESEARCH_2026-10-03.md:230`) names chapter 5 `进阶处理器架构 / CPU Architecture 2` and says
"Symphony 架构；2.0 前为 LEG", and the README's own scope paragraph (`:183-186`) already says the
campaign follows 2.x with "Symphony in place of LEG". Pointwise one-phrase edit; the rest of the
parenthetical (functions / assembly challenges / sandbox ≈ chapters 5/6/7) is untouched, as
instructed, and is not contradicted by the 2.x scope paragraph.

## Evidence

All three run from `D:\Documents\turing-complete` with the bundled runtime
(`$NODE = ...\dependencies\node\bin\node.exe`, `$PNPM = ...\dependencies\pnpm\bin\pnpm.mjs`).

`& $NODE $PNPM smoke` — at `8f1b678`, **21 passed (24.7s)**:

```
Running 21 tests using 1 worker
  ok  19 test\smoke\ui.spec.ts:750:1 › chapter 3 ends with a level that mounts its program check: level 49 (418ms)
  ok  20 test\smoke\ui.spec.ts:799:1 › chapter 4 grades a hand-written program: level 50 (975ms)
  ok  21 test\smoke\ui.spec.ts:869:1 › a save written before the 2.x realignment keeps its stars (455ms)
  21 passed (24.7s)
```

`& $NODE $PNPM test` — **48 files / 1495 tests passed** (`Duration 4.26s`), unchanged from HEAD.

`& $NODE $PNPM build` — `tsc --noEmit && vite build`, 70 modules, `✓ built in 89ms`, no diagnostics.

Run order: all three edits were in the working tree for the first full smoke run (21 passed there
too, after the fix below), then the two commits, then `test` and `build`, then a second `smoke` at
`8f1b678` whose output is quoted above. Commits change no file content, so the tested tree and the
committed tree are byte-identical.

## Surprises / notes for the controller

1. **A tile click raises the briefing again.** The first smoke run failed at `.ide-test`:
   `<div class="briefing"> intercepts pointer events` (30s timeout, 20 passed / 1 failed). Opening a
   level from the map re-raises its briefing — the `?dev=1` test already dismisses it a second time
   and the level-49 case never clicks anything after the tile, so neither existing case shows it.
   Fixed by clicking `开始` again after the tile click; the failing run is in
   `test-results/ui-chapter-4-grades-a-hand-written-program-level-50/`.
2. **The "49" in job 2 was also wrong about which levels declare what** — see the deviation note
   above.
3. **Commit 2's subject has no scope.** I used the two subjects exactly as specified in the task,
   but `docs: correct the last stale counts and the chapter-5 wording` does not match AGENTS.md rule
   4 (`type(scope): summary`) — the same class of defect the ledger's root todo 1 is fixing for
   `2468d61`. If the controller wants it reworded (e.g. `docs(readme): …`), it is one `git rebase`-
   free `commit --amend` away; I left it verbatim rather than substituting my judgement for an
   explicitly specified message.
4. **The smoke spec's header is already loose about "the last six tests"** (`CHAPTERS 2 AND 3 ARE
   COVERED BY THE LAST SIX TESTS`, while the migration test is now the last of 21 and chapters 2, 3
   and 4 are each covered). It was out of the named scope ("add one Playwright case"), so I left it
   alone — flagging it as a possible phase-closeout nit rather than editing unasked.
5. `ui.spec.ts` and `README.md` stayed CRLF in the worktree (`.gitattributes` stores LF); both diffs
   are insertion-only with no line-ending churn. `program-check.test.ts` is LF in the worktree, as it
   was.
