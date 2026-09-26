# Task 2 report — 引脚宽度按实例解析

Plan: `docs/superpowers/plans/2026-09-25-turing-complete-phase1.md` (Task 2, 本阶段核心难度 3)
Brief: `.superpowers/sdd/2026-09-25-turing-complete-phase1/task-2-brief.md`
Commit: `6cdb37b` — `fix(core): resolve pin widths per instance, not per definition`
Status: **DONE** (three judgement calls a reviewer should see: §6.1, §6.2, §6.3)

Worktree `.worktrees/phase1`, branch `phase1`, base `c4fb3ab` (Task 1). Toolchain exactly as
instructed (nothing from PATH): node
`C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`,
pnpm `...\pnpm\bin\pnpm.mjs`.

## 1. What I implemented

### 1.1 `compile()` resolves every width per instance

New module-local helper, the single place a width is decided:

```ts
function effectiveWidth(inst: Instance, pin: PinDef): number {
  return inst.params.width ?? pin.width;
}
```

Every width-dependent site now uses it. That list is the whole point of the task, and it
includes the two Task 1 added (`net.ts:231-245` region loop, `net.ts:137-150` capacityFor):

| site | before | after |
| --- | --- | --- |
| slot allocation (`table.alloc`) | `pin.width` | `inWidths` / `outWidths` |
| `capacityFor` slot term | `pin.width` | `effectiveWidth(inst, pin)` |
| `capacityFor` region term | `pin.width` | `effectiveWidth(inst, pin)` |
| `drive` mapping width | `min(def.out.width, def.in.width)` | `min(from.outputWidths[..], to.inputWidths[..])` |
| region-materialising loop | `inst.def.inputs[p].width` | `inst.inputWidths[p]` |
| `#readInputs` gather width | `inst.def.inputs[p].width` | `inst.inputWidths[p]` |
| output write-back (`#holds` / `setPort` / `#staged`) | `pin.width` | `outWidths[i]` |
| `#publishState` | `setBit(base, …)` | `setPort(base, outputWidths[p], …)` |

`CompiledInstance` gained `inputWidths` / `outputWidths` (parallel to `inputs` / `outputs`), so
the settle loop reads a width off the *compiled* instance and cannot fall back to the def.

### 1.2 `params.width` 规则（the rule I chose, and why）

**`params.width` overrides every pin of that instance — every input and every output — whose
effective width it names. I.e. `width(inst, pin) = inst.params.width ?? pin.width`, for both
directions.** This is the brief's own wording (「有效引脚宽度…解析为 `inst.params.width ??
def.pin.width`」) applied to all pins, and the controller's ruling allows exactly this shape.
`src/core/defs/` declares one width per `PinDef` and there is no per-pin-name params syntax
(nothing needs one yet; inventing one now would add a second, unenforced source of width to the
document). Consequences worth naming:

- `level_input` (one 1-bit output pin) → `params.width = 8` gives an 8-bit output pin.
- `level_output` (1-bit `in` + 1-bit `mirror`) → both pins become 8 bits. The extra 8 slots for
  `mirror` are the only cost; `evaluate` copies a full `PortValue`, so the mirror is correct.
- A gate widened by `params.width` gets wide pins but its def's `evaluate` still speaks 0/1
  (e.g. `nand` would look at bit 0 only). That is the def's business, not the kernel's — the
  kernel only promises the pin is the width the instance asked for. Task 3 owns wide defs.

Tested directly: `test/core/net.test.ts` › `per-instance pin widths` ›
"resolves a pin width from the instance over the def" (output side) and "reads a params-wide
pin straight from an equally wide driver" (input + output side of a 1-bit def raised to 8).

### 1.3 `Netlist.inputWidth` / `Netlist.outputWidth`

`bindLevelIo` needs the width the pin was *actually compiled at*, and only `compile` knows it,
so the netlist now publishes both (`widthOf` mirrors `baseOf`, same `no such … pin: <key>`
error). `inputBase`'s doc now reads `read(inputBase(key), inputWidth(key))`. `Simulation.read`
/ `write` are unchanged, as required.

### 1.4 `bindLevelIo` binds at the compiled width and reports disagreement

- Inputs: `net.outputWidth('IN_<pin>.out')` decides the width; the write uses it.
- Outputs: `net.inputWidth('OUT[_<pin>].in')` decides the width; the read uses it.
- A pin that is **present but compiled at another width** is recorded
  (`LevelIo.mismatch`, e.g. `OUT.in is 1-bit in the circuit but the level declares 8`) and binds
  nothing. `createSim` maps a non-empty `mismatch` to `{ error: 'missing-io' }`, so the check
  fails loudly through the existing `CheckFailure.reason` union — no new field in
  `levels/spec.ts` (not in scope) and no throw escaping `runChecks`/`grade`.
- A pin whose instance is **absent** keeps Phase 0 behaviour exactly: reads 0, swallows writes,
  no mismatch (a half-built board still grades).
- `mismatch` is only present when there is something to report, because
  `exactOptionalPropertyTypes` rejects an explicit `undefined`.
- The candidate chain for a multi-output `level_output` (`OUT_<pin>.in` then `OUT.in`) is
  unchanged: a throw means "absent, try the next naming", a width disagreement means
  "present but wrong, report it and stop".

### 1.5 The width gets into the graph — both producers

The guard above is only satisfiable if the board the game builds itself carries the width:

1. `src/ui/board/interact.ts`: `levelIoInstanceId(level, graph, defId): string | undefined`
   became `levelIoPlacement(level, graph, defId): { id, width } | undefined` (the pin's width
   comes from the pin the id refers to — never guessed back from the id string). `place()`
   writes `inst.params.width = placement.width` inside the command's `do`, so undo/redo replay
   the width too. This is a rename of the only exported symbol in the project that had no
   in-scope consumer left: its sole caller was `place()` and its sole test consumer was
   `test/ui/panels.test.ts` (updated, and extended with width assertions). No docs reference it
   (grepped `docs/` and `.superpowers/`).
2. `test/fixtures/build.ts`: level-IO nodes take an optional `width`
   (`{ kind: 'input', name: 'a', width: 8 }` / `{ kind: 'output', from: 'a', width: 8 }`) which
   is written to `params.width` — the same thing a palette drop does. Omitted means the def's
   1 bit, so every Phase-0 fixture is byte-identical. **`bindLevelIo` was not weakened to avoid
   this**; the fixture was fixed, as ruled.

### 1.6 Malformed `params.width` is a graph issue, not a `RangeError`

`params.width` now feeds slot allocation, so a value `alloc` cannot take would otherwise raise a
bare `RangeError` out of `runChecks` → `grade()` on every board edit — the hazard class
`graph.ts` already documents for unknown defs ("reported as an issue rather than allowed to
reach `registry.get`, which throws"). New `IssueCode` `'invalid-params'` (error severity) is
reported by `validateGraph` for a `params.width` that is not a positive safe integer; `compile`
turns it into the usual `CircuitValidationError`, which `createSim` already maps to a
`missing-io`-style `'invalid'` failure. Only `params.width` is judged — no other key in
`params` is read by the kernel yet, and I did not invent policy for them.

### 1.7 Comment precision fix (controller-authored, from Task 1's review)

`src/core/net.ts` `drive` doc: now "…so such a bit reads 0 **unless a caller writes that slot,
which is how an unwired input is driven directly**. A materialised read region is not addressed
through `drive`." (`net.ts:35-38`.) Comment-only, in this commit.

## 2. What I tested and the results

Full suite: **266 passed / 15 files** (Task 1 left 245; this task adds 21). Focused runs below.
Also `tsc --noEmit` exit 0, `pnpm build` (tsc + vite build) clean, and `pnpm smoke`
(Playwright, real browser) 2 passed — the UI path I touched is covered end to end.

New coverage (brief's list → where):

- **8-bit level input through an 8-bit component, end to end via `bindLevelIo`** —
  `checks.test.ts` › `level I/O width binding`: `IN_a --pass8--> OUT` with only the two level
  pins widened; all 256 rows generated from the level's own pin widths pass, plus a direct
  `bindLevelIo` round trip of `0x00/0x01/0x55/0x80/0xab/0xff`.
- **回归 params.width 缺省 = Phase 0** — `net.test.ts` › "leaves every width at the def default
  when the instance sets no params" (widths + exact slot count 3), plus the untouched
  `slotCount` assertions of 24 and 34, plus the whole pre-existing suite.
- **宽度不一致时报错** — `checks.test.ts`: input side, output side, each asserting
  `failures[0].reason === 'missing-io'` with no throw; a direct `bindLevelIo` test asserting the
  message names `OUT.in` and both widths.
- **`place()` 写出正确的 `params.width`** — `panels.test.ts`: jsdom `PointerEvent` drop of
  `level_input` + `level_output` through `attachBoardInput` on an 8-bit level, asserting
  `[['IN_a', 8], ['OUT', 8]]`; plus `levelIoPlacement` width assertions for both directions.
- **Task 1's two invariants re-asserted at width 8 from `params`** — `net.test.ts` ›
  `paramsWideFixture` (a 1-bit `pass1` raised to 8 by `params.width`, driven by a 1-bit driver
  with a live 8-bit neighbour in the next slot): per-bit gather gives bit 0 and zeros above;
  `inputBase` is a materialised 8-bit region (≠ the driver's base, slot count 34) refreshed by
  every settle and coherent with what the pin's own consumer reads.
- **`capacityFor` reservation (the reviewer's named risk)** — `net.test.ts` › "reserves table
  capacity for params-derived widths and their read regions": 24 one-bit sources driving 24
  eight-bit params-widened instances need 600 slots (408 pin + 192 region) while a capacity
  computed from def widths gives 106 and one computed without the region term gives 526; both
  would make `alloc` throw "signal table is full". Slot count asserted exactly (25 × 24).
- **Malformed width** — `net.test.ts` › `it.each([0, -1, 1.5, NaN])` asserting
  `CircuitValidationError` with `issues = ['invalid-params']`.
- **Grading, not just checking, at 8 bits** — `checks.test.ts` › "grades as a passable,
  three-star level at 8 bits".

## 3. TDD evidence

Three RED/GREEN cycles, one per affected layer. Raw logs kept next to this report:
`task-2-red-1-net.txt`, `task-2-red-2-checks.txt`, `task-2-red-3-panels.txt`,
`task-2-green-full.txt`.

### Cycle 1 — kernel widths (RED, then GREEN)

RED: `… pnpm.mjs test test/core/net.test.ts` → `Tests 11 failed | 25 passed (36)`
(± `node "…\node\bin\node.exe" "…\pnpm\bin\pnpm.mjs"`).

```
FAIL  compile > rejects a malformed params.width (0) as a validation issue
AssertionError: expected undefined to be an instance of CircuitValidationError
FAIL  per-instance pin widths > resolves a pin width from the instance over the def
TypeError: net.outputWidth is not a function
FAIL  per-instance pin widths > reports an unknown pin by name and direction
AssertionError: expected [Function] to throw error matching /no such input pin: feed\.out/ but got 'net.inputWidth is not a function'
FAIL  per-instance pin widths > reads a params-wide pin straight from an equally wide driver
AssertionError: expected 3 to be 24 // Object.is equality
FAIL  per-instance pin widths > reserves table capacity for params-derived widths and their read regions
AssertionError: expected 72 to be 600 // Object.is equality
```

Why expected: the width-resolution API did not exist yet (`TypeError`), a params-widened
`pass1` was still allocated at its def width (3 slots instead of 24; 72 instead of 600), and a
malformed width was silently accepted instead of raising a catchable validation error.

GREEN: `… test/core/net.test.ts` → `36 passed (36)`.

### Cycle 2 — level I/O binding (RED, then GREEN)

RED: `… test test/levels/checks.test.ts` → `Tests 4 failed | 23 passed (27)`.

```
FAIL  level I/O width binding > refuses a bound level input whose compiled width disagrees with the spec
AssertionError: expected 'mismatch' to be 'missing-io'   (Received: "mismatch")
FAIL  level I/O width binding > refuses a bound level output whose compiled width disagrees with the spec
AssertionError: expected true to be false                (the level PASSED with a 1-bit bound output!)
FAIL  level I/O width binding > names the pin and both widths in the mismatch it reports
AssertionError: the given combination of arguments (undefined and string) is invalid …
FAIL  level I/O width binding > binds an 8-bit level built by the build() fixture
AssertionError: expected [ [ 'IN_a', undefined ], …(1) ] to deeply equal [ [ 'IN_a', 8 ], [ 'OUT', 8 ] ]
```

Why expected, and the most interesting result of this task: with `bindLevelIo` still taking the
width from `spec.io`, a *1-bit* bound level output **passed all 256 rows** — it read 8 bits from
the spec width starting at the driver's base, which happened to alias a wide driver exactly. The
input side did the opposite and corrupted the table (rows failed with `mismatch`, the write
running past a 1-bit pin). That is the accidental-correctness / silent-corruption pair the guard
replaces with one loud `missing-io`.

GREEN: `… test/levels/checks.test.ts` → `27 passed (27)`.

### Cycle 3 — palette drop writes the width (RED, then GREEN)

RED: `… test test/ui/panels.test.ts` → `Tests 7 failed | 15 passed (22)`.

```
FAIL  level io placement > names the single level output OUT
TypeError: levelIoPlacement is not a function      (× 5 call sites)
FAIL  level io placement > writes that width into params when the part is dropped on the board
AssertionError: expected [ [ 'IN_a', undefined ], …(1) ] to deeply equal [ [ 'IN_a', 8 ], [ 'OUT', 8 ] ]
```

Why expected: the placement helper did not exist, and the jsdom drop already placed both parts
correctly (`IN_a`, `OUT` at the conventional ids) but with no `params` — exactly the state that
would make the game's own 8-bit board trip the new mismatch guard.

GREEN: `… test/ui/panels.test.ts` → `22 passed (22)`.

### Final verification (at the committed tree)

```
$ … pnpm.mjs test
 Test Files  15 passed (15)
      Tests  266 passed (266)

$ … pnpm.mjs exec tsc --noEmit
tsc exit: 0

$ … pnpm.mjs build        # tsc --noEmit && vite build
✓ built in 56ms

$ … pnpm.mjs smoke        # playwright, real browser
 ok 1 test\smoke\ui.spec.ts:41:1 › level 1 is playable end to end and shows its epilogue
 ok 2 test\smoke\ui.spec.ts:64:1 › progress survives a reload and unlocks the next level
 2 passed (4.9s)
```

Task 1's `slotCount` assertions at `test/core/net.test.ts:497,502` (24 and 34) are **unchanged
and still asserted** — this change does not re-size those regions, because those fixtures set no
`params`. The same two numbers are re-asserted at params-derived widths at lines 614 and 646.

## 4. Files changed

```
src/core/graph.ts          |  32 +-   IssueCode 'invalid-params' + the validation loop + docs
src/core/net.ts            | 109 +-  effectiveWidth, width routing, inputWidth/outputWidth, comment fix
src/levels/checks.ts       |  63 +-  compiled-width binding, LevelIo.mismatch, missing-io mapping
src/ui/board/interact.ts   |  55 +-  levelIoPlacement {id,width}, place() writes params.width
test/core/net.test.ts      | 198 +-  +11 tests (per-instance widths, invariant re-assertions, capacity)
test/fixtures/build.ts     |  33 +-  width on level-IO nodes -> params.width
test/levels/checks.test.ts | 149 +-  +7 tests (8-bit round trip, mismatch, fixture, grading)
test/ui/panels.test.ts     |  81 +-  levelIoPlacement rename + width assertions + jsdom drop test
```

Not touched: `src/core/defs/` (Task 3), `src/levels/content/` (Tasks 8–11),
`src/levels/spec.ts` (no new failure reason was needed — `missing-io` already existed and was
dead until now), `src/core/signal.ts`, `src/app/`.

## 5. Self-review findings

- **Trailing detail I fixed during review**: a stray double blank line after `effectiveWidth`;
  an overstated "`alloc` can never fire" claim reworded to what is actually guaranteed (a
  positive integer); the `validateGraph` doc's issue *order* was wrong (defs are reported
  before params, not interleaved); one over-long line in `panels.test.ts` split.
- **Checked every width use in `src/`** (`grep '\.width'`) after the change: the only remaining
  def-width reads are def declarations, `signal.ts`/`fields.ts` helpers that take a width
  argument, and `bindLevelIo`'s comparison against the compiled width. No site still sizes a
  slot, a region or a read from `def.pin.width`.
- **`#publishState` was the one site the brief did not list** and it did use a def-independent
  assumption (`setBit` per state byte). It now writes the pin's full resolved width. No existing
  behaviour changes (all shipped stateful defs are 1 bit); a def with state but more output pins
  than state bytes writes 0 across the extra pin exactly as it wrote bit 0 before.
- **Undo/redo**: `place()`'s command sets `params.width` inside `do`, so a redo re-creates the
  instance with its width; `undo` removes the instance wholesale.
- **`levelIoPlacement` return-shape change is behaviour-preserving** for every Phase-0 case:
  single-output → `OUT`; multi-output → `OUT_<pin>` in pin order; nothing free → `undefined`;
  non-level defs → `undefined`. The five pre-existing placement tests were updated only to read
  `.id`.
- **Ruling site 3 is vacuous today, verified rather than assumed**: every `spec.io` pin in
  `src/levels/content/` is 1 bit (grepped), so no existing hand-written `IN_*`/`OUT*` instance in
  any test is wider than its spec pin and none needed `params.width`. The 8-bit tests I added
  set it explicitly.
- **`git status` after the commit**: only `.superpowers/…/progress.md` remains modified — that
  file was already dirty before I started and is the controller's ledger, so I left it alone.

## 6. Issues / concerns

### 6.1 `validateGraph` gained an `IssueCode` (`invalid-params`) — deliberate, please sanity-check

`src/core/graph.ts` is in scope "only if the params typing needs it", and this is slightly more
than typing. I judged it in scope because `params.width` is now the first *data* to reach
`table.alloc`, and the file's own contract is that a defect which would make a kernel call throw
is reported as an issue instead. Without it, `{ params: { width: 0 } }` throws a bare
`RangeError` from `table.alloc` straight through `runChecks`/`grade` on every board edit. If the
reviewer prefers, the check can move into `compile` (it would then have to build its own
`CircuitValidationError`) — but then `validateGraph` and `compile` would disagree about what a
valid document is.

### 6.2 A pathologically large `params.width` is still a resource error, not a graph issue

`Number.isSafeInteger(width) && width > 0` admits e.g. `1e9`, and `capacityFor` would then ask
for a ~1.25 GB `Uint8Array`, whose `RangeError` escapes `runChecks`. I deliberately did not
invent an upper bound (any number would be policy, and Phase 1's widest pin is 8 bits), and the
same exposure already exists for a def that declares an absurd width — i.e. this change does not
widen it. Flagging it rather than silently capping: if the controller wants a cap (e.g. reject
`width > 4096` as `invalid-params`), it is a three-line follow-up.

### 6.3 One override per instance means a wide `level_output` also widens `mirror`

That is the rule I documented in §1.2 and it is correct for everything that exists, but it costs
8 unused slots per 8-bit `level_output` and it is the one place where "override every pin" is
visible in the slot count. If Task 3 introduces a def that genuinely needs per-pin widths (a
1-bit `carry` beside an 8-bit `sum`), the rule has to grow a per-pin form; nothing in the
brief or the plan asks for it yet, and I did not pre-build it.

### 6.4 `mismatch` is reported, but the UI does not show it

A width disagreement surfaces as a `missing-io` failure with empty `inputs`/`expected`/`actual`,
so the truth-table panel shows a failing row with no explanation. The diagnosis lives in
`LevelIo.mismatch` and is not rendered anywhere. Making it visible (or making the failure carry
the message) belongs to whichever task owns the failure panel; the union in `levels/spec.ts` was
out of scope here.

### 6.5 Ledger suggestions (controller's file, not edited by me)

- The `params.width` rule is now load-bearing for every task that places or widens a part:
  "per instance, all pins, no per-pin syntax" is worth a ledger line, together with
  `levelIoInstanceId` → `levelIoPlacement` as an interface rename.
- Tasks 8–11 should declare chapter-2 level IO widths on fixture nodes
  (`{ kind: 'input', name: 'a', width: 8 }`) so the fixture and the level spec agree; a
  disagreement now fails the level with `missing-io` instead of corrupting the table.
