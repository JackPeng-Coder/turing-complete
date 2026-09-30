# Phase 2 ledger — 第 3 章「CPU 架构 OVERTURE」

Plan: `docs/superpowers/plans/2026-09-29-turing-complete-phase2.md`
Spec: `docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
Predecessor: `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`

**How this ledger was reconstructed.** Phase 2 was executed in a session that ran out of
credit mid-phase and ended with a bulk commit (`5029bac 没钱了，先推送一下`) that mixed the
session archive with three chapter-3 batch files. It left no ledger at all — this directory
did not exist. The record below was rebuilt from the git history, the plan, the code and the
test suites, and the rulings are the ones the code actually implements. Where a ruling was
made during execution and is visible only in the code, it is marked RECONSTRUCTED and says
what it is read from.

## Where phase 2 actually stopped

| Task | Deliverable | State |
|---|---|---|
| T1 recon | `recon-kernel.md` | **MISSING** — never written; the mechanism it was to document exists and works (`params.image` into `ram_prog`), so the plan's T2/T4 design was not blocked in practice. Not reconstructed: the conclusions would be a reading of the code as it now stands, not the recon that informed the design. |
| T2 CPU defs | `src/core/defs/cpu.ts`, `defs/index.ts`, `test/core/defs-cpu.test.ts` | done (774-line test) |
| T3 assembler | `src/asm/{isa,assemble,index}.ts`, `test/levels/asm.test.ts` | done |
| T4 `program` check | `levels/spec.ts`, `levels/checks.ts`, `core/net.ts`, `test/levels/program-check.test.ts` | done |
| T5 ch3 batch 1 | `ch3/batch1.ts`, `test/levels/ch3-batch1.test.ts` | done (levels 39-41) |
| T6 ch3 batch 2 | `ch3/batch2.ts`, `test/levels/ch3-batch2.test.ts` | done (levels 42-44) |
| T7 ch3 batch 3 | `ch3/batch3.ts`, `test/levels/ch3-batch3.test.ts` | done (levels 45-47) |
| T8 assembly + unlock | `ch3/index.ts`, `content/index.ts`, the two whole-set tests | **WAS MISSING** — finished in this session |
| T9 phase close | full suite, tsc, build, smoke, ledger, final review | **DONE** — this session |

The failure mode T8 represents is worth naming because the repository has now paid for it
twice. `content/index.ts` is the ONLY join between chapters. Chapter 2 once shipped 22 of its
26 levels written and unreachable; chapter 3 repeated it exactly — all nine levels written,
compiling, and passing their own three batch tests, while `content/index.ts` never named the
chapter. A batch test cannot catch it: it imports its batch by path, so it passes whether or
not the chapter is ever appended. Only the whole-set walks see it.

## Rulings (plan §「本阶段的范围裁决」, plus those made during execution)

1. **The assembler splits into kernel (now) and UI (phase 3).** Plan ruling 1. The `asm`
   module is the finished text→bytes kernel; the editor and debugger panel are phase 3.
   Cost if wrong: the player can play the Program level but cannot type their own assembly.
2. **`program` is a new check kind, not a `custom` entry.** Plan ruling 2. Cost if wrong: the
   same driving logic triplicated into the level layer, i.e. the engine hidden in the levels.
3. **`regfile6` is a 2-read/1-write 6×8 file with per-register conditional write; the engine
   provides no instruction semantics.** Plan ruling 3. Cost if wrong: level 40's source
   concept (register-to-register copy) is displaced into levels 42/43.
4. **Level 41 is rebuilt as control fan-out.** Plan ruling 4. Blueprints (spec §3.4) are
   phase 3, so the source's "encapsulate a circuit" goal is met with parts that exist now.
   Recorded as `AUTHORED` in the level data, alongside chapter 2's levels 15/23/34.
5. **Instruction word layout is this replica's design.** Plan ruling 5. The source fixes
   "high 2 bits opcode, low 6 bits argument" and the four modes but gives no field bit order.
   The layout the code implements: `loadi` 00 (imm[5:0]), `calc` 01 (`[5:3]` op, `[2:0]`
   reserved zero), `move` 10 (`[5:3]` src, `[2:0]` dst), `jump` 11 (`[5:3]` cond, `[2:0]`
   reserved zero); operands 0-5 = REG0-REG5, 6 = `inp`, 7 = `out`. Cost if wrong: the field
   bit order is invented; every level comment says so.
6. **RECONSTRUCTED — the `alu8` op numbering is the ISA's, linearly.** `isa.ts` numbers the
   six `calc` mnemonics `{ add: 0, sub: 1, and: 2, or: 3, nand: 4, nor: 5 }`; `alu8`'s `op`
   pin implements exactly that table, with 6 and 7 publishing 0 so the op map is total.
   `test/core/defs-cpu.test.ts`'s independent `ALU_REFERENCE` table is what pins it.
7. **RECONSTRUCTED — level 39's three selector pins are the ISA field's three bits.** Pin
   `opN` is bit N, so the code is `op0 + 2*op1 + 4*op2`. This is stated at the level's `fuzz`
   expectation and is what the reference circuit must implement. See ruling 8.
8. **The level-39 contract had to be re-derived from hardware, and the derivation itself is
   the finding.** Detailed below; it is the most expensive defect of the phase.

## Defects found and fixed in this session

### D1 — level 39 contradicted the part it rewards (four of eight op codes)

`aluOp` in `ch3/batch1.ts` is the level's expectation, and the level's own `fuzz` check builds
its expected value by CALLING `aluOp`. So the expectation and its generator were the same
function: whatever encoding mistake they shared could not be caught by grading the circuit
they were checked against. The mistake they shared was real — the function's spare-code guard
read `op2 === 1 && op0 === 0`, true for codes 4 and 5 (NAND and NOR) and false for 6 and 7
(the actual spares), i.e. inverted on both counts. A player who dropped the `alu8` this level
REWARDS into the level was marked wrong on half the codes.

What caught it was the reference circuit in `test/fixtures/ch3-references.ts` — wired from
gates and muxes and therefore holding no opinion — once it was registered into the whole-set
walks (`grader.test.ts`, `level-buildability.test.ts`) that T8 had left unwired.

Getting from there to a correct circuit took several wrong turns, and the record is the point,
because each wrong turn looked verified at the time:

- Each of the three components (`aluOp`, the reference circuit, `alu8`) was consistent with
  itself, so "fix the odd one out" was not decidable by reading. Two of the three agreed by
  construction (the expectation and its generator), which made the majority wrong.
- All six assignments of "class / select / invert" to the three op bits were tried against the
  registered `alu8`; **all six mismatched**. The correct conclusion was not that a seventh
  assignment would work but that the map is a table, not a bit-field recipe, and the level
  expectation must therefore BE the table. `aluOp` is now a `switch (op & 7)` over the ISA's
  six operations plus two zeroes, which matches the registered `alu8` over all 524,288
  `(op, a, b)` triples.
- The reference circuit's control inputs then had to be routed pin by pin. Fixing the class
  bit and the inverter while leaving the arithmetic selector on the wrong pin produced a
  circuit that passed codes 5, 6 and 7 and failed 1-4 — a shape that reads like progress and
  is not. What finally resolved it was measuring the circuit's answer for all eight pin
  combinations at once and comparing that table against the ISA table, rather than reasoning
  about one wire at a time.

**Standing lesson, recorded because it generalises:** a check whose expectation is produced by
the same code that is being checked proves nothing. `checks.ts`'s `fuzz` and the level's
`outputs` are necessarily coupled here (the level must state what it expects), so the
decoupling has to come from a second, independent statement of the contract — the reference
circuit and the registered component. Both now exist, and both are graded.

### D2 — chapter 3 was unreachable (see T8 above)

Fixed by adding `src/levels/content/ch3/index.ts` and appending `CH3_LEVELS` to
`content/index.ts`. Pinned by a chapter-3 block in `unlock-chain.test.ts` (nine levels at
indices 39-47, the join point in order, and the six machine parts handed out one per level in
build order) and by a chapter-3 whole-set walk in `level-buildability.test.ts`.

### D3 — the whole-set registries did not know chapter 3 existed

`REFERENCE_SOLUTIONS` (`level-buildability.test.ts`) and `shippedReference`
(`grader.test.ts`) both stopped at chapter 2, so every chapter-3 level failed "no reference
solution filed" the moment the chapter became reachable. Fixed by spreading `CH3_REFERENCES`
into both. That is 27 red tests which were invisible while T8 was undone — the same reason the
defect survived to the end of the phase.

### D4 — `unlock-chain.test.ts`'s chapter-2 join assertion was unbounded

`expect(LEVEL_ORDER.slice(12)).toEqual(CH2_LEVELS...)` ran to the END of the order, so it
silently became "chapter 2 plus everything appended after it" the moment chapter 3 landed. It
is now bounded at both ends (`slice(12, 38)`), and the chapter-3 equivalent is bounded too
rather than relying on being last. The comment in the test records why: the unbounded form is
exactly the assertion that cannot notice a later chapter.

### D5 — the session transcript in the commit was a different session's

`docs/session-archive/session.v4.jsonl` as committed in `5029bac` was 13,987,303 bytes /
3,869 lines of session `55a385c3`. The file of the same name left in the working tree was
2,251,418 bytes / 413 lines of session `e5d36c2c` — `origin: "subagent"`, `delegationDepth: 1`,
run from `C:\Users\Administrator\Desktop\turing-complete` — i.e. one subagent's own log had
overwritten the main transcript under the same filename. Both are now preserved under distinct
names (`session.v4.jsonl`, `session-e5d36c2c-asm-builder.jsonl`). The undo used
`git reset --mixed` rather than `--hard` precisely so the working-tree file was not destroyed;
all eight code files were then confirmed byte-identical to the commit by git blob hash.

## Evidence

- `test/core/defs-cpu.test.ts` — 774 lines; the six CPU parts against an independently written
  contract table and an independent ALU reference over all eight ops.
- `test/levels/asm.test.ts` — round-trips per instruction, forward label reference, and
  line-located errors.
- `test/levels/program-check.test.ts` — the `program` check kind, including the
  `missing-program` hard failure (the `missing-rows` lesson).
- `test/levels/ch3-batch{1,2,3}.test.ts` — per-batch references, three-star targets pinned to
  measured metrics, and counterexample circuits that must fail.
- `test/levels/unlock-chain.test.ts` — spec §3.3's rows parsed from the markdown at run time
  and compared with the level data in both directions; chapter-3 block added.
- `test/levels/level-buildability.test.ts` — every shipped level's reference builds from the
  palette that level offers; chapters 1/2/3 held to their index ranges.

## Defects found and fixed while closing the phase (T9)

Chapter 3 shipped with all nine levels written, compiling, and passing their own batch tests. It
had never been graded as a CHAPTER, because T8 was not done. Registering it in the whole-set
walks turned 27 tests red and exposed the following, in the order they surfaced.

### D2 — every level-39 op above code 3 was graded against the wrong function

`aluOp` in `ch3/batch1.ts` is the level's expectation, and the level's own `fuzz` check builds
its expected value by CALLING `aluOp`. Expectation and generator were therefore the same
function, so no encoding mistake they shared could be caught by grading the circuit they were
checked against — and the mistake was real. The spare-code guard read
`op2 === 1 && op0 === 0`: true for codes 4 and 5 (NAND and NOR) and false for 6 and 7 (the
actual spares), i.e. inverted on both counts. A player who dropped in the `alu8` this level
REWARDS was marked wrong on half the codes.

`aluOp` is now a `switch (op & 7)` over the ISA's six operations plus two zeroes, and it agrees
with the registered `alu8` over all 524,288 `(op, a, b)` triples. What made this expensive to
find is worth recording:

- **A bit-field recipe for this ALU does not exist.** All six assignments of
  "class / select / invert" to the three op bits were tried against the registered `alu8` and
  **all six mismatched**. `alu8` decodes the op into five control lines and composes them, so
  the op→function map is a TABLE, not a reading of the bits. Several rounds were spent looking
  for the right assignment before that was accepted.
- **The level's pin assembly and the reference circuit disagreed about bit order.** The pins are
  the ISA field's bit positions (`op = op0 + 2*op1 + 4*op2`); the level assembled them as the
  reverse for a while. The reference circuit, wired from gates, is what settled it.
- **The reference circuit itself was wrong**, and was rebuilt by a delegated teammate after the
  Lead's own one-hot construction was measured wrong (`not(nand(nand(t0,t1),t2))` is
  `~(t0&t1)&t2`, not a 3-input AND — verified: it differs from `AND3` on 4 of 8 rows). The
  rebuilt mux tree is 273 gates / delay 5 and passes 524,288 exhaustive assertions with 0
  mismatches.
- **New permanent regression test**: `ch3-batch1.test.ts` → "the level expectation agrees with
  the ALU this level rewards" compares `aluOp` against the registered `alu8` directly, over
  every op and a dense operand set. Mutation-checked: breaking `aluOp`'s `sub` case makes it
  fail on `op=1 a=0 b=1`.

### D3 — chapter 3 was unreachable

`content/index.ts` never named `CH3_LEVELS`, so all nine levels were written and no player could
reach any of them. Fixed by adding `src/levels/content/ch3/index.ts` and appending it. A batch
test cannot catch this — it imports its batch by path and passes either way; only a walk from
the app's own level list can. This is the SECOND time the repository has paid for it (chapter 2
shipped 22 of 26 levels unreachable the same way), and `content/index.ts` now records both.

### D4 — the whole-set registries did not know chapter 3 existed

`REFERENCE_SOLUTIONS` (`level-buildability.test.ts`) and `shippedReference` (`grader.test.ts`)
both stopped at chapter 2, so every chapter-3 level failed "no reference solution filed" the
moment the chapter became reachable. Fixed by spreading `CH3_REFERENCES` into both. 27 red tests
that were invisible while T8 was undone.

### D5 — level 40's reference was wrong in four independent ways

Every one of these would have failed the level alone, and none was visible without running it:

1. its stores were `mem1` cells wired `from: ['data', gate]`, and `build()` wires pins in
   DECLARATION order — `mem1` declares `set` first and `value` second, so the store latched on
   the data bit and the write gate did nothing;
2. `dec.b0`..`dec.b7` were addressed as if `decoder3` published eight 1-bit pins. It publishes
   ONE 8-bit `out`; `validateGraph` reported eight `unknown-port` issues and all eight AND gates
   lost their `b` input to `dangling-input`;
3. the read tree used `mux8` to select single BITS and took its selects from a splitter on
   `addr`, while the write path decoded the same address through `decoder3` — two readings of
   one signal in one circuit;
4. its `level_output` declared no width, so it compiled at 1 bit, `bindLevelIo` refused to bind
   it, and every failure collapsed into the same uninformative `missing-io`.

Rebuilt on `reg8` with the read select taken from the SAME `decoder3` one-hot lines the write
path uses. Measured 267 / 3 / 8.

### D6 — level 40's script could not be satisfied by ANY correct register bank

`driveSteps` (`levels/checks.ts`) has two properties that are not the obvious reading, and the
script violated both. **`d2f`/`ch2/batch4.ts` already documents them**; batch 1's author did not
follow that note:

- **Every input a step does not name is written as ZERO.** Inputs do not persist between steps.
- **`tick` is an ABSOLUTE target**: `while (io.sim.tickCount < step.tick) io.tick()`. A run of
  steps that all say `tick: 1` produces exactly ONE edge at the first of them and none after —
  so a script written as a sequence of `tick: 1` steps silently stops clocking. The rewritten
  script counts up instead (1..8).

The script also has to respect `reg8.load` being combinational: `driveSteps` settles between
writing a step's inputs and advancing the clock, so the edge that lands a byte is the one whose
step carries `we = 1`, and the read must be a later tick with `we = 0`. Mutation-checked:
making the write enable irrelevant (`g0 = sel.b0 AND sel.b0`) fails two tests.

### D7 — level 41's reference bound neither output

Its instance names were `a` and `b`, but `bindLevelIo` looks for `OUT_a` / `OUT_b` on a
multi-output level. Both outputs read 0 on every step. Chapter 2's multi-output references spell
it `OUT_sum` / `OUT_cout`. One-token fix.

### D8 — the three batch-1 palettes omitted their own connectors

`allowedComponents` for levels 39-41 listed neither `level_input` nor `level_output`, which
`level-buildability.test.ts` reports as "uses `level_input`, which its palette does not offer" —
and which the batch-1 test could not see, because it skips connectors explicitly. Batches 2 and
3 spread a `LEVEL_IO` constant; batch 1 now does too.

### D9 — a kernel change that was tried and reverted

Making `Simulation.tick()` settle before sampling looked like the right fix for D6, and it is
not wrong about values (`tick`'s trailing settle republishes through `evaluate` either way). It
changes the NUMBER of sweeps, and two committed tests in `test/core/net.test.ts` observe the
first sweep directly, because `#publishState` is a pre-seed that carries the held byte into the
table before the sweep begins. The ordering belongs to the caller, and `net.ts` now says so.
Recorded because the same temptation will recur: D6 reads like a kernel bug and is a level-data
bug.

## Chapter-3 level provenance

As with chapter 2, the compendium supplies only each level's name (both languages), its index,
and one line of concept. Ports, widths, pass conditions, targets and rewards are this replica's
design and are marked `SOURCED` / `AUTHORED` in each level's data. Three levels are knowingly
rebuilt rather than reproduced:

- **41** (Component Factory): blueprints are phase-3 work, so the source's "encapsulate a
  circuit" goal is met as control fan-out. Recorded in the level data and in ruling 4.
- **40** (Registers): the source's concept is register-to-register copy, which is an
  instruction-layer idea; this level builds the addressable bank that idea stands on, per
  ruling 3.

## Open / deferred

Closed in the phase-close pass that followed this ledger (commit `4a6e0b9` onwards):
- **Level 39's stale bit roles — FIXED.** Its brief (zh/en) had `op2` and `op0` the
  wrong way round, and the comment above its `out` expectation repeated the same transposition.
  Its hint was always correct, which is what made the brief's error easy to miss: two of the
  three prose blocks agreed with the code and one did not. The roles are now derived and stated
  the same way everywhere — `op1` is the CLASS (bit 1, the twos bit), `op0` picks inside the
  class (bit 0), `op2` inverts (bit 2), and the spares are `op1 AND op2` (codes 6, 7). Verified
  against the encoding table before editing, not by reading the old prose.
- **`test/fixtures/build.ts`'s two naming conventions — DOCUMENTED.** A part's `id` in a
  declaration list is a BUILD-TIME name: `addInstance` is called without a name for parts, so
  the graph holds `i1`, `i2`, `i3`.. and `partIds` is the map between them. `from: ['g0', ...]`
  therefore works while `g0` never appears in `graph.instances`, and
  `net.outputBase('<Node.id>.<pin>')` does not address such an instance — the error reads as a
  typo in a pin name. Level inputs and outputs ARE named, because `checks.ts` binds them by id,
  so both conventions coexist by design. The doc comment now says all of this.

Still open, and deliberately so:

- **T1's recon document was never written, and is NOT reconstructed.** This is a decision
  rather than an omission. T1 existed to answer three questions about the kernel before Task 2
  designed against it, and the answers are now recorded here directly, because the phase's own
  documentation got one of them wrong and that is worth pinning:

  1. **Does `compile()` read instance `params`?** It reads `params.width`, through
     `effectiveWidth` (`inst.params.width ?? pin.width`) — the Phase-1 mechanism every wide
     instance depends on. It does NOT read `params.image`.
  2. **How are state slots allocated?** Per def, from `def.stateBytes`, at compile
     (`new Uint8Array(i.def.stateBytes)` per compiled instance). `compile` refuses a def that is
     `sequential && stateBytes > 0` without an `evaluate`, because a storage element that cannot
     publish what it holds is a silently dead part.
  3. **Does `reset()` erase a loaded image?** Yes — and this is the answer that matters, because
     it decides the ORDER of the two calls. The program image reaches `ram_prog` through
     `Simulation.loadImage(instanceId, bytes)`, a run-time entry point called by the `program`
     checker (`levels/checks.ts`), NOT through `params.image` and NOT at compile time.
     `loadImage`'s own comment says "must be called AFTER `reset()`", and it zeroes the whole
     state before copying so a shorter image after a longer one cannot leave a tail behind.

  **The plan's Task 1 and Task 4 both say `params.image` is the path** ("`params.image` →
  `ram_prog` 初始状态", "编译产物写入 `ram_prog` 实例的 `params.image` 之后再 `compile`"). That is
  not how it was built and not how it should be: a compile-time parameter would be erased by
  the `reset()` that precedes every check, which is precisely the hazard T1 was written to
  find. The recon was never written, so nothing recorded the correction — the implementation
  found the right mechanism and the plan was never updated. This ledger is the record.

  A recon document written now would be the code read back to itself, looking authoritative
  while carrying none of the uncertainty the original was supposed to resolve.
- `decoder2` is registered and named by spec §3.3 but rewarded by no level; ruled acceptable
  in phase 1 and unchanged here.
- The `custom` check registry still ships empty; `program` is the new kind rather than an
  escape hatch, per ruling 2.
- Chapter 3's levels are playable but **not playtested by a human**. Every claim in this ledger
  is from the automated walks (batch tests, whole-set buildability, smoke) and from probes
  written to answer specific questions. Nothing here substitutes for someone building the
  circuits by hand.


