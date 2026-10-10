# Task 8 report — 第 53–56 关 (`src/levels/content/ch4/batch2.ts`)

**Status: DONE**
**Commit:** `69c8d6a` `feat(levels): add chapter 4's closing four levels` (exactly three files:
`src/levels/content/ch4/batch2.ts`, `test/levels/ch4-batch2.test.ts`, `test/fixtures/ch4-references.ts`)

## 1. What was implemented

Four pure-data levels, `CH4_BATCH2`, index 53–56, chapter 4, **not** registered into
`campaign.ts` / `content/index.ts` (that is Task 9). Both languages of `brief` and `hint`,
`SOURCED`/`AUTHORED` provenance comments per level, the chapter's own `BOARD_PARTS` palette
(no rewards), and measured `threeStar` targets.

| # | id | io | checks | board |
|---|---|---|---|---|
| 53 | `ch4-53-conditional-jumps` | `n:8 → out:8` | two `program` (player, asm), vectors 10 / 1 | `overtureBoard({ inputId: 'n' })` (halt default) |
| 54 | `ch4-54-code-breaker` | `match:8 → try:8` | `custom: lock`, `params { secret: 42, budget: 1024 }` | `overtureBoard({ inputId: 'match', halt: false })` |
| 55 | `ch4-55-mod-4` | `in:8 → out:8` | two `program` (player, asm), vectors 42 / 255 | `overtureBoard({ inputId: 'in' })` (halt default) |
| 56 | `ch4-56-the-maze` | `sensors:8 → move:8` | `custom: maze`, `params { grid, budget: 1024 }` (facing default east) | `overtureBoard({ inputId: 'sensors', halt: false })` |

`test/fixtures/ch4-references.ts`: four entries **appended** (format `'asm'` for all four, as the
brief pins), each the controller's pre-verified text from `reference-programs.md`; the module
comment was extended to say so. No board enters the fixture (ruling 1).

## 2. TDD evidence

**RED (before the implementation existed).** Freeze-frame of the first run:

```
❯ test/levels/ch4-batch2.test.ts (0 test)
FAIL  test/levels/ch4-batch2.test.ts
Error: Cannot find module '../../src/levels/content/ch4/batch2'
  imported from D:/Documents/turing-complete/test/levels/ch4-batch2.test.ts
Test Files  1 failed (1) / Tests  no tests
```

Command: `& $NODE $PNPM vitest run test/levels/ch4-batch2.test.ts`.

**First GREEN attempt (guided by the failing assertions, not by hand-tuning).** With the level
data and the fixture in place, 33/35 passed and the two failures were the *same factual
disagreement* about the maze's tick:

```
FAIL > pins every three-star target to its reference solution own metrics
  ch4-56-the-maze target is not its reference's metrics:
  expected { gate: 675, delay: 6, tick: 258 } to deeply equal { gate: 675, delay: 6, tick: 168 }
FAIL > states each closed-loop level's tick as the checker's own report
  ch4-56-the-maze ticksUsed moved: expected 168 to be 258
```

My written prediction (258) was wrong; the measurement through the real kernel is **168**. I
re-derived the arithmetic (`jz` jumps to address 23, so the forward branch's `out` sits at pass
offset 14, not 24 — the earlier figure double-counted the pass) and pinned 168 everywhere. That
is the correct direction of repair: the pin follows the measurement, not the other way round.

**GREEN, final:**
`pnpm test` → **47 files / 1470 tests passed** (baseline was 46 / 1435; +1 file, +35 tests).
`pnpm build` → `tsc --noEmit && vite build` clean.

## 3. Measured metrics behind each `threeStar`, and how they were measured

Every target is re-derived inside the test rather than restated:
`grade(graphFromBoard(level.id, level.board), registry, spec, { text: CH4_REFERENCES[id].program })`
and the test asserts `spec.threeStar` `toEqual` the metrics `grade` returns, plus the literal
list `[135, 590, 10, 168]`.

| # | gate | delay | tick | where the tick comes from |
|---|---|---|---|---|
| 53 | 675 | 6 | **135** | `Math.max` of the walks' last assertions: n=10 walk asserts at ticks 0/128/129/135 (answer 55 revealed at 129), n=1 walk at 0/11/12/18 (answer 1 at 12). The reveal tick is the program's shape: the loop is instructions 1–13, the exit pass 1–11, so `out` (address 14) is reached on tick 13n−1. |
| 54 | 675 | 6 | **590** | The `lock` checker's own `ticksUsed`: the read at which `try == 42`. Candidate *k* is published at tick 2+14k (the publish at address 2 is the loop head, 14 instructions per pass), so 2+14·42 = 590. Budget 1024 sits 434 ticks above it. |
| 55 | 675 | 6 | **10** | The walks' last assertion (both walks): answer on tick 4 — the index of `move|s3|out` — held to tick 10 by the halt. |
| 56 | 675 | 6 | **168** | The `maze` checker's own `ticksUsed`: nine full 17-instruction passes of the wall follower (153) plus the tenth move's `out` fourteen instructions into its pass (167), then the arrival edge (+1). Re-measured independently as the mirror case `custom-maze.test.ts` records at 168 for the right-hand rule. |

`halt` is a 0-cost part, so both board shapes measure 675 gates / 6 delay, as the brief's table
says; the test asserts both numbers for all four levels.

## 4. The maze: grid, solvability, and why "always forward" fails

```
########
#S.....#
#.#.##.#
#.#..#.#
#.##.#.#
#....#G#
########
```

`S` at (1,1) facing **east**; `G` at (6,5); no `facing` param (the checker's default).

**Why it is solvable, and by the reference rule.** It is `custom-maze.test.ts`'s right-hand grid
flipped top to bottom. A reflection swaps left for right and clockwise for anticlockwise while
leaving east and west alone, so a right-hand maze becomes a left-hand one: the reference program
(`reference-programs.md` ch4-56 — read sensors at address 0, every loop-back to 0, left open →
turn left, else ahead open → forward, else right) walks the mirror of that test's route — five
cells east along the top corridor, a right turn at the wall, four south onto `G`, ten moves. The
mirror prediction is confirmed by the clock: 168 ticks here, the same number that test measured
for the mirrored route.

The test asserts the three properties ruling 3(a) asks for instead of eyeballing them: the grid is
rectangular; the whole border is wall; there is no 2×2 block of open cells anywhere (corridors are
one cell across); exactly one `S` and one `G`, on different cells; and a breadth-first walk from
`S` reaches `G`.

**Why "always forward" must fail, and does.** The top corridor ends at a wall at (7,1), two cells
before the goal's column, so a program that only publishes `move = 1` drives into it. The
counterexample is the honest four-instruction spelling on a machine whose `out` is combinational —
`loadi|1`, `move|s0|out`, `loadi|0`, `j` — which publishes 1 only at ticks ≡ 1 (mod 4): the robot
advances to (6,1) over five such ticks and the sixth (tick 21) is the collision. Asserted in the
test: `passed === false`, the failure's `actual` is `{ move: 1 }`, its tick is 21, and its detail
names the cell and facing it walked from — `(6,1) facing east`.

## 5. Counterexamples the brief demanded

* **53 / 55 — R9 (input-ignoring constant).** One spoof per program level, built by
  `constantAtTick(byte, tick)` (`loadi|byte`, then `move|s0|d1` fillers to push `out` to index
  `tick`). Each is proven to read no input (no byte matching `10_110_NNN`), and each **passes the
  walk it was built for when run alone** (`{ ...spec, checks: [thatWalk] }`) and is rejected by the
  level: 53's constant 1 (revealed at tick 12 for the n=1 walk) is caught by the n=10 walk at tick
  128 (expects 0, gets 1) and again at 129 (expects 55, gets 1); 55's constant 3 (tick 4 for the
  255 walk) is caught by the 42 walk at tick 4 (expects 2, gets 3).
* **53 / 55 — sabotage, one bit from the reference.** 53: the accumulator's `add` (01_000_000)
  becomes `sub` (01_001_000) → 251 instead of 55 at tick 129 (the n=1 walk is unchanged, which the
  test notes). 55: `or` (01_011_000) instead of `and` (01_010_000) → 43 instead of 2 at tick 4.
* **54 — the reference's own algorithm with a stride that steps over the secret** (the increment
  becomes `loadi|4`, so it publishes 0, 4, … 40, 44 … and never 42) is rejected at tick 1024 with
  `expected { try: 42 }`; plus the empty buffer (`missing-program`, `ticksUsed 0`) and an
  unassemblable line (`invalid`, `line 1`).
* **56 — always forward** (above), plus a turn-only program (budget failure at 1024, naming the
  cell it gave up in) and the empty buffer.

## 6. Files changed

* `src/levels/content/ch4/batch2.ts` (new, 488 lines) — the four levels.
* `test/levels/ch4-batch2.test.ts` (new, 1121 lines) — 35 tests over the two shapes.
* `test/fixtures/ch4-references.ts` (modified, +157/−4) — four entries appended, module comment
  extended; the three batch-1 entries untouched.

No engine, checker, campaign or content-index file was touched.

## 7. Self-review findings

1. **Corrected by measurement:** the maze's tick was 258 in my first draft and is 168 in fact; the
   cause (a taken `jz` puts the forward branch's `out` at pass offset 14, not 24) is written into
   the level comment so the number is auditable. Two other predictions — 53's 13n−1 and 54's
   2+14·42 = 590 — held exactly.
2. **The pins are self-checking:** the test re-grades and compares `threeStar` with the metrics, so
   a future drift in a program, a grid or a budget is red rather than a stale number.
3. **`testcases.test.ts:113-114`** skips its per-check case-count assertion for levels with more
   than one check. It does not bite here at all, because this batch is not in `LEVELS` until Task
   9 — noted as expected rather than surprising.
4. **Registration is a test-only side effect for now:** nothing under `src/levels` imports the two
   checkers (`checks.ts` only looks ids up), so `ch4-batch2.test.ts` names
   `src/levels/custom/lock` and `src/levels/custom/maze` as side-effect imports. Task 9's
   registration will need the same naming on the content path.
5. **`out`'s combinational limitation on 54 is recorded, not glossed:** the level brief and hint in
   both languages say the sampled `match` is always 0 and that the criterion is "the secret byte
   was published within the budget"; a test asserts those sentences are present, so a future edit
   cannot quietly start claiming the CPU reacts to `match`.
6. **The maze is not a perfect (loop-free) maze** — it contains one cycle, inherited from the
   mirrored grid. Ruling 3 does not require a tree, and every property it does require is asserted;
   the follower reaches `G` before the cycle matters (measured). Flagged in case a reviewer reads
   "single-cell-wide" as "perfect".
7. **The lock is passable by a program that publishes the constant 42**, if the player knows the
   secret. That is the checker's documented contract (it passes on the byte it reads) and the
   level's own known limitation, not something this task could change without a semantics ruling.

## 8. Concerns

* Budgets (1024 both) are mine, as the brief leaves both open; they are 1.7× the lock's and 6× the
  maze's measured reference cost, and they bound the cost of a wrong program per board edit. If the
  controller wants a stated house rule for closed-loop budgets, these two numbers should be
  reconciled with it.
* The maze grid is a mirror of an existing test's grid rather than a fresh design; the reason (the
  reference program implements the *left*-hand rule) is documented, and the always-forward
  counterexample is specific to it.
