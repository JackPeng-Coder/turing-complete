# SDD ledger — plan: docs/superpowers/plans/2026-09-25-turing-complete-phase1.md

Spec: docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md
Plan baseline: 405b497 (branch `phase1` in worktree `.worktrees/phase1`, cut from master)
Predecessor plan: docs/superpowers/plans/2026-09-25-turing-complete-phase0.md (12 tasks, complete)

## Setup

Worktree: `.worktrees/phase1` on branch `phase1`, cut from master at `405b497`.
`node_modules` is a junction to the parent repo's, so no reinstall. Baseline verified
in the worktree before any work: `pnpm test` -> 15 files, **239 passed**.

Ruling: work in a git worktree rather than on `master`. Phase 0 ruled the opposite
(local-only repo, nothing to disturb). That premise no longer holds: master now has a
public GitHub remote, and Phase 1 is a long multi-task effort that would leave the
pushed repository half-built for its whole duration. Asked the user; they chose the
worktree. — Cost if wrong: Phase 1's work is on a branch needing one merge at the end,
and `pnpm dev` run from the parent directory will not see Phase 1 changes until merged.

## Research finding that reshaped this phase (load-bearing)

I dispatched a research subagent to extract chapter 2's level list from the user's
compendium (`图灵完备_Turing_Complete_游戏资料全集.md`). Report:
`.superpowers/research/compendium-structure.md`. Findings, machine-verified against the
source:

- The chapter spine is **confirmed**: 7 chapters, 82 levels, chapter 2 = **26 levels,
  13–38**. Counts reconcile three ways (heading, §16.5 table, row count). This part is solid.
- The 26 **level names and their one-line teaching concepts are confirmed** and documented.
- The compendium supplies **no truth tables, no port lists, no bit widths, no pass
  conditions, and no per-level component rewards** for any chapter-2 level. Its only
  reward statement for any level in the game is chapter 1's level 2 (`获得初始元件 NAND`).
- Five numeric figures exist (5 blue components, delay ≤ 35, "8位"系列元件, ≤ 65 gates,
  最高级) but §4.3 classes them as **scoring/achievement** conditions, and the compendium
  never says they are required to pass.
- Two levels (15 二进制速算, 23 负数) are `限时小游戏` with **zero circuit spec**.
  Level 34 总线 is `"共享数据传输线路的概念"` — a concept, not a computable spec.
  Level 37 小盒子 is `"刚好装满存储空间的电路设计"` — capacity, address width and the
  meaning of 装满 are all unstated.
- The research subagent's own words: "Chapter-2 specs need external verification before
  implementation." It declined to fabricate the missing specifications.

Ruling: attempt external verification before deciding, because the researcher
recommended it and the user's original request was a faithful replica. `web_search` is
**unavailable in this session** (`DEEPSEEK search has no API key for "DEEPSEEK_API_KEY"`),
and I will not bruteforce URLs or scrape the commercial game's assets. External
verification is therefore not possible here. — Cost if wrong: none; the attempt was cheap
and its failure is what makes the next ruling necessary rather than lazy.

Ruling: implement all 26 chapter-2 levels using the compendium's **names, order and
teaching concepts** as the binding skeleton, and **author the mechanical specifications
myself** so each level teaches the concept its name names. Every authored field is marked
in the level data as `本复刻版设计` with a comment naming what the source did and did not
supply. This is the only complete path forward: the alternatives are stopping the phase
(the source cannot supply the specs, so no amount of further reading fixes it) or
inventing specs while claiming they were sourced (dishonest, and the exact failure the
research subagent refused to commit). — Cost if wrong: the 26 levels are a
concept-faithful but mechanically original curriculum rather than a byte-for-byte
reproduction. The names, order, chapter structure and teaching progression are the
source's; the port lists, widths, graders and star targets are mine. **This is the single
most important thing to tell the user**, and it is the one part of this phase they may
want reworked.

Ruling: three levels whose source spec is not computable are adapted, not dropped, and
each adaptation is recorded in the level data itself. Level 15 二进制速算 and level 23
负数 were timed mini-games in the original; converting them to circuit levels on the same
concept (binary counting; two's-complement arithmetic) keeps the curriculum whole — the
alternative is a 26-level chapter with two holes. Level 34 总线 is reframed as a
"exactly one driver active" selector level because spec §3.1 **forbids** multi-driver
arbitration in this engine, so a literal tri-state bus is unimplementable by design.
— Cost if wrong: three levels differ from the original in kind, not just in detail. They
are the three the user is most likely to want changed.

Ruling: `half_adder` is **not** made a component, though level 20 is named 半加器.
Spec §3.3's chapter-2 component list does not contain it, and spec §3.3's own teaching
principle is that a component exists only where a level needs it. Level 20's reward is
`full_adder`, which the player needs one level later. — Cost if wrong: the player cannot
reuse a named half adder; they build one from gates each time they want one, which is
what the level is teaching.

Ruling: `decoder1` and `decoder2` are **one width-parametrised decoder** rather than two
components. `decoder2` appears in spec §8's list but in no chapter-2 level name, and
spec §3.3 already governs `splitter`/`maker`/the 8-bit family by exactly this
"same operator, width parameter" rule. — Cost if wrong: the palette shows one decoder
whose width the player sets, instead of two fixed-width parts.

## Pre-flight conflict scan

Pairs of tasks sharing a file or an interface. "Found" is what the scan turned up, not a
verdict; every finding is ruled on below the table.

| A | B | Shared surface | Found |
|---|---|---|---|
| 1 | 2 | `net.ts`, `test/core/net.test.ts` | Both rewrite the read path. Ordered 1→2. Task 1 fixes the read **mechanism**; Task 2 makes widths **per-instance**. Task 2's tests must re-assert Task 1's invariants at width 8, or a later rewrite could regress Task 1 silently. |
| 2 | 4 | `net.ts` (`#publishState`) | Task 2 touches input width; Task 4 extends `#publishState` for multi-byte state. Both edit `Simulation` but in disjoint methods. Ordered 2→4. |
| 3 | 4 | `src/core/defs/wide.ts` | Task 4 appends to the file Task 3 creates. Hard order 3→4. |
| 5 | 6 | `src/levels/spec.ts`, `checks.ts` | Both add a `LevelCheck` variant. Disjoint variants, same union. Prefer one task; if split, 5→6 and Task 6 rebases the union. |
| 6 | 7 | `levels/index.ts` | Task 7 adds chapter-2 file imports. Disjoint from `custom/`. No order needed. |
| 7 | 8–11 | `levels/content/ch2/*`, `allowedComponents` semantics | Task 7 builds the unlock-chain test that Tasks 8–11 must satisfy **and must not fake**. The test must reject a level whose `allowedComponents` names a component unlocked later. |
| 8 | 9,10,11 | `levels/content/ch2/batch*.ts` | Disjoint files by construction. Each owns its own test file. Safe in sequence only (SDD forbids parallel implementers). |
| 9 | 11 | `threeStar` derivation | Task 9 must **measure** the delay target from its reference solution rather than copying the source's achievement number. My first draft of the plan had Task 9 copying `延迟 ≤ 35`; corrected. |
| 11 | 12 | `README.md` | Task 12 edits README after Task 11; no overlap if Task 11 leaves README alone. |
| 2 | 8–11 | `params.width` on level IO instances | Tasks 8–11 author `io` with `width: 8`. If Task 2 is incomplete, every 8-bit level silently mis-binds. Task 2 must land before any content task. |
| — | — | spec §3.3 vs teaching order | **Conflict**: spec §3.3 lists `full_adder` as a chapter-2 component without saying which level grants it, while level 21 is *named* Full Adder — the player should build it, not receive it. Ruled: grant at level 20, use at 22. |
| — | — | spec §3.3 vs source order | **Conflict**: source order is OR/NOT (18–19) before Half/Full Adder (20–21), so a level-22 8-bit adder cascading `full_adder` needs `full_adder` from level 21. Ruled: yes, 21 → 22, which the source order already supports. |
| — | — | spec §3.3 vs `decoder2` | **Conflict**: `decoder2` is in spec §8's catalog, absent from the chapter-2 list, and no chapter-2 level name introduces it. Ruled: width-parametrised decoder. |
| — | — | `mem1` availability | **Resolved**: `mem1` is a chapter-1 level-8 reward (Phase 0 fact), so level 28's latch has a part to build with. Not a conflict. |

Per-task self-consistency: each task's stated tests match the code it specifies; no task
mandates a test that asserts nothing. Task 5's "`rounds: 0` must not pass silently" and
Task 6's "unregistered id is a hard failure" are the two places the plan deliberately
mandates a strong assertion — they mirror the `missing-rows` lesson and the review rubric
treats them as required, not as defects.

## Environment constraints on execution

Ruling: the per-role model selection the SDD skill mandates cannot be honoured in this
session. The `subagent` tool exposes no model/provider parameter, and DSH's model config
(`~/.dsh/profiles/desktop/cordis.yml`) was not read for a set of valid names. Every
implementer and reviewer therefore runs on the session's default model. I am recording
this rather than silently ignoring it, because the skill calls an omitted model a defect
that "silently defeats" the section. — Cost if wrong: none to correctness; the cost is
that cheap mechanical tasks are not run on a cheaper tier, so this phase is slower and
more expensive than the skill intends. Fixable only by a change to the harness.

## Worktree setup: a junction is not enough

Ruling: the worktree gets its **own real `node_modules`**, not a junction to the parent's.
The junction worked for `pnpm test` (baseline 239 passed) but **broke `pnpm smoke`**: pnpm
runs a `runDepsStatusCheck` before scripts, reads the parent's `.modules.yaml` whose
`virtualStoreDir` points at the parent, concludes the modules are stale, and tries to
purge them — then aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` because this
shell has no TTY. That is a Task 12 blocker found early and cheaply.
`pnpm install --prefer-offline` in the worktree fixed it in **1.2 s** (85 packages, all
reused from the store, 0 downloaded), and `pnpm smoke` then reported **2 passed (5.6s)**
from the worktree path, regenerating `test-results/smoke-*.png`.
— Cost if wrong: the worktree holds its own ~85-package tree instead of sharing one. Space
only; no behavioural difference, and it removes a whole class of stale-store confusion.

## Task status

Task 1: complete (commits 2a2cece..c4fb3ab, review clean — no Critical, no Important).
Task 1: minor (deferred): net.ts:35-37 — the edited comment states a wire-less bit "reads 0"
  unconditionally, but a caller does write those slots to drive an unwired input. Fixed as
  a one-line comment correction in Task 2's dispatch (comment-only; controller-authored).
Task 1: minor (deferred): net.ts:231-245 — the defined 0 above a narrow driver is inherited
  from never-written identity slots rather than enforced. Unreachable in-tree; hardening it
  with a driven-bit mask would make a partially driven pin behave differently from a fully
  unwired one, which is intentionally write-through. Recommendation to the final review: stand.
Task 1: minor (deferred): test/core/net.test.ts:467-482 pins exact slotCount (24/34). The
  property that matters is asserted directly at :425-429; the counts are the brittle half and
  are expected to need updating when Task 2 re-sizes regions.
Task 1: minor (deferred): test/core/net.test.ts:419-446 covers region refresh after settle()
  but not after tick(), and the script checker reads outputs after ticks. Correct via
  `tick() -> settle()`; coverage gap only.
Task 1: review ⚠️ carried into Task 2 (named risk, not a Task 1 gap): `levels/checks.ts:67-68`
  reads `net.inputBase('OUT_<pin>.in')` at LEVEL-SPEC width while `compile` sizes the region at
  DEF width. Task 2 must route the effective width through the region loop (`net.ts:231-245`)
  AND `capacityFor` (`net.ts:137-150`), and keep spec/def widths in agreement, or a
  `read(pin.width)` runs past a def-sized region. Carried verbatim into Task 2's dispatch.
Task 2: BASE `6010948` (corrected again to the true dispatch base: `7f95f40`. Both
  `6010948` and `7f95f40` are controller commits that landed before Task 2's dispatch, so
  its review range must start there. Lesson: stop correcting BASE and instead take BASE
  immediately before each dispatch, after any controller bookkeeping commit).
Task 2: HEAD `6cdb37b` — DONE, review dispatched.
  Interface rename worth recording: `levelIoInstanceId(level, graph, defId)` ->
  `levelIoPlacement(level, graph, defId)` returning `{ id, width } | undefined`.
  The width had to travel with the id, or `place()` cannot set `params.width` and the game
  builds level-IO instances that its own binder then rejects.
Task 2: implementer's RED finding is the sharpest evidence yet that the phase-0 defects
  were real rather than theoretical: with the old spec-width binding, a **1-bit** bound
  `level_output` passed **all 256 rows** of an 8-bit level — it read 8 bits from the spec
  width and happened to alias a wide driver — while the input side wrote past its 1-bit pin
  into neighbouring slots. Accidental correctness and silent corruption, one root cause.
Task 2: complete (commits 7f95f40..6cdb37b, review clean — no Critical, no Important).
Task 2: minor (deferred): the rich `io.mismatch` message is discarded at checks.ts:398, so a
  pin-width disagreement reaches the player as a `missing-io` failure rendered as a row of
  zeros with no explanation. Unreachable through play today (graphs are never persisted and
  `place()` always sizes the part) but Tasks 8–11 hand-author wide levels, so this is exactly
  when it could bite. Deferred to the final review with the reviewer's own note that
  `mismatch` is test-visible only until a failure-panel task renders `reason`.
Task 2: minor (deferred): `params.width` is per instance and widens every pin of that
  instance, `level_output.mirror` included (8 unused slots per 8-bit output). Harmless, but it
  means level IO instances cannot mix widths. Recorded so Task 11's `ram8` level and the CPU
  chapters know the rule before they need a per-pin form.
Task 2: minor (deferred): report §1.1 and §1.6 describe behaviour the code does not have (the
  write-back lines were already driven by `OutputPin.width`; a malformed width reaches
  `grade()` as `failures: []` plus an `invalid-params` issue, not as `invalid`). Code is
  correct; the ledger records the real behaviour.

Ruling: close Task 2's `1e9`-width escape in Task 3 rather than parking it. The reviewer
found that `invalid-params` accepts any positive safe integer, so `params.width = 1e9` passes
`validateGraph`, `capacityFor` asks for >4 GB, and the resulting `RangeError` escapes
`createSim` into `runChecks`/`grade` — precisely the escape Task 2's ruling 2 exists to
forbid. The reviewer judged it Minor because only authored data can trigger it, and I agree
on severity; I am fixing it anyway because the guard was added to close the hazard class and
a three-line cap closes it completely, so leaving it half-closed is worse than either
extreme. Routed to Task 3, which already owns `core/defs` and touches the same validation
neighbourhood. — Cost if wrong: a hand-authored level with a width above 4096 is rejected
rather than attempted; no legitimate level comes close to 4096 bits.

Ruling: Task 3 must keep `tsc --noEmit`, `pnpm build` and `pnpm smoke` output **in a log
file**, not only inline in its report. Task 2's reviewer could not verify those three claims
from the artifacts and had to re-derive the type-safety argument by hand. The cost of keeping
the logs is one redirect; the cost of not keeping them is a reviewer spending its budget
re-doing a verifiable check. — Cost if wrong: a few KB of scratch per task.

Task 3: BASE `e27d81a`, implementer commit `a57908a` — DONE_WITH_CONCERNS; fix round 1 dispatched.
Task 3: controller-found Important: the wide family conflated the **gate** metric with the
  **delay** metric. `delayOf` (net.ts:616,639,648) and `gateCost` (grader.ts:29-34) both
  consume `def.cost`, so setting `cost: 1` on every wide operator fixed delay correctly and
  made an `add8` count as **one gate**. Spec §5.4 defines the gate metric as expanding
  "电路 + 自定义组件 + 宽位组件" into NAND equivalents, while spec §3.2 defines a wide
  component as contributing 1 unit of **delay**. The two metrics deliberately differ for wide
  parts: gate multiplies, delay does not.
  Why this mattered enough to stop and fix: Tasks 8–11 author every `threeStar.gate` target,
  and they would have been measured against a metric the spec does not describe. Fixing it
  after 26 levels existed would have invalidated all 26 sets of targets.
  Ruling: add an explicit NAND-equivalent gate cost with `cost` as the fallback (so phase-0
  defs and all 12 chapter-1 scores stay byte-identical), and pin the asymmetry with a test
  asserting one `and8` has `delay === 1` and `gate > 1`. — Cost if wrong: the gate numbers for
  wide parts are my chosen constructions rather than the original game's, which is already
  true of every chapter-2 number (see the source-fidelity ruling).
Task 3: review clean on the round-1 range — Finding 1 ADDRESSED; task quality Approved. The
  reviewer independently re-derived all 24 `gateCost` values at width 8 from the stated
  constructions and confirmed the phase-0 freeze is assertion-based (literal metrics AND
  scores for 12 reference circuits, cross-checked against `scoreOf`, with each `threeStar`
  bound compared directly) rather than an absence of change.
Task 3: fix round 2/5 dispatched — the same conflation one level up: the phase-0 built-in
  gates still fall through `?? def.cost` and are worth 1 each, so a built-in `and` costs 1
  while one bit of `and8` costs 2, both under the label "NAND equivalent".

Ruling: fix the **metric**, not the documentation — and lift my own freeze instruction for
the three chapter-1 gate targets it moves. The reviewer recommended the opposite (keep the
numbers, correct the two doc comments) because fixing the metric moves `ch1-06` gate 2→4,
`ch1-10` 2→6, `ch1-11` 2→4 and those levels would stop meeting their own `threeStar.gate`.
I overrule that recommendation on the authority of spec §5.4, which defines gate as
"电路 + 自定义组件 + 宽位组件全部展开后，**NAND 等价门**的总数" with no carve-out for the
built-in gates: the spec is the binding authority, the plan argues from it, and the
documentation is what is wrong. The freeze was my instruction and it exists to stop
*accidental* score drift, not to entrench a metric that contradicts the spec.
Recalibration rule: re-measure the 12 chapter-1 reference solutions and set `threeStar.gate`
to the measured value only where the reference no longer meets it; delay and tick must not
move; and add a machine check that **every** level's reference solution meets **all** of its
own `threeStar` bounds. That last test is worth more than the three edited numbers — it
turns the phase-0 principle ("a target its own reference solution fails is a defect") into
something that cannot silently rot across chapters 3–7.
— Cost if wrong: three chapter-1 three-star gate thresholds become more generous (2→4, 2→6,
2→4), so three levels get slightly easier to three-star. The alternative is 26 chapter-2
targets authored against a metric the spec does not define, which is worse and harder to
undo later.

Task 3: ruling ratified — `shift_*`/`rot_*` are barrel shifters (3 stages × 8 muxes = 24
  muxes → 96 NAND at width 8; +29 for the `amount >= width` corner rules on logical shifts,
  +44 for `ashr8` sign-fill), **not** the `8 × mux2` I suggested in the fix dispatch. My
  suggestion was wrong: the `amount` pin is 8 bits wide, so 8 muxes is a shift-by-one and
  cannot produce `shift_l8(1, 7) = 0x80`. The implementer deviated with a stated reason and
  the deviation is correct. — Cost if wrong: the gate counts for the shift family are 4×
  higher than a naive reading would give, which makes those levels' star targets stricter.
Task 3: honest-limits note carried forward — the per-operator `gateCost` values are counts of
  **documented constructions, not proven minima**. The implementer names `mul8` (704) and
  `div8` (950) as the two it would least defend as tight. Tasks 8–11 must therefore treat a
  `threeStar.gate` target as "achievable with a good solution" and measure it from the
  reference solution, not from the bare `gateCost` of the parts used.

Task 3: ruling ratified — `splitter`/`maker` pin **count** is a def-factory parameter, not
  `params.width`. Task 2's rule widens *every* pin of an instance, so an instance knob would
  have made all eight outputs 4 bits instead of re-counting them. Registered at 8; a level
  needing 4 bits uses `b0..b3`. **Recorded limitation: the project cannot instantiate these
  two at a non-8 count**, and per-instance counts would need a def-level hook in `net.ts`.
  Later chapters (`byte_indexer`, `bit_indexer`) may need that hook; not this phase.

Task 3: fix round 2/5 (1 addressed, 0 open — built-in gates priced at 1 NAND equivalent while
  the wide family was priced per the documented basis; commits 0ebb7bc..2027b75). All nine
  built-in gates now state an explicit `gateCost` (nand 1, not 1, and 2, or 3, nor 4, xor 4,
  xnor 5, and3 4, or3 6) with an all-NAND construction derived per cell; `cost` stayed 1 on
  all nine so delay is provably unchanged; the false doc claims were corrected in four places.
Task 3: complete (commits e27d81a..2027b75, review clean after 2 fix rounds).
  Recalibrated chapter-1 targets (measured, raised only, no delay/tick moved):
  `ch1-06-nor-gate` gate 2→4, `ch1-10-bigger-or-gate` gate 2→6, `ch1-11-bigger-and-gate`
  gate 2→4. The other nine chapter-1 references were unaffected.
  New phase-wide guarantee: `test/levels/grader.test.ts` walks the **shipped** level set and
  asserts every level's reference solution meets **all** of its own `threeStar` bounds. That
  test fails for a missed bound while the freeze test stays green — mutation-proven — which is
  the machine check that keeps chapters 3–7 honest.
Task 3: minor (deferred): `src/levels/grader.ts:38-39` says the `?? def.cost` fallback is for
  defs "zero on both", but a synthetic test def with `cost: 1` and no `gateCost` legitimately
  uses it, and `registry.ts:54-58` permits absence for any part worth ≤ 1 NAND. Doc wording
  narrower than the mechanism; no behaviour.
Task 3: minor (deferred): the four items adjudicated as not worth fixing this round —
  `toUint`'s `Uint8Array` branch unexercised (carrier for phase 5's 16/32-bit defs),
  `makeOp`'s negative intermediate at w=32 (value correct), the freeze test's copied circuits
  that could drift from `ch1-part1`/`part2`'s local `solutions`, and no `grade()` end-to-end on
  a wide-part level spec. Final review to triage.

Ruling: Tasks 5 and 6 (`fuzz` and `custom` checkers) are merged into **one** dispatch. They
add two variants to the same `LevelCheck` union in the same two files, and both carry the same
`missing-rows` lesson — an empty specification must not pass silently. The skill's own
guidance is to batch same-shape work rather than pay a dispatch and a review seat per variant.
— Cost if wrong: if one of the two needed its own judgment, its review is bundled with the
other's and a fix round must address both. The plan's task numbering stays as documentation;
this ledger records the merge so a reader is not confused by the gap that Task 5–6 creates.
Task 4: BASE `2027b75`, commit `740e670` — DONE_WITH_CONCERNS, review **Approved** (0 Critical,
  no code defect). The reviewer verified the publish-mechanism fix, `delay_line`/`mem1`
  byte-identical behaviour, the storage contract per def, capability of multi-byte state, the
  three named test classes (the latch test asserts the held value *between* an input flip and
  the edge; the oscillator asserts both a stable storage ring and a still-throwing
  combinational twin), and capacity arithmetic (200 `ram8` banks at exactly 200 × 44 slots).

Ruling: **amend Global Constraint 5**, do not change the code. `ram8`'s `evaluate` reads `addr`
as a pure selector, so the constraint's literal words ("`evaluate` must never read `inputs`") are
now false for one def. The constraint exists because a `delay_line` that mirrored its input
degraded into a wire, and that purpose is intact: `d` and `load` are never read, and the
published byte is always one a clock edge wrote. Constraint 5 now reads: `evaluate` publishes the
held state and may read **at most** one input that only selects among bytes already in `state`.
— Cost if wrong: the constraint is one sentence weaker, and a future reader could use the carve-out
to justify a def that genuinely leaks an input into its published value. The def-level test that
mutates a storage def into mirroring its input (`net.test.ts:685`) is the guard against that.

Ruling: **built-in storage stays at 0 NAND equivalents**, against the reviewer's suggestion that a
256-byte RAM at 0 gates might be too generous. The gate metric measures **what the player built,
not what the platform provides**: spec §5.4 charges 0 for `const`/`probe`/`level_*` and 1 for NAND,
Phase 0 already priced `mem1`/`delay_line` at 0, and pricing storage at its expansion (~663,000
gates for RAM cells alone) would make any gate target involving storage meaningless and would
invert the incentive that makes unlocking a part worth doing. The player who wants to *count*
storage gates builds a latch from gates. A comment at the storage defs now states this so a later
reader does not "fix" it by pricing them. — Cost if wrong: gate scores for levels solved with
built-in storage understate the storage's real NAND cost; a player comparing "my latch" against
"the built-in register" sees the built-in as cheaper, which is the same relationship every other
unlocked part already has.
Task 4: ruling ratified — the four storage defs keep `category: 'wide'`, not `'memory1'`, which
  Phase 0 used for the 1-bit pair. The category is a grouping label; the palette is driven by each
  level's `allowedComponents` (`src/app/progress.ts` intersects the two), so this cannot leak a
  part into the wrong level. Splitting 8-bit storage into a 1-bit-named category would be the more
  confusing choice.
Task 4: fix round 1/5 (4 addressed, 0 open — commits 740e670..171fd6c). All six re-review items
  ADDRESSED: mutation logs re-run on the final tree with the differing test **named**
  (`publishes a multi-byte storage def through the same path`, the 12-bit holder) and shown to be
  indifferent to A/B/C by running it alone under each; `#publishState` made non-deletable
  (mutation D red on exactly the two new tests, so the pass can no longer be removed or reverted
  silently); the `compile` guard now throws `CircuitValidationError` with one error-severity
  issue so `checks.ts` maps it to `'invalid'` instead of letting it escape the pipeline;
  `delay_line`/`mem1` pinned to exactly 1 state byte and 1 output pin **by def id**, with the weak
  inequality retained for the RAM family.
Task 4: complete (commits 2027b75..171fd6c…, review clean after 1 fix round).

Ruling: my own ruling's **premise** was wrong, and the re-reviewer caught it. I wrote that the
gate metric measures what the player built because "a built-in part is not charged" — false:
`gateCost()` sums `def.gateCost ?? def.cost` over every placed instance, so `and` costs 2 and
`add8` costs 72. The true rule is narrower and is now the one recorded: **the `cost` fallback is
0 for exactly four kinds of def — a rail, a level connector, a wire-like packer, and a storage
element.** Storage is the exception, not built-in parts generally. The same comment had the same
slip twice more: it said a player wanting storage to cost gates builds a latch "from `mem1`",
but `mem1` is itself a 0-gate storage element. Ruled: keep the **conclusion** (storage stays 0 on
both metrics) and correct the premise sentences to match `grader.ts`, which already states the
narrow rule correctly. Dispatched as its own tiny comment-only fix because no live subagent
remained to resume. — Cost if wrong: none to behaviour; a wrong rationale in a comment is how a
later reader gets talked into a wrong change, which is exactly what happened here.

Ruling: a fresh comment-only fix gets **no** review seat. It changes no behaviour, the ruling it
records is already reviewed, and its correctness is checkable by reading two sentences against
`grader.ts`. This is a deliberate, recorded exception to "every change is reviewed", not an
oversight; the final whole-branch review will read it. — Cost if wrong: an unreviewed comment
could state something false; the cost is bounded to the comment, and the assertion that guards
the behaviour (storage at 0 on both metrics) is already pinned by test.
Task 4: comment correction landed separately as `3fc19cf` (`docs(core): make the free-storage
  premise match gateCost()`), comment-only, 2 files 22/11. `grader.ts` already stated the narrow
  rule, so the fix aligned `wide.ts` to it. The implementer also re-scoped one neighbouring
  sentence it was not asked to touch ("drop in the unlocked part instead of rebuilding it"
  scores better) — true of storage, not of gates generally, since an `add8` costs its declared
  72 either way. Correct call; recorded here so the scope creep is visible rather than silent.

Task 5–6 (merged): BASE `3fc19cf`, commit `e61d556` — DONE, review dispatched.
  The implementer found and removed a **latent real defect** while adding the two kinds: the
  `script` branch was the fall-through of `runChecks`'s dispatch, so a `fuzz` or `custom` check
  reached `check.steps` and threw `TypeError: check.steps is not iterable` out of
  `runChecks`/`grade` — on every board edit. Its RED-2 log records exactly that error against
  the pre-change dispatch. The dispatch is now exhaustive with an unknown-kind guard. Same
  failure class as the phase-0 `RangeError` escape, caught before any level used the new kinds
  rather than after.
Task 5–6 handoffs recorded for later tasks:
  1. The chapter-1 content tests have an "every level has a check with something to compare"
     loop that knows only `truth-table`/`script`. Task 8's chapter-2 content tests must add a
     `fuzz` clause (positive integer `rounds`, every pin named), or the new kinds are unguarded
     by that invariant.
  2. The UI (`src/ui/truthTable.ts`) does not render the new `detail`/`round` fields, so a fuzz
     or malformed-custom failure shows as a bare pin row. Recorded against Task 12.
  3. Over-cap `rounds` clamp rather than fail; and a custom checker that always returns
     `passed: true` passes its level — reviewing custom checkers is part of reviewing the levels
     that name them.
  4. A `custom` checker owns its tick count, which the kernel trusts via `Math.max`, so a checker
     could understate ticks and inflate a star rating. No shipped checker exists yet; a rule for
     chapters 3–7, not a defect.

Ruling: batch the remaining work, because dispatch overhead has dominated the last five tasks
(each dispatch carries a full brief plus context; each fix round re-carries its findings).
**Task 7 (chapter assembly) merges into Task 12 (phase-end verification)** — assembly is a
prerequisite of verification, it cannot be properly tested until chapter-2 content exists, and
Task 12 already owns the unlock-chain test. The four content batches stay separate: 26 levels is
precisely the case where one implementer's context runs out and quality drops.
— Cost if wrong: the assembly work is not independently reviewed until the phase end, so a
mistake in chapter wiring surfaces later and inside a larger diff.

Task 5–6: review **Approved** (0 Critical, 0 Important, 9 Minor). Independently verified rather
  than accepted: the reviewer recomputed xorshift32 by hand and confirmed the golden vectors for
  seed `0x1234`, confirmed seed 0 unmapped returns 0 forever while the remap yields 8 distinct
  vectors, confirmed the latent `check.steps` defect is real (31 occurrences of the TypeError in
  RED-2), and confirmed the new `round`/`detail` fields degrade gracefully because the only
  reader (`src/ui/truthTable.ts`) never branches on `reason`.
Task 5–6: ruling ratified — extending `test/levels/checks.test.ts` was NOT required; the new
  focused `test/levels/fuzz-custom.test.ts` is the better choice, since a 700-line addition to a
  shared file costs more than a focused new one. Both briefs named the shared file; the brief was
  wrong and the implementer was right.
Task 5–6: ruling ratified — over-cap `rounds` **clamps** rather than failing. Clamping cannot hang
  the editor and still fails wrong circuits; a hard failure would punish a legitimate authoring
  choice. — Cost if wrong: an author asking for 10^7 rounds silently gets 4096, and the cap is per
  check, so many fuzz checks in one level cost ~26 ms each per board edit.
Task 5–6: ruling ratified — a `custom` checker owns its `ticksUsed`. The brief makes
  `CheckOutcome.ticksUsed` the channel, and `io.reset()` zeroes `sim.tickCount`, so the kernel has
  no independent measure to compare against. A checker could understate ticks and inflate a star
  rating; that trust is now documented on the `CustomChecker` type and is reviewed with any
  checker a later chapter ships. — Cost if wrong: a first-party checker can inflate its own level's
  star rating, which is why reviewing it is part of reviewing the level that names it.
Task 5–6: fix round 1/5 dispatched — (1) `checks.ts:388-396` (level with no output pins) has no
  test although report §2 claims it does; it is one of the four mandated vacuity shapes, so it
  gets its own case and the report gets corrected; (2) `custom/index.ts:13-19` documents pin-id and
  value validation that `failureIssue` does not perform (`fuzz` validates with `fitsPin`, `custom`
  does not), so either enforce it or soften the doc — a doc promising enforcement the code skips is
  how a later author ships a silently wrong grader; (3) `FAILURE_REASONS` hand-duplicates the
  `reason` union, so adding a reason to the type would silently make it "malformed" — derive it;
  (4) close the two residual `grade()` escape paths (`checks.ts:595` element-level malformation,
  `checks.ts:838` a throwing accessor on a returned outcome), cheap fixes for the one instruction
  that exists because a phase-0 `RangeError` fired on every board edit.

Task 8 handoff (from Task 5–6's reviewer, must land with the first chapter-2 content):
  `test/levels/ch1-part1.test.ts:50-61` and `ch1-part2.test.ts:39-49` run an "every level has a
  check with something to compare" invariant that handles only `truth-table`/`script` with **no
  else branch**, so it passes vacuously for `constraint`, `fuzz` and `custom`. The chapter-2
  content tests must extend it (positive integer `rounds`, every pin named, constraint rule
  present) or the new kinds are unguarded by the very invariant meant to catch vacuous checks.





