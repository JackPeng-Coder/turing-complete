# Task 4 report — 宽位存储与序列组件 (wide storage and sequential components)

**Status:** DONE_WITH_CONCERNS (one design consequence worth the controller's eye, no
unfinished work — see §8)
**Worktree:** `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`)
**Commit:** `740e670` — `feat(core): add the 8-bit storage family and a layout-free publish path`
(7 files, +1162/−42; the controller's `progress.md` was already committed separately as
`9ccff8b` mid-session and is NOT part of my commit)
**Logs:** `.superpowers/sdd/2026-09-25-turing-complete-phase1/task-4-*.txt`

---

## 1. What I implemented

| File | Change |
|---|---|
| `src/core/defs/wide.ts` | New "storage family" section: `mux8`, `delay8`, `reg8`, `counter8`, `ram8`, exported as `WIDE_STORAGE_DEFS` + `WIDE_STORAGE_DEF_IDS`; file header updated (it claimed every def in the file was combinational) |
| `src/core/defs/index.ts` | `DEF_IDS` and `BASE_DEFS` now spread the storage family |
| `src/core/net.ts` | `Simulation.#publishState` rewritten (kernel keeps **no** state layout); `compile` refuses a storage def that could not publish; `settle`'s doc notes ram8's address read |
| `src/core/registry.ts` | **Doc-only** (3 lines): the storage contract's "must never read `inputs`" now names its single sanctioned exception — a memory's read address |
| `test/core/defs-wide.test.ts` | Storage contract table transcribed verbatim + per-def edge/publish semantics (60 tests in file) |
| `test/core/net.test.ts` | Kernel-level storage acceptance suite: latch, oscillators, counter, RAM, publish, capacity (53 tests in file) |
| `test/core/registry.test.ts` | Sequential-def list, publish/state honesty invariant, wide-family exclusion sets (26 tests in file) |

Pins, ids and widths are verbatim from the brief:

| id | inputs | outputs | `sequential` | `stateBytes` | `cost` | `gateCost` |
|---|---|---|---|---|---|---|
| `mux8` | `a:8` `b:8` `sel:1` | `out:8` | false | 0 | 1 | 32 |
| `delay8` | `a:8` | `out:8` | true | 1 | 0 | (fallback → 0) |
| `reg8` | `d:8` `load:1` `reset:1` | `out:8` | true | 1 | 0 | (fallback → 0) |
| `counter8` | `en:1` `reset:1` | `out:8` | true | 1 | 0 | (fallback → 0) |
| `ram8` | `d:8` `addr:8` `load:1` | `out:8` | true | 256 | 0 | (fallback → 0) |

The fixed `SignalTable` capacity is untouched by all this: `ram8`'s 256 bytes live in
`Simulation.#state` (`new Uint8Array(def.stateBytes)` per instance), not in the fixed
`SignalTable`, whose capacity is about pins. Pins per `ram8` = 17 in + 8 out = 25 slots, plus
a materialised read region per driven wide input when a narrower driver feeds it —
`capacityFor`'s existing `width > 1 && driven` term already reserves exactly that, and a test
pins a 200-instance bank at exactly `200 × 44` slots (3 feed + 17 in + 8 out + 16 region).

---

## 2. The publish mechanism: what I chose and why

**Choice: neither a kernel-side layout change nor a new per-def publish hook — I removed the
kernel's layout knowledge entirely.** `#publishState` no longer knows that state byte *p* is
output pin *p* (or anything else about a def's state); it gathers the instance's inputs and
runs **the def's own `evaluate`**, the same call the settle sweep makes, then writes the pins
that call produced. "How a byte becomes a pin" is now stated exactly once, in the def that
owns the state, so the two publish paths cannot disagree and no width or state size can
outgrow the kernel.

Rejected alternatives, and why:

* **A state-layout descriptor on `ComponentDef`** (e.g. `statePins: [{pin, offset}]`). It is
  *data* duplicating what `evaluate` already does in *code*: two statements of the same
  mapping, which is precisely the drift this task exists to remove. It also cannot express
  `ram8`, whose output byte is selected by an input, so `ram8` would still need an escape
  hatch — a second mechanism for one family.
* **A `publishState(state, outputs)` hook, with the storage defs dropping `evaluate`.** This
  changes the storage contract (Global Constraint 5) that the whole phase is pinned on, and
  puts the hook and `evaluate` side by side on the same defs, where they can disagree. A hook
  that also takes `inputs` (to serve `ram8`) just renames `evaluate`.
* **Keeping the old byte-per-pin rule as a fallback for 1-byte state.** The bug is the rule,
  not its width: `delay_line`/`mem1` are unchanged *because their own `evaluate` publishes
  what they hold* (`o[0] = state?.[0] === 1 ? 1 : 0`), which the pass now calls. Their defs
  were not edited at all.

Two consequences, both deliberate and documented in the code:

1. A def with `sequential: true`, `stateBytes > 0` and **no** `evaluate` can no longer be
   published (the old rule was the only thing that could). `compile` now refuses one by name
   (`"<def.id>: a storage element must declare evaluate() to publish what it holds"`) instead
   of letting it hold zero in silence — a def-authoring bug fails loudly at the only point
   where a graph and a catalog meet.
2. The pass still runs (it is not deleted): it writes the table directly, so the first sweep
   of the following settle already reads the held value, and the documented "a caller reading
   right after `reset`/`tick` sees the held value" property survives without depending on the
   sweep. See the honest limitation in §7 (mutation A).

---

## 3. Each def's edge semantics

| def | `clockEdge` (samples into `state`) | `evaluate` (publishes) |
|---|---|---|
| `mux8` | none (combinational) | `sel ? b : a`, both masked to 8 bits |
| `delay8` | `state[0] = a` | `state[0]` — never the input |
| `reg8` | `reset → 0`; else `load → d`; else hold | `state[0]` — never `d`/`load`/`reset` |
| `counter8` | `reset → 0`; else `en → (state[0]+1) & 0xff`; else hold | `state[0]` — never `en`/`reset` |
| `ram8` | `load → state[addr] = d`; else nothing | `state[addr]` — never `d`/`load` |

**Ruling 1 (`reset` beats `en`/`load`)** is implemented as an if/else chain where `reset` is
tested first, argued in each def's comment ("a clear is unconditional, so `d` cannot win an
edge the level asked to be a clear") and pinned by four tests: def-level (`reg8`, `counter8`)
and kernel-level (`clears on reset, and reset beats load on the same edge`, `counts one step
per tick …`). Both also pin that `reset` is *sampled*, not level-triggered: asserting it
between edges leaves the output alone until the next one.

**Ruling 2 (`counter8` wraps to 0)** — `(state[0] + 1) & 0xff`, i.e. `255 + 1 = 0`. Pinned at
the def level (`0xff → 0x00`) and through the kernel by walking the counter from 3 to 255 in
252 ticks and asserting the next tick is 0, then 1 again.

**Ruling 3 (`ram8`: combinational read, edge-triggered write)** — this is the only def in the
project whose `evaluate` reads an input, and the reason is exact: `addr` can only **select**
a byte of `state`, and the value published is always one a clock edge put there, so no input's
*value* can reach a pin through the read path. `d` (i[0]) and `load` (i[2]) are never read in
`evaluate`, so the write path cannot leak into the read path either. If `evaluate` only
published a held byte and ignored `addr`, the read path would not be combinational and an
address change would need a clock edge — the opposite of a memory's contract. Tests pin both
sides: an address change with **no** edge shows the newly addressed byte (and 0 for an
unwritten address); `d` changing with `load` asserted shows nothing until the edge; after the
edge the new byte appears. I recorded the exception in `registry.ts`'s contract doc (§1) so
the invariant's text stays true.

**Ruling 4 (`mux8`)** — `sequential: false`, `stateBytes: 0`, `cost: 1`, `gateCost: 32`, with
a truth table over boundary byte pairs × `sel ∈ {0,1}` and the "unwired `sel` reads 0 → `a`"
case.

**`gateCost` derivations** (same documented NAND basis as the rest of `wide.ts`):

* `mux8` = **8 × MUX2 = 8 × 4 = 32**: a byte-wide 2:1 mux is one 2:1 mux per bit, and the
  basis table in `wide.ts` prices a 2:1 mux at 4 NANDs (`NOT s, NAND(a,~s), NAND(b,s), NAND
  of those two`).
* `delay8`, `reg8`, `counter8`, `ram8` = **0 on both metrics**, `gateCost` left to the
  `?? cost` fallback, exactly as phase 0's `delay_line`/`mem1` do. `registry.ts` documents
  that choice ("the storage elements are zero on BOTH metrics … a second explicit 0 would
  only give the two zeroes a way to drift apart"), and Global Constraint 4 gives storage 0
  combinational delay. `test/core/registry.test.ts` now checks the storage family against
  that fallback rule explicitly, so the two zeroes cannot drift apart silently.

---

## 4. TDD evidence

### RED-1 — behaviour, before any of the five defs existed

```
node <bundled node> <bundled pnpm.mjs> test test/core/defs-wide.test.ts test/core/net.test.ts test/core/registry.test.ts
```
→ log `task-4-red-1.txt`; exit 1, **21 failed | 117 passed (138)**.

Failing because the components do not exist yet — the expected failure for a from-scratch
feature, not an import/typo failure:

```
FAIL test/core/net.test.ts > wide storage > publishes every bit of a wide register, not just the low one
Error: unknown component: reg8
FAIL test/core/net.test.ts > wide storage > holds its byte between the input flip and the next clock edge (latch)
Error: unknown component: reg8
FAIL test/core/net.test.ts > wide storage > counts one step per tick, holds when en is low, and wraps to 0 at 256
Error: unknown component: counter8
FAIL test/core/net.test.ts > wide storage > settles an 8-bit inverting ring that a delay8 breaks, and toggles the whole byte
CircuitValidationError: circuit is invalid: unknown-def
FAIL test/core/net.test.ts > wide storage > refuses a storage def that could never publish what it holds
AssertionError: expected [Function] to throw an error
FAIL test/core/registry.test.ts > base defs > marks exactly the storage elements as sequential
AssertionError: expected [ 'delay_line', 'mem1' ] to deeply equal [ 'counter8', 'delay8', …(4) ]
```
Note what passed in RED-1: the 1-bit ring (`nand` + `delay_line`) and both combinational-throw
tests, i.e. the contrast half of the oscillator class was already green against the old
kernel — which is what makes it a real contrast and not a second copy of the storage test.

### RED-2 — the structural pins that name the new exports

```
… test/core/defs-wide.test.ts test/core/net.test.ts test/core/registry.test.ts
```
→ log `task-4-red-2.txt`; exit 1, **24 failed | 114 passed (138)**, adding:

```
AssertionError: expected undefined to deeply equal [ 'mux8', 'delay8', 'reg8', …(2) ]   (WIDE_STORAGE_DEF_IDS)
TypeError: WIDE_STORAGE_DEF_IDS is not iterable                                        (both skip-set tests)
```

### GREEN — focused

```
… pnpm.mjs test test/core/defs-wide.test.ts test/core/net.test.ts test/core/registry.test.ts
```
→ log `task-4-green-focused.txt`; exit 0, **3 files passed, 139 tests passed**
(`defs-wide` 60, `net` 53, `registry` 26).

### GREEN — full suite, typecheck, build, smoke (final, against the committed tree)

| command | log | result |
|---|---|---|
| `… pnpm.mjs test` | `task-4-green-full.txt` | exit 0, **16 files / 373 tests passed** |
| `… pnpm.mjs exec tsc --noEmit` | `task-4-tsc.txt` | exit 0, no output (clean) |
| `… pnpm.mjs build` | `task-4-build.txt` | exit 0, `tsc --noEmit && vite build`, 32 modules, `dist/` written |
| `… pnpm.mjs smoke` | `task-4-smoke.txt` | exit 0, **2 passed** (level 1 end-to-end, progress survives reload) |

The three files I touched are the only ones whose test counts changed; all 234 pre-existing
tests elsewhere in the suite stay green, which is the evidence that `delay_line` and `mem1`
"keep behaving exactly as they do".

### Mutation checks (self-review, not required by the brief)

I temporarily broke the implementation three ways to confirm the new tests actually
discriminate, then restored from a backup and re-verified green:

* **Mutation A** — `#publishState` reverted to the pre-task body (`state[p]` → pin `p`):
  `task-4-mutation-A-legacy-publish.txt`, **139 passed, exit 0**. Honest finding: the
  pass is *not* load-bearing for any observable behaviour under the final design, because a
  storage def's `evaluate` republishes correctly in the settle that always follows `reset()`
  and `tick()`. Correctness now lives in the def; the pass is a pre-seed. See §11.
* **Mutation B** — `publishByte` mirrors its first input instead of publishing state (the
  exact phase-0 failure mode): `task-4-mutation-B-mirroring-publish.txt`, **8 failed**,
  including `holds its byte between the input flip and the next clock edge (latch)`,
  `delay8 publishes the byte it holds and never its inputs`, the counter tests and the 8-bit
  ring. The latch class is discriminating.
* **Mutation C** — `ram8.evaluate` publishes `d`: `task-4-mutation-C-ram8-mirrors-d.txt`,
  **4 failed**, including `is combinational on its read path and edge-triggered on its write
  path` and both 256-byte tests.

---

## 5. What is tested (kernel level, `test/core/net.test.ts`)

* **Publish**: a register's whole byte is readable after each tick (`0xa5, 0x5a, 0xfe, 0x01`);
  a hand-built 12-bit def with **two** state bytes publishing a byte-array `PortValue` proves
  the mechanism is not "eight bits wide" and not one-state-byte-deep; a `delay_line` widened
  by `params.width = 8` still publishes `0b00000001` (the resolved-width behaviour the old
  comment documented).
* **Latch (acceptance class 1)**: after `d` flips 0x3c → 0x00 *and* `load` drops to 0, and
  after `settle()`, the output is asserted to still read **0x3c** — the assertion between the
  flip and the edge that a wire cannot pass.
* **Oscillator (acceptance class 2)**: `nand` + `delay_line` and `not8` + `delay8` rings both
  `settle()` stable and toggle exactly once per tick (the 8-bit ring asserts 0xff/0x00, so a
  low-bit-only publish would show 0x01 and fail); the combinational twin of each (self-fed
  `nand`; `not8` → `switch8(on=1)` → `not8`) still throws `UnstableCircuitError`.
* **Counter (acceptance class 3)**: 1, 2, 3 on consecutive ticks; `en = 0` holds across
  settles and two edges; 252 further ticks reach 255; the next tick wraps to 0 and then 1;
  `reset` asserted with `en` on the same edge clears.
* **RAM**: write/read-back at 0x00, 0x10, 0xff and an unwritten address; address change with
  no edge; `d` never leaks; two instances keep separate memory; 256 distinct bytes at the def
  level (`(addr * 7 + 1) & 0xff`, so an aliasing or 128-byte store fails).
* **Capacity**: 200 `ram8` instances fed by 1-bit drivers compile at exactly `200 × 44` slots
  and settle.
* **Invariant**: `compile` rejects a `sequential`/`stateBytes`/no-`evaluate` def by name.

Def level (`test/core/defs-wide.test.ts`): the contract table (ids, pins, widths,
`sequential`, `stateBytes`, `cost`, `gateCost`, `clockEdge` presence), registry reachability
and `DEF_IDS` membership, `ram8`'s 256-byte state and its per-address distinctness,
`mux8`'s truth table, and the storage contract itself — every edge call asserts
`clockEdge` wrote **no** outputs, and every publish call passes inputs deliberately opposite
to the held state.

---

## 6. Files changed

```
src/core/defs/wide.ts       | 267 +++++++++++++++-
src/core/defs/index.ts      |  28 ++-
src/core/net.ts             |  60 ++++-
src/core/registry.ts        |   8 +-          (doc only)
test/core/defs-wide.test.ts | 273 +++++++++++++++-
test/core/net.test.ts       | 518 +++++++++++++++++++++++++++++++-
test/core/registry.test.ts  |  50 ++--
```
Logs and this report live under `.superpowers/sdd/2026-09-25-turing-complete-phase1/`, which
`.gitignore` deliberately keeps out of the repository (only `progress.md` is tracked); they
are on disk beside this report and are referenced by path above.

---

## 7. Self-review findings

1. **Stale header fixed.** `wide.ts`'s module doc said "every def here is pure combinational"
   — untrue the moment the storage family landed. Updated to describe both halves and to
   point at the storage section's notes.
2. **Overclaim removed.** My first draft of the `#publishState` comment said the old rule
   "silently truncated an eight-bit register". Mutation A proved that is too strong: for a def
   with an `evaluate`, the wrong write was corrected by the following settle and was
   invisible. Both that comment and the storage section note now say exactly that — the
   failure is fatal only for a def with no `evaluate` to correct it (which is why `compile`
   now refuses one).
3. **A wrong claim in a test comment** ("this doubles as the wide publish's regression") was
   rewritten: the tests pin the observable contract, not the pass's internals.
4. **`registry.ts` is outside the brief's file list.** The edit is documentation-only and
   exists because `ram8` makes the contract's literal wording ("must never read `inputs`")
   false; leaving it would have made the phase's hard constraint self-contradictory. No
   behaviour changed and `tsc`/tests are unaffected. Flagged here in case the controller
   wants it reverted or moved.
5. **Storage family is not width-generated**, unlike the operators. Documented and test-pinned
   on purpose: `stateBytes` is per instance and a `ram{w}` holds `2 ** w` bytes, so
   `createWideDefs`-style generation at 32 bits would allocate 4 GiB per RAM instance.
6. **`params.width` on a storage instance** narrows every pin at once (task 2's rule). A
   narrowed `reg8`/`ram8` publishes a value that no longer fits its output pin and throws
   `RangeError` from `assertWidth` — the same pre-existing behaviour as a narrowed `add8`, and
   `levels/checks.ts` already absorbs that as a failed check. Not changed here; noted for the
   level-authoring task.
7. `W = 8` is a local constant rather than `DEFAULT_WIDE_WIDTH`, so the ids (`reg8`) and the
   pin widths cannot desynchronise if the default ever changes.
8. Left `counter8`'s wrap as `& 0xff` (not `% 256`) and short-circuit `reset` before `en`,
   both branch-free and obvious at a glance; no allocation, no per-tick garbage.

---

## 8. Concerns

1. **The publish pass has no observable effect (mutation A).** Under the final design a
   storage def's `evaluate` publishes correctly during the settle that always follows
   `reset()`/`tick()`, so the pass is a pre-seed, not the correctness mechanism. I kept it
   (the brief asked me to extend the mechanism rather than remove it; it preserves the
   documented "held value visible right after reset/tick" ordering and seeds the first sweep
   with the held value) and documented it truthfully. If the controller prefers the strictly
   minimal kernel, deleting `#publishState` and its two call sites is a safe, test-neutral
   follow-up — the `compile` invariant is what makes that safe.
2. **`ram8` is `sequential: true` while its read path is combinational** (ruling 3), so
   `delayOf` cuts the path through it in both directions and a level whose critical path runs
   through a RAM read is charged **0** delay units. That follows the ruling and Global
   Constraint 4 literally, but it is a metric under-count the level-authoring task should know
   about when it sets `threeStar` targets. The *simulator* is unaffected: a ring through
   `ram8`'s address→output path is still evaluated every sweep and still throws
   `UnstableCircuitError` if it cannot settle.
3. **`gateCost = 0` for all four stateful parts** is inherited phase-0 precedent (storage is
   free on both metrics) and the brief gave no numbers for them. If the plan intends a
   `counter8`'s incrementer or a RAM cell to be priced into the gate metric, that is a
   deliberate change to `wide.ts`'s table and to `test/core/defs-wide.test.ts`'s
   `STORAGE_CONTRACT`, and it should be made once, centrally — I did not guess.

---

# 9. FIX ROUND 1 — response to the task-4 review

**Commit:** `171fd6c` — `fix(core): pin the publish pre-seed, align the compile guard, keep storage free`
(5 files, +211/−16; branch `phase1`, worktree `D:\Documents\turing-complete\.worktrees\phase1`)
**Logs of this round:** `task-4-fix-*.txt` beside this report; per-command index in
`task-4-fix-commands.txt`; commit message in `task-4-fix-commit-msg.txt`.
**Scope:** `src/core/defs/wide.ts` (comment), `src/core/net.ts`, `src/core/registry.ts` (comment),
`test/core/net.test.ts`, `test/core/registry.test.ts`. `src/levels/`, `src/ui/`, `src/app/` and
`src/core/defs/index.ts` were not touched; categories were not changed. The controller's
`progress.md` is left modified and is **not** in the commit.

The review approved the task (0 Critical). Nothing below changes a shipped def's behaviour: the
storage family's ids, pins, widths, edge rules and 0 cost are exactly as reviewed. §9.1 and §9.2
are the two rulings; §9.3–§9.6 are the four cheap improvements; §9.7 is the evidence block.

## 9.1 Ruling 1 — GC5's carve-out for `ram8.addr` (doc only, wording tightened)

No code change, and the `registry.ts` doc edit from task 4 is **kept**, as ruled. I applied the
cleaner wording the ruling offered, so the carve-out now reads as a rule with an exact boundary
rather than an exception with a caveat (`src/core/registry.ts`, `ComponentDef.evaluate`):

> The exception is exactly one input that only SELECTS among bytes already in `state`, and nothing
> else: a memory's read ADDRESS (`ram8.addr`), which is an index into `state`, never a value that
> could become the published byte — every byte it selects is one a clock edge wrote (see the def).
> Any second input read, or an address read as a value rather than an index, is the wire this rule
> forbids.

The important addition is the last sentence: the amended constraint now says what would *violate*
it, which is what makes it checkable rather than merely permissive. Mutation C (§9.3) is that
violation, and it is still red.

## 9.2 Ruling 2 — storage stays at 0 gate cost; the reasoning is now in the code

No code change: `gateCost` stays absent on `delay8`, `reg8`, `counter8` and `ram8`, so all four
fall back to `cost` = 0 on both metrics. The deliverable is the comment, and it is in exactly one
place — the storage section's `COST` note in `src/core/defs/wide.ts`, where the four defs are
declared — so a later reader cannot "fix" the pricing without deleting an argument that says why:

* the gate metric measures what the **player BUILT**, not what the **platform PROVIDES**: a
  built-in part is one of the primitives the player assembles, so it is not charged, while
  anything wired up out of those primitives is;
* that is what makes "drop in the unlocked part instead of rebuilding it" score better, so pricing
  a 256-byte `ram8` at its expansion — 2,048 stored bits at a latch cell of a few NANDs each,
  before a single address decoder is priced — would dwarf a level's whole gate budget and make any
  gate target involving storage meaningless;
* a player who wants storage to **cost** gates builds the latch from `mem1` and the gates on the
  palette, and pays for every one of them. So the incentive is intact, not inverted;
* the delay half (`cost` = 0, per Global Constraint 4, and the `?? cost` fallback shared with
  phase 0's `delay_line`/`mem1`) is stated in its own paragraph, so the two zeroes are not
  conflated.

I did not repeat the ruling's "~663,000 gates for cells alone" figure, because I could not
reproduce that arithmetic from the NAND basis in this file and would not put a number in the
source I cannot defend. The comment states the derivation it *can* defend (2,048 cells × a few
NANDs each, before decoders), which is enough to carry the argument.

## 9.3 Fix 1 — the three mutations re-run on the final tree, and the test that differs

All three mutations were re-applied to the **final** tree (`171fd6c`, i.e. the tests as they now
stand) and reverted afterwards; each log contains the focused run, and then the two candidate
tests for the count difference run *alone* under the same mutation.

| mutation | what was broken | old log (52 net tests) | **this round (55 net tests)** | only in this round |
|---|---|---|---|---|
| **A** | `#publishState` reverted to the pre-task `state[p]` → pin `p` body | 138 passed, exit **0** | **2 failed** / 139 passed, exit 1 | the two new `pre-seeds …` tests |
| **B** | `publishByte` mirrors its first input instead of publishing state | 8 failed (3 + 5) | **9 failed** / 132 passed, exit 1 | 3 + 6; the 9th is the new tick test |
| **C** | `ram8.evaluate` publishes `d` | 4 failed (2 + 2) | **4 failed** / 137 passed, exit 1 | identical set |
| **D** (extra) | `#publishState` deleted at both call sites | — | **2 failed** / 139 passed, exit 1 | the two new `pre-seeds …` tests |

**The test that differs, named.** It is
`test/core/net.test.ts > wide storage > publishes a multi-byte storage def through the same path`
— the 12-bit `reg12` holder with two state bytes. It was added to `net.test.ts` after the old
mutation runs and before the old GREEN run, which is the whole of the 52-vs-53 mismatch (and why
the old §4 line "mutation A: 139 passed" contradicted its own 138-test log: that 139th test did not
exist yet when the log was written).

This is settled from the artefacts rather than from memory: the four pre-commit logs that cover the
52-test tree (`task-4-red-1`, `task-4-red-2`, `task-4-mutation-B`, `task-4-mutation-C`) are all
**verbose** — 129..157 per-test lines each — and the string `multi-byte` occurs **zero times** in
all four, while `publishes a 1-bit storage def across a pin an instance widened` occurs exactly
once in each. So the review's other candidate (the widened 1-bit publish test, `net.test.ts:776`)
was already present in the 52-test tree, and the extra test is the 12-bit one.

**Is it indifferent to A/B/C? Yes — and that is now shown, not assumed.** It is run alone under
each of the three mutations (three `EXIT=0` results, one per log). The reason is structural: it
registers its own `reg12` test def, so no shipped def's publish body is in the picture at all, and
every assertion is read *after* a settle, which republishes through `evaluate` whatever the pass
did or failed to do. So the reviewer's read was right on the substance, and the count mismatch is
now explained and named instead of left standing.

**One honest delta in mutation B.** The old log had 8 failures; this round has 9. The extra failure
is the new `pre-seeds the held byte … after a tick` test, and it fails there at its *earlier*
`no edge yet` assertion (a mirroring delay publishes its input on every settle, edge or not), not
at the pre-seed assertion it exists for. That is B breaking the storage contract more visibly, not
a new claim about B.

## 9.4 Fix 2 — `#publishState` is now observable, and pinned

The controller kept the pass and asked for a test that would fail if it were removed or broken. The
**first thing to say honestly** is where the observable can and cannot be: after `reset()` and after
`tick()` the settled table holds the held value *either way*, because both end in `settle()`, which
republishes through each def's `evaluate`. No read performed after those calls can tell the pass
from its absence. The only place the pass has an effect is **inside** the settle that follows: it
writes the held value into the table *before* the first sweep, so the first sweep reads the
post-edge value rather than the pre-edge one. That is the documented ordering — "a caller reading
right after `reset`/`tick` sees the held value without waiting on the sweep" — and it is what the
two new tests observe.

* `test/core/net.test.ts > wide storage > pre-seeds the held byte into the table before the settle
  that follows a tick` — one `delay8` (so `publishByte`, so a shipped def) feeding a test def
  (`watcherDef`) that records the value it reads on every sweep. After `sim.tick()`, `seen[0]` must
  be the held `0xa5`; the same fact is read a second way by asserting the settle needed **2**
  iterations instead of 3. If the pass is reverted to the legacy body or deleted, `seen[0]` is
  `0x00` and the settle takes 3 sweeps (§9.3 A and D), while every pre-existing storage test stays
  green — which is exactly the gap the review found.
* `test/core/net.test.ts > wide storage > pre-seeds a storage output whose zeroed state publishes a
  1, before reset() settles` — the reset half, which needs an invented def and says why in its
  comment: `reset()` zeroes the table *and* the state, so a def that publishes 0 from a zero state
  (`delay8`, `reg8`, `counter8`) has nothing to pre-seed into an already-zero slot and the pass is
  invisible. The new test def `latch_not` publishes the **complement** of the bit it holds, so the
  first sweep of `reset()`'s settle reads 1 with the pass and 0 without it. It is a legal storage
  def (`evaluate` reads `state`, never an input) and only exists to make the reset ordering
  observable.

Both tests are red under mutation A and under mutation D. Under C both are green; under B the
tick test is red (a mirroring delay is wrong on every settle, §9.3) while the reset test stays
green, because it uses its own `latch_not` def and never goes through `publishByte`. So the pass
is no longer inert-by-test: it cannot be deleted (D) or reverted (A) without a red test, which was
the controller's condition for keeping it. Nothing else in the suite depends on it — 139 of 141
tests still pass under D — so the pass is load-bearing for exactly the property it documents and
for nothing else, which is now a measured statement rather than a claim.

## 9.5 Fix 3 — the new `compile` guard joins the error taxonomy

`net.ts` already imported `CircuitValidationError` (line 1, from `./errors`), so **no new
dependency and no cycle** was created; the guard now throws it instead of a plain `Error`, with one
error-severity issue that names the instance and the def:

```ts
throw new CircuitValidationError([
  { severity: 'error', code: 'invalid-params', inst: inst.id,
    message: { zh: `${def.id}: 存储元件必须声明 evaluate() 才能发布其所存的值`,
               en: `${def.id}: a storage element must declare evaluate() to publish what it holds` } },
]);
```

Consequences, both checked:

* `levels/checks.ts` absorbs `CircuitValidationError` as `'invalid'` and `UnstableCircuitError` as
  `'unstable'`, and re-throws everything else, so a def-authoring mistake now becomes a failed
  `'invalid'` check like every other compile refusal — the path
  `test/levels/checks.test.ts:112` ("reports an unbuildable circuit as a failed outcome instead of
  throwing") already pins for unknown defs. That file needed no change and was not touched.
* `CircuitValidationError`'s message is only the list of codes, so the **diagnosis lives in the
  issue's message**, and the def name is still in the refusal. The test that pinned the old
  behaviour by message regex (`refuses a storage def that could never publish what it holds`) was
  updated to assert the type, the single issue, `inst`, and that the message names both the def and
  `evaluate` — strictly more than the regex checked.

`code: 'invalid-params'` is a judgement call: the taxonomy has no "the def itself is broken" code,
and the code list lives in `graph.ts`, which is outside this task's scope. `invalid-params` is the
closest ("this instance's declaration cannot be compiled"), and the comment in `net.ts` records the
choice so the next reader does not have to guess. If the controller would rather have a new
`storage-def-without-evaluate` code, that is a one-line change in `graph.ts` plus this literal —
say the word and I will do it in a follow-up rather than reach outside the scope now.

## 9.6 Fix 4 — `stateBytes` exactness restored for the Phase-0 pair

`test/core/registry.test.ts`, in "gives every def a publisher, and sizes storage honestly": the
inequality (`stateBytes * 8 >= outputBits`) stays as the wide/RAM rule, and `delay_line` and `mem1`
are additionally pinned to **exactly 1 state byte and exactly 1 output pin**, by def id rather than
by category filter (the category question is the controller's, separately). Phase-0 exactness is
therefore not traded away for `ram8`'s 256 bytes.

## 9.7 Evidence — covering files, exact commands, output

Covering test files: `test/core/net.test.ts` (all of §9.3–§9.5, 53 → 55 tests),
`test/core/registry.test.ts` (§9.6, 26 tests, unchanged count), `test/core/defs-wide.test.ts`
(unchanged, run as the regression for the comment-only `wide.ts` edit, 60 tests). The comment-only
edits in `src/core/defs/wide.ts` and `src/core/registry.ts` carry no behaviour and are covered by
`tsc` plus the full suite.

`<NODE> <PNPM>` below is the pair given in `task-4-fix-commands.txt` (pnpm is not on PATH).

| command | log | result |
|---|---|---|
| `<NODE> <PNPM> test test/core/defs-wide.test.ts test/core/net.test.ts test/core/registry.test.ts` | `task-4-fix-green-focused.txt` | exit 0 — **3 files, 141 passed** (registry 26, defs-wide 60, **net 55**) |
| `<NODE> <PNPM> test` | `task-4-fix-green-full.txt` | exit 0 — **16 files, 375 passed** (373 before this round: +2 tests, none deleted); the log ends with a second identical run made after the mutations were reverted |
| `<NODE> <PNPM> exec tsc --noEmit` | `task-4-fix-tsc.txt` | exit 0, no output (clean) |
| `<NODE> <PNPM> build` | `task-4-fix-build.txt` | exit 0 — `tsc --noEmit && vite build`, 32 modules, `dist/assets/index-DGTrH-9z.js` 52.36 kB |
| mutations A / B / C / D (focused command of row 1 after each edit, reverted after each) | `task-4-fix-mutation-A-legacy-publish.txt`, `task-4-fix-mutation-B-mirroring-publish.txt`, `task-4-fix-mutation-C-ram8-mirrors-d.txt`, `task-4-fix-mutation-D-pass-deleted.txt` | exit 1 each, by design — 2 / 9 / 4 / 2 failures, tables in §9.3 |
| `git status --short` after the last revert | (inline in `task-4-fix-green-full.txt`) | only `.superpowers/…/progress.md` modified — the controller's ledger, deliberately uncommitted |

## 9.8 Notes for the scoped re-review

* **No behaviour of a shipped def changed.** The only `src/` behaviour edit is the *type* of the
  `compile` refusal for a def that could not publish (unreachable for every shipped def, since all
  six storage defs declare `evaluate`), plus two comments. Everything else this round is tests.
* **The old report's contradiction is corrected here, not quietly dropped**: §4's "mutation A: 139
  passed" was wrong; its log said 138, and the missing test is named in §9.3.
* **Mutation D is extra** (not one of the three re-runs) and exists solely to answer the
  controller's Fix-2 condition: the pass can stay *because* deleting it is now red.
* **Storage `gateCost` deliberately still absent** on all four defs (§9.2) — please do not treat
  the added comment as a request to price them later; it says the opposite, with the argument.
* The `wide.ts` storage-section note and the `registry.ts` carve-out are the only files where the
  ruling text landed, so a re-review that reads those two comments has read the whole ruling
  response.

# Comment correction (post re-review)

**Commit** `3fc19cf` "docs(core): make the free-storage premise match gateCost()", branch `phase1`,
worktree `D:\Documents\turing-complete\.worktrees\phase1`. Comment-only: `src/core/defs/wide.ts` and
`src/core/net.ts`. No `gateCost`, `cost`, `category` or any other value changed; storage stays 0 on
both metrics, the ruling stands, and nothing was priced.

## What was wrong

1. `src/core/defs/wide.ts:840-842` stated the premise as "a built-in part is one of the primitives the
   player assembles, so it is not charged, while anything wired up out of those primitives is".
   `gateCost()` (`src/levels/grader.ts:44-52`) sums `def.gateCost ?? def.cost` over **every** placed
   instance, and the built-in primitives state counts (in the `gateCost` table of
   `src/core/defs/index.ts`: `nand` 1, `not` 1, `and` 2, `or` 3; in `wide.ts`: `and8` 16, `add8` 72).
   Being built in is not what makes a def free, so the premise was false.
2. `src/core/defs/wide.ts:846-848` told a player who wants storage to cost gates to build the latch
   "from `mem1` and the gates on the palette" -- but `mem1` *is* a 0-gate built-in storage element
   (`index.ts:213-224`: `cost: 0`, no `gateCost`), so it cannot make storage cost anything.
3. (optional item, taken) `src/core/net.ts:236-239` said the def-broken diagnosis "lives" in the
   issue. That is true of the thrown `CircuitValidationError`, not of the path the guard serves: both
   level-checker paths collapse it -- `createSim` returns a bare `{ error: 'invalid' }`
   (`levels/checks.ts:402`) and `runChecks` pushes `failure(check, {}, {}, {}, tick, 'invalid')` with
   no issue attached (`levels/checks.ts:315`).

## New wording

`wide.ts`, the storage family's COST paragraph:

> COST: FREE ON BOTH METRICS, AND THAT IS A RULING RATHER THAN AN OVERSIGHT. The gate metric measures
> what the PLAYER BUILT, not what the platform PROVIDES, and being built in is NOT what makes a def
> free: `gateCost()` charges every placed instance the count its def states, and the built-in
> primitives state counts like anything else -- `nand` 1, `not` 1, `and` 2, `or` 3 (the basis table in
> `defs/index.ts`), `and8` 16, `add8` 72 (above). What is free is the `?? def.cost` fallback, and that
> fallback is 0 for exactly four kinds of def: a rail, a level connector, a wire-like packer
> (`splitter`, `maker`), and a STORAGE ELEMENT. Storage is that fourth exception, not built-in parts
> generally. That storage exception is what makes dropping in the unlocked part score better than
> rebuilding it from gates, and it is why a 256-byte `ram8` is 0 NAND equivalents rather than its
> expansion -- 2,048 stored bits at a latch cell of a few NANDs each, before a single address decoder
> is priced -- which would dwarf a level's whole gate budget and make any gate target involving
> storage meaningless. A player who wants storage to COST gates builds the latch from palette gates
> instead -- the cross-coupled pair is two `nand`s or two `nor`s, plus whatever gates the enable and
> write logic need -- and pays for every one of them. So `gateCost` stays ABSENT on `delay8`, `reg8`,
> `counter8` and `ram8`; pricing them is not an improvement to make later.

The four-kind clause is the same list, in the same words, as `grader.ts:38-39` ("a rail, a level
connector, a wire-like packer, a storage element"), so the two comments now state one rule.

`net.ts`, the refusal guard's last paragraph:

> ... the closest existing code is used -- and the ISSUE names the def, so the diagnosis is in the
> error's own `issues`: `CircuitValidationError`'s message is only the list of codes. That detail
> survives wherever the throw is caught directly; the level checker collapses it -- `createSim` maps
> it to a bare `{ error: 'invalid' }` and `runChecks` pushes a failure with no issue attached
> (`levels/checks.ts`) -- so nothing in that path names the def.

One sentence beyond the two named defects was re-scoped: "That is what makes 'drop in the unlocked
part instead of rebuilding it' score better" is true of storage (0 gates vs. a built latch) but not
of gates generally (an `add8` costs its declared 72 either way), so it now reads "That storage
exception is what makes dropping in the unlocked part score better than rebuilding it from gates".
Flagging it because it is a wording change the brief did not ask for; the claim is now scoped, not
strengthened.

## Commands and output

`<NODE> <PNPM>` are the absolute paths from `load_workspace_dependencies`. They must be invoked as
`& "<node.exe>" "<pnpm.mjs>" ...`: the bare `node` on this PATH (`C:\Program Files\nodejs\node.exe`)
does not launch `pnpm.mjs` -- it dies with a `SyntaxError: Invalid or unexpected token` on an `MZ`
header, i.e. node's own image read as a script. Same family of breakage as the `pnpm` wrapper.

| command | result |
|---|---|
| `& <NODE> <PNPM> test test/core/defs-wide.test.ts test/core/registry.test.ts` | exit 0 -- **2 files, 86 passed** (defs-wide 60, registry 26); `Duration 334ms` |
| `& <NODE> <PNPM> exec tsc --noEmit` | exit 0, no output (clean) |
| `git show --numstat --format='%h %s' HEAD` | `3fc19cf docs(core): make the free-storage premise match gateCost()`; `16 9 src/core/defs/wide.ts`, `6 2 src/core/net.ts` -- 2 files, 22 insertions / 11 deletions, comments only |
| `git status --short` | ` M .superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` -- the controller's ledger, left modified and deliberately **not** committed |
