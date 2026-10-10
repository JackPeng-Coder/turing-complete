# Task 10 — Phase 3 residuals (reset route, guard, app-level evidence, level 51 brief)

Date: 2026-10-10. Tree: `D:\Documents\turing-complete`. Not committed (this file).

Commits (in order):

| SHA | Subject |
| --- | --- |
| `c7facc1` | `fix(ui): reset the board the player is looking at` |
| `d5ded79` | `test(smoke): pin the chapter-4 reset flow` |
| `413cc5f` | `docs(levels): keep level 51's brief out of the answer` |

## 1 + 2 — The reset route and the guard

**What was wrong.** `rebuild()` (`main.ts`) is the only place a display is bound
to `run.machine`. A text edit (`onProgramEdit`) drops the run without rebuilding,
so after any keystroke the display keeps painting the *previous* run's
`Simulation` while `ensurePlayerRun()` hands `resetBoard` a different one. With
`resetBoard`'s `run.machine !== null` guard the reset went to that other run, so
the painted board (canvas, the io clock card reading the display's snapshot, the
clock's counter) was never cleared. The same guard also let a run that had gone
inert mid-session (`step`/`reset` hit a settle failure → `stopped = true` →
`machine` reads `null` while the display still paints its `sim`) fall through to
`display?.reset()`, which wipes `ram_prog` with no reload.

**What changed.**

* `main.ts` `onStop` is now the re-review's recommended route:
  `dropPlayerRun(); rebuild(); paint(); io.render(); refreshBench(); paintTools();`.
  `rebuild()` builds a fresh run first (`createProgramRun` resets, loads the
  image and settles) and hands its machine to `createDisplay`, and it samples the
  new display; a board with no run compiles its own cleared circuit
  (`createDisplay` calls `display.reset()` when no machine is handed in). The
  player's text is in `state.programs`, so nothing typed is lost. `dropPlayerRun`
  also stops a program clock that the old handler left ticking.
* `runTestStep` (the `main.ts:361` path — a level with both a case list and a
  player program) takes the same route: if `levelExpectsProgram(store.get().level)`
  it does `dropPlayerRun(); rebuild();`, so a case reset can no longer clear a
  shared machine either. A board with no player program is still reset in place
  (`display?.reset()`), because recompiling the graph for every one of a fuzz
  level's cases (513 on `ch2-38-little-box`) would be the whole cost of the run.
* Item 2 folds in here: with the button and the case reset both going through a
  freshly built run, there is no path left on which the button wipes a machine
  that holds a loaded program — including the mid-session-inert case, because the
  machine it clears is brand new and was either loaded by the run or compiled
  empty by the display.

**`resetBoard` did not survive — deliberately.** After these two changes it had
no caller in `src/`. It was deleted from `src/ui/board/signals.ts` (along with
the now-unused `ProgramRun` type import) rather than left as a dead export, as
the brief directed. Its behavioural coverage was moved onto `ProgramRun.reset()`
in `test/ui/display-run.test.ts` (second test): the run resets to tick 0 with the
register file empty, the image still in `ram_prog` (`0xb1 0x8f`), the display
painting that same simulation reads tick 0, and two further edges still publish
the level's byte on `out` — the "reset clears the machine, the reset reloads the
image" property is intact.

`src/levels/run.ts` was **not** touched: it was not needed.

## 3 — App-level evidence (smoke)

One new Playwright case, `test/smoke/ui.spec.ts`: *chapter 4 resets the board
without losing the program: level 50* (22 total now). `seedProgress` gained an
optional third parameter and now writes the save's `programs` half
(`progress.programs`), so the walk seeds level 50's five fixture byte lines (the
same text the existing level-50 case types; the two walks now share one
`LEVEL_50_PROGRAM` constant) and the display opens built on the run's machine.

The walk: open level 50 → assert the editor holds the text and the debugger's RAM
reads `B1` → two clicks of the toolbar's 单步 (clock card reads `2 拍`) → a
keystroke in the editor (type a space, Backspace it: same text, and the run the
display was built on is dropped) → press 停止并复位. Assertions: the io clock card
reads `0 拍`, the editor still holds the text, and after one 单步 the IDE's byte
view reads `B10582409F` with the RAM window showing `B1 05 82 40 9F` (the program
was never silently lost).

**RED evidence.** With the pre-fix `onStop` body restored temporarily
(`ensurePlayerRun()` + the old `run.machine !== null` guard + `display?.reset()`
fallback), the case failed:

```
1) test\smoke\ui.spec.ts:890:1 › chapter 4 resets the board without losing the program: level 50
   Error: expect(locator).toContainText(expected) failed
   Locator: locator('.io-tick')
   Expected substring: "0 拍"
   Received string:    "2 拍 · 10Hz"
```

**The assertion that caught it was the clock card** (`await
expect(page.locator('.io-tick')).toContainText('0 拍')`): the reset had gone to
the fresh run the keystroke left behind, while the display went on painting the
old machine at 2 ticks. The fix was then restored (verified by diff) and the case
passed: `ok … chapter 4 resets the board without losing the program: level 50
(766ms)`.

Because the smoke case lands on `main.ts`'s wiring and not on the seam, the
brief's option to fold it into commit 1 was not taken: it is its own commit
(`d5ded79`), and the three-commit shape in the brief is unchanged.

## 4 — Level 51's brief

`src/levels/content/ch4/batch1.ts`, `ch4-51-assembly-programming`: both briefs no
longer spell the solution. Removed `move|inp|d1、loadi|3、move|s0|d2、add、
move|s3|out` (zh) / `move|inp|d1, loadi|3, move|s0|d2, add, move|s3|out` (en) and
replaced them with a pointer at the hint's table:

* zh: `每行一条指令，# 之后是注释——汇编器认哪几种写法、每种长什么样，提示里列了表和例子。`
* en: `One instruction per line, with # starting a comment: the hint lists the spellings the assembler accepts, with a worked example.`

The brief still states the task (`out = (in + 3) & 0xff`, constant 5 → 3, the
machine halts after `out`) and the hint is untouched. No test pins the brief text
(`test/levels/ch4-batch1.test.ts` asserts only `brief`-referenced metrics).

## Gate results (final committed tree)

| Gate | Result |
| --- | --- |
| `pnpm test` | 48 files / 1497 tests passed |
| `pnpm build` | `tsc --noEmit && vite build` clean, 70 modules |
| `pnpm smoke` | 22 passed (was 21; the new case is the 22nd) |

Run with the bundled toolchain from README "Running it":
`C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
+ `…\pnpm\bin\pnpm.mjs`, from the repository root.

## Concerns

None blocking. Two notes for the record:

* The `main.ts:361` branch for a level with both a case list and a player program
  is not exercised by any shipped level (none declares both), so it is covered by
  reading rather than by a test; a mixed level now resets correctly, at the price
  of one recompile per `item.reset` case on such a level.
* Screenshots written by the new walk (`test-results/smoke-ch4-level50-reset*.png`)
  are test artefacts, not committed.
