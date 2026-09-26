# Task 10 fix report — move `AppState` / `DragState` into `src/app/store.ts`

Status: **DONE_WITH_CONCERNS** — every gate is green (focused 11/11, full suite 213/213, i.e.
209 pre-existing + 4 new, and `pnpm build` clean); no existing test line changed and the generic
`Store<S>` / `createStore<S>` are byte-identical to HEAD. The one concern is outside the briefed
scope: the plan document still assigns the store to Task 11 (see §6.1).

The file-ownership overlap is resolved: Task 11 no longer needs to write `src/app/store.ts`.
It consumes `AppState` / `DragState` from the app layer and fills in the rest of
`src/ui/board/view.ts` around the `Camera` type.

## 1. Missing module: option 1 (preferred)

`src/ui/board/view.ts` did not exist, so the type-only `Camera` import in `store.ts` would not
resolve. I took the **preferred option**: created the file with **only** the `Camera` interface
plus a short doc comment. No behaviour — `worldToScreen`, `screenToWorld`, `snap`, `pinPosition`
and `hitTest` are deliberately absent; they remain Task 11's work. The file is 13 lines:

```ts
/**
 * The board's viewport transform: camera position in world units (the pan
 * offset, screen pixels at zoom 1) plus the zoom factor.
 *
 * Only the type lives here for now -- `app/store.ts` imports it type-only to
 * declare `AppState`. The world/screen conversions, snapping and hit testing
 * that operate on a `Camera` are added by the board task that owns this file.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
```

New file, untracked at HEAD: `src/ui/board/view.ts`. It is not bundled (`vite build` still
transforms 4 modules) because the only importer uses `import type`, which is erased.

## 2. `src/app/store.ts` — `+30 / -3`

Added, verbatim as briefed, directly after the module header and before `Store<S>`:

- six type-only imports: `Graph` (`../core/graph`), `Registry` (`../core/registry`),
  `GradeResult` (`../levels/grader`), `LevelSpec` (`../levels/spec`), `Progress` (`./progress`),
  `Camera` (`../ui/board/view`). All are `import type`, so nothing is emitted and the
  `core ⇄ app ⇄ ui` edges do not exist at runtime — `tsc` and the bundle confirm it.
- `export type DragState` — the four-variant union with the briefed doc comment.
- `export interface AppState` — the nine fields with the briefed doc comment.

The 3 removed lines are **the stale sentence in the module header doc comment**, not code. It
read "The concrete application state -- level, graph, camera, selection -- is declared by the UI
layer that owns those types", which this fix makes false; it now reads "The container stays
generic; the one concrete state this app has, `AppState`, is declared below and passed in here
as the type parameter:". Nothing else in the file changed:

```
HEAD src/app/store.ts lines 20-63  ===  working tree lines 47-90   (byte-identical)
```

so `Store<S>`'s and `createStore<S>`'s signatures and bodies — including the snapshot-with-live-
membership `emit`, the unconditional notification and the idempotent unsubscribe — are exactly
as Task 10 committed them.

## 3. `test/app/store.test.ts` — `+80 / -0`

Appended one new `describe('AppState through createStore')` block with four tests; the seven
existing `createStore` tests are untouched (the diff contains **zero removed lines**), only the
import block grew:

- builds a minimal valid `AppState` — `getLevel('ch1-01-crude-awakening')`, `emptyGraph()`,
  `createRegistry(BASE_DEFS)` from `src/core/defs`, `emptyProgress()`, a `Camera`, empty
  selection, `dragging: null`, `lastGrade: null`, `status: null`;
- `createStore<AppState>(state).get()` is `toBe(state)`;
- `set({ selected })` and `set({ camera })` each notify, in order, and are visible through
  `get()` (the recorded notifications assert both patches and their ordering);
- the unsubscribe returned by `subscribe` stops delivery (1 call after two `set`s, and the
  second `set` still landed in `get()`);
- one extra test carries all four `DragState` variants through `set` so the union is exercised,
  not merely declared. No Task 10 behaviour is re-tested beyond these briefed assertions.

## 4. Commands and output

Focused, while iterating:

```
$ & "<node>" "<pnpm.mjs>" test test/app/store.test.ts

 RUN  v5.0.2 D:/Documents/turing-complete

 ✓ test/app/store.test.ts (11 tests) 11ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  21:59:06
   Duration  574ms (transform 69%, import 20%, worker 7%, tests 4%)
```

Full suite, before committing:

```
$ & "<node>" "<pnpm.mjs>" test

 RUN  v5.0.2 D:/Documents/turing-complete

 ✓ test/core/signal.test.ts (16 tests) 30ms
 ✓ test/app/commands.test.ts (6 tests) 24ms
 ✓ test/core/registry.test.ts (24 tests) 47ms
 ✓ test/app/progress.test.ts (14 tests) 28ms
 ✓ test/levels/grader.test.ts (12 tests) 46ms
 ✓ test/levels/checks.test.ts (20 tests) 71ms
 ✓ test/persist/storage.test.ts (12 tests) 30ms
 ✓ test/smoke/sanity.test.ts (1 test) 11ms
 ✓ test/app/store.test.ts (11 tests) 23ms
 ✓ test/levels/ch1-part1.test.ts (34 tests) 56ms
 ✓ test/levels/ch1-part2.test.ts (29 tests) 58ms
 ✓ test/core/net.test.ts (19 tests) 384ms
   ✓ compile (4)
     ✓ sizes the signal table for the circuit instead of the 65,536 default 334ms
 ✓ test/core/graph.test.ts (15 tests) 698ms
   ✓ validateGraph (9)
     ✓ scans a 50,000-instance cycle without recursing 660ms

 Test Files  13 passed (13)
      Tests  213 passed (213)
   Start at  21:59:13
   Duration  1.92s (transform 52%, import 22%, tests 17%, worker 9%)
```

209 before this fix, 213 now: the delta is exactly the four new tests, and every pre-existing
test file reports the same count as at `b62bd86`.

Build:

```
$ & "<node>" "<pnpm.mjs>" build
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 4 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                0.33 kB │ gzip 0.26 kB
dist/assets/index-Cunev-bE.js  0.76 kB │ gzip 0.48 kB

✓ built in 60ms
```

`tsc --noEmit` type-checks `src` **and** `test` (tsconfig `include`), so the new test file is
under the same strict flags as the source: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`.

## 5. Confirmation

- **No existing test changed.** `git diff --numstat -- test/app/store.test.ts` is `80 0`; the
  diff for that file contains no `-` line other than the `--- a/...` header, and no other file
  under `test/` was touched at all.
- **The generic store did not change.** HEAD's lines 20–63 (the whole `Store<S>` interface and
  `createStore` implementation) are byte-identical to the working tree's lines 47–90.
- **Nothing else moved.** `Progress`, `GradeResult`, `LevelSpec`, `Graph` and `Registry` are
  imported, not redeclared. No dependency added, `package.json` untouched, no other part of
  `src/ui/` implemented, no existing test modified.

## 6. Concerns

1. **The plan document still assigns `src/app/store.ts` to Task 11.**
   `docs/superpowers/plans/2026-09-25-turing-complete-phase0.md` lines 4785–4839 (Task 11,
   Step 6) still show the pre-Task-10 code block: a non-generic `Store`/`createStore` with
   `AppState`/`DragState` declared inline. I left the plan alone (out of the briefed scope), but
   Task 11's brief must say "consume `AppState` and `DragState` from `src/app/store.ts`; do not
   redeclare them or re-implement the store", otherwise the plan will re-introduce exactly the
   overwrite this fix prevents. The plan's summary line 4569 has the same stale shape.
2. **`src/ui/board/view.ts` is a placeholder that Task 11 owns.** It exports only `Camera`. If
   Task 11's `view.test.ts` arrives expecting the conversion helpers, that file must be extended
   — the interface itself is the contract `AppState.camera` depends on, so `Camera`'s three
   fields (`x`, `y`, `zoom`) should not change shape without touching `store.ts`.
3. **`test/app/store.test.ts` now spans two concerns** (the generic container and the concrete
   app state). That is what the brief asked for and the boundary is documented in the new
   block's comment, but a later split into `store.test.ts` + `app-state.test.ts` would be
   reasonable if the file keeps growing.

This report lives under `.superpowers/sdd/`, which is gitignored by
`.superpowers/sdd/.gitignore` (`*`), matching the earlier task reports; it is intentionally not
part of the commit.
