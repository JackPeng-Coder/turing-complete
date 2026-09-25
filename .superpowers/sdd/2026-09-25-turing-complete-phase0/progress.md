# SDD ledger — plan: docs/superpowers/plans/2026-09-25-turing-complete-phase0.md

Spec: docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md
Plan commit baseline: 000b495 (branch master, local-only repo — no remote, no shared branch)

## Setup rulings

Ruling: implement directly on `master` instead of a git worktree — the repo is brand
new, local-only, has no remote and no other work in flight, so a worktree would add
path friction with no isolation benefit. This is NOT the "shared main branch" the
skill warns about; nothing else can be disturbed.
  — Cost if wrong: the phase-0 history is interleaved with the docs commits. Recoverable
    by branching retroactively; no data loss risk.

Ruling: use PowerShell ports in `tools/sdd/` instead of the upstream bash scripts —
Git's bash on this host resolves to WSL, which mangles Windows drive paths, and the
repo has autocrlf warnings that would break `set -euo pipefail` scripts.
  — Cost if wrong: the ports could drift from upstream semantics. Mitigated by testing
    each port against a real plan before first use (task-brief on Tasks 1 and 5 both
    produced correct, fence-aware output).

Ruling: do not fight the harness over per-dispatch model selection. The `spawn_teammate`
and `subagent` tools on this platform expose no model parameter, so every dispatch
inherits the session model. Skipped rather than faked.
  — Cost if wrong: higher token cost per task than a tiered scheme would give. No
    correctness impact.

## Preflight conflict scan

File/interface conflict rows (every pair of tasks sharing a file or an interface):

| Tasks | Produces → Consumes | Finding |
|---|---|---|
| 1 → 11 | `package.json` scripts + vite build/`tsconfig` → `pnpm build` for the smoke test | None. Task 11 runs `pnpm build`; Task 1's `build` script is `tsc --noEmit && vite build`. Consistent. |
| 1 → all | `test.include`, `environment: 'node'`, jsdom only under `test/ui/**` | Finding: Task 11 adds `test/ui/view.test.ts`, which is DOM-free but lives under `test/ui/`, so it silently gets jsdom. Ruled harmless (geometry tests pass under jsdom) and the directory split is deliberate. No change. |
| 2 → 3, 5, 6 | `SignalTable`, `PortValue`, `Port` → registry defs, `net.ts` slots, `boundLevelIo` | Finding: Task 2's first draft reallocated the backing `Uint8Array` on growth, invalidating every previously handed-out `base`. Ruled a real defect — fixed in the plan before dispatch (fixed capacity + explicit `RangeError`, capacity 65536). |
| 2 → 5 | `SignalTable` API | Finding: Task 5's `compile()` built a `drive: Int32Array` sized from `table.size` at that moment. Consistent with fixed capacity. No change. |
| 3 → 4 | `PinDef`, `Registry`, `ComponentDef` → `validateGraph` | None. |
| 3 → 5 | `ComponentDef.evaluate/clockEdge/stateBytes` → `Simulation.settle`/`tick` | Finding: `#publishState()` writes `state[p]` into `outputs[p]`, which only holds for one output slot per state byte. True for `delay_line`/`mem1` (all Phase 0 has). Ruled acceptable with an explicit plan note; 8-bit registers in Phase 1 will need a `publish` hook. |
| 3 → 5, 6 | `level_input`/`level_output` defs | Finding: both were originally introduced only inside a Task 6 side-note, but Task 5's `compile` and Task 6's `bindLevelIo` both need them, and Task 4's `validateGraph` runs before either. Ruled: moved into Task 3's `BASE_DEFS` (`category: 'level'`, `hidden: true`, cost 0) so every later task can rely on them. |
| 3 → 8, 9 | `DEF_IDS` | None. |
| 4 → 5, 6, 7 | `Graph`, `Instance`, `Wire`, `GraphIssue` → `compile`, `runChecks`, `grade`, `delayOf` | None. |
| 5 → 6 | `Netlist.inputBase/outputBase`, `Simulation.read(base,width)`, `compile`, `UnstableCircuitError` | Finding: Task 6 originally re-declared `bindLevelIo` with hard-coded width 1, while Task 9 needed width-4 pins. Ruled: Task 6 owns the width-aware version; Task 9 must not re-declare it. Fixed in plan (Task 9 no longer redefines it). |
| 5 → 7 | `delayOf`, `compile`, `validateGraph` → `grade` | Finding: `delayOf` was a path-enumerating DFS — exponential on diamond circuits. Ruled a real defect, fixed in plan (Kahn topological order + single relaxation). |
| 5 → 6, 9 | `SETTLE_LIMIT` | Ruled internal to `net.ts`; no consumer needs it. No change. |
| 6 → 7 | `runChecks`, `CheckOutcome`, `CheckFailure`, `LevelSpec` → `grade`, `starsOf` | Finding: Task 6's `truth-table` branch silently skipped comparison when `rows` was omitted, so any circuit passed. Ruled a real defect, fixed in plan (omitted/empty `rows` is a `missing-rows` failure). |
| 6 → 8, 9 | `truthTable()` generator, `LevelIo` type | Finding: `truthTable()` was specced but the level files called it with `LevelSpec['io']`, which is only available *from* the level being defined. Ruled: introduce a standalone `LevelIo` interface in `tables.ts` so `const IO = {...}` can be declared first and reused. Fixed in plan. |
| 6 → 8 | `CheckFailure.reason` union | Finding: the union listed `'missing-io'` but nothing produced it, while the new `missing-rows` had no member. Ruled: add `'missing-rows'`; leave `'missing-io'` (used by `AttemptFail`). Fixed in plan. |
| 7 → 10 | `Metrics`, `GradeResult` → `Progress`, `applyGrade`, `resumePointOf` tests | Finding: the star/score formula `gate + delay*4 + tick*8` was duplicated between `grader.scoreOf` and `progress.applyGrade`. Ruled: `progress.ts` keeps a private `SCORE_WEIGHTS` with a comment pointing at `grader.ts`, because importing the grader into the progress model would invert the dependency. Documented in plan. |
| 7 → 11 | `grade()` → `regrade()` in `main.ts` | None. |
| 8 → 9 | `test/fixtures/build.ts` (`build`, `registry`) → Task 9's test | Finding: Task 9 Step 1 said "extract the fixture to `test/fixtures/build.ts`" but Task 8 already creates it there. Ruled: Task 8 owns the file, Task 9 only consumes it. Fixed in plan (Task 9's redundant step replaced with a "confirm it exists" step). |
| 8 → 9 | `src/levels/index.ts` | None: only Task 8 modifies it. |
| 8, 9 → 10 | `LEVELS`, `LEVEL_ORDER`, `getLevel`, `LevelSpec` → progress/map/palette | None. |
| 8, 9 → 11 | level ids and `allowedComponents` → palette contents | Finding: Task 1's `sanity.test.ts` imports `LEVEL_ORDER` from `src/levels/index`, which Task 1 itself stubs then Task 8 fills. Consistent. |
| 10 → 11 | `emptyProgress()`, `isUnlocked`, `resumePointOf`, `unlockedComponents`, `paletteDefsFor` → store init, palette, map | Finding: `resumePointOf` was specced in Task 12 but consumed by Task 11's `main.ts` — an ordering inversion. Ruled: move `resumePointOf` (and its three unit tests) into Task 10. Fixed in plan. |
| 10 → 11, 12 | `loadProgress()`, `saveProgress()`, `STORAGE_KEY`, `migrate` | Finding: Task 10 first stored `unlockedComponents` in `Progress` *and* derived it from rewards, which drifts after an import. Ruled a real defect, fixed in plan (derived only). |
| 11 → 12 | `test/ui/panels.test.ts` (created 11, appended 12), `src/ui/style.css` (created 11, appended 12), `src/main.ts` (created 11, wired 12) | Finding: Task 11's `main.ts` imported `mountMap`/`narrativeFor` and called `mapRender.render()`, none of which exist until Task 12 — Task 11 would not compile. Ruled: Task 11 ships a placeholder `openMap`, Task 12 replaces it. Fixed in plan. |
| 11 → 12 | `mountShell(root, store, options)` signature | Finding: `test/ui/panels.test.ts` calls `mountShell(root, store)` without options while the shell requires `onOpenMap`. Ruled: test passes `{ onOpenMap: () => {} }`. Fixed in plan, plus a second test asserting the callback fires. |
| 12 → 11 | smoke tests target `playwright.config.ts` | Finding: Task 11 Step 10's commit only added `src/ui src/app src/main.ts test/ui`; the smoke spec has no `playwright.config.ts` yet. Ruled: `playwright.config.ts` and `test/smoke/ui.spec.ts` are created in Task 12. Consistent as written. |

Per-task self-consistency rows (`tests specified vs code specified`):

| Task | Finding |
|---|---|
| 1 | Clean. The sanity test imports `LEVEL_ORDER`, which step 7 deliberately stubs so the test can be seen failing first. |
| 2 | Finding: the Step 5 capacity test originally asserted table growth, impossible with fixed capacity. Fixed (earlier values survive; over-allocation throws). Also `snap(-3)` asserted `-0` via `toEqual` — changed to an `Object.is` check. |
| 3 | Finding: the `gate()` helper took a predicate `fn: (bits: readonly number[]) => number`, but the test called `def.evaluate!([a, b], …)` with destructured params, which does not typecheck. Fixed: `gate()` now takes a full truth-table array, which is also more auditable. |
| 4 | Finding: the `multiple-drivers` test contained `throw new Error('placeholder')` and a follow-up step telling the implementer to fix it — a plan-mandated broken test. Ruled a real defect, fixed in plan (the assertion is written directly). |
| 5 | Finding: Step 6's replacement test for the NAND chain carried a wrong expectation in a comment (`nand(1,1)=0 → not=1`, comment said 0). Fixed. Finding 2: the initial `describe('Simulation')` block was a probe with `expect(slotOf).toBeDefined()` that asserted nothing. Ruled a real defect, fixed. |
| 6 | Finding: `andSpec.checks` was `[{ kind: 'truth-table' }]` with no rows while the tests expected `reason: 'mismatch'` — under the corrected semantics that is `missing-rows`. Fixed in plan (explicit 4-row table). |
| 7 | Same class as Task 6: `andSpec.checks` had no rows, so the "3 stars" expectations would fail. Fixed (explicit rows). |
| 8 | Finding: the original `build()` helper was an admitted half-placeholder returning a cast `Graph`. Ruled a real defect, replaced with the real `build()` fixture. Finding 2: the ch1-05 test whitelist (`allowedComponents`) included `or`, which is not unlocked until ch1-06 — the level-gating test would fail. Fixed. Finding 3: the NOR reference solution was `NOT(NAND)`, which is AND. Fixed to `or` + `not`. |
| 9 | Finding: level 12 specified a 4-bit output pin, which needs `maker` (Phase 1) and would require four wires on one input pin. Ruled: four 1-bit outputs with a generated 16-row truth table. Finding 2: level 8's script check asserted a bare `const_on` was acceptable at tick 2 — it is high from tick 0, so the level taught nothing. Fixed with a tick-0 low assertion. Finding 3: level 11's three-star delay of 4 was unreachable (two ANDs is delay 2 on the base-gate path). Fixed to 2. |
| 10 | Finding: `emptyProgress(initialComponents)` was called with `[]` everywhere, which is what made level 1 unplayable. Fixed to `emptyProgress()`. |
| 11 | Finding: the palette read `progress.unlockedComponents`, which no longer exists after the Task 10 fix; it also never offered the level-IO plumbing, so no level could be finished. Fixed: palette uses `paletteDefsFor`, and its jsdom test was rewritten to assert the plumbing-only initial state. Finding 2: the initial render loop used `requestAnimationFrame` forever, contradicting spec §7's "静止时不重绘". Fixed (store subscription + resize). Finding 3: the board was absolutely positioned at `z-index: -1`, making pointer math depend on stacking. Fixed (normal-flow flex child). |
| 12 | Finding: the smoke test's selectors used raw def ids (`const_on`) after the palette switched to localized labels. Fixed. Finding 2: the smoke test never dismissed the briefing overlay, which covers the canvas. Fixed. Finding 3: the reload assertion expected the level-1 result to persist, but a second pass advances the app to level 2 and clears the grade. Ruled: split into two tests, the second asserting the level-2 briefing and an unlocked NAND instead. |

Global-constraint conformance, checked against every task that could violate one:

| Constraint | Finding |
|---|---|
| 0 runtime dependencies | Clean: every task's only adds are devDependencies (`vite`, `vitest`, `jsdom`, `typescript`, `@playwright/test`). |
| All graphics procedural, no copied assets | Clean: `theme.ts` colors + Canvas primitives only; narrative text is original. |
| Signals are `0`/`1`; multi-bit ports occupy consecutive 1-bit slots | Clean: `signal.ts` stores one bit per slot; width only appears at API boundaries. |
| Every component's delay is 1; storage elements add none | Clean: `cost` is 1 per gate, 0 for sources/plumbing/storage; `delayOf` treats `sequential` as a path breaker. |
| Combinational loops must raise, never hang; settle cap 512 | Clean: `SETTLE_LIMIT = 512`; `UnstableCircuitError` is tested at three levels (kernel, checks, grader). |
| Score = gate + delay*4 + tick*8 | Clean and now single-sourced. |
| Levels unlock strictly linearly | Clean: `isUnlocked` only looks at the immediately preceding level. |
| Theme values only from `theme.ts` | Finding: `style.css` hard-codes the same hex values as `THEME`. Ruled acceptable for Phase 0 (CSS cannot import a TS constant without a build step), but recorded as a deferred minor for the final review to triage. |
| Commits in English, `type: summary` | Clean. |

## Progress

Task 1: complete (commits 000b495..a9b81d6, review clean — Approved)

Task 1: Ruling: amend the plan's `jsdom` pin from `28.0.1` to `28.1.0` — the pinned
version does not exist (registry 404, verified by the implementer and re-verified by
the reviewer against the npm registry); `28.1.0`'s integrity hash matches the committed
lockfile. — Cost if wrong: none identified; jsdom is unused until Task 11, and the
substitution is the smallest correct one.

Task 1: Ruling: amend the plan's `vite.config.ts` to drop `environmentMatchGlobs` and
use per-file `// @vitest-environment jsdom` docblocks — Vitest 5 removed the option
(0 occurrences in `node_modules/vitest`), it is silently ignored at runtime AND
rejected by `tsc`, which breaks the plan's own `pnpm build` acceptance criterion. The
replacement keeps jsdom off the DOM-free `test/ui/view.test.ts` and fails loudly
(`document is not defined`) if a future DOM test forgets the docblock. — Cost if wrong:
a DOM test that forgets the docblock fails with a clear error rather than silently
running without a DOM, which is the failure mode we want.

Task 1: Ruling: keep `pnpm-workspace.yaml` and treat it as required project config, and
add an explanatory comment — I resolved the reviewer's ⚠️ provenance question by
deleting the file and running a clean `pnpm install --frozen-lockfile`: it fails with
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (exit 1) naming exactly the four pinned
exemptions. So the file is load-bearing, not an accidental workaround, and the
reviewer's Minor ("add a comment naming the gate") is now satisfied. — Cost if wrong:
a committed supply-chain-policy exemption that outlives its need. Mitigated by the
comment telling the next maintainer to drop entries as versions age.

Task 1: minor (deferred): `package.json` `"smoke": "playwright test"` is non-runnable
until Task 12 creates `playwright.config.ts` and `test/smoke/ui.spec.ts`.
Task 1: minor (deferred): `tsconfig.json` `include` omitted `playwright.config.ts`.
Ruled: add it now (it is a one-token change and Task 12's `tsc --noEmit` would
otherwise never typecheck that file).
Task 1: minor (deferred): no `engines`/`packageManager` pin, so a Node 20 contributor
gets an opaque Vitest 5 failure. Not fixed; polish.
Task 1: minor (deferred): the plan's `style.css` hard-codes the same hex values as
`src/ui/theme.ts`. Deferred for the final whole-branch review to triage.
Task 1: minor (deferred): `test/smoke/sanity.test.ts` proves the runner and import
graph rather than level data. Superseded by Task 8's level tests.

Task 2: complete (commits 04ceeaf..ec166d8, review clean after 1 fix round)

Task 2: fix round 1/5 (2 addressed, 0 open — `getPort` floored where `assertWidth`
ceiled; the identity test could not catch re-allocation; commits fd82f2b..ec166d8)

Task 2: Ruling: keep the implementer's `formatPort` fix and the brief's Step 1 test —
the brief contradicted itself (`padStart` never truncates, so its own binary branch
returned `'101'` for `formatPort(0b101, 1, 2)` while its test required `'1'`). The test
defines the contract ("pads binary to the port width"); the code was amended to mask to
the port width. Both the reviewer and I checked this independently. — Cost if wrong: an
over-wide value silently renders truncated instead of throwing. Acceptable because
`setPort` already rejects over-wide values, so the only way to reach it is a caller that
ignored `assertWidth`.

Task 2: minor (deferred): `valuesEqual` cannot equate a number with the byte-array form
of the same wide value (`valuesEqual(0x1234, Uint8Array([0x34,0x12])) === false`). Not
reachable in Phase 0 (no pin exceeds width 1). **Forward note for Task 6:** the planned
`bindLevelIo` already normalizes both representations to a number via
`toNumber(sim.read(base, width))`, which is why this stays deferred rather than fixed.
Task 2: minor (deferred): `alloc` accepts non-integer widths, and `assertWidth` is
asymmetric for negative widths. Hot-path design; unreachable while every pin is width 1.
Task 2: minor (deferred): `setBit`/`getBit` do no bounds checking — deliberate for the
evaluation hot path, recorded so it is not re-litigated.
Task 2: minor (deferred): a round trip through a non-multiple-of-8 wide port is lossy
above `width` inside the top byte (12-bit `0x12` reads back as `0x02`). Inherent to a
`width`-bit port, now explicitly asserted by a test rather than left implicit.
Task 2: minor (deferred): `formatPort` masks for radix 2 but renders radix 10/16
verbatim, so `formatPort(0x1FF, 8, 16)` yields `'1FF'` for an 8-bit port. Plan-verbatim;
contract is undocumented in the test suite.
Task 2: minor (deferred): `setPort`'s number path wraps above 32 bits (shift count is
mod 32), so `setPort(base, 40, 1)` writes bit 0 twice. Fix would be to require
`Uint8Array` when `width > 32`. Not reachable in Phase 0.
Task 2: minor (deferred): the default 65,536-slot capacity is tighter than the plan's
"room to spare" comment claims — 20,000 2-input gates at 3 slots each is 60,000 slots,
and any 3-input gate overruns it. **Forward note for Task 5:** pass an explicit capacity
rather than relying on the default.

Task 3: complete (commits ec166d8..75f214e, review clean after 1 fix round)

Task 3: fix round 1/5 (1 addressed, 1 open-then-closed — the storage semantics defect;
the second item was a plan-document inconsistency I fixed myself as controller;
commits 2fc391c..75f214e)

Task 3: Ruling: `evaluate` publishes held state and `clockEdge` only samples into state;
the implementer's "never reached through the kernel" claim was FALSE and I reproduced the
defect empirically — with the shipped mirroring `evaluate`, dropping the delay line's
input from 1 to 0 changed its output immediately, so the delay line was a plain buffer.
The kernel's settle loop calls `evaluate` on every def that has one, skipping only defs
with none. — Cost if wrong: one extra settle pass per storage element per tick, which is
exactly what the latency metric is supposed to measure, so a wrong call here would
mis-price every memory level.

Task 3: Ruling: my own ruling text contained a false premise — I claimed `state` could be
an OPTIONAL parameter so existing 3-arg `evaluate` calls would keep compiling. The
implementer disproved it with a compiler experiment (a `state?` third parameter makes
`{ tick: 0 }` fail with TS2353, because the third argument is positionally checked
against `state`), and proposed inserting `undefined` at the 9 call sites instead. I
verified the reasoning independently and accept it. The implementer also offered a
method-overload alternative that avoids the call-site edits, but it only works by typing
the legacy third argument `unknown`, which removes type checking at exactly those sites —
strictly worse. Ruled: keep the ruled signature and order, take the 9 mechanical edits.
— Cost if wrong: 9 call sites carry a redundant `undefined`; if `state` ever becomes
optional-in-position this noise goes away.

Task 3: Ruling: `const_on` / `const_off` are `category: 'io'`, not `'logic1'` — the
brief's code block contradicted its own test (`byCategory('logic1')` must exclude
`const_on`). The implementer chose `'io'`; I confirmed the shipped code matches.
— Cost if wrong: the palette groups sources separately from gates, which is arguably
what a player expects anyway.

Task 3: minor (deferred): `fields.ts` is 32-bit only (`1 << i` wraps past 31). Matters
only once Phase 1 introduces 16/32/64-bit values.
Task 3: minor (deferred): the plan's Task 3 Step 6 still predicts "14 passed" where the
block yields 18. Cosmetic; the task is closed.
Task 3: minor (deferred): `state[p] → output[p]` is now published in two places — the
kernel's `#publishState()` for `reset()`/`tick()`, and each storage def's `evaluate`.
Idempotent by construction, but Task 5 may drop the duplication if it reads more clearly.
Task 3: minor (deferred): plan doc drift — expected test counts in a few later tasks are
one or two off after amendments. Cosmetic.

Task 4: complete (commits 75f214e..f35213b, review pending)

Task 4: Ruling: accept the implementer's fix to the `accepts a well-formed circuit`
fixture — the brief's fixture left a NAND's two inputs unwired while asserting zero
issues, which is unsatisfiable because an unwired input is reported as a
`dangling-input` **warning**. The implementer added a `const_off` source so the circuit is
genuinely fully wired and kept the strong `toHaveLength(0)` assertion. I checked the
downstream consequence before accepting: `grade()` only treats `severity: 'error'` as
fatal, so a dangling input does not block a pass — which is correct, because an unwired
input reads 0 by design. — Cost if wrong: an unwired input silently passes a level while
reading 0. Acceptable in a build-your-own-circuit game where the player is mid-edit, and
the warning is still surfaced in the issues list.

Task 4: minor (deferred): the plan's Task 6 fixtures for the unstable-feedback-loop tests
were also wrong (see the Task 5 entry below); I corrected them in the plan.

Task 5: complete (commits f35213b..2648a4e, review clean)

Task 5: Ruling: accept the parallel/Jacobi settle sweep over the brief's in-place sweep.
The reviewer and I independently confirmed the brief's version is not merely slower but
INCAPABLE of the required behaviour: for a two-inverter ring, in-place propagation flips
both gates within a single pass and finds the self-consistent pair (n1=1, n2=0), so it
reports `stable` for a circuit that genuinely oscillates. The parallel sweep stages all
outputs from the committed table and only reports stable when every staged output equals
the table, so a period-2 orbit can never be misreported. — Cost if wrong: `SETTLE_LIMIT`
is now a combinational-DEPTH cap (~511) rather than a loop budget, and a settle is
O(depth x instances) after a change instead of O(instances). Phase 0's deepest reference
solution is depth 4 and every storage element breaks the path, so this is fine now;
recorded as the first Phase 1 performance item.

Task 5: Ruling: accept `inputBase` returning the DRIVER slot rather than the pin's own
slot. With the brief's own-slot version, `net.inputBase('OUT.in')` could only ever read 0
once the pin was wired, which would make every level unpassable. The reviewer verified
this against Task 6's planned `bindLevelIo` source and confirmed the driver-slot
semantics is load-bearing. — Cost if wrong: writing through the `inputBase` of a *wired*
pin targets the driver's output slot and is overwritten on the next sweep; Task 6 only
writes via `outputBase`, so the safe path is the only one used.

Task 5: Ruling: the "unstable circuit" fixtures were wrong in three places — the brief's
Task 5 fixture and (via the plan) Tasks 6 and 7. Cross-coupled NANDs with UNWIRED free
inputs are a stable fixed point (`nand(x,0) === 1` for every x — a perfectly good SR
latch), so they never oscillate. Fixed by tying the free inputs high so each gate inverts.
I corrected the Tasks 6 and 7 fixtures in the plan myself before dispatching Task 6,
because Task 6 would otherwise have been implemented against a test that cannot pass.
— Cost if wrong: the tests would assert `unstable` on a circuit that legitimately settles,
which is the exact class of bug that hid the Task 3 storage defect.

Task 5: minor (deferred): `SETTLE_LIMIT` is now a depth cap but `UnstableCircuitError`'s
message still asserts "combinational feedback loop", and `blame` lists every instance
rather than the guilty cone. The reviewer asks for a 64-gate chain test (expect
`iterations === 65`) and a 512-gate test (expect the throw) to pin the real contract.
**Forward note for Phase 1.**
Task 5: minor (deferred): `#readInputs` reads `width` bits CONTIGUOUSLY from `drive[base]`,
bypassing the per-bit drive map. Correct for every 1-bit pin in Phase 0, silently wrong
the moment a narrower output drives a wider input. **This is the first thing Phase 1's
wide-port work must fix** — the reviewer's suggested fix is to gather bit-by-bit via
`drive[base + bit]`.
Task 5: minor (deferred): the `delayOf` storage-break test cannot fail against a
source-only implementation, because every Phase 0 storage def costs 0. Needs a custom
registry def with `{ sequential: true, cost: 2 }` to actually pin the two-directional
break.
Task 5: minor (deferred): the two-`delay_line`-in-series one-stage-per-tick guarantee has
no test; only a single delay line is covered.
Task 5: minor (deferred): a `SignalTable` lives on the netlist while `#state` lives on the
`Simulation`, so a second `Simulation` over one netlist silently shares signals. Inert as
planned (one per netlist); worth a doc comment.
Task 5: minor (deferred): a two-inverter ring's fixture comment claims "no stable state",
which is mathematically false (the detection depends on the zero-initialised table). A
three-inverter ring would be the rigorous fixture.


Task 6: complete (commits 2648a4e..111de70, review pending)

Task 6: Ruling: accept the implementer's correction of the level-IO fixture ids. The plan
wrote `IN_A`/`IN_B`, but the binding convention is `IN_<pinId>` with the pin name coming
from the level spec -- so a level with pins `a`/`b` needs `IN_a`/`IN_b`. Three independent
plan sources agree on the lowercase form (Task 8's `build()` fixture generates
`IN_${node.name}`, Task 8's level-1 hint text says `IN_a`, Task 9 uses `OUT_out3`), so the
hand-written fixtures in Tasks 6 and 7 were the outliers. I corrected every occurrence in
the plan before dispatching Task 7. — Cost if wrong: level binding silently reads 0 for
every input, which would have made all 12 levels unpassable -- a failure the level tests
would have caught, but only after wasting a task.

Task 6: Ruling: `sum-equals` reduces the sum into the declared output width
(`sum % 2 ** width`). The brief's version returned the raw sum, which makes its own
"half adder parity" test unsatisfiable: on a 1-bit output, two high inputs sum to 2, and
`2 !== 1`. The prose intent is "the output equals the count of high inputs, as that count
fits in the output" -- i.e. parity. — Cost if wrong: a level using `sum-equals` with a
narrow output would compare an unreachable value. Task 12's binary-racer eventually uses a
4-input truth table rather than `sum-equals`, so the practical blast radius is the plan's
own parity test.

Task 6: Ruling: accept the added row-level `missing-rows` guard (a `truth-table` row that
declares no outputs). Same hazard as the mandated whole-check guard, one level down: a row
with no expectations compares nothing and therefore passes. — Cost if wrong: a level author
who writes a row but forgets its outputs gets a failed level instead of a silent pass,
which is the safe direction.

Task 6: minor (deferred): `checks: []` and a `script` check with `steps: []` both pass
vacuously. No honest `reason` member exists for "the level declares no tests", and no
Phase 0 level does it. Recorded for the level-authoring tasks: every level must have at
least one check, and the level-content tests in Tasks 8-9 should assert it.
Task 6: minor (deferred): the generated input enumerators (`2 ** bits`) are 32-bit bound.
Relevant only when a level declares more than 32 input bits.

Task 7: complete (commits 111de70..a216998, review pending)

Task 7: Ruling: accept the destructuring workaround for the `threeStar: undefined` test
fixture. `exactOptionalPropertyTypes` rejects an explicit `undefined` for an optional
property (TS2379), so the brief's literal fixture cannot coexist with the project's
mandated `pnpm build` gate. The implementer kept the assertion and the prose intent ("a
level that declares no targets") by omitting the key instead. — Cost if wrong: the test
now constructs the spec differently while asserting the same behaviour, so no coverage is
lost.

Task 7: minor (deferred): `grade` does not wrap `runChecks`/`delayOf` in a try/catch. All
three named never-throw cases (empty, invalid, unstable) pass, and `runChecks` itself
catches the domain errors; what escapes is a non-domain throw. The first such path will be
custom-component expansion in Phase 1. Recorded so the wide-port/blueprint work wraps it.

Task 6: fix round 1/5 (2 addressed, 0 open — an exception could escape `runChecks` via
`assertWidth`'s RangeError; the `rows` doc comment stated the opposite of the enforced
behaviour; commits 111de70..4e1da35)

Task 6: complete (commits 2648a4e..4e1da35, review clean after 1 fix round)

Task 6: Ruling: fix the never-throw hole in the level layer rather than the kernel. A
malformed authored level row (`inputs: { a: 2 }` on a 1-bit pin, or `{ a: 0.5 }`) reached
`assertWidth` and threw a `RangeError` straight out of `grade()`, which the UI calls on
every board edit. Both halves applied: `writeInput` rejects values that do not fit the
declared pin width, and the check-body catch maps `RangeError` to the existing `'invalid'`
reason (no new union member). — Cost if wrong: a rejected write is silent, so a malformed
row can now PASS when its expectation coincides with the zero-drive outcome, where it used
to throw. That is the safe direction for a player (a throw breaks the UI) but it does hide
bad level authoring; recorded as a deferred item, with the suggested fix being a per-row
`fitsPort` check that emits `'invalid'`.

Task 6: minor (deferred): `'missing-io'` is declared in the reason union and carried by
`AttemptFail`, but no path produces it — a level pin with no matching connector degrades to
an ordinary `mismatch` instead of a diagnostic. Plan-verbatim; harmless for correctness.
Task 6: minor (deferred): the multi-output fallback tries `OUT_<pinId>.in` then falls back
to `OUT.in` for EVERY pin, so a circuit with a single bare `OUT` makes all output pins
mirror one signal instead of failing loudly. **Forward note for Task 9:** level 12 must
keep per-pin `OUT_<pinId>` names.
Task 6: minor (deferred): `checks: []` and a `script` check with `steps: []` pass
vacuously; a truth-table row whose expected key is a typo also passes because `compare`
treats a missing key as 0.
Task 6: minor (deferred): the `missing-rows` failure payloads use non-pin keys
(`{ rows: 1 }`, `{ outputs: 1 }`) in fields typed as pin-id maps, so a UI labelling
failures by pin id will show a bogus pin.
Task 6: minor (deferred): `createSim` still rethrows anything that is not
`UnstableCircuitError`/`CircuitValidationError`, so a `RangeError` raised during
`compile`/`new Simulation`/`bindLevelIo` would still escape. Unreachable from authored
data today.
Task 6: minor (deferred): `compare` returns true for MISMATCH, so its three call sites read
inverted. Documented rather than renamed.
Task 6: minor (deferred): truth-table and constraint rows always evaluate at tick 0, and
`ticksUsed` stays 0 for a storage-based level checked by a truth table. Fine for chapter 1
(all combinational); matters when chapter 2's memory levels arrive.
Task 6: minor (deferred): `export { formatPort }` re-exports a presentation helper with no
Phase 0 consumer.
Task 6: minor (deferred): `bindLevelIo` validates against the spec's DECLARED width while
the connector def allocates the slot, so a level declaring `width: 2` on the 1-bit
`level_input.out` would spill into the next slot. Unreachable in Phase 0. **The successor
fix belongs to the wide-port phase: derive the slot width from the compiled pin def at bind
time rather than trusting `spec.io`.**

Task 8: complete (commits 4e1da35..b50e651, review pending)

Task 8: Ruling: seed the "always available" component set with `const_on` and
`const_off`, not just the level IO plumbing. Level 1's palette offers `const_on` and its
reference solution IS `const_on -> level_output`, so the constants cannot come from an
earlier reward -- there is no earlier level. The implementer caught this from its own
gating test (RED: `ch1-01-crude-awakening offers locked component const_on`) and seeded
the walk with a documented `STARTER_COMPONENTS`. I renamed Task 10's planned `PLUMBING`
constant to `STARTER_COMPONENTS` and gave it the same four members, so the palette the UI
builds and the gating the tests enforce come from one list. — Cost if wrong: level 1's
palette is empty of anything that can drive an output, which is the exact "level 1 is
unplayable" defect this derivation exists to prevent. Task 12's smoke test would fail.

Task 8: minor (deferred): level 6's `threeStar` target (gate 4, delay 3) is loose -- the
OR+NOT reference solution scores 2/2 and the NAND-only route scores exactly 4/3, so the
target is still reachable. Tightening it to the true optimum would make the target
unreachable by the shipped reference solution, so it stays.

Task 9: complete (commits 453b5bc..ae41b06, review pending)

Task 9: Ruling: level 8's three-star tick target is 3, not 2. The `tick` metric is the
highest tick the CHECK drives, not the circuit's latency: the corrected 4-step check
asserts the output is still high at tick 3, so every graded circuit reports tick 3 and a
target of 2 is unearnable. What actually pins the two-tick lesson is the check itself --
a single delay line is still low at tick 2 and fails it, which the wrong-circuit test
proves. — Cost if wrong: the tick star for this level measures the check's length rather
than the circuit's latency. That is a real weakness in the metric for script levels, and
it is recorded as a design item for the metric work: a level whose script runs to tick N
can never earn a tick star below N.

Task 9: Ruling: level 8's palette needs `delay_line`, so level 7 rewards it (level 7 is its
only predecessor). The plan had level 7 reward only `xor`, which left level 8 offering a
part nothing unlocked. Same shape as Task 8's starter-set ruling: the gating walk requires
every offered part to come from an earlier reward or the starter set. — Cost if wrong: the
gating test fails loudly, which is how this was caught.

Task 9: Ruling: `xor` stays in level 9's `allowedComponents` even though it makes the level
solvable with a single part. Part 1 ships the same convention (level 6 offers `nor`), and
the level's value is that it can be solved several ways -- a player who wires four NANDs
gets the lesson, and a player who drops in the XOR part gets a shortcut they have earned.
— Cost if wrong: level 9 can be finished without understanding XOR's construction. The
three-star target (gate 4) still requires the four-NAND solution for full marks, so the
incentive is intact.

Task 9: minor (deferred): the plan's Step 4 rewrote two assertions in
`test/levels/ch1-part1.test.ts`, which was outside the brief's file list. The implementer
scoped part 1's tests to part 1's own levels and moved the whole-chapter assertions into
part 2. Reasonable, and recorded so the Task 8 review knows the file moved.
Task 9: minor (deferred): the plan's truth-table lambdas (`a ^ b`, `b3`) do not typecheck
under `noUncheckedIndexedAccess`; rewritten as `a === b ? 0 : 1` and `b3 ?? 0` with
identical tables.
Task 9: minor (deferred): `task-9-brief.md` reportedly did not exist for that implementer.
The file is on disk now (485 lines, generated before dispatch), so the implementer most
likely looked in the wrong directory. No action.

Task 9: review round 1 (1 Important — my own ratification disagreed with the artifact;
commits ae41b06, no code change required)

Task 9: Ruling (CORRECTING an earlier ruling of mine): level 9 does NOT offer `xor`, and
that is correct. My earlier ruling said `xor` stays in level 9's palette; I based that on
the plan's SUMMARY TABLE, whose cumulative "上 + …" palettes list `xor` from level 8 on,
while the plan's own code block for level 9 omits it. The reviewer checked the artifact and
the code block, which agree. The shipped state is the better one: level 9's hint and its
exact 4-gate target both describe the four-NAND construction, and offering `xor` would make
`threeStar: { gate: 4 }` meaningless and let one part solve the level. No level lists `xor`
in its `allowedComponents`, so gating is unaffected either way. — Cost if wrong: players
must build XOR from NANDs instead of dropping in the XOR part. That is the level's entire
point, so the cost of being wrong here is that the game is more educational than intended.

Task 9: Ruling: tighten the three-star targets for levels 6, 10 and 11 to (gate 2, delay 2,
tick 0) so each matches its reference solution. As shipped they were 4/3 (level 6), 6/4
(level 10) and 4/2 (level 11) — every one looser than the intended answer, so a strictly
worse circuit earned 3 stars and the star stopped identifying the optimal construction.
`starsOf` treats a metric EQUAL to its target as met, so matching the reference exactly is
safe and the reference tests stay green. — Cost if wrong: the targets now demand the
intended construction rather than merely permitting it. A player who solves a level the
long way gets 1 star instead of 3, which is the correct signal and is what the design
spec calls for ("三星用来引导玩家优化解法").

Task 9: minor (deferred): level 8's three-star target carries no information — the tick
metric is the highest tick the check drives (always 3), the palette contains no gate, and
delay_line costs 0, so every passing circuit scores 3 stars. The check itself still rejects
a one-delay-line circuit, which is the real gate. Root cause is a design gap: a level whose
script runs to tick N can never earn a tick star below N. **Forward note for the metric
work in Phase 1.**
Task 9: minor (deferred): rejection tests assert only `passed === false`, which cannot
distinguish a value mismatch from a structural rejection, because `grade()` returns an
empty `failures` list when there are fatal graph issues. Levels 1 and 7 also have no
rejection fixture beyond the empty circuit. Suggested tightening: assert
`failures.some((f) => f.reason === 'mismatch')`.
Task 9: minor (deferred): `STARTER_COMPONENTS` is duplicated in both chapter tests with a
comment cross-referencing them but nothing enforcing equality. Task 10 exports the real
constant from `src/app/progress.ts`; both tests should import it.
Task 9: minor (deferred): chapter-wide invariants (registry shape, gating, non-vacuity)
live in `ch1-part2.test.ts` because the two-part split forced the rescope. They belong in a
chapter-level test file before a chapter 2 part file arrives.
Task 9: minor (deferred): the plan's chapter-1 SUMMARY TABLE is stale in several rows
(level 7's palette, level 8's tick target, level 12's check kind, cumulative palettes
listing `xor`). The per-level code blocks are authoritative; the table should be regenerated
or deleted, since it has now caused one wrong ruling.
Task 9: minor (deferred): `build()`'s doc comment implies an output `name` is a pin id, but
the builder passes `name` through verbatim while adding `IN_` for inputs — hence callers
writing `name: 'OUT_out3'`. No validation; a caller writing `name: 'out3'` gets a silently
unbound output. Worth either validating or documenting the asymmetry.
Task 9: minor (deferred): `LevelIo` is exported by both `src/levels/tables.ts` (pin lists)
and `src/levels/checks.ts` (a bound simulation). No barrel exists so nothing collides today.

Task 10: complete (commits cf9d561..f7df924, review pending)

Task 10: Ruling: resolve the two-task overlap on `src/app/store.ts` by moving `AppState`
and `DragState` into the app layer now, rather than having Task 11 extend Task 10's
committed file. The file is owned by Task 10; Task 11 only imports from it. The `Camera`
type that `AppState` depends on lives in the UI layer, so `src/ui/board/view.ts` was
created containing only that interface, for Task 11 to extend. — Cost if wrong: Task 11's
diff shows a partial `view.ts` as pre-existing, which is accurate; the alternative was two
tasks writing one file, which is the failure mode this avoids.

Task 10: minor (deferred): `migrate` does not validate per-record shapes and degrades
gracefully rather than rejecting a malformed save.
Task 10: minor (deferred): `saveProgress` failures are silent — there is no UI error
channel yet, so a full quota or a blocked storage backend loses progress without telling
the player.

Task 11: complete (commits cf9d561..63df10e, review pending)

Task 11: Ruling: accept the implementer's decision to assign level-binding instance ids at
placement time. Placing a component now sets `IN_a`/`IN_b`/… for level inputs and
`OUT`/`OUT_<pinId>` for level outputs, derived from the level spec. Without this no level
could ever be passed in the UI: the binding convention is by instance id, and a player
dragging a `level_input` onto the board has no way to know it must be named `IN_a`.
— Cost if wrong: two inputs of the same level would collide on the same id if the
assignment ever stopped being per-pin; the smoke test and the level tests both exercise it.

Task 11: Ruling: accept the `snap()` normalisation. `Math.round(-3 / 8) * 8` is `-0`, and
`Object.is(-0, 0)` is false, so the brief's own assertion could not pass. Normalising in
`snap` keeps the assertion and makes the function's output usable as a map key.
— Cost if wrong: none identified; `-0` and `0` are the same grid cell.

Task 12: complete (commits 79b2adb..452e90d, review pending)

Task 12: Ruling: accept the CSS fix rather than a test relaxation. `.screen-board
{ display: flex }` silently defeated the `hidden` attribute, so the board stayed visible
beside the chapter map. The smoke test caught it; the fix is `.screen[hidden]
{ display: none }`. — Cost if wrong: none; without it the map screen never actually hid
the board, which the map screenshot now disproves.

Task 12: minor (deferred): the epilogue briefing re-fires on every later edit of an
already-passed level. Brief-faithful; a "first pass only" guard is a product decision.
Task 12: minor (deferred): clicking the current level's own map tile wipes the open
circuit, because `openLevel` always rebuilds an empty graph. Pre-existing semantics.
Task 12: minor (deferred): `mountMap` rebuilds all 12 tiles on every store notification,
including ones the map does not display. Fine at 12 levels; chapter 7 will have 82.

## Lead verification (independent of every implementer report)

Run after Task 12, on commit 452e90d, by the controller:
- `pnpm test` -> 239 passed (239), 9 files.
- `pnpm build` -> `tsc --noEmit` clean, vite build clean, dist 43.44 kB JS / 2.31 kB CSS.
- Playwright smoke on the built app -> 2 passed (4.8s), exit 0. The two cases are
  "level 1 is playable end to end and shows its epilogue" and "progress survives a reload
  and unlocks the next level".
- Visual confirmation by screenshot: the shell bar shows the level name, map button, the
  three metrics and 3 stars; the palette offers exactly the four starter parts; the board
  draws a grid, a placed Constant On, a placed level output and the wire between them; the
  truth table reports all cases passing; the chapter map shows 12 levels with 11 correctly
  disabled and the current one highlighted.

## Final whole-branch review (most capable pass, read-only)

Verdict: Phase 0 functionally complete. No Critical findings; three non-code items required
before calling it done, all now fixed, plus one copyright fix the review surfaced.

Ruling: untrack the user's research compendium. It contains a verbatim line of the original
game's dialogue and, as a committed file, shipped in the deliverable while the README claims
the project contains no original text. The file stays on disk as the research input the user
supplied; it is now gitignored. — Cost if wrong: the research document is no longer versioned
with the project. It is the user's own input file, unmodified, and can be re-added at any time.

Ruling: rename the narrator from the original game's character name to 考核者 / The Assessor.
The design spec requires original character naming, and the review found the replica had kept
the original's name while its own source comment claimed otherwise. Fixed in `narrative.ts`
and in the two chapter-1 briefs that still named it. — Cost if wrong: the game's antagonist has
a different name from the original's. That is what the spec asked for.

Ruling: fix `pnpm smoke` rather than documenting the workaround. The review REPRODUCED a real
defect: `playwright.config.ts` built its webServer command from bare `node` and `pnpm`, so with
`NODE_BIN`/`PNPM_BIN` unset it ran `node pnpm build` and died with `Cannot find module`.
A phase whose own acceptance checklist names `pnpm smoke` cannot ship a smoke script that only
works with unexported environment variables. Now defaults to `process.execPath` plus a resolved
`pnpm.mjs`, with a bare-`pnpm` fallback for normal hosts. — Cost if wrong: the config carries
one host-specific absolute path, guarded by an existence check.

Ruling: waive the remaining deferred Minors into Phase 1, with two newly recorded. The review
triage found none of them block, and I checked its reasoning for the ones that sounded serious
(`#readInputs` contiguity, `bindLevelIo` width, the 32-bit shifts) — all are unreachable while
every pin is width 1, which is the whole of Phase 0. — Cost if wrong: a wide port in Phase 1
misreads neighbouring slots instead of failing loudly, which is why those three are recorded as
Phase 1's FIRST work rather than as ordinary Minors.

## Lead-run final verification (clean shell, NODE_BIN/PNPM_BIN unset)

- `test`   -> 15 files, 239 passed
- `build`  -> clean
- `smoke`  -> 2 passed (4.9s), starting its own build + preview
- Visual: shell bar, palette, board, wire, truth table, chapter map all confirmed by screenshot.

## Deferred into Phase 1

First, in this order (they gate wide ports and the CPU chapters):
1. `#readInputs` must gather bit-by-bit through `drive[]` instead of reading `width` bits
   contiguously; a narrower output driving a wider input currently corrupts silently.
2. `bindLevelIo` must take the slot width from the compiled pin def, not from `spec.io`.
3. `setPort`'s number path wraps above 32 bits (shift count mod 32) and `fields.ts`'s
   `1 << i` wraps past 31.
4. `fuzz` and `custom` checkers must exist before chapter 2's 8-bit arithmetic and chapter 3's
   CPU levels; chapter 7's maze/dance levels need `custom` specifically.

Also recorded: marquee/multi-select and space-drag pan are absent (spec §7 lists them) and
`DragState`'s `pan`/`marquee` variants are dead; Tick/Run/Stop and zoom controls are absent
(spec §4.2), which does not block level 8 but stops the player from *seeing* time pass, which
is that level's lesson; no `pointercancel` handler; the global keydown listener is never
detached and will swallow Delete inside the Phase 3 IDE; `render.ts` allocates a Map per frame
in `drawWires`; `mountMap` rebuilds all tiles on every store notification (fine at 12 levels,
not at 82); the plan's chapter-1 summary table remains stale and should be regenerated from the
code blocks or deleted.
