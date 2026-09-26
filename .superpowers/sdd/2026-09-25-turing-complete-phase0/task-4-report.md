# Task 4 report — 电路文档模型 (`src/core/graph.ts`)

Status: **DONE_WITH_CONCERNS** (one brief defect found and resolved unilaterally — the brief's
own "well-formed circuit" test cannot pass under the brief's own validator; see
*Deviation 1* below for the evidence and the ruling I applied). Everything else is
plan-verbatim.

Commit: `f35213b feat(core): add editable circuit graph model and validator`

---

## What I implemented

### `src/core/graph.ts` (new, 331 lines)

The editable document model — the thing the canvas mutates (Task 11) and the thing that is
serialized to disk. Exports exactly the pinned surface:

- Types: `Instance`, `WireEnd`, `Wire`, `CustomComponentDef`, `Graph`, `IssueCode`,
  `GraphIssue`.
- `emptyGraph(level?)` — omits `level` entirely when not given (required: `tsconfig` has
  `exactOptionalPropertyTypes: true`, so assigning `undefined` would not typecheck).
- `nextId(prefix, existing)` — highest numeric suffix + 1; `i1/i3 → i4`, `[] → i1`;
  non-numeric suffixes (`i`, `iw1`) are ignored rather than mis-parsed.
- `addInstance` / `removeInstance` — removal also drops every wire touching the instance in
  either direction.
- `connect` / `disconnect` — `connect` deliberately does **not** validate its endpoints:
  a caller may be mid-edit, and `validateGraph` is the single place that judges a graph.
- `cloneGraph` — deep copy of instances (+`params`), both wire ends, and `customComponents`
  (`name`, pin arrays, and `body` recursively), for editor undo snapshots.
- `validateGraph(g, registry)` — reports, never throws, never mutates. Emission order:
  `unknown-def` → `unknown-instance` → `unknown-port` → `multiple-drivers` → `feedback-loop`
  → `dangling-input`.

Severity semantics follow the pinned design decisions: **error** = the circuit is meaningless
(unknown def, wire to a missing instance, wire to a missing port, two wires driving one input);
**warning** = the player may still be working (unwired input reads 0, feedback loop). A feedback
loop is never fatal here — storage elements make legitimate loops and the simulator (Task 5) is
the only thing that can tell whether it settles.

Every registry lookup is gated on `registry.has` first, because `registry.get` **throws**
`unknown component: <id>`; a bogus def therefore produces an issue, not an exception.
The feedback scan is an explicit grey/black DFS stack — no recursion.

Two deliberate pieces of bookkeeping carry comments explaining that nothing reads them yet
(`driverCount` per output pin; the ids in `loopNodes`) — both are seeds the plan asks to keep.

### `test/core/graph.test.ts` (new, 213 lines)

15 tests: 5 construction/clone, 10 validation. 10 of them are the brief's tests verbatim; see
the deviations section for the other 5 lines of difference (1 amended fixture, 4 added tests).

---

## What I tested and the results

| Command | Result |
|---|---|
| `pnpm test test/core/graph.test.ts` (before implementation) | FAIL — module unresolved (RED, as the brief predicted) |
| `pnpm test test/core/graph.test.ts` (brief's implementation) | 10 passed, **1 failed** — the brief's fixture is unsatisfiable |
| `pnpm test test/core/graph.test.ts` (after fixture fix) | 12 passed |
| `pnpm test test/core/graph.test.ts` (after added coverage) | 15 passed, 210 ms |
| `pnpm test` (full suite) | **56 passed** (4 files) — was 41 before this task, +15 |
| `pnpm build` (`tsc --noEmit && vite build`) | clean, `✓ built in 29ms` |

Toolchain used (not on PATH):
`& "C:\Users\ME\.dsh\...\node\bin\node.exe" "C:\Users\ME\.dsh\...\pnpm\bin\pnpm.mjs" test`

Extra probe (verification of the *test*, not of the code): the same DFS written recursively over
a 50,000-node chain in Node throws `RangeError: Maximum call stack size exceeded`, so the
`scans a 50,000-instance cycle without recursing` test genuinely fails if the scan ever becomes
recursive. It is not a tautology.

---

## TDD evidence

### RED #1 — Step 2 exactly as the brief specifies

```
$ pnpm test test/core/graph.test.ts

 ❯ test/core/graph.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  test/core/graph.test.ts [ test/core/graph.test.ts ]
Error: Cannot find module '../../src/core/graph' imported from D:/Documents/turing-complete/test/core/graph.test.ts
 ❯ test/core/graph.test.ts:2:1
 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

Expected: the brief's Step 2 says exactly this (`无法解析 ../../src/core/graph`). Cause: the module
does not exist yet, so the import graph fails before any test runs.

### RED #2 — the brief's defect, found by running the brief's implementation against the brief's test

After implementing `src/core/graph.ts` verbatim from the brief (Step 3 → Step 4):

```
 ❯ test/core/graph.test.ts (11 tests | 1 failed) 11ms
   ✓ graph construction (5)
   ❯ validateGraph (6)
     × accepts a well-formed circuit 5ms
     ✓ reports unknown defs
     ✓ reports wires that point at missing instances
     ✓ reports wires that point at missing ports
     ✓ reports two drivers on one input pin
     ✓ reports dangling inputs and feedback loops

 FAIL  test/core/graph.test.ts > validateGraph > accepts a well-formed circuit
AssertionError: expected [ { severity: 'warning', …(4) }, …(1) ] to have length of +0 but got 2
 ❯ test/core/graph.test.ts:71:40
     71|     expect(validateGraph(g, registry)).toHaveLength(0);
      Tests  1 failed | 10 passed (11)
```

Why that expectation failed: the brief's fixture builds `nand` + `not` and wires only
`nand.out → not.a`. A NAND has **two** inputs (`a`, `b`), both left unwired, and the brief's own
validator (same page, 200 lines below) emits a `dangling-input` **warning** for every unwired
input because it reads 0. So the brief's implementation returns 2 issues, and
`toHaveLength(0)` cannot hold. The brief's Step 4 also predicts "PASS — 10 passed" for a file
that contains 11 tests, which is a second sign that this expectation was never executed.

### GREEN

```
$ pnpm test test/core/graph.test.ts
 ✓ test/core/graph.test.ts (15 tests) 210ms
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ pnpm test
 ✓ test/smoke/sanity.test.ts (1 test)
 ✓ test/core/signal.test.ts (16 tests)
 ✓ test/core/registry.test.ts (24 tests)
 ✓ test/core/graph.test.ts (15 tests)
 Test Files  4 passed (4)
      Tests  56 passed (56)

$ pnpm build
$ tsc --noEmit && vite build
✓ 4 modules transformed.
✓ built in 29ms
```

---

## Files changed

| File | Change |
|---|---|
| `src/core/graph.ts` | new, 331 lines — document model + validator |
| `test/core/graph.test.ts` | new, 213 lines — 15 tests |

Commit `f35213b` contains both; `git status` is clean afterwards. No `package.json` change
(zero runtime dependencies holds: the file imports types from `./registry` only).

## Deviations from the brief

1. **Amended (the defect):** `accepts a well-formed circuit`. The circuit is now *genuinely*
   well-formed — a `const_off` source drives both NAND inputs, then `nand.out → not.a` as
   before — so the strong `toHaveLength(0)` assertion is preserved rather than weakened to
   "no errors". A comment records why.
   *Ruling applied:* the brief's implementation and the dispatch note's pinned design decision
   ("`severity: 'warning'` covers … an unwired input") agree with each other and disagree with
   the one fixture, so the fixture was the wrong half. I did **not** invent semantics to satisfy
   it (e.g. "only warn when at least one input is already wired"), because that rule would
   suppress the most common real mistake — a gate whose inputs were forgotten — and is not
   requested anywhere.
2. **Added:** `warns about unwired inputs instead of rejecting the circuit` — pins the exact
   behaviour the old fixture asserted by accident: two `dangling-input` warnings with
   `severity: 'warning'`, zero errors.
3. **Added:** `reports an unknown def instead of throwing when a wire points at it` — the brief's
   unknown-def test has no wires, so it never exercised the `registry.get` throw path from the
   wire walk. Asserts no throw, `unknown-def` present, and that an unknown pin surface yields
   neither `unknown-port` nor a bogus `dangling-input`.
4. **Added:** `clones custom component bodies, not just their references` — `cloneGraph`'s
   deep copy of `customComponents` (name, pins, body instances/wires, recursively) is a stated
   requirement that the brief's clone test did not touch.
5. **Added:** `scans a 50,000-instance cycle without recursing` — pins the "iterative, not
   recursive" requirement, which otherwise had no coverage.

The remaining 10 tests are byte-for-byte the brief's.

## Self-review findings

1. **Brief defect (above)** — the only behavioural decision I had to make; flagged for the Lead
   to ratify or overrule. If overruled in favour of the fixture, the change is a two-line revert
   in the test file; the shipped `src/core/graph.ts` matches the brief line-for-line in behaviour.
2. **`driverCount` is accumulated but never read** (plan-verbatim). I kept it and documented why
   in the code: multi-driving is detected from the input side, and the map is the explicit record
   of legal fan-out for a future fan-out limit. Reviewers who dislike seeded bookkeeping can drop
   it with no behavioural change. Same class: `loopNodes`' ids are collected but only its
   emptiness is used; commented as a future highlight hint.
3. **Duplicate instance ids are not diagnosed.** `byId`/`defs` are last-wins, so two instances
   sharing an id silently collapse (and the dangling-input scan can then report the same pin
   twice). The pinned `IssueCode` union has no `duplicate-id` member, so reporting it would mean
   extending a pinned interface; generated ids are collision-free, so this is only reachable via
   an explicit caller-supplied `id`. Deferred, not fixed — worth a ruling if Task 11 ever lets a
   caller pass ids (e.g. paste/import).
4. **`pinIds()` allocates a Set per wire**, i.e. O(wires) small allocations. Measured: the whole
   50,000-instance/50,000-wire validation (including this) runs in ~200 ms. Plan-verbatim;
   deferred as a micro-optimization if Task 5's compile step ever calls it in a hot loop.
5. **Verified non-obvious paths behave:** self-loop (`a.out → a.a`) yields exactly one
   `feedback-loop` warning; a wire into an output-only pin yields `unknown-port` on the `to` side;
   `validateGraph` neither mutates `g` nor throws for any fixture used, including the bogus-def
   one; `cloneGraph` preserves `level` and its absence.
6. **Style/consistency:** comments in English (global constraint), error/warning messages
   bilingual `{zh, en}` as pinned, one commit in `type: summary` form.

## Issues or concerns

- **Concern (needs a ruling):** deviation 1. The brief is internally inconsistent and its Step 4
  expectation ("10 passed") is unreachable for a 15-test file; I chose the implementation + the
  pinned severity semantics over the one fixture. Evidence is in RED #2 above.
- No blockers, no dependency changes, no workspace files touched.
