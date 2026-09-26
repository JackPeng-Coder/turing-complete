# Task 12 report — 章节地图、叙事外壳与冒烟测试

**Status:** DONE
**Commit:** `452e90d` `feat(ui): add chapter map, original narrative shell and playwright smoke test`
**Branch:** `master` (local-only repo, per the phase-0 setup ruling)

---

## 0. Preflight: the brief file was missing

`task-12-brief.md` did not exist on disk (every other brief 1–11 did). It is not
tracked by git (`.superpowers/sdd/.gitignore` is `*`), so it could not be
recovered from history. I regenerated it from the plan with the repo's own
fence-aware extractor before starting:

```
& pwsh -NoProfile -File tools\sdd\task-brief.ps1 `
    docs\superpowers\plans\2026-09-25-turing-complete-phase0.md 12 `
    .superpowers\sdd\2026-09-25-turing-complete-phase0\task-12-brief.md
# wrote ...\task-12-brief.md: 464 lines
```

The regenerated brief covers plan lines 5607–6070, i.e. Task 12 plus the
phase-0 acceptance checklist and the plan's self-audit sections (Task 12 is the
last task, so its "section" runs to EOF). Two brief defects were found and are
noted in §7: the step numbering repeats 8/9, and the second smoke test has a
stray `Run: ... install chromium` line spliced into the middle of its body,
which is why `await page.mouse.up();` is missing there.

---

## 1. What I implemented

### 1.1 `src/ui/narrative.ts` (new, 96 lines)

`Narrative { before, after }` of `LocalizedText`, `NARRATIVE` with the brief's
12 original chapter-1 entries verbatim (Chinese and English), and
`narrativeFor(levelId)` falling back to generic text for a level with no
authored narrative — the fault tolerance the brief specifies for later
chapters. All text is the brief's own original writing; nothing is copied from
the source material, and no character names are taken from it.

### 1.2 `src/ui/map.ts` (new, 54 lines)

`mountMap(root, store, onSelect)` builds one `<button class="map-tile">` per
entry of `LEVELS`, in level order, inside a `.map` > `.map-grid` section:

- `disabled = !isUnlocked(progress, level.id, order)` — locked tiles cannot be entered;
- passed levels carry `record.stars` as `★` and are tinted `THEME.success`;
- locked-and-unpassed tiles are dimmed with `THEME.textMuted`;
- the level the board has open gets `.map-tile-current`;
- a click reports `onSelect(levelId)`; the map never changes the level itself;
- it subscribes to the store, so progress changes re-render it.

Colours come from `src/ui/theme.ts`; the one new CSS rule mirrors
`THEME.accent` per the established stylesheet exception.

### 1.3 Briefing overlay in `src/main.ts`

`showBriefing(text)` renders a `.briefing` panel (fixed, full-viewport) with
the `before`/`after` text and a `开始` button that removes it. It is pure
narrative: it does not read or write the store and never reaches the level
data, so it cannot participate in grading. It fires in three places — on
startup for the resume level, on `openLevel` for every level entered from the
map, and in `regrade` when an attempt passes.

### 1.4 Map wiring in `src/main.ts`

The placeholder `openMap` from Task 11 is gone. `mapRender = mountMap(mapScreen,
store, openLevel)` is mounted before `mountShell` (which prepends its bar into
`#app`, so the screens element has to exist first), and `onOpenMap` now calls
`showScreen('map')` and `mapRender.render()`.

### 1.5 `playwright.config.ts` (new) and `test/smoke/ui.spec.ts` (new)

Config as amended by the plan: `webServer.command` reads `NODE_BIN`/`PNPM_BIN`
from the environment, `testDir: './test/smoke'`, `testMatch: /.*\.spec\.ts/`,
port 4173 with `--strictPort`, `reuseExistingServer: !CI`. `test/smoke/sanity.test.ts`
is a vitest file and is deliberately not matched.

Two smoke tests cover the real player path: enter level → dismiss the briefing
→ pick parts from the palette → place → wire output pin to input pin → read the
grade; then reload and check that progress came back, level 2 is unlocked, the
map shows ★ on level 1, and clicking a tile navigates back to that level with
its briefing.

---

## 2. Exact commands and results

Toolchain (not on PATH). `pnpm` on PATH was re-confirmed broken while writing
this report:

```
> (Get-Command pnpm).Source
C:\Users\ME\AppData\Local\pnpm\bin\pnpm.ps1
> pnpm --version
&: ...pnpm.ps1:14 ... 'C:\Users\ME\AppData\Local\pnpm\bin/../global/v11/49d0-1a0096e4fc9-
f014d0455fced34d/node_modules/@pnpm/exe/pnpm.exe' 不会被识别为 cmdlet、函数、脚本文件或可执行程序的名称。
```

so every command below is run through the bundled binaries:

```powershell
$node = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
```

| Check | Command | Result |
|---|---|---|
| Baseline before touching anything | `& $node $pnpm test` | 231 passed (231) |
| Unit tests (final) | `& $node $pnpm test` | **239 passed (239)**, 15 files |
| Typecheck + build (final) | `& $node $pnpm build` | `tsc --noEmit` clean; `✓ built in 52ms` |
| Smoke test (final) | `$env:NODE_BIN=$node; $env:PNPM_BIN=$pnpm; & $node "node_modules\@playwright\test\cli.js" test` | **2 passed (4.8s)**, exit code 0 |

Net test delta: +8 (12 → 20 in `test/ui/panels.test.ts`): 3 narrative tests and
5 chapter-map tests.

No browser install was needed: `chromium-1243` / `chromium_headless_shell-1243`
were already present next to the older 1223 that does not match
`@playwright/test` 1.63.0.

---

## 3. TDD evidence

### RED 1 — unit tests (why expected: neither module exists yet)

```
& $node $pnpm vitest run test/ui/panels.test.ts
 FAIL  test/ui/panels.test.ts [ test/ui/panels.test.ts ]
Error: Failed to resolve import "../../src/ui/map" from "test/ui/panels.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: D:/Documents/turing-complete/test/ui/panels.test.ts:14:25
 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

### RED 2 — the real browser smoke test (why expected: Task 11 left `openMap` a
placeholder and shipped no briefing overlay, so there is no `开始` button to
dismiss the panel that would cover the canvas)

```
& $node "node_modules\@playwright\test\cli.js" test
[WebServer] $ tsc --noEmit && vite build
[WebServer] $ vite preview "--port" "4173" "--strictPort"

  1) test\smoke\ui.spec.ts:42:1 › level 1 is playable end to end and survives a reload
    Test timeout of 30000ms exceeded.
    Error: locator.click: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: '开始' })
    > 46 |   await page.getByRole('button', { name: '开始' }).click();

  2) test\smoke\ui.spec.ts:61:1 › progress survives a reload and unlocks the next level
    Error: locator.click: Test timeout of 30000ms exceeded.
      - waiting for getByRole('button', { name: '开始' })

  2 failed
[exit code: 1]
```

This RED run also proves the harness works on this host: the webServer built the
app and started `vite preview`, and Chromium 1243 launched and navigated.

### RED 3 — a genuine visual defect the smoke test found (not a test bug)

The first screenshot the smoke test produced showed the board still on screen
**beside** the map. `.screen-board { display: flex }` is an author rule, and
author rules outrank the user-agent `[hidden] { display: none }` regardless of
specificity, so `boardScreen.hidden = true` did nothing at all. It merely
stopped being the flex child that grows. The map "worked" until now only
because `mapScreen` was empty and an empty column is invisible.

I added the missing assertion first:

```ts
await page.getByRole('button', { name: '章节地图' }).click();
await expect(page.locator('.screen-board')).toBeHidden();
```

```
& $node "node_modules\@playwright\test\cli.js" test
  ok 1 ... level 1 is playable end to end and shows its epilogue (554ms)
  x  2 ... progress survives a reload and unlocks the next level (5.6s)

    Error: expect(locator).toBeHidden() failed
    Locator:  locator('.screen-board')
    Expected: hidden
    Received: visible
    Call timeout: 5000ms
    Call log:
      - Expect "toBeHidden" locator('.screen-board') with timeout of 5000ms
      - waiting for locator('.screen-board')
        14 × locator resolved to <div hidden="" class="screen screen-board">…</div>
           - unexpected value "visible"
  1 failed
  1 passed (9.8s)
[exit code: 1]
```

`<div hidden="" …>` and still visible is the whole defect in one line. Fixed in
`src/ui/style.css` (a file this task owns):

```css
.screen[hidden] { display: none; }
```

### GREEN

```
& $node $pnpm test
 Test Files  15 passed (15)
      Tests  239 passed (239)

& $node $pnpm build
✓ built in 52ms

& $node "node_modules\@playwright\test\cli.js" test
  ok 1 test\smoke\ui.spec.ts:41:1 › level 1 is playable end to end and shows its epilogue (572ms)
  ok 2 test\smoke\ui.spec.ts:64:1 › progress survives a reload and unlocks the next level (625ms)

  2 passed (4.8s)
EXITCODE=0
```

Run on the committed revision `452e90d` with a clean working tree. The smoke
test was green on every run after the fixes: four green runs while iterating
before the commit (after wiring, after fixing the screenshot timing, after the
CSS fix, after adding the map-navigation assertions) and three green runs
afterwards on the committed revision, one of which is transcribed in §4.
`test-results/.last-run.json` records `{"status": "passed", "failedTests": []}`.
The only non-green runs were the two RED runs in §3 RED 2 and RED 3.

---

## 4. The smoke test's actual output

```
[WebServer] $ tsc --noEmit && vite build
[WebServer] $ vite preview "--port" "4173" "--strictPort"

Running 2 tests using 1 worker

  ok 1 test\smoke\ui.spec.ts:41:1 › level 1 is playable end to end and shows its epilogue (572ms)
  ok 2 test\smoke\ui.spec.ts:64:1 › progress survives a reload and unlocks the next level (625ms)

  2 passed (4.8s)
SMOKE_EXITCODE=0
```

Artifacts (three screenshots, copied to `task-12-evidence/`; the originals live
in the gitignored `test-results/`):

| Evidence | What it shows |
|---|---|
| [smoke-level1-parts-placed.png](task-12-evidence/smoke-level1-parts-placed.png) | Level 1-1 with 高电平 and OUT placed from the palette, shell bar `门 0·延迟 0·拍 0·得分 0·未通过`, truth table showing the failing row `0 ≠ 1` in red |
| [smoke-level1-passed.png](task-12-evidence/smoke-level1-passed.png) | The epilogue overlay `门开了。走廊尽头还有一扇门，上面刻着一个与非门的符号。` over a passed board |
| [smoke-chapter-map.png](task-12-evidence/smoke-chapter-map.png) | The map filling the screen — level 1 green with `★★★`, level 2 ringed as current, levels 3–12 dimmed and disabled, board gone |

The `parts-placed` shot also independently confirms the geometry the smoke test
hard-codes: the parts land at the expected screen positions (pin row on the
cursor's y, output pin 64 px right of the body's left edge), which is why the
drag lands on real pins.

---

## 5. Files changed

```
 playwright.config.ts   |  29 ++++++++++++      (new)
 src/main.ts            |  50 +++++++++++++++++---
 src/ui/map.ts          |  54 ++++++++++++++++++++++ (new)
 src/ui/narrative.ts    |  96 ++++++++++++++++++++++++++++++++++++++ (new)
 src/ui/style.css       |   7 +++
 test/smoke/ui.spec.ts  |  94 +++++++++++++++++++++++++++++++++++++ (new)
 test/ui/panels.test.ts | 122 ++++++++++++++++++++++++++++++++++++++++++++++-
 7 files changed, 443 insertions(+), 9 deletions(-)
```

`package.json` is untouched; zero runtime dependencies were added.

---

## 6. Self-review findings

1. **The `.screen[hidden]` fix is a Task 11 defect, found by this task's smoke
   test.** Reported prominently because it changes behaviour beyond the brief's
   literal step list, and because the same class of bug (an author `display`
   rule silently defeating the `hidden` attribute) is easy to reintroduce. The
   brief's own CSS comment already states the intent — "one screen at a time
   fills the space below the shell bar" — so the stylesheet, not the JS, was the
   side that had to change.
2. **The brief's `mountMap(root, store: Store, …)` signature does not
   compile.** `Store<S extends object>` declares no default type parameter, so a
   bare `Store` is `TS2314: Generic type 'Store<S>' requires 1 type argument`.
   Used `Store<AppState>`, exactly as `mountShell`, `mountPalette` and
   `mountTruthTable` do. The behaviour is unchanged; only the annotation
   differs.
3. **`playwright.config.ts` is deliberately outside `tsconfig.include`.** It
   reads `process.env`, and `@types/node` is not installed — with
   `types: ["vitest/globals"]` that would fail `tsc --noEmit` and break
   `pnpm build`. Adding `@types/node` is not allowed (no dependency changes), so
   the config stays where the brief put it and Playwright's own transpile loads
   it. `test/smoke/ui.spec.ts` *is* inside `include` (`test/**`) and therefore
   is typechecked by `pnpm build`.
4. **`openLevel` keeps Task 11's `canvas.dataset.pendingDef = ''`.** The brief's
   step-8 snippet omits it, but without it a part armed in level 1 stays armed
   after switching levels, so the first click on the new board silently stamps a
   part the new level may not offer. Kept deliberately; it is not one of the
   four changes the step describes.
5. **Passed-but-locked tiles are disabled.** The brief's prose says "tiles for
   un-passed-and-locked levels disabled", while its code says
   `tile.disabled = !unlocked`. These differ only for a level that is passed but
   whose predecessor is not — reachable only by a hand-edited save. I followed
   the code: linear gating is the invariant `isUnlocked` enforces, and a locked
   level should not be enterable.
6. **One of my own assertions was wrong, not the implementation.** I first
   asserted `tile.style.color === THEME.success`; jsdom parses the inline colour
   and reports `rgb(63, 185, 80)`. The assertion now normalises both sides
   through a local `rgbOf()` helper, so it still pins the exact colour rather
   than merely asserting "some colour was set". This was the only failing
   assertion I had to correct, and it was a units mistake, not a weakened claim.
7. **Import tidying.** `type Progress` was folded into the existing
   `app/progress` value import rather than added as a duplicate line.

### Additions beyond the brief's literal snippets (all keep the strong assertions)

- The smoke test dismisses the briefing and *also* asserts that passing shows
  the epilogue (`门开了`) — the `after` text is otherwise untested end-to-end.
- `.screen-board` / `.screen-map` visibility assertions (§3 RED 3).
- A map-navigation assertion: clicking tile 0 returns to the board, on level 1,
  with level 1's briefing (`金属舱室`). Without it, nothing verified that the
  map is wired to `openLevel` at all — the tile assertions alone would pass with
  a completely dead `onSelect`.
- A third narrative test asserting both locales exist on `before` *and* `after`
  for every chapter-1 level plus the fallback: the overlay only renders `zh`,
  so a missing `en` would ship silently.
- Two `page.screenshot()` calls, so the acceptance checklist's "at least one
  screenshot" is satisfied by real artifacts rather than by Playwright's
  default screenshot-on-failure.

---

## 7. Issues and concerns

1. **The epilogue re-fires on every later edit of a passed level.** This is the
   brief's code as written (`regrade` shows `narrativeFor(l.id).after` whenever
   `result.passed`), and I implemented it faithfully rather than adding an
   unexplained guard. Concretely: pass level 1, dismiss the epilogue, then nudge
   a part 8 px — `regrade` runs, the level still passes, and the epilogue covers
   the board again. If the intent is "once per level, on the first pass", the
   fix is one condition in `regrade` (`progress.levels[l.id]?.passed !== true`
   before showing it). Flagging rather than changing it, because it is a
   behaviour the brief specifies and no test pins either way.
2. **Clicking the current level's own tile wipes the open circuit.**
   `openLevel` clears the undo stack and installs `emptyGraph`. That is Task 11
   semantics and the map just calls it, so this is pre-existing, but the map now
   makes it reachable in one click (build on level 5, open the map, click level
   5's tile, work is gone). Worth a follow-up decision: ignore a selection of
   the already-open level, or confirm before resetting.
3. **The briefing overlay has no keyboard dismissal and no dialog semantics.**
   It covers the whole viewport including the shell bar, so `开始` is the only
   way out. The brief specifies exactly that, and it is not a grading path — but
   `Escape` and `role="dialog"` + `aria-modal` would be cheap follow-ups.
4. **`mountMap` rebuilds all 12 tiles on every store notification**, including
   each frame of a board pan. The palette guards against this with a memo key;
   the map does not. It is invisible in practice (the map is static while open,
   and the tiles are rebuilt only on a store change, of which there are none
   while the map is on screen), so I kept the brief's simpler code rather than
   adding a fourth memoisation scheme to the codebase.
5. **The regenerated brief has two defects of its own** (§0): duplicated Step
   8/9 numbering, and a `Run: … install chromium` line spliced into the middle
   of the second smoke test, which had swallowed `await page.mouse.up();`. I
   reconstructed that line — without it the wire is never completed and both
   tests fail on the pass assertion.
6. **`pnpm smoke` still cannot be run as `pnpm smoke` on this host**; the
   working invocation is the `node … @playwright/test/cli.js test` form in §2
   with `NODE_BIN`/`PNPM_BIN` exported. The plan records the same host facts,
   and `package.json` was left alone rather than hard-coding host paths into a
   portable script.
