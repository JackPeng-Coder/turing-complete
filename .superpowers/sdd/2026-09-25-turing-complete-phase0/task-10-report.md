# Task 10 report — 应用状态、撤销栈、进度与持久化

Commit: `b62bd86` — `feat(app): add progress model, command stack and local storage`
Branch: `master` (working tree clean afterwards)

Commands used throughout (toolchain is not on PATH):

```
node = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
pnpm = C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs
& "<node>" "<pnpm>" test [file]     # vitest run
& "<node>" "<pnpm>" build           # tsc --noEmit && vite build
```

## What I implemented

### `src/app/progress.ts`
- `Progress` / `LevelRecord` (`version: 1`, `levels: Record<string, LevelRecord>`, `best: Metrics | null`, `stars: 0 | 1 | 3`), all fields `readonly`.
- `STARTER_COMPONENTS = ['level_input', 'level_output', 'const_on', 'const_off'] as const` — four members, as the context ratified, exported as the single copy that both chapter-1 gating tests now import and that `paletteDefsFor` consumes.
- `SCORE_WEIGHTS` is **re-exported** from `levels/grader.ts`, not redeclared. `applyGrade` compares `result.score` against the grader's `scoreOf(previous.best)`; there is exactly one scoring formula in the repo (verified by grep: only `src/levels/grader.ts:23` declares it).
- `emptyProgress`, `isUnlocked` (linear unlocking, first level always reachable, throws `unknown level: <id>` for ids outside the order), `resumePointOf` (first *reachable and unpassed* level, else the last level; throws on an empty order rather than returning `undefined` behind a `string` type), `unlockedComponents` (derived: starter set ∪ rewards of passed levels), `paletteDefsFor` (`level.allowedComponents` filtered by the unlocked set).
- `applyGrade` is pure and gates on `result.passed` before writing anything, because `grade()` scores any valid-graph circuit including one that failed its checks. Improvements are decided by `result.score < scoreOf(previous.best)`.

### `src/persist/storage.ts`
- `STORAGE_KEY = 'tc.progress.v1'`, `migrate`, `loadProgress`, `saveProgress`, `exportProgress` (pretty-printed), `importProgress`.
- `migrate` rejects a non-record payload (`not a progress payload`), rejects any version other than 1 (`unsupported progress version: …`), repairs a missing/array `levels` map to `{}`, and returns a **fresh** object holding only `version` + `levels` so a stale top-level `unlockedComponents` field from an older save is dropped rather than resurrected.
- `loadProgress()` / `saveProgress()` are optional-chained (`globalThis.localStorage?.…`) and wrapped in `try/catch`: with no DOM (node tests) or a storage that throws (private mode) the progress stays in memory instead of throwing. `loadProgress` also reads an absent or corrupt save as a fresh one.

### `src/app/commands.ts`
- `Command` and `CommandStack` exactly as specified. `push` **applies** the command then records it, drops the redo branch, and caps history (default 200, oldest dropped). A `do` that throws records nothing and leaves the redo branch intact. `undo`/`redo` return `false` when their branch is empty; `clear()` forgets both.

### `src/app/store.ts`
- Deliberately dependency-clean generic core: `Store<S extends object>` (`get`/`set`/`update`/`subscribe`) and `createStore<S>(initial)`.
- `set` shallow-merges a patch, `update` replaces the state with the transform result; both notify synchronously, in subscription order, with the new state. Notification is **unconditional** because `core/graph.ts` edits `g.instances`/`g.wires` in place, so a reference-equality change check would silently swallow a re-render — exactly the trap the task context warned about. The listener round iterates a snapshot and re-checks membership, so a listener can unsubscribe itself or another listener mid-notification.
- **Scope note / conflict:** the task header lists `src/app/store.ts`, and the plan's Task 10 file list repeats it, but the plan's Task 11 *also* claims it (`Files: Create src/app/store.ts`, `Interfaces: interface AppState { … camera: Camera … }`, `Step 6: 实现 src/app/store.ts`). `AppState` embeds `Camera` (declared in `src/ui/board/view.ts`) and `DragState`, i.e. UI-layer types that do not exist yet and whose import would put app → ui against the declared `app → levels → core` direction. So I shipped the part that is Task 10's by dependency, and left the concrete `AppState`/`DragState` to Task 11. **Task 11 must not overwrite the file blindly:** keep `Store<S>`/`createStore`, then declare `AppState` + `DragState` in the same file and use `Store<AppState>` — the plan's method bodies are already what is there.

### Tests
- `test/app/progress.test.ts` (14), `test/app/commands.test.ts` (6), `test/persist/storage.test.ts` (12), `test/app/store.test.ts` (7) — 39 new tests, all green. The first three files are the brief's tests plus additions; `store.test.ts` is new because the store step has no brief test.
- `test/levels/ch1-part1.test.ts` and `test/levels/ch1-part2.test.ts` now `import { STARTER_COMPONENTS } from '../../src/app/progress'` and no longer declare local copies (the old "kept in sync with…" comments are gone). Level 1's palette assertion is now a cross-module invariant: `CH1_PART1[0].allowedComponents` (sorted) === `STARTER_COMPONENTS` (sorted).

## What I tested and the results

| Command | Result |
| --- | --- |
| `pnpm test test/app/progress.test.ts` | 14/14 pass |
| `pnpm test test/app/commands.test.ts` | 6/6 pass |
| `pnpm test test/app/store.test.ts` | 7/7 pass |
| `pnpm test test/persist/storage.test.ts` | 12/12 pass |
| `pnpm test` (full suite) | **13 files, 209/209 pass** (baseline was 170/170, +39) |
| `pnpm build` | `tsc --noEmit` clean, vite build clean, exit 0 |

Additional verification beyond the brief:
- **Mutation check of the added degradation tests**: removing the `try/catch` + optional chaining from `loadProgress`/`saveProgress` made exactly 3 of the new tests fail (`reads a corrupt save as a fresh one instead of throwing`, `degrades to memory when storage throws on every access`, `degrades to memory when there is no storage at all` — `SyntaxError: Expected property name or '}'…` and `Error: storage disabled`). `storage.ts` was then restored from a backup and the SHA-256 verified identical (`3192F805…6125`), so the tests are not vacuous.
- Runtime check: `node v24.21.0`, `typeof globalThis.localStorage === 'undefined'` with no DOM — the persistence tests really do run in the degraded environment.
- Dependency direction grep across `src/`: `core` imports nothing from `levels`/`app`/`ui`; `app` imports only `levels` + `core`; `persist` imports only `app`. No `package.json` change (zero runtime dependencies).

## TDD evidence

### RED

**(1) `test/app/progress.test.ts`, before `src/app/progress.ts` existed** — command `pnpm test test/app/progress.test.ts`:

```
Error: Cannot find module '../../src/app/progress' imported from D:/Documents/turing-complete/test/app/progress.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**(2) The brief's `paletteDefsFor` test could not pass against the brief's own implementation** — 12 passed, 1 failed:

```
FAIL test/app/progress.test.ts > unlockedComponents > paletteDefsFor filters the level list down to what is unlocked
AssertionError: expected [] to deeply equal [ 'level_input', 'level_output' ]
❯ test/app/progress.test.ts:98:60
```

Why that expectation failed: `paletteDefsFor` is `level.allowedComponents` filtered by the unlocked set, and the brief's fixture builds `other` as `{ ...level, allowedComponents: ['nand', 'not'] }`, overriding away the plumbing. There is no implementation of "parts offered by this level that the player has actually unlocked" that returns `['level_input','level_output']` for a level that does not offer them.

**(3) The same test's second expectation, after adding the plumbing to `other`**:

```
AssertionError: expected [ Array(3) ] to deeply equal [ 'nand', 'not', 'level_input', …(1) ]
-   "nand",
```

Why: `'nand'` is unlocked only by a passed level's reward, and the fixture's only passable level rewards `['not']`. Both expectations were unsatisfiable with the brief's fixture; the *assertions* were right and the *fixture* was wrong.

**(4) `test/persist/storage.test.ts`, before `src/persist/storage.ts` existed**:

```
Error: Cannot find module '../../src/persist/storage' imported from D:/Documents/turing-complete/test/persist/storage.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**(5) `test/app/commands.test.ts`, before `src/app/commands.ts` existed**:

```
Error: Cannot find module '../../src/app/commands' imported from D:/Documents/turing-complete/test/app/commands.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**(6) The brief's first CommandStack test could not pass against the ratified `push`** — 3 passed, 1 failed:

```
FAIL test/app/commands.test.ts > CommandStack > undoes and redoes an add
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
- 1
+ 2
❯ test/app/commands.test.ts:18:25
```

Why: the fixture calls `addInstance(g, 'nand', 10, 10)` (which already pushes into `g.instances`) and then pushes a command whose `do` pushes the same instance again. That only yields length 1 if `push` *records without applying*. The ratified contract is "every command's `do` runs when pushed", so the fixture was wrong, not the stack.

**(7) `test/app/store.test.ts`, before `src/app/store.ts` existed**:

```
Error: Cannot find module '../../src/app/store' imported from D:/Documents/turing-complete/test/app/store.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

### GREEN

```
✓ test/app/progress.test.ts (14 tests) 27ms
✓ test/app/commands.test.ts (6 tests) 25ms
✓ test/app/store.test.ts (7 tests) 17ms
✓ test/persist/storage.test.ts (12 tests) 33ms
✓ test/levels/ch1-part1.test.ts (34 tests) 52ms
✓ test/levels/ch1-part2.test.ts (29 tests) 54ms
… (all 13 files)
 Test Files  13 passed (13)
      Tests  209 passed (209)
```

```
$ tsc --noEmit && vite build
✓ 4 modules transformed.
dist/assets/index-Cunev-bE.js  0.76 kB │ gzip: 0.48 kB
✓ built in 61ms
exit=0
```

### The two brief conflicts, resolved

Both sides' *prose intent* and the assertions are the strong side; only the fixtures were internally inconsistent, so I repaired the fixtures and kept **every assertion verbatim** (no expectation was weakened, deleted or reordered):

1. `test/app/progress.test.ts`: `other.allowedComponents` now includes the plumbing it is expected to offer, and the passed level rewards `['nand','not']` so the expected `['nand','not','level_input','level_output']` is actually reachable. A comment above the fixture records why.
2. `test/app/commands.test.ts`: the fixture allocates the instance id via `addInstance`, removes it again, and lets the pushed command do the adding — which now also *tests* the "push applies" contract instead of contradicting it. A comment records why.

## Files changed

Created:
- `src/app/progress.ts` (147 lines)
- `src/app/commands.ts` (87)
- `src/app/store.ts` (63)
- `src/persist/storage.ts` (68)
- `test/app/progress.test.ts` (151)
- `test/app/commands.test.ts` (94)
- `test/app/store.test.ts` (96)
- `test/persist/storage.test.ts` (142)

Modified:
- `test/levels/ch1-part1.test.ts` (local `STARTER_COMPONENTS` → import; comments)
- `test/levels/ch1-part2.test.ts` (same)

`git status` after the commit: clean. The commit stages `src/app src/persist test/app test/persist` (per the brief) **plus `test/levels`**, because the two chapter tests are modified by this task and leaving them unstaged would make the committed tree untested.

## Self-review findings

1. **`store.ts` ownership conflict** (see above) — the one thing a Task 11 implementer must read before touching that file. I chose a tested, dependency-clean core rather than inventing a duplicate `Camera` type in `app` (the exact "two copies drift" failure mode this task is about).
2. **`loadProgress` signature delta**: the brief's interface line says `loadProgress(initialComponents: readonly string[])`; the brief's own Step 5 code, the plan's Task 11 `main.ts` (`let progress: Progress = loadProgress();`) and the ratified "the unlocked set is derived, never stored" decision all say no argument. I implemented `loadProgress(): Progress` and did not keep a dead parameter.
3. **`SCORE_WEIGHTS` is re-exported, not declared** in `progress.ts` (the brief listed it as produced there). Re-exporting keeps the brief's contract while leaving one copy of the formula; a fresh `const` would be the drift the task context forbids.
4. **`readonly` on `Progress`/`LevelRecord`**: no consumer mutates a record (`applyGrade` builds a new one), and it documents the purity contract. `record.passed`/`best`/`stars` are still plain data for JSON round-trips.
5. **`applyGrade` returns the same object reference for a failed attempt.** That is correct for a pure function, but a caller that treats "reference changed" as "progress changed" must call `saveProgress` unconditionally or compare contents.
6. **`migrate` does not validate individual `LevelRecord` shapes.** A hand-edited save with `levels: { 'ch1-01': 7 }` is accepted and then reads as "not passed" everywhere (`?.passed === true` is false), so it degrades gracefully rather than crashing — but it is silently discarded rather than repaired. Not covered by the brief; noted as a known limitation rather than invented behaviour.
7. **`saveProgress` failures are silent.** Correct for Phase 0 (the brief specifies the swallow, and there is no UI error channel yet), but a player can lose progress in private mode with no signal. Flagging it for the UI phase.
8. **The 5 added `loadProgress`/`saveProgress` tests were not TDD-RED** (the behaviour already existed from the brief's Step 5); they were verified by the mutation check described above instead. The brief imports `beforeEach` without using it, which is consistent with this harness having been intended and dropped.
9. **Line endings**: new files are LF in the worktree like every existing source file (`core.autocrlf=true`, no `.gitattributes`); git prints the usual LF→CRLF warnings, no content difference.

## Issues or concerns

- **Two brief fixtures were internally inconsistent** (progress `paletteDefsFor`, commands `add`); both are documented above with RED evidence, both were fixed on the fixture side, and no assertion was weakened. This is finding #8-style brief drift, not an implementation workaround: the implementations follow the brief's prose.
- **`src/app/store.ts` is claimed by two tasks.** I shipped only the dependency-clean generic core so the file exists and is tested; Task 11 must extend it with `AppState`/`DragState` and use `Store<AppState>` rather than replacing the generic store (or, if it prefers to own the file wholesale, it must re-cover the store behaviours now tested in `test/app/store.test.ts`).
- Nothing else blocks: full suite 209/209, `pnpm build` clean, zero new dependencies, dependency direction intact, commit `b62bd86` on `master`.
