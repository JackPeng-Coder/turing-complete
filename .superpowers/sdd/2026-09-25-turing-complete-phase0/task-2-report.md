# Task 2 report — 信号表与端口 (`src/core/signal.ts`)

Brief: `.superpowers/sdd/2026-09-25-turing-complete-phase0/task-2-brief.md`
Commit: `fd82f2b` — `feat(core): add bit-level signal table and ports`
Status: **DONE_WITH_CONCERNS** — all brief acceptance criteria met (12 then 15 tests green,
`pnpm build` green, zero dependency changes); two brief-internal conflicts and three
unfixed edge-case behaviors are documented in §5/§6 for the Lead and the reviewer.

Toolchain used verbatim as instructed (nothing on PATH):

- node: `C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
- pnpm: `C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs`
- Invoked as `& "<node>" "<pnpm>" test …`. No package was added or removed; `package.json` is
  untouched (`dependencies` is absent — zero runtime deps).

## 1. What I implemented

| File | Content |
|---|---|
| `src/core/signal.ts` (156 lines) | Brief Step 3 **verbatim**, except one forced one-line change in `formatPort`'s binary branch (Conflict 1, §5). |
| `test/core/signal.test.ts` (131 lines) | Brief Step 1 verbatim (12 tests) + Step 5's two capacity tests + one added invariant test (Conflict 2, §5). |

Export surface is exactly the brief's 9 names, nothing more:

```
Bit, PortValue, SignalTable, assertWidth, createSignalTable, Port, createPort, valuesEqual, formatPort
```

Design decisions honoured as given, not re-litigated:

- `createSignalTable(capacity = 65_536)` allocates one `Uint8Array` up front and **never
  reallocates**. There is no grow path and no `growTo` (the brief's closing note at line 291
  refers to a `growTo` that its own Step 3 code does not contain — stale draft text; adding one
  would invalidate every issued `base`, so I did not).
- `alloc(width)` throws `RangeError('signal table is full: need N slots, capacity is C')` when the
  table is full — the message contains `capacity`, matching Step 5's `/capacity/i`.
- `slots` is exposed as the stable array instance and `size` as a getter over a closure variable;
  internal methods read through `table.slots` (never a cached copy).
- Signals occupy consecutive single-bit slots, low bit first. `PortValue` stays `number` at the
  boundary for `width <= 8` and `Uint8Array` for `width > 8`; `Port.read/write` go through the
  table so the returned object is a live view.
- All comments are English, source is UTF-8/LF (verified with `git ls-files --eol`: `i/lf w/lf`,
  same as the existing `src/main.ts`). Nothing was copied from the original game.

## 2. What I tested and the results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Focused RED (Step 2) | `pnpm test test/core/signal.test.ts` | FAIL, exit 1 — `Cannot find module '../../src/core/signal'` |
| 2 | Verbatim Step 3 implementation | `pnpm test test/core/signal.test.ts` | FAIL, exit 1 — `11 passed, 1 failed`: `expected '101' to be '1'` |
| 3 | Focused GREEN (Step 4) | `pnpm test test/core/signal.test.ts` | PASS, exit 0 — `Tests 12 passed (12)` |
| 4 | Step 5 regressions | `pnpm test test/core/signal.test.ts` | PASS, exit 0 — `Tests 15 passed (15)` |
| 5 | Full suite (post-commit) | `pnpm test` | PASS, exit 0 — `Test Files 2 passed (2)`, `Tests 16 passed (16)` (1 sanity + 15) |
| 6 | Typecheck + build | `pnpm build` (`tsc --noEmit && vite build`) | PASS, exit 0 — `✓ built in 29ms`, `dist/assets/index-Cunev-bE.js 0.76 kB` |
| 7 | Edge-case probes | transient `test/core/__probe.test.ts`, 10 tests | PASS (asserts *observed* behavior); file deleted before commit — see §5 |
| 8 | Git hygiene | `git status --short`, `git diff HEAD~1 HEAD --name-only` | clean tree; commit touches only the two intended files |

Typechecking matters here because `pnpm build` runs `tsc --noEmit` under `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`: the brief's
`table.slots[base + i]!` and `bytes[i >> 3]! |= …` constructs compile clean, so no non-null
assertions had to be reshaped.

## 3. TDD Evidence

### RED (Step 2) — command, output, why it is the expected failure

Command: `pnpm test test/core/signal.test.ts` (test file written first, `src/core/signal.ts`
deliberately absent)
Exit code: **1**

```
 ❯ test/core/signal.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  test/core/signal.test.ts [ test/core/signal.test.ts ]
Error: Cannot find module '../../src/core/signal' imported from D:/Documents/turing-complete/test/core/signal.test.ts
 ❯ test/core/signal.test.ts:2:1
      1| import { describe, expect, it } from 'vitest';
      2| import {
       | ^

 Test Files  1 failed (1)
      Tests  no tests
```

Why expected: the failure is the missing module and nothing else — it happens at the import,
before any assertion runs (`0 test`, `no tests`). The wording differs from the brief's prediction
(`Failed to resolve import "…"`); Vitest 5 / Vite 8 report `Cannot find module … imported from …`,
the same newer-resolver message Task 1 already recorded. File/line/column match the brief's intent.

### RED 2 — the brief's own Step 3 code fails the brief's own Step 1 test

This is the finding of the task. I pasted Step 3 **character-for-character** into
`src/core/signal.ts`, ran the Step 1 test file unchanged, and got:

```
 ✓ test/core/signal.test.ts (12 tests | 1 failed) 10ms
   ✓ SignalTable (7)   ✓ Port (2)   ❯ formatPort (2)   ✓ valuesEqual (1)

 FAIL  test/core/signal.test.ts > formatPort > pads binary to the port width
AssertionError: expected '101' to be '1' // Object.is equality

Expected: "1"
Received: "101"

 ❯ test/core/signal.test.ts:88:37
     88|     expect(formatPort(0b101, 1, 2)).toBe('1');
```

Why this failure was real and not a test bug: `formatPort` pads with
`n.toString(2).padStart(width, '0')`, and `padStart` never truncates. The test asserts that a
1-bit port displaying `0b101` renders `'1'`, i.e. the function must reduce the value to the port's
low `width` bits *before* padding. `formatPort(0b101, 8, 2) => '00000101'` passes either way, so
only the 1-bit case discriminates. Since Step 4 demands `PASS — 12 passed` and the test file is
the specification, I changed the **implementation**, not the test (one line; see §5 Conflict 1):

```ts
if (radix === 2) return (n % 2 ** width).toString(2).padStart(width, '0');
```

`% 2 ** width` rather than `& ((1 << width) - 1)` so wide (byte-array) values beyond the 32-bit
boundary are still reduced correctly. `radix` 10/16 are untouched.

### GREEN (Step 4)

Command: `pnpm test test/core/signal.test.ts`, after the one-line `formatPort` change and nothing else
Exit code: **0**

```
 ✓ test/core/signal.test.ts (12 tests) 6ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### GREEN (Step 5)

Command: `pnpm test test/core/signal.test.ts`, after appending the two capacity tests (+1, §5)
Exit code: **0**

```
 ✓ test/core/signal.test.ts (15 tests) 6ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Both Step 5 tests are in the `SignalTable` describe block as the brief's indentation implies:
`keeps earlier values while allocating more slots` (capacity 16) and
`refuses to over-allocate instead of silently corrupting indices` (capacity 4 → `alloc(1)` throws
`/capacity/i`; `size` stays 4).

## 4. Files changed

Commit `fd82f2b`, 2 files, 287 insertions, no deletions, no other file touched:

```
src/core/signal.ts       | 156 +++++++++++++++++++++++++++++++++++++++++++++++
test/core/signal.test.ts | 131 +++++++++++++++++++++++++++++++++++++++++++++++
```

Both are new files in new `src/core/` and `test/core/` directories. `package.json`,
`pnpm-lock.yaml`, `tsconfig.json` and `vite.config.ts` are unchanged. This report
(`.superpowers/sdd/.../task-2-report.md`) is not committed: `.superpowers/sdd/.gitignore` ignores
that directory by design, matching Task 1.

## 5. Self-review findings

I read my own diff line by line and re-ran every acceptance command after committing.

### Conflict 1 (forced) — the brief's `formatPort` contradicts the brief's test

Documented in §3 RED 2. One line changed; consequence: for binary output the render is exactly
`width` characters even when the caller passes an over-wide value. `radix` 10 and 16 keep the
brief's exact code. **This is the only deviation from the brief's Step 3 listing.**

### Conflict 2 (count) — the brief's "15 passed" cannot be reached by its own test list

Step 1 contains 12 `it` blocks (verified by count and by the independent Step 4 run: `12 passed`).
Step 5 appends 2, which is 14 — but Step 5 predicts `PASS — 15 passed`. Rather than pad or ignore
the discrepancy I added one test that pins the load-bearing decision the brief's prose makes and
its Step 5 tests do *not* cover — that the backing array is never swapped:

```ts
it('never swaps its backing slots, so earlier bases stay valid', () => {
  const t = createSignalTable(8);
  const slots = t.slots;              // grab the reference before allocating
  expect(slots.length).toBe(8);
  const base = t.alloc(8);
  expect(t.slots).toBe(slots);        // identity: no reallocation happened
  t.setPort(base, 8, 0b1111_0000);
  expect(slots[base]).toBe(0);        // the captured reference is live
  expect(slots[base + 4]).toBe(1);
});
```

This directly guards `net.ts`'s `drive: Int32Array` indexed by `base` (Task 5): any future
"grow on demand" regression now fails a test instead of silently corrupting that lookup. Result:
15 passed, matching Step 5's stated number.

### Stale brief text

The brief's note under Step 3 says "注意实现中的 `growTo`" ("mind the `growTo` in the
implementation"). Step 3 contains no such function, and the task's design constraints explicitly
forbid a grow path. I treated the note as leftover from the superseded growing draft and
implemented the fixed-capacity version only. Nothing named `growTo` exists in the tree: grepping
`growTo|grow` over `src/core/` returns exactly one hit, the doc comment
"Deliberately NOT growable: reallocating the backing `Uint8Array` would …", i.e. no grow code path
at all.

### Edge-case probes (transient, deleted)

A scratch `test/core/__probe.test.ts` asserted the *observed* behavior of cases the brief does not
specify; all 10 assertions passed, so the notes below are measured, not guessed. The file was
deleted before the commit (`git status` clean afterwards). Findings are raised in §6 rather than
"fixed", because no brief test demands different behavior and the brief says verbatim.

| Probe | Observed behavior |
|---|---|
| width 12, `setPort(base,12,new Uint8Array([0x34,0x12]))` | `getPort(base,12)` returns `Uint8Array([0x34])` — bits 8–11 silently dropped |
| width 20 with 3 bytes | `getPort` returns 2 bytes — bits 16–19 dropped |
| `alloc(1.5)` | accepted; returns `0`, `size` becomes `1.5` |
| `setBit(base+99, 1)` on a 4-slot table | silently ignored; `getBit` returns `0` |
| `assertWidth(-1, 32)` / `assertWidth(-1, 31)` | no throw / throws |
| `formatPort(new Uint8Array([0x34,0x12]), 16, 16 \| 10 \| 2)` | `'1234'` / `'4660'` / `'0000000000000101'` (little-endian, as designed) |
| full table `createSignalTable(2).alloc(3)` | throws `/capacity/i`, `size` unchanged at 0 |
| `valuesEqual(3, new Uint8Array([3,0,0,0]))` | `true`; a 2-byte array vs `0` is `false` (length mismatch) |
| `alloc(0)` / `alloc(-2)` | both throw `/positive/` |
| `valuesEqual(0x1234, new Uint8Array([0x34,0x12]))` | `false` — same value, different representation |

### Other checks

- `clear()` fills `[0, size)` only, not the whole capacity. Correct as written: every base handed
  out by `alloc` is `< size`, and slots past `size` are unreachable through the API. It is cheaper
  and it keeps `size` semantics intact.
- `fitsWidth` is module-private; `assertWidth` is exported and reused by `setPort`, so `createPort`
  and direct callers share one validation path.
- Tests use no DOM, no fake timers, no network; the file runs on the global `node` environment
  with no per-file `@vitest-environment` docblock, as the brief requires.
- Full suite after commit: 16/16 green; `pnpm build` green. No probe or scratch file remains.

## 6. Issues or concerns for the Lead

1. **`formatPort` binary branch deviates from the brief by one line** (Conflict 1). It is forced —
   the brief's Step 3 text cannot pass the brief's Step 1 test. If Task 11 (truth table / panels)
   or any level checker expects an over-wide binary value to render in full, that decision needs
   revisiting; otherwise the current behavior (exactly `width` characters) is the one the test
   suite locks in.
2. **Wide ports whose width is not a multiple of 8 silently lose the partial high byte on read.**
   `getPort` sizes its buffer with `new Uint8Array(width / 8)` (V8 truncates `1.5` → 1), while
   `assertWidth` requires `Math.ceil(width / 8)` bytes. So `setPort(base, 12, Uint8Array([0x34,0x12]))`
   is accepted and `getPort(base, 12)` returns one byte. I did **not** change this (no test covers
   it, brief says verbatim), but Task 5 (`net.ts`) and Task 6 (level checker) must decide before
   building on it: either require `width % 8 === 0` for `width > 8`, or use
   `Math.ceil(width / 8)` in `getPort`. One-line fix either way.
3. **`valuesEqual` cannot match the two representations of one wide value**: `numberToBytes`
   always emits 4 bytes, so `valuesEqual(0x1234, new Uint8Array([0x34,0x12])) === false`. If a
   level's expected output is written as a number while the simulation returns `Uint8Array` for a
   16-bit port, the level will fail spuriously. The checker should normalize both sides (e.g. via
   `table.getPort`) or `valuesEqual` needs a width parameter. Flagging now because it is a
   data-shape trap, not a visible bug.
4. **No bounds checking on `setBit`/`getBit`**: an out-of-range write is silently dropped and the
   read returns `0`. Deliberate for speed in a simulator hot path; recorded so the reviewer does
   not mistake it for an oversight.
5. **`alloc` accepts non-integer widths** (`alloc(1.5)` → base `0`, `size` `1.5`), and
   `assertWidth` accepts negatives for `width >= 32` while rejecting them below. Both are
   unreachable from the brief's tests and harmless for the planned call sites; noting them so the
   Lead can decide whether Task 2 should be tightened or left verbatim.

## Fix round 1

Fixing the review findings on `fd82f2b`: one Important (`getPort` floors where `assertWidth`
ceils) and one hardening item (identity test does not actually catch reallocation). Base commit:
`fd82f2b`. Branch: `master`. Toolchain, commands and invocation form are unchanged from §1.

### What changed

| File | Change |
|---|---|
| `src/core/signal.ts` | one line: `new Uint8Array(width / 8)` → `new Uint8Array(Math.ceil(width / 8))` in `getPort`, plus a 5-line comment explaining why the two must agree with `assertWidth`. |
| `test/core/signal.test.ts` | +1 test (`reads back every bit of a wide port whose width is not a multiple of 8`) and the existing `never swaps its backing slots, so earlier bases stay valid` reshaped to fill to capacity, attempt one more `alloc(1)` inside `try`/`catch`, then re-assert identity **and** value survival. |

Net diff (`git diff --cached --stat`): 2 files, +36/−2. Nothing else in the tree moved (see
§Constraints below).

#### Finding 1 — `getPort` sized its buffer with a floored division

`assertWidth` requires `Math.max(1, Math.ceil(width / 8))` bytes for the byte-array path, so
`setPort(base, 12, new Uint8Array([0x34, 0x12]))` is legal input, while
`new Uint8Array(12 / 8)` allocated **one** byte and bits 8–11 were discarded on read-back. The
reader now allocates `Math.ceil(width / 8)`.

Behaviour after the fix, for every width class:

| width | input accepted by `assertWidth` | read-back length before | after |
|---|---|---|---|
| ≤ 8 | number branch | number | number (unchanged) |
| 16 (all prior tests) | 2 bytes | 2 | 2 (unchanged) |
| 9–15, 17–23, … | `ceil(width/8)` bytes | `floor(width/8)` — **corrupting** | `ceil(width/8)` |

For non-multiples of 8 the round trip is length-preserving and every one of the `width` bits is
preserved; bits at or above `width` inside the top byte are not stored by `setPort` (it writes
`width` slots, by design), so `0x12` in a 12-bit port reads back as `0x02`. That masking is now
asserted explicitly rather than left implicit — it is the only lossy part left, and it is inherent
to a `width`-bit port, not to the buffer size. `Simulation.settle` does not exist in this tree yet
(`grep -n 'settle' src/` → no match), so the misdiagnosis the reviewer described
(1-byte read-back vs 2-byte output keeping `changed` permanently true → `UnstableCircuitError`)
remains a future-facing contract concern; the contract now admits only input its own reader can
return intact.

#### Finding 2 — the identity test could not see a reallocation

The old test did `createSignalTable(8)` then `alloc(8)`: exactly at capacity, so a table that only
grows *when full and asked for more* never entered its grow path, and the assertion passed. The
test now fills the table, calls one more `alloc(1)` inside a `try`/`catch` that swallows the
expected refusal, and then asserts (a) `t.slots` is still the same object, (b) `getPort(base, 8)`
still returns `0b1111_0000`, and (c) the raw captured slots still hold their values. It asserts the
thing that matters: **a failed allocation must not invalidate an already-issued `base`**.

### Evidence

#### RED (Finding 1, before the source fix)

Command (exact):
`& "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\ME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" test test/core/signal.test.ts`

Exit code: **1**

```
 ❯ test/core/signal.test.ts (16 tests | 1 failed) 14ms
   ❯ SignalTable (11)
     ✓ allocates sequential slot ranges 1ms
     ✓ defaults every slot to 0 0ms
     ✓ writes and reads single bits 0ms
     ✓ stores an 8-bit port as 8 separate slots, low bit first 0ms
     ✓ accepts a Uint8Array for wide ports 1ms
     × reads back every bit of a wide port whose width is not a multiple of 8 5ms
     ✓ rejects a value that does not fit the port width 1ms
     ✓ clear() zeroes every allocated slot and keeps size 0ms
     ✓ keeps earlier values while allocating more slots 0ms
     ✓ refuses to over-allocate instead of silently corrupting indices 0ms
     ✓ never swaps its backing slots, so earlier bases stay valid 0ms
   ✓ Port (2)   ✓ formatPort (2)   ✓ valuesEqual (1)

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)

 FAIL  test/core/signal.test.ts > SignalTable > reads back every bit of a wide port whose width is not a multiple of 8
AssertionError: expected Uint8Array[ 52 ] to deeply equal Uint8Array[ 52, 2 ]

- Expected
+ Received

  Uint8Array [
    52,
-   2,
  ]
 ❯ test/core/signal.test.ts:59:33
```

This is precisely the reported defect: a 2-byte write is read back as a 1-byte array (52 = `0x34`);
the assertion of `t.getBit(base + 9) === 1` never ran because line 59 failed first.

#### Mutant probe for Finding 2 (transient, deleted before commit)

To prove the reshaped assertion really catches the corruption it is meant to catch, I ran a
grow-on-demand mutant table (grows only when full and asked for more — the reviewer's exact
scenario) against both the old and the new assertion shapes, in a scratch `test/core/__probe.test.ts`
that was deleted before staging (`git status --short` afterwards showed only the two intended
files).

Command (exact): `… pnpm.mjs test test/core/__probe.test.ts` → exit code **1**

```
 ❯ test/core/__probe.test.ts (3 tests | 2 failed) 9ms
   ❯ probe: grow-on-demand mutant vs the sharpened identity test (3)
     ✓ control: the OLD test shape passes against the growing table (blind spot) 1ms
     × net 1: the refused over-allocation is not refused by a growing table 3ms
     × net 2: the identity assertion detects the relocated backing array 3ms

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

- **Control (passes):** the old shape (`createSignalTable(8)` → `alloc(8)` → `expect(t.slots).toBe(slots)`)
  is blind to the mutant — the reviewer's point, reproduced.
- **Net 1 (fails):** `AssertionError: expected undefined to be an instance of RangeError` — a
  silently growing table does not refuse the over-allocation.
- **Net 2 (fails):** `AssertionError: expected Uint8Array[ 0, 0, 0, 0, 1, 0, 0, …(10) ] to be Uint8Array[ 0, 0, 0, 0, 1, 0, 0, 0 ]`
  — the backing array was relocated, the captured reference is stale, i.e. every earlier `base` is
  now dangling. The reshaped test fails on both nets; the shipped fixed-capacity table passes both.

#### GREEN — focused file

Command (exact, identical to the RED command): `… pnpm.mjs test test/core/signal.test.ts` → exit code **0**

```
 ✓ test/core/signal.test.ts (16 tests) 6ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

`test/core/signal.test.ts` is the covering test file: the new
`reads back every bit of a wide port whose width is not a multiple of 8` is the regression test for
Finding 1 and fails on `fd82f2b` without the source change; the reshaped
`never swaps its backing slots, so earlier bases stay valid` is the covering test for Finding 2 and
is validated by the mutant probe above. All 15 pre-existing tests still pass unchanged — including
`accepts a Uint8Array for wide ports` (width 16) and `refuses to over-allocate …`, so width 16 and
the `RangeError` path did not move.

#### GREEN — full suite and typecheck

Command: `… pnpm.mjs test` → exit code **0**

```
 ✓ test/smoke/sanity.test.ts (1 test) 3ms
 ✓ test/core/signal.test.ts (16 tests) 8ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

Command: `… pnpm.mjs build` (`tsc --noEmit && vite build`) → exit code **0**

```
✓ 4 modules transformed.
dist/index.html                0.33 kB │ gzip: 0.26 kB
dist/assets/index-Cunev-bE.js  0.76 kB │ gzip: 0.48 kB
✓ built in 35ms
```

`tsconfig.json` includes `test`, so the new `let refusal: unknown` + `try`/`catch` test body is
typechecked under `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; it compiles
clean.

### Constraints kept

- **No design change:** still one fixed `Uint8Array` allocated up front, no growth path, no
  `growTo`, `alloc` behavior and its `RangeError` message untouched.
- **`formatPort` untouched** (masking fix from §5 Conflict 1 stands), and none of the brief's Step 1
  assertions were edited — only added to (12 → 16 tests).
- **Deferred Minors not acted on:** no 32-bit wrap handling in `setPort`, no direct `assertWidth`
  test, no capacity-headroom change, no edit to the stale probe row in §5.
- **No dependency and no manifest change:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
  `vite.config.ts` untouched.
- **Hygiene:** `git ls-files --eol` still reports `i/lf w/lf` for both files (0 CR bytes each), no
  scratch/probe file remains, and `git diff` is limited to the two intended files.

### Commit and post-commit confirmation

Commit: `ec166d8` — `fix(core): size wide port read-back buffer with ceil(width / 8)`; 2 files,
+36/−2 (`src/core/signal.ts`, `test/core/signal.test.ts`).

The full suite was re-run against the committed revision (same command as §GREEN above) — exit
code **0** — and the tree is clean afterwards:

```
 ✓ test/smoke/sanity.test.ts (1 test) 2ms
 ✓ test/core/signal.test.ts (16 tests) 8ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

`git status --short` → empty. This report itself is still uncommitted: `.superpowers/sdd/.gitignore`
ignores that directory by design, matching §4 and Task 1.
