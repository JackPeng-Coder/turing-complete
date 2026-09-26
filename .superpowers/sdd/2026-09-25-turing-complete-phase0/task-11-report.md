# Task 11 report: UI 外壳、画板与调色板

**Status:** DONE (one brief-vs-test conflict resolved in favour of the test, reported below)

**Commit:** `63df10e` — `feat(ui): add canvas board, palette, shell and truth table panel`
(Task 11 step 12). 11 files, +1344/-4. This report lives under `.superpowers/`,
which `.superpowers/sdd/.gitignore` excludes, so it is not part of the commit.

**Note on the brief:** `task-11-brief.md` does not exist in
`.superpowers/sdd/2026-09-25-turing-complete-phase0/`. The requirements I worked
from are the plan's own Task 11 section,
`docs/superpowers/plans/2026-09-25-turing-complete-phase0.md` lines 4557-5603,
plus the "Interfaces from earlier tasks" and "Design decisions already made"
sections of the dispatched task. Where the plan's Task 11 code disagreed with
the shipped Tasks 1-10 code, I followed the shipped code (it has tests) and
recorded every difference below.

---

## 1. What I implemented

| File | Content |
|---|---|
| `src/ui/theme.ts` | `THEME` (18 colours), `GRID = 8`, `PIN_RADIUS = 4`, `INSTANCE_WIDTH = 64`, `INSTANCE_HEIGHT = 48`. Values verbatim from the plan. |
| `src/ui/board/view.ts` | Extended the existing `Camera` file with `worldToScreen`, `screenToWorld`, `snap`, `instanceRect`, `pinPosition`, `hitTest`, `Point`, `Hit`. `Camera`'s three fields untouched. |
| `src/ui/board/render.ts` | `renderBoard`: DPR-correct backing store (only reassigned when the CSS box changed), background, grid, wires (beziers), parts, pins. Reads state, never the DOM timers. |
| `src/ui/board/interact.ts` | `attachBoardInput` + `levelIoInstanceId`: placement, wiring, wire/part deletion, part dragging, panning, wheel zoom, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Delete/Backspace, Escape. All mutations go through `CommandStack` and then `options.onChange()`. |
| `src/ui/shell.ts` | `mountShell`: level title, 章节地图 button, armed-part status, grade metrics with stars. |
| `src/ui/palette.ts` | `mountPalette`: `paletteDefsFor(progress, LEVELS, level)` ∩ registry, localised labels, reports def ids. |
| `src/ui/truthTable.ts` | `mountTruthTable`: pass banner with the three metrics, or the failing rows as `actual ≠ expected` (capped at 20 rows) plus any fatal graph error. |
| `src/ui/style.css` | Layout: `#app` column flex, shell bar first, `.screens` fills the rest, board screen = palette / board / truth table. Colours mirror `theme.ts` (the one accepted exception). |
| `src/main.ts` | Wires everything: store, CommandStack, screens, palette pick → `dataset.pendingDef`, regrade-on-change, save progress, placeholder `openMap`, `openLevel` seam for Task 12, render on store change + resize. |
| `test/ui/view.test.ts` | 6 geometry/hit-test tests (the plan's Step 1 verbatim). |
| `test/ui/panels.test.ts` | The plan's 7 panel tests + 5 placement/binding tests (see §4). jsdom docblock first line. |

Zero runtime dependencies: only `src/` modules, DOM and Canvas 2D. No image,
sprite, font or audio asset was added. Comments are English.

---

## 2. Brief code that could not work as written (each decision + evidence)

### 2.1 `snap()` returns `-0`, so the brief's own test fails — **fixed in the implementation**

The brief's `snap` is `Math.round(v / GRID) * GRID`. `Math.round(-3 / 8)` is
`-0` and `-0 * 8` is `-0`, so `Object.is(snap(-3), 0)` is `false` while the
brief's `test/ui/view.test.ts` asserts it is `true` (with the comment "`-0` and
`0` are the same grid cell").

Which side expresses the intent? The test. A part dropped just left of the
origin must not store `-0` as its coordinate: `Object.is(-0, 0)` is false, so
position comparisons (`toEqual`, `instance.x === startX`) disagree about two
coordinates in the same grid cell, and the negative zero would also travel into
the saved graph. I kept the assertion and normalised in `snap`:

```ts
const snapped = Math.round(v / GRID) * GRID;
return snapped === 0 ? 0 : snapped;
```

RED evidence in §4 (RED-2). No assertion was weakened.

### 2.2 `Store` needs an explicit type argument

`src/app/store.ts` (Task 10) ships the **generic** `Store<S extends object>`, so
the plan's bare `store: Store` signatures do not compile (`Generic type 'Store'
requires 1 type argument`). Every UI module and `main.ts` uses
`Store<AppState>` / `createStore<AppState>(...)` instead. `AppState` and
`DragState` are imported, never redeclared.

### 2.3 The brief's grid painter draws a ~128 px patch

The plan's `drawGrid` computes `ox = (camera.x * zoom) % (step * 4)` and then
draws five lines at `ox + i * step * 4` — five lines, 32 px apart, covering at
most 160 px of a ~1280 px board, and it paints the *first* of them in the major
colour rather than every fourth. `render.ts` walks the visible world range
instead: a minor pass every `GRID * zoom` px (skipped below 4 px spacing) and a
major pass every fourth line. Verified visually in the browser (§5, screenshots
2 and 11).

### 2.4 Palette / board / truth table were in the wrong DOM order

Both `mountPalette` and `mountTruthTable` append to the board screen, and the
plan appends the canvas first, so the visual order was board → palette → truth
table: the palette strip (styled with `border-bottom`) ended up *below* the
board. `main.ts` now appends in visual order — palette, canvas, truth table —
so DOM order matches layout order and tab order.

### 2.5 Nothing could ever be placed as level IO — **the level was unwinnable**

`levels/checks.ts` binds a circuit to its level **by instance id**:
`IN_<pin>.out` for inputs and `OUT.in` / `OUT_<pin>.in` for outputs. The plan's
placement path calls `addInstance(g, defId, x, y)` with no id, so every palette
placement would be `i1`, `i2`, … and no level could ever pass: the level's
output slot is never found, `readOutput` returns 0, and the truth table reports a
mismatch forever. There is no rename UI in Phase 0 either.

`attachBoardInput` now asks `levelIoInstanceId(level, graph, defId)` for the
conventional id: level inputs in pin order (`IN_a`, `IN_b`, …), the single
output as `OUT`, and a multi-output level as `OUT_out3`, `OUT_out2`, … (level
12). Once the level's pins are all placed, an extra part falls back to the
graph's allocator, which is legal but inert. This is also what Task 12's smoke
test depends on: it clicks 关卡输出 and expects the level to pass.

Level 12's four outputs are drawn with their instance id (`OUT_out3`) instead of
the type name, because four identical 关卡输出 boxes are otherwise
indistinguishable.

### 2.6 Placement convention: the cursor lands on the part's pin row

The plan's placement is `snap(world.x), snap(world.y)`. Task 12's smoke test
drags from `cx - 160 + 64, cy` (the source's output pin, "output pin at
`x + INSTANCE_WIDTH`, vertically centred" per the plan's own note) to
`cx + 160, cy` (the target's input pin). With top-left placement the pin sits at
`inst.y + INSTANCE_HEIGHT / 2`, i.e. **24 px below** the row that was clicked,
so both the drag start and the drop point miss the pin by 24 px and no wire is
ever created. The plan's Step 5 anticipates exactly this ("连线的 `pointerup`
落点偏出引脚 … 修实现，不要放宽断言").

Placement is therefore:

```ts
const x = snap(world.x);
const y = snap(world.y - INSTANCE_HEIGHT / 2);
```

i.e. the click lands on the pin row at the part's left edge, so a part dropped at
`(px, py)` has its output pin at `(px + 64, py)` — the row the player then drags
along. This makes Task 12's coordinates work verbatim: I ran its exact pointer
sequence in Chromium against both the built preview and the dev server and level
1 passes (§5).

### 2.7 Panel tests did not typecheck

The plan's `makeStore` helper lets TypeScript infer the state object, where
`lastGrade: null` widens to the type `null`; the very next line
(`store.set({ lastGrade: { … } })`) then fails `tsc --noEmit`, which
`pnpm build` runs over `test/` (RED-4 in §4). `makeStore` is annotated
`Store<AppState>` / `createStore<AppState>`; every assertion is unchanged.

---

## 3. Deliberate additions beyond the brief's snippets

Each is small, and each is load-bearing for "this task is what makes it
playable"; none of them changes a brief assertion.

1. **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.** `attachBoardInput` is handed a
   `CommandStack` that otherwise only ever grows: every edit was one-way. Undo
   and redo replay the stack against the live graph, clear the selection (the
   selection may name a part a history step just removed) and re-grade. Verified
   in the browser: undo turns a pass back into a failing check, redo restores it.
2. **Dragging a part.** `AppState.dragging` / `DragState['instance']` exist for
   this. A drag moves the part in place (`store.set({})` — the store's
   notification is unconditional by design), and the whole drag is recorded as
   one undoable `move` command with absolute start/end coordinates.
   `DragState['wire']` is published too, so the board lights up the output pin a
   wire is being pulled from.
3. **Escape disarms the picked part**, and the shell bar shows
   `已选 <part> — 点击画板放置，Esc 取消` through the otherwise unused
   `AppState.status`. Picking a part is a stamp: without both, it stays armed
   forever and every later click on empty space drops another copy.
4. **Panels compare what they display.** The store notifies unconditionally
   (that is deliberate), so a pan or a drag fires a notification per frame. The
   palette keys on `level.id + available defs` and the truth table on
   `level.id + grade identity`, so a drag does not rebuild their DOM 60 times a
   second (which would drop button hover/focus state for nothing).
5. **`registry.has` guards** in the palette and in `renderBoard`, per the task's
   warning that `registry.get` throws on an unknown id.
6. **A fatal graph error is printed** in the truth table. `grade` returns no
   failures when `validateGraph` reports an error, so the panel would otherwise
   show a bare red 用例 with no rows and no explanation.

---

## 4. TDD evidence

Toolchain (bare `pnpm` on PATH is broken):

```
$node = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
$pnpm = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs
& $node $pnpm <script>
```

### RED-1 — `test/ui/view.test.ts` written first (plan Step 1 → Step 2)

`pnpm test test/ui/view.test.ts`

```
 ❯ test/ui/view.test.ts (6 tests | 6 failed) 15ms
   × round-trips world and screen coordinates 7ms
   × translates without scaling when zoom is 1 1ms
   × snaps to the 8 pixel grid 1ms
   × finds an instance by its body 1ms
   × prefers a pin over the body underneath it 1ms
   × returns null in empty space 1ms
TypeError: worldToScreen is not a function
 ❯ test/ui/view.test.ts:13:20
Test Files  1 failed (1)   Tests  6 failed (6)
```

Why it failed: `src/ui/board/view.ts` declared only the `Camera` interface at
this point; the geometry functions did not exist yet. (The module resolved, so
the failure is the missing behaviour rather than a path typo.)

### RED-2 — the brief's `snap` fails the brief's own assertion (the conflict)

After implementing `theme.ts` and `view.ts` with the plan's code **verbatim**:

`pnpm test test/ui/view.test.ts`

```
 ❯ test/ui/view.test.ts (6 tests | 1 failed) 17ms
   ✓ camera (2)  ✓ hitTest (3)
   × snaps to the 8 pixel grid 10ms
AssertionError: expected false to be true // Object.is equality
 ❯ test/ui/view.test.ts:28:36
     28|     expect(Object.is(snap(-3), 0)).toBe(true); // -0 and 0 are the sam…
Test Files  1 failed (1)   Tests  1 failed | 5 passed (6)
```

Why it failed: `Math.round(-3 / 8) * 8 === -0`, and `Object.is(-0, 0)` is
`false`. `snap` was changed to return `0` for that cell (§2.1); the assertion
was kept as written.

### RED-3 — `test/ui/panels.test.ts` written before the panels existed

`pnpm test test/ui/panels.test.ts`

```
 FAIL  test/ui/panels.test.ts [ test/ui/panels.test.ts ]
Error: Failed to resolve import "../../src/ui/palette" from "test/ui/panels.test.ts". Does the file exist?
 Test Files  1 failed (1)   Tests  no tests
```

Why it failed: `src/ui/palette.ts`, `shell.ts`, `truthTable.ts` and
`board/interact.ts` did not exist yet. Same class of RED the plan uses for
`view.test.ts` ("无法解析 …"). The panel test was written here rather than after
the panels (plan Step 10) so that it could produce a RED at all; every
assertion is the plan's.

### RED-4 — `pnpm build` rejects the plan's panel test

```
$ tsc --noEmit && vite build
test/ui/panels.test.ts(73,7): error TS2322: Type '{ passed: true; … }' is not assignable to type 'null'.
test/ui/panels.test.ts(91,7): error TS2322: Type '{ passed: false; … }' is not assignable to type 'null'.
test/ui/panels.test.ts(122,7): error TS2322: Type '{ passed: true; … }' is not assignable to type 'null'.
```

Why it failed: `createStore({ …, lastGrade: null, … })` infers `lastGrade` as
the literal type `null`. Fixed by annotating the helper `Store<AppState>` (§2.7).

### GREEN

```
$ pnpm test test/ui/view.test.ts
 ✓ test/ui/view.test.ts (6 tests) 9ms
 Test Files  1 passed (1)   Tests  6 passed (6)

$ pnpm test test/ui
 ✓ test/ui/view.test.ts (6 tests) 10ms
 ✓ test/ui/panels.test.ts (12 tests) 107ms
 Test Files  2 passed (2)   Tests  18 passed (18)

$ pnpm test                      # full suite, includes every earlier task
 Test Files  15 passed (15)
      Tests  231 passed (231)    # 213 before this task; +18 new

$ pnpm build
$ tsc --noEmit && vite build
✓ 29 modules transformed.
dist/index.html                  0.41 kB │ gzip:  0.30 kB
dist/assets/index-BN-MFgtQ.css   2.24 kB │ gzip:  0.85 kB
dist/assets/index-PwJ9whFX.js   37.91 kB │ gzip: 13.94 kB
✓ built in 91ms
```

---

## 5. Browser verification (throwaway harness, deleted before committing)

jsdom cannot exercise canvas, pointer capture or real layout, so I drove the real
UI in Chromium through a temporary Playwright config + spec, then deleted both
(plus `test-results/`) — Task 12 owns `playwright.config.ts` and
`test/smoke/ui.spec.ts`, and neither exists in this commit (`git status` clean of
them).

Six scenarios, run three times: against the built preview (`vite preview`, port
4173), against `vite --port 5173` (the `pnpm dev` path, where the CSS arrives
through the JS import instead of a `<link>`), and once more against a fresh
preview build of the frozen commit. **6 passed every time.**

1. **Level 1 end to end with Task 12's exact pointer coordinates** — palette
   高电平 → click `(cx-160, cy)` → palette 关卡输出 → click `(cx+160, cy)` →
   drag `(cx-96, cy)` → `(cx+160, cy)`: `.truth-table` becomes 全部用例通过 and
   `.shell-metrics` shows `得分 0 · ★★★`. No page errors, no console errors
   other than the browser's automatic `/favicon.ico` 404 (index.html declares no
   icon; adding one would mean adding an image asset, which the constraints
   forbid).
2. Reload keeps the win and level 2 opens with 与非门 enabled.
3. Ctrl+Z turns the pass back into a failing check, Ctrl+Shift+Z restores it.
4. Escape clears the armed part, and the next click on empty space places
   nothing.
5. A part can be dragged 96 px down, and a wire drawn from its new pin row still
   passes the level.
6. Shift+drag pans the camera and the wheel zooms around the cursor; the grid
   and the parts follow, and the pass state survives.

Screenshots inspected: initial, two parts placed (failing truth-table row
`0 ≠ 1`), passed, reloaded, undone, redone, dragged, panned, zoomed. Layout,
grid coverage, selection highlight, wire bezier, pin dots and both panels look
correct at 1280x800.

---

## 6. Files changed

Created:
- `src/ui/theme.ts`
- `src/ui/board/render.ts`
- `src/ui/board/interact.ts`
- `src/ui/shell.ts`
- `src/ui/palette.ts`
- `src/ui/truthTable.ts`
- `src/ui/style.css`
- `test/ui/view.test.ts`
- `test/ui/panels.test.ts`

Modified:
- `src/ui/board/view.ts` (kept `Camera`; added the geometry/hit-test API)
- `src/main.ts` (was a 2-line placeholder)

Not touched: `src/app/**`, `src/core/**`, `src/levels/**`, `src/persist/**`,
`vite.config.ts`, `package.json`, `index.html` — no runtime dependency was
added.

---

## 7. Self-review findings

Read the whole diff after the browser run. Found and fixed:

1. `drawGrid`'s line loops had no guard against `spacing <= 0`; a corrupted
   `camera.zoom` of 0 would have hung the tab. Added `if (!(spacing > 0)) return;`
   (the wheel handler clamps zoom to 0.25-4, so this is defence in depth).
2. `renderBoard` called `graph.instances.find` once per wire (O(n·m)); it now
   builds an id map once, as `hitTest` already did.
3. `drawInstance` read `store.get()` once per instance; it now takes the state
   the caller already fetched.
4. A leftover draft expression in `drawWires`'s parameter type
   (`Store<AppState>['get'] extends never ? …`) and two unused imports
   (`INSTANCE_WIDTH/HEIGHT`) were replaced with a plain `Registry` parameter —
   the plan had papered over the unused imports with `void INSTANCE_WIDTH;`.
5. Dropped the plan's `void graph;` / `void INSTANCE_WIDTH;` no-op statements.
6. The truth table's `用例` heading was red even before the first grade; it is
   now muted when there is no grade, red only for a real failure.

Verified explicitly:

- `Camera`'s shape is unchanged and `AppState.camera` still typechecks against
  it (Task 10's `store.test.ts` passes).
- No colour literal in any drawing code: `render.ts` uses `THEME` only. The only
  literals are in `style.css`, the accepted exception (commented as such).
- No `requestAnimationFrame` anywhere; the board repaints from the store
  subscription and the window `resize` listener only, and `store.set` is what
  makes pan/zoom/drag repaint (`renderBoard` is skipped while the board screen is
  hidden, where `clientWidth` is 0).
- The canvas backing store is only reassigned when `clientWidth/Height * dpr`
  actually changed, so painting does not reallocate or clear the buffer per
  frame.
- Every `registry.get` call site is preceded by `registry.has`.
- All user-facing strings are Chinese panel labels, as the plan specifies;
  `AppState.status` carries `{ zh, en }`.

No unrepaired defects found in the reviewed diff.

---

## 8. Issues, concerns and hand-off notes for Task 12

1. **Task 12's smoke test needs the briefing overlay it expects to dismiss.**
   Its first line is `await page.getByRole('button', { name: '开始' }).click()`.
   Per the scope boundary, the overlay is Task 12's, so this commit's `main.ts`
   does not render it — Task 12 must add `showBriefing` *and* the
   `showBriefing(narrativeFor(level.id).before)` call before that test can run.
2. **`playwright.config.ts` as planned will fail on this machine twice over**:
   `@playwright/test` 1.63.0 expects browser revision 1243 while the local cache
   holds 1223 (`Executable doesn't exist at …chromium_headless_shell-1243…`), and
   its `webServer.command` is `pnpm build && pnpm preview …`, where bare `pnpm`
   on PATH is broken. For my own verification I pointed
   `launchOptions.executablePath` at
   `%USERPROFILE%\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe`
   and ran the servers from the bundled node/pnpm; Task 12 will need the same
   treatment (or `pnpm exec playwright install`, which needs network).
3. **No wire preview while dragging.** `DragState['wire']` has no cursor field
   and I would not extend a Task 10 type, so a wire drag in progress shows only
   the armed source pin (highlighted in `THEME.pinOn`) until `pointerup`. A
   rubber-band line would need a cursor in `DragState` or an optional
   `renderBoard` parameter.
4. **Picking a part is a stamp, not one-shot.** It stays armed (with a visible
   status hint and Escape to cancel) so several of level 12's eight IO parts can
   be placed without re-picking. If one-shot placement is preferred, clear
   `canvas.dataset.pendingDef` at the end of `place()` and drop the Escape
   handler.
5. **Pin hit tolerance is 7 world px** (`PIN_RADIUS + 3`, the plan's value), so
   grabbing a pin at zoom 0.25 is a 1.75 px target on screen. Making it
   zoom-aware means changing `hitTest`'s signature (it takes no camera), which is
   a cross-task contract change I did not take unilaterally.
6. **Two brief texts disagree about whose `main.ts` is final.** The plan's Task 12
   Step 8 replaces parts of Task 11's `main.ts`; the version here keeps
   `openLevel`, `showScreen`, `regrade` and the `mapScreen` element so that step
   is additive. If Task 12 restructures it, `status` (the armed-part hint) and
   `canvas.dataset.pendingDef` must stay in sync with the palette pick — that is
   the only coupling between `main.ts` and `interact.ts`.
7. **Not fixed, by design:** the browser's `/favicon.ico` 404 (adding an icon
   would add an image asset); the plan's `test/ui/panels.test.ts` reorder
   (written before the panels to obtain a RED — see RED-3).
