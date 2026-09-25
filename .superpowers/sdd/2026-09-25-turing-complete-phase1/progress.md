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

Task 3: BASE `6cdb37b`.

