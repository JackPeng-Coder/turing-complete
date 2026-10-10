# Task 7 report — 第 50–52 关（chapter 4's first three programming levels）

**Status: DONE** (with three brief ambiguities resolved by the brief's own ruling hierarchy — see
「对 brief 含糊处的裁定」below; one design limitation recorded as a concern)

Commit: `65ee370` `feat(levels): add chapter 4's first three programming levels`
(3 files changed, 921 insertions; staged by explicit path only)

## What I implemented

Author-only task, no engine code touched. Three files, exactly the brief's write scope:

1. **`src/levels/content/ch4/batch1.ts`** — `CH4_BATCH1: readonly LevelSpec[]`, three levels:
   - `ch4-50-punchcard-programming` 打孔编程 / Punchcard Programming (index 50),
     `in:8 → out:8`, `program` (`from: 'player'`, `format: 'bytes'`), semantics `out = (in + 5) & 0xff`;
   - `ch4-51-assembly-programming` 汇编程序 / Assembly Programming (index 51),
     `in:8 → out:8`, `program` (`from: 'player'`, `format: 'asm'`), `out = (in + 3) & 0xff`;
   - `ch4-52-circumference` 三番两次 / Circumference (index 52), `r:8 → out:8`,
     `program` (`from: 'player'`, `format: 'asm'`), `out = (6 * r) & 0xff`.
   - All three ship `board: overtureBoard({ inputId })` with the default `halt: true`
     (straight-line levels, per the brief's board rule) — `inputId: 'in'` for 50/51, `'r'` for 52.
   - `rewards` absent on all three; `allowedComponents` = the shipped board's 22 component ids
     (connectors included, nothing else); `source` is NOT written in level data (ruling 2).
   - `brief`/`hint` in both languages, each saying 「这台 CPU 是你第 3 章搭的，现在给它写程序」
     plus the level's own teaching (byte encoding / assembly syntax / `add`'s r1,r2→r3 discipline).
   - Per-level `SOURCED`/`AUTHORED` data comments (names, positions, concepts and the 1.x
     ancestor names are SOURCED from the 2.x dossier §5; io, semantics, board, walk, palette and
     targets are AUTHORED).
2. **`test/fixtures/ch4-references.ts`** — `CH4_REFERENCES: Record<string, { program: string; format: 'asm' | 'bytes' }>`
   (ruling 1's exact shape). Boards do NOT enter the fixture; references run against
   `graphFromBoard(level.id, level.board)`. Programs are the controller-verified texts from
   `reference-programs.md` (level 50 as five binary lines `B1 05 82 40 9F`; 51 `B1 03 82 40 9F`;
   52 `B1 B2 40 99 40 9A 99 40 9F`), with per-program comments naming each instruction.
3. **`test/levels/ch4-batch1.test.ts`** — 25 tests in the `ch3-batch3.test.ts` shape, adapted per
   ruling 5 (fixture-program assertions instead of `check.source` assertions): reference filed /
   runs / three stars; `threeStar` == measured metrics (through `grade()`, with 675/6 pinned
   explicitly and tick pinned to the walk's last assertion); the walk's answers and arithmetic;
   hand-encoded bytes pinned against `asm/isa.ts`; palette covers the board's every part and
   names nothing beyond it; board == `overtureBoard({ inputId })`; 8-bit connector binding;
   counterexamples (below); index range / rewards absent / no unearned part; io shapes; `from:
   'player'` with no `source`; inputs repeated at every step; `SOURCED`/`AUTHORED` markers.

## TDD evidence

**RED** — test written first; run before any implementation existed:

```
$ $NODE $PNPM test ch4-batch1
 ❯ test/levels/ch4-batch1.test.ts (0 test)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  test/levels/ch4-batch1.test.ts
Error: Cannot find module '../../src/levels/content/ch4/batch1' imported from
D:/Documents/turing-complete/test/levels/ch4-batch1.test.ts
 ❯ test/levels/ch4-batch1.test.ts:12:1
 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

**GREEN** — after `src/levels/content/ch4/batch1.ts` + `test/fixtures/ch4-references.ts`:

```
$ $NODE $PNPM test ch4-batch1
 ✓ test/levels/ch4-batch1.test.ts (25 tests) 79ms
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

**Gates** (bundled node + pnpm.mjs, from the repo root):

```
$ $NODE $PNPM test        → Test Files 46 passed (46) / Tests 1431 passed (1431)
                            (baseline 45/1406 + this batch's 25; output clean, no warnings)
$ $NODE $PNPM build       → tsc --noEmit clean, vite build ✓ 64 modules, built in 277ms
```

`pnpm smoke` was not run (not in this task's verification list); `pnpm build` and `pnpm test`
are both green.

## The measured metrics behind each `threeStar`

| level | gate | delay | tick | how measured |
|---|---|---|---|---|
| ch4-50-punchcard-programming | 675 | 6 | 10 | `grade(graphFromBoard(id, level.board), registry, spec, { text: fixture program })` |
| ch4-51-assembly-programming | 675 | 6 | 10 | same |
| ch4-52-circumference | 675 | 6 | 14 | same |

- **gate 675 / delay 6** are the brief's authoritative board metrics
  (`overtureBoard({ inputId })`, `halt` default true) — the same 675/6 `test/levels/boards.test.ts`
  pins for the wired board. My test re-measures them through `grade()` and asserts the literal
  675/6, so a drift in either direction fails.
- **tick** is the reference run's measured `ticksUsed` (`grade().metrics.tick`), which for a
  `program` walk is the last assertion's tick — the brief's own definition ("本批 = steps 里最后
  断言的拍"). The walks assert 0 before the reveal, the answer on it, and the answer held later:
  - 50/51: steps at ticks 0, 3, **4**, **10** — the answer appears at tick 4 (`out` is
    combinational while the counter looks at `move|s3|out`, the 5th instruction) and is held by
    `halt` through tick 10;
  - 52: steps at ticks 0, 7, **8**, **14** — 9 instructions, answer at tick 8, held to 14.
- The pin is real: the test runs `grade()` and asserts `spec.threeStar` `toEqual`
  `{ gate: m.gate, delay: m.delay, tick: m.tick }` of that run, with gate/delay/tick each also
  pinned independently (675, 6, and `lastAssertedTick`).
- Walk inputs and answers: 50 drives `in = 100` → 105; 51 drives `in = 100` → 103; 52 drives
  `r = 200` → 176 (6·200 = 1200, wrapped — the exact case `reference-programs.md`'s verification
  measured at 200 → 176). For 50/51 the answers (105, 103) sit outside {0–63} ∪ {192–255}, the
  values a five-instruction constant program can publish at tick 4, so "ignore the input, hold a
  constant" cannot pass those two walks.

## Counterexamples (all through the player channel, `runChecks(graph, registry, spec, player?)`)

- **改坏程序 → `mismatch`** with the tick and both bytes: 50's `loadi|5`→`loadi|4` (104 vs 105 at
  tick 4); 51's `loadi|2` (102 vs 103 at tick 4); 52's first-draft 5r program — the very mistake
  `reference-programs.md` records — caught at tick 8 (232 vs 176).
- **空程序 → `missing-program`**: `''`, whitespace, and (separately) a comment-only buffer that
  compiles to zero bytes; details name the player's buffer.
- **corrupted → `invalid` + line number**: a foreign binary digit on line 3 (`program image failed
  at line 3`), a bogus mnemonic after the reference text (`program assembly failed at line 6/10`).
- **wrong-width → `invalid` + line number**: 7- and 9-digit binary lines (`a byte is 8 binary
  digits` at line 2), and the assembly analogue `loadi|99` (field does not fit, line 2).
- A refused program does not drive the steps (failures = `['invalid']` alone).

## Files changed

- `src/levels/content/ch4/batch1.ts` (new) — three `LevelSpec`s, `CH4_BATCH1`.
- `test/fixtures/ch4-references.ts` (new) — `CH4_REFERENCES`.
- `test/levels/ch4-batch1.test.ts` (new) — 25 tests.

No engine/content-index/campaign edits (ruling 2: registration is Task 9). Nothing under
`.superpowers/` staged or committed.

## 对 brief 含糊处的裁定（human interaction was unavailable, so resolved per the brief's own hierarchy）

`ask_user_question` is unreachable in this delegated session ("human interaction is unavailable
while the calling agent is owned by another live agent"), so I resolved the three ambiguities by
the brief's own rule — 「控制器裁决（对含糊处的裁定，按此执行）」— and flag them here:

1. **「参考解拿到 1 星」 vs 裁决 3.** These cannot both be literal: ruling 3 pins `threeStar` to
   the reference's measured metrics exactly, and `starsOf` awards **3** when measured ≤ target
   (equality passes). An exactly-1-star reference is impossible under ruling 3. The test asserts
   `stars === 3` (and `passed`), consistent with ruling 3 and the `ch3-batch3` template. If "1 星"
   meant "at least one star / passes", the assertion satisfies that too.
2. **One `program` check per level** (template's shape: `checks` length 1; the brief speaks of
   "steps 里最后断言的拍" in the singular). Counterexamples are exactly the brief's named kinds
   (改坏程序/空程序 + corrupted/wrong-width edge cases).
3. **`allowedComponents` = exactly the reference board's component ids** — the literal reading of
   「allowedComponents 列出参考板所需的全部元件 id」(22 ids: connectors, fetch stage, mode/field
   glue, register file + ALU + write path, jump glue + halt). The test pins this both ways
   (covers every board part; names nothing beyond the board).

## Self-review findings

- **Completeness** — every brief step done: test-first with watched RED, three level specs,
  fixture references, measured `threeStar`, `pnpm test` green, exact commit message, this report.
  Edge cases covered by tests: empty program (3 spellings + comment-only), corrupted program
  (both formats), wrong-width program (byte lines + out-of-range immediate), sabotaged program
  (both formats, including the documented 5r bug), refusal does not run steps.
- **Quality** — names/ids/io/ticks taken verbatim from the brief; every constant in the tests is
  hand-derived (the byte encodings from `asm/isa.ts`'s table) and comments explain why (tick
  arithmetic, the input-repetition pitfall, palette rule, halt semantics, the 5r lesson).
- **Discipline** — only the three owned files changed; no engine edits; no registration; staged
  by explicit path; `@ts-expect-error` on `node:fs` adopted from chapter 2's established pattern
  after `tsc` flagged the bare import.
- **Testing** — everything runs through real `runChecks`/`grade` on the real board (no mocks);
  the `threeStar` pin measures the reference run and compares; suite output clean.

## Concerns

1. **Constant-spoofing on level 52 (design limitation, documented in `STEPS_52`'s comment).**
   A `program` check executes the player's text once, so one walk pins one (input, answer) pair.
   On 50/51 the chosen input (100 → 105/103) is outside what a five-instruction constant program
   can publish at the reveal tick, so constant cheats fail. Level 52's reveal is at tick 8, and
   eight setup instructions can build the answer from constants alone — I verified this with a
   throwaway test (deleted after the run): `loadi|63, move|s0|d1, loadi|50, move|s0|d2, add,
   move|s3|d2, move|s0|d4, add, move|s3|out` computes 63 + (63 + 50) = 176 into r3 by edge 7 and
   publishes it on instruction 8 (the filler at 6 is needed so the `out` write lands on index 8,
   where the walk reveals), and `runChecks` PASSES it against level 52's board and walk. So a
   hard-coded 176 passes the single walk whatever the input. Only multiple checks (two or more
   runs with different inputs) close that hole, which would deviate from the brief's
   one-check/one-`steps` shape; the brief's named counterexamples (改坏程序/空程序) all fail as
   required. If the controller wants constant programs to be counterexamples too, the fix is a
   second `program` check per level with a second input value (say `r = 9` → 54, the other
   verified case).
2. The brief's 「拿到 1 星」 wording (see 裁定 1 above) — worth a one-line correction in the plan.
3. `pnpm smoke` not run (outside this task's gate list); `pnpm build` + `pnpm test` both green.

---

## Independent verification addendum (second Task-7 implementer session, same brief)

**Provenance note for the controller.** Two implementer sessions ran Task 7 in this workspace
concurrently. The implementation, this report and commit `65ee370` (14:44:15) were authored by the
session whose account is above; the second session (which received the same brief at 13:52) found
the three files already in its write scope mid-run (`test/levels/ch4-batch1.test.ts` modified
during its reads, 14:30:43 → 14:43:25), made **no writes** to tracked files, and switched to
read-only verification to avoid clobbering the live writer. Both sessions were reported to the
controller as they were detected.

**Independent gate runs (second session, post-commit state — files unchanged since 14:43:25):**

```
$ $NODE $PNPM exec vitest run test/levels/ch4-batch1.test.ts   (14:50:29)
  ✓ test/levels/ch4-batch1.test.ts (25 tests) 75ms   → 25 passed
$ $NODE $PNPM build                                          (14:51)
  tsc --noEmit clean; vite build ✓ 64 modules, built in 88ms
$ $NODE $PNPM test                                           (14:52:25)
  Test Files 46 passed (46) / Tests 1431 passed (1431) — output clean
```

**Second-session review verdict.** Line-by-line read of all three files against the brief agrees
with the report above: fixture shape (ruling 1), no `source` in level data (ruling 2),
`threeStar` = measured with a live `grade()` pin (ruling 3), indices 50/51/52 (ruling 4),
source-assertions replaced by fixture assertions + player-channel counterexamples (ruling 5),
`SOURCED`/`AUTHORED` markers present. The three ambiguity rulings (「拿到 1 星」→ 3 stars under
ruling 3; one check per level; palette = the board's exact parts) are the ones this session
independently reached while reading the brief, including the same 「1 星」 vs ruling 3
contradiction. Concern 1 above (level 52's constant-spoof) was independently identified as the
main design trade-off; the documented single-walk shape is defensible under the brief's singular
「steps 里最后断言的拍」, and the fix if wanted is the report's own suggestion (a second `program`
check per level, e.g. `r = 9` → 54).

---

## Fix round 1

**Status: DONE** — the finding's hole (ch4-52 accepting a hard-coded 176) is closed, and controller
ruling R9 is implemented for all three levels: every chapter-4 `program` level here now carries
**two** `program` checks with different input vectors. Commit: `fix(levels): drive two vectors
through each chapter-4 program check` (2 files: `src/levels/content/ch4/batch1.ts`,
`test/levels/ch4-batch1.test.ts`; staged by explicit path only).

### 1. Two `program` checks per level (`src/levels/content/ch4/batch1.ts`)

Same walk shape as before (0 at the early ticks, the answer at the reveal tick, held later;
`inputs` repeated at every step), one walk per check:

| level | walk 1 (kept) | walk 2 (added) | reveal tick | `threeStar.tick` |
|---|---|---|---|---|
| ch4-50-punchcard-programming | `in = 100 → 105` (`STEPS_50_AT_100`) | `in = 42 → 47` (`STEPS_50_AT_42`) | 4 (steps 0/3/4/10) | 10 |
| ch4-51-assembly-programming | `in = 100 → 103` (`STEPS_51_AT_100`) | `in = 200 → 203` (`STEPS_51_AT_200`) | 4 (steps 0/3/4/10) | 10 |
| ch4-52-circumference | `r = 200 → 176` (`STEPS_52_AT_200`) | `r = 9 → 54` (`STEPS_52_AT_9`) | 8 (steps 0/7/8/14) | 14 |

Both checks of a level are `kind: 'program'`, `from: 'player'`, one reader (`bytes` for 50, `asm`
for 51/52), no `source`. Module and per-level comments were rewritten: the old "ONE WALK IS ONE
EXECUTION … a program that hard-codes 176 can pass it" admission is gone, replaced by the R9
two-walk rule (`runChecks` builds a fresh `Simulation` per check, `ticksUsed` merges as
`Math.max`), and each walk note now explains why its VECTOR PAIR is spoof-proof together (105 is
not hard-codable at tick 4; 47 is, and the sibling walk rejects that constant — same for 103/203
on 51, 176/54 on 52). Hint/brief text unchanged (deferred items stay deferred).

### 2. `threeStar` re-measured — 10/10/14 confirmed, unchanged

The live `grade()` pin is intact and now measures the two-check runs: `m.tick` is the merged
`Math.max` of both walks' `ticksUsed`, and same-shaped walks merge to the single walk's last
assertion. Verified, not assumed: the test asserts `spec.threeStar` `toEqual` the measured
`{ gate: m.gate, delay: m.delay, tick: m.tick }` with the literal 675/6 pins kept AND now also
pins the measured/stated tick literally:

```
expect(CH4_BATCH1.map((spec) => lastAssertedTick(spec))).toEqual([10, 10, 14]);
expect(CH4_BATCH1.map((spec) => spec.threeStar?.tick)).toEqual([10, 10, 14]);
```

(`lastAssertedTick` now reads the last assertion **across both checks** — ruling 3's tick.)

### 3. Counterexamples — constant spoofs (RED first, then GREEN)

New `SPOOF` table in the test: one **input-ignoring constant program per level** that publishes
the expected answer on the reveal tick. Each test asserts three things: the spoof compiles and
**reads no input** (no move-from-inp opcode `10_110_xxx` / `0xB0–0xB7` in the bytes, no `inp` in
the assembly); the spoof **passes the walk it was built for when that walk runs alone** (right
answer, right tick, input ignored — the invariant ruling R9 protects); and the **level rejects
it** (`runChecks` false) at the sibling walk's reveal tick with the expected/actual pair.

| level | spoof (constant program) | reproduces | caught at |
|---|---|---|---|
| 50 | `00101111 10000001 10000010 10000011 10000111` = `loadi\|47`, `move\|s0\|d1/d2/d3`, `move\|s0\|out` | walk 2: 47 at tick 4 | tick 4, expected 105, actual 47 |
| 51 | `loadi\|52, move\|s0\|d1, move\|s0\|d2, nor, move\|s3\|out` (203 = ~52) | walk 2: 203 at tick 4 | tick 4, expected 103, actual 203 |
| 52 | the finding's nine instructions: `loadi\|63, move\|s0\|d1, loadi\|50, move\|s0\|d2, add, move\|s3\|d2, move\|s0\|d4, add, move\|s3\|out` (63+113=176) | walk 1: 176 at tick 8 | tick 8, expected 54, actual 176 |

**RED** — tests written first, run against the pre-fix single-walk data
(`$NODE $PNPM exec vitest run test/levels/ch4-batch1.test.ts`): **12 failed | 17 passed (29)**.
The finding's hole reproduced exactly:

```
FAIL ... > rejects a program that ignores its input and hard-codes the answer on ch4-52-circumference
AssertionError: ch4-52-circumference passed a program that ignores its input: expected true to be false
```

i.e. `runChecks` PASSED the nine-instruction hard-coded 176 against ch4-52's single walk — the
spoof passing before the fix. The two-vector invariant test also failed (`ch4-50-… carries fewer
than two program checks: expected 1 to be greater than or equal to 2`), as did the walks/vectors
table and the one-failure-per-run expectations (`expected [ 'missing-program' ] to deeply equal
[ Array(2) ]`).

**About 50/51's RED:** no constant spoof can pass their FIRST walk — at tick 4 a program that
ignores the input has executed four setup instructions, and the values reachable in a register by
then are a bare immediate (0–63), its complement (192–255), twice an immediate (even, ≤126), 255
or 254 (from `nor`/`nand`/`add` on the zeroed register file); 105 and 103 are odd and in
(63, 192), so they are unreachable. Their RED failure was therefore the *solo* assertion
(`spoof does not reproduce its own walk`), because the second walk did not exist yet — the spoofs
above target walk 2 (47 and 203 ARE reachable, as bare immediate and as `~52`), which is exactly
the walk a single-walk level with those vectors would accept. Per the fix instructions' fallback
clause, the assertion each level carries is the stated invariant: **each level rejects at least
one program that produces the right answer at the right tick while ignoring its input** — proven
by `solo.passed === true` plus the rejection.

**GREEN** — after `src/levels/content/ch4/batch1.ts` got its second walk per level:
`✓ test/levels/ch4-batch1.test.ts (29 tests) 132ms — Tests 29 passed (29)`. All three spoofs now
fail `runChecks` at the sibling walk's tick with the exact expected/actual bytes in the table.

### 4. Empty/corrupt/refusal tests adjusted (meaning kept)

With two checks each `runChecks` call reports one failure per check; expectations updated from
exactly one to two, and details asserted on **every** record (not just `[0]`):
vacuum (`''`, whitespace, `'\n\t\n'`) ⇒ `['missing-program', 'missing-program']`, every detail
naming the player's buffer; comment-only (zero bytes) ⇒ `['missing-program', 'missing-program']`,
every detail containing `zero bytes`; parse/assembly errors ⇒ `['invalid', 'invalid']`, every
detail carrying the reader's own line number (`program image failed at line 3`, `program assembly
failed at line 6/10`, `line 2` + `8 binary digits`, `loadi|99` field refusal at `line 2`); a
refused program still drives nothing (the whole record is `['invalid', 'invalid']`, no
mismatches). The sabotaged-program test now pins the FIRST walk's mismatch explicitly
(`f.expected.out === answerOf(spec)`), since both walks report theirs.

### 5. Untouched (deferred by the ruling)

Hints containing full solutions, the `SOURCED`/`AUTHORED` marker regex lazy-blob, the missing
"no player buffer at all" (`runChecks` without 4th argument) case, and `threeStar.tick`
semantics: not touched. No engine, campaign or content-index edits.

### Tests run (bundled node + pnpm.mjs, repo root)

```
$ $NODE $PNPM exec vitest run test/levels/ch4-batch1.test.ts     (RED, before the data fix)
  Tests  12 failed | 17 passed (29)
  ... ch4-52-circumference passed a program that ignores its input: expected true to be false

$ $NODE $PNPM exec vitest run test/levels/ch4-batch1.test.ts     (GREEN, after)
  ✓ test/levels/ch4-batch1.test.ts (29 tests) 132ms
  Test Files  1 passed (1) / Tests  29 passed (29)

$ $NODE $PNPM test
  Test Files  46 passed (46) / Tests  1435 passed (1435)          (baseline 1431 + 4 new)

$ $NODE $PNPM build
  tsc --noEmit clean; vite build ✓ 64 modules, built in 80ms
```

### Decisions I made on my own

1. **Spoof choice for 50/51** (the instructions asked for "the same class of cheat (constant
   built from immediates timed to the reveal tick)"): 50 uses `loadi|47` + three filler moves +
   `move|s0|out` (47 is a bare immediate, so it is the reachable constant of walk 2); 51 uses
   `loadi|52, move|s0|d1, move|s0|d2, nor, move|s3|out` (203 = ~52, the reachable complement).
   Both hit their reveal tick exactly and ignore the input; the analysis above explains why no
   such cheat can hit 105/103 at tick 4, which is why their spoofs aim at the added vector.
2. **Per-level `it` blocks for the spoof test** (instead of one loop test) so the RED/GREEN
   evidence is reported per level — the run above shows ch4-52's hole directly instead of being
   masked by an earlier level's failure.
3. **The `solo` run** — each spoof test executes its program against a one-check copy of the spec
   (`{ ...spec, checks: [programsOf(spec)[walk]] }`), which is literally the retired single-walk
   shape, to prove the spoof reproduces "the right answer at the right tick while ignoring its
   input" before asserting the two-check level rejects it.
4. **Mechanical "reads no input" assertion** — the spoof's compiled bytes must contain no
   `0xB0–0xB7` (the move-from-`inp` opcode range), rather than trusting the comment.
5. **`lastAssertedTick` now takes the max across all checks** (ruling 3's "last assertion across
   both checks"), and the measured tick got the literal `[10, 10, 14]` pin quoted above.
6. `pnpm smoke` was not run (not in this round's toolchain; `pnpm test` + `pnpm build` are the
   named gates and both are green). Nothing under `.superpowers/` staged or committed.

