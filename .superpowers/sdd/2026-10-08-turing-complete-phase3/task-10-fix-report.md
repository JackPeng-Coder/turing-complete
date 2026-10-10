# Task 10 — Phase 3 whole-branch fix wave: implementer report

Date: 2026-10-10
Branch: `master`
Starting point: `4757e39` (the reviewed whole-branch HEAD)
Final HEAD: `163fddc`

Three commits, each staged by explicit path (`git add <path>` only; never `-A`/`.`):

| SHA | Subject |
| --- | --- |
| `e7244ca` | `fix(ui): keep the player's program when the board is reset` (Important 1 + nit 1) |
| `5cce329` | `fix(levels): stop the lock's record naming the secret` (Important 2) |
| `163fddc` | `docs(levels): trim the chapter-4 hints and correct two stale notes` (nits 2–4) |

One history note: the first version of `e7244ca` was missing the `ProgramRun`
type import in `signals.ts` and so failed `tsc --noEmit`. The import was folded
back into that commit with `git rebase -i --autosquash` (a `fixup!` commit), so
every commit in the wave builds; `5cce329`'s SHA moved with the rewrite. Nothing
had been pushed.

---

## Important 1 — the board's stop/reset wiped the program the IDE and debugger read

### What changed

* `src/ui/board/signals.ts:188-207` — new exported seam `resetBoard(display, run)`.
  When a run owns a machine (`run.machine !== null`) the reset goes through the
  **run's** `reset()`, which clears the board and then reloads the image
  (`loadProgramImage`); with no run behind the board it keeps
  `DisplaySimulation.reset()`. `ProgramRun` was added to the existing type import.
* `src/main.ts:960` — `onStop` (停止并复位) now calls
  `resetBoard(display, ensurePlayerRun())`, then `syncPlayerInputs()` (a reset
  clears the inputs with the storage) and `refreshBench()` (the debugger's
  counter/RAM are readings of that machine and were not repainted before).
* `src/main.ts:361` — the test run's per-case reset (`if (item.reset)`) uses the
  same seam: `resetBoard(display, playerRun)`. That is the reviewer's
  `main.ts:357` latent hazard; no shipped level both has a case list and grades a
  player program today, so it is pinned by the seam's contract.
* `test/ui/display-run.test.ts:117` — new regression test
  *“keeps the program loaded, and still runnable, when the board is reset”*, in
  the existing `createDisplay(..., machine)` + `ProgramRun` style: steps the
  shared machine, resets through the seam, and asserts tick 0, empty registers,
  `ram_prog` still `B1 8F…`, and `out` still carrying the echoed byte after two
  more edges.

### Why a helper instead of a test of `onStop` directly

`main.ts` is the whole application (top-level DOM, a real save, a real canvas) and
cannot be mounted in vitest; the closest seam the app actually exposes is the
display+run pair, so the app's reset was moved into `resetBoard` and the test
drives exactly that call. The closure wiring itself has no unit harness — see
“Seams not tested” below.

### RED evidence

* **Unit (committed test):** with `resetBoard` first added carrying the old
  behaviour (`display.reset()`), the new test failed:
  `AssertionError: expected [ +0, +0 ] to deeply equal [ 177, 143 ]` at the
  `run.readRam()` assertion (`test/ui/display-run.test.ts:143`) — the shared
  machine's `ram_prog` was 256 zeros. After the body was changed to route through
  the run, the file is green.
* **App level (temporary, uncommitted):** the committed smoke suite's count is
  part of the gate (21), so the app path was verified with a throwaway Playwright
  spec (`test/smoke/zz-tmp-reset-check.spec.ts`, run and then deleted) that seeds
  49 passed levels, opens level 50, types the five bytes, single-steps twice,
  clicks 停止并复位 and steps again. With the **pre-fix** `main.ts` checked out
  from `4757e39` it failed:
  `Expected: "0 拍"  Received: "2 拍"` — the debugger was not even repainted, and
  the machine behind it was wiped. Against HEAD it passes.

---

## Important 2 — level 54's failure record put the answer on screen

### What changed

* `src/levels/custom/lock.ts:199-212` — the budget failure keeps `inputs: { match: 0 }`
  (the level's own pin, so the record still keys its matrix column) and
  `actual: { try: tried }` (the byte the board's program actually reached), drops
  `expected` (`expected: {}`), and the detail no longer names the secret
  (`... ran out with the last code tried being ${tried}`). The pass criterion and
  `ticksUsed` are untouched.
* `test/levels/custom-lock.test.ts:199` — **new** test *“never puts the secret in
  the failure record the panel renders”*: runs the checker with secret 200 and a
  scripted board that publishes 9, then asserts the record's `inputs`/`actual`,
  `expected` empty, and that `JSON.stringify(failure)` and `detail` contain no
  `200`. The old-shape assertion in the budget test (was `{ try: 200 }`) and the
  real-board budget test (was `{ try: 42 }`) were updated the same way.
* `test/levels/ch4-batch2.test.ts:759-769` — the T8 strided-search test now
  asserts `expected` empty and that the whole record carries no `42`.

### RED evidence

Reverting `src/levels/custom/lock.ts` to the pre-fix checker (working tree only)
and running `custom-lock.test.ts` + `ch4-batch2.test.ts` produced exactly the four
record assertions failing, all with the secret still in `expected`:

```
AssertionError: expected { try: 42 } to deeply equal {}   (ch4-batch2.test.ts:765)
AssertionError: expected { try: 200 } to deeply equal {}  (custom-lock.test.ts:187)
AssertionError: expected { try: 200 } to deeply equal {}  (custom-lock.test.ts:213, the new test)
AssertionError: expected { try: 42 } to deeply equal {}   (custom-lock.test.ts:615)
4 failed | 67 passed
```

With the fix re-applied both files are green (71 passed).

### Seams not tested here

The truth table's DOM rendering was **not** mounted for level 54; what is pinned
is that the panel-facing record carries no secret. The panel's rendering path
(`hasVector`/`renderMatrix`, `src/ui/truthTable.ts:266-276`, `:299-301`) is
unchanged and stays covered by `test/ui/panels.test.ts`. The record still renders
as a column through `inputs.match`, showing the last byte the *player's* program
published — the player's own output, not the level's.

---

## Nits

1. **`src/main.ts:52-55`** (commit 1) — the “Nothing writes them yet -- the IDE is
   a later task” comment now says what is true: the IDE writes the text back on
   every keystroke through `onProgramEdit`, `progress.programs` and
   `saveProgress`.
2. **`src/levels/content/ch4/batch1.ts`** (commit 3) — level 50's hint no longer
   lists the five solution bytes and level 51's no longer says “把 5 改成 3”.
   Each is now the T7 recommendation: the encoding table (or the assembler's
   spellings) plus **one** worked example, `move|s2|d4` → `10010100`, which is not
   a line of the solution. Both languages and the levels' own voice are kept.
   *One file beyond the finding's list:* `test/smoke/ui.spec.ts:839` called the
   fixture bytes “the five bytes the level's own hint names”; that would have
   become false, so the comment now says “the five bytes the reference solution
   uses”. Comment only.
3. **`test/levels/ch4-batch2.test.ts`** (commit 3) — the code-lock budget test no
   longer compares `590 < 1024` as two literals: it grades the lock's reference
   (`runReference(spec)`) and asserts the run passed, spent more than zero ticks,
   and spent fewer than the level's own `budget`. The sum/mod-4 assertions are
   recomputed from the vectors the level data drives, via a new `answerOfWalk`
   helper (`:203`) used by both walks of levels 53 and 55 — moving a walk's input
   without moving its answer is now red, where the old lines compared literals to
   literals.
4. **`src/levels/checks.ts:1550`** (commit 3) — “the phase plan's Task 9” is now
   “Task 6” (the plan's ownership table gives `src/ui/ide.ts` and
   `src/ui/debug.ts` to T6).

---

## Gate (final tree, HEAD `163fddc`)

| Task | Command | Result |
| --- | --- | --- |
| Unit/level/convention tests | `pnpm test` | **48 files / 1497 passed** (baseline 1495; +2 new tests) |
| Types + production bundle | `pnpm build` | clean — 216.92 kB JS, 18.09 kB CSS |
| Browser smoke | `pnpm smoke` | **21 passed** (27.1 s) |

Focused runs used while iterating: `test/ui/display-run.test.ts`,
`test/levels/custom-lock.test.ts`, `test/levels/ch4-batch2.test.ts`,
`test/levels/ch4-batch1.test.ts`, `test/levels/run.test.ts`,
`test/ui/signals.test.ts`, `test/levels/ch4-registration.test.ts`.

## What was not tested (explicit)

* **The app's closure wiring** (`onStop`/`runTestStep` calling the seam) has no
  vitest harness — `main.ts` is not mountable in a unit test. It was verified at
  the app level with the temporary Playwright spec described above, not with a
  committed test, because committing one would change the suite's pinned count of
  21. If the controller wants that turned into a permanent smoke test, the spec is
  trivial to re-add from this report and the gate's expected count becomes 22.
* **The truth table's DOM for the lock record** was not mounted separately (see
  Important 2 above).
* **The `main.ts:361` case-reset path** has no shipped level exercising it (the
  combination is latent); it is fixed by the same seam the regression test
  covers, not by a level-level test.

Untouched: the controller's pre-existing working-tree modifications
(`progress.md`, `reference-programs.md`, the phase plan) and every untracked SDD
file; this report is not committed.
