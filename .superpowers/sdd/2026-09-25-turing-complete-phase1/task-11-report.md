# Task 11 report — chapter 2, levels 28–38 (storage and timing)

Worktree: `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`)
Commit: `650d19c` — *feat(levels): chapter 2 batch 4 -- levels 28-38, storage and timing*
Files added: `src/levels/content/ch2/batch4.ts` (1138 lines), `test/levels/ch2-batch4.test.ts` (1739 lines).
`.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md` was left modified and **not** committed, as instructed.
No other file was touched (`src/core/`, `src/ui/`, `src/app/`, `src/levels/checks.ts`, the other batches and
`src/levels/content/index.ts` are all unchanged; `ch2/index.ts` still assembles batch 1 alone).

---

## 1. The one thing that had to be established before authoring

**The `script` checker's tick semantics are not the obvious reading**, and eleven levels of scripts hang off them.
`runChecks`'s script branch (`src/levels/checks.ts`, lines 921–944) does, per step, in this order:

```js
for (const pin of spec.io.inputs) io.writeInput(pin.id, step.inputs?.[pin.id] ?? 0);
io.sim.settle();
while (io.sim.tickCount < step.tick) io.tick();
if (step.expect) { /* read outputs now */ }
```

So:

1. **`tick` is an ABSOLUTE target**, and a step runs `step.tick − previousTick` edges. A step at tick 0 runs **no
   edge at all**, which is why every generated walk in this batch starts with a tick-0 step and starts writing one
   tick in (level 37's writes are ticks 1–256, its read-backs 257–512).
2. **A step's inputs drive the edges that reach that step's tick**, so an `expect` at tick T reads the value the edge
   into T just sampled. A delay line therefore reads **exactly like a wire** while the input changes at every step.
   The only way a script can show a value is *held* is a **second step at the same tick**: no edge, new inputs, old
   value still required.

I proved both with a throwaway scratch test before writing any level data, and the first version of that test was
**wrong in exactly the way the brief warned about** — it expected a one-tick delay to lag by one step, and the run
failed at tick 2 (`expected out 1, actual 0`). After the correction the scratch test verified, in one run: the
absolute-tick/edge-before-read order; `mem1`'s hold-vs-sample rule; `counter8`'s wrap at 256 and `reset` beating `en`;
`ram8`'s full-range write/read-back; the loop-through-`delay_line` latch settling; a two-NOT ring and a cross-coupled
NOR latch both throwing `UnstableCircuitError`; the loop latch's metrics (8/3) and the hand-built 8-bit incrementer's
(41 gates / 7 delay). Logs: `task-11-scratch-semantics-1-guess.log` (RED) and
`task-11-scratch-semantics-2-verified.log` (GREEN). The scratch file itself was deleted before the commit.

That measurement is also **documented in the module header** of `batch4.ts` (the `runChecks` / `ABSOLUTE` / `SAME tick`
paragraph) and asserted structurally by the test block *"the script levels hold a value across edges, not just within
one"*, which requires each of levels 28, 29, 35 and 36 to contain at least one same-tick pair with different inputs and
the same expectation, and a run of consecutive ticks (0..n, no gaps).

---

## 2. The eleven levels

`gate/delay/tick` below are the **measured** metrics of the reference the level's `threeStar` was measured from; the
test asserts `level.threeStar` equals those metrics exactly for all eleven.

| # | id | io | checker | reference (the measured answer) | gate/delay/tick | rewards |
|---|---|---|---|---|---|---|
| 28 | `ch2-28-circular-dependency` | `set:1 value:1 → out:1` | script, 9 steps (4 same-tick pairs) | loop: `not` + two `switch` + `or` + `delay_line` | 8 / 3 / 4 | `ram8` |
| 29 | `ch2-29-delayed-lines` | `a:8 → out:8` | script, 10 steps (4 pairs) | `delay8` | 0 / 0 / 4 | `reg8` `delay8` |
| 30 | `ch2-30-odd-ticks` | `enable:1 → out:1` | script, 24 steps **+** script, 8 steps | `const_on` + `mem1` + `xor` | 4 / 1 / 23 | — |
| 31 | `ch2-31-bit-inverter` | `a:1 inv:1 → out:1` | truth-table, 4 rows (`truthTable`) | `xor` | 4 / 1 / 0 | — |
| 32 | `ch2-32-bit-switch` | `a:1 on:1 → out:1` | truth-table, 4 rows | `and` | 2 / 1 / 0 | — |
| 33 | `ch2-33-input-selector` | `a:8 b:8 sel:1 → out:8` | fuzz, seed `0x3308`, 256 rounds | `mux8` | 32 / 1 / 0 | `mux8` |
| 34 | `ch2-34-the-bus` | `a:8 b:8 sel:1 → out:8` | truth-table, 4 authored rows | `mux8` | 32 / 1 / 0 | — |
| 35 | `ch2-35-saving-gracefully` | `d:1 load:1 → out:1` | script, 11 steps (5 pairs) | `mem1` | 0 / 0 / 5 | — |
| 36 | `ch2-36-saving-bytes` | `d:8 load:1 → out:8` | script, 14 steps (6 pairs) | `reg8` + `const_off` | 0 / 0 / 6 | `counter8` |
| 37 | `ch2-37-little-box` | `d:8 addr:8 load:1 → out:8` | script, 513 steps | `ram8` | 0 / 0 / 512 | — |
| 38 | `ch2-38-counter` | `en:1 reset:1 → out:8` | script, 265 steps | `reg8` + hand-built incrementer | 41 / 7 / 263 | — |

Every level carries a `SOURCED` / `AUTHORED` data comment in the shape `batch1.ts` established, and the test's marker
block asserts both words are present for all eleven, plus five specific notes (see §6).

**Sourced vs authored, per level** (the source fixes name, position and one concept line only — no ports, widths, pass
conditions, targets or rewards):

- **28 Circular Dependency / 循环依赖** — SOURCED: `引入反馈回路概念，构建基本锁存器`. AUTHORED: the `set/value` shape, the
  nine-step script, the target, the `ram8` reward, the palette. The comment records (a) that the level's core assertion
  is that `settle()` does **not** raise `UnstableCircuitError`, with no check kind of its own, (b) why the palette
  withholds `mem1`, and (c) that `ram8` is awarded but not listed (one-bit level / eight-bit part).
- **29 Delayed Lines / 延迟线** — SOURCED: `信号延迟一拍输出`. AUTHORED: `a:8 → out:8`, the script and its same-tick
  pairs, the target, the rewards, the palette. Records that a delay and a wire are indistinguishable under the
  checker's semantics unless the check re-reads a tick, and that three spellings (`delay8`, eight `delay_line`s, a
  `reg8` with `load` high) tie at 0/0/4.
- **30 Odd Ticks / 奇变偶不变** — SOURCED: `构建振荡电路（时钟信号发生器）`; **no period, no duty cycle, no gating rule**.
  AUTHORED: everything computable — `enable:1 → out:1`, the two-tick period, the *hold* rule when `enable` is low, the
  sixteen alternating + four held + four resumed ticks and the eight held-low ticks, the target, the palette. The
  comment quotes the source line, says the period and the hold are authored, contains 周期 / periodicity, and states
  that a single tick would prove nothing.
- **31 Bit Inverter / 1 位取反器** — SOURCED: `使用 XOR 进行位翻转`. AUTHORED: which pin is the control (`inv`, the
  source names the gate and not the pins), the four rows, the target, the one-bit palette.
- **32 Bit Switch / 1 位开关** — SOURCED: `条件通断信号（类似与门但可级联省或门）`. AUTHORED: the shape, the rows, the target,
  the palette. The comment records that the source's "like an AND gate" is *measured*: `and` and the registered
  `switch` part are both 2 gates / 1 delay, asserted as a tie.
- **33 Input Selector / 数据选择器** — SOURCED: `2-to-1 多路复用器（MUX）`. AUTHORED: the byte shape, the fuzz check
  (seed, rounds, pin maps, expectation), the target, the `mux8` reward, the palette.
- **34 The bus / 总线** — SOURCED: `共享数据传输线路的概念` **and nothing else**. AUTHORED: the reframing (see §3), the
  four-row table and its vectors, the target, the palette. The comment also records that the source's concept is not
  computable in this engine *and why*, quotes spec 3.1's own words, and says the level teaches **driver selection**.
- **35 Saving Gracefully / 优雅存储** — SOURCED: `1 位锁存器/寄存器（条件写入）`. AUTHORED: the shape, the eleven-step
  script, the target, the palette. The comment records that this is level 28's rule under different pin names (framed
  as *use the part* where 28 is *build the loop*), and gives the built alternative's measured price (8 gates / 3 delay,
  one star).
- **36 Saving Bytes / 存储一字节** — SOURCED: `8 位寄存器`. AUTHORED: the shape, the script, the target, the `counter8`
  reward, the palette. Records the eight-`mem1` tie and that `counter8` cannot answer the level.
- **37 Little Box / 小盒子** — SOURCED: `刚好装满存储空间的电路设计`; no capacity, no address width, no definition of
  "full". AUTHORED: **the definition** (all 256 bytes of a `ram8` addressable and writable, every address reading back
  what was written), the 513-step check, the target, the palette. The comment says the definition is the level's
  contract, that it is stated in the brief, and that a two-address check would not test 装满.
- **38 Counter / 计数器** — SOURCED: `自增寄存器` **and the achievement** `成就：≤ 65 个门`. AUTHORED: the shape, the
  265-step script, the target, the palette. The comment records the achievement, says in full that it is an
  **achievement, not a pass condition**, explains the basic-gate vs NAND-equivalent distinction, and gives the
  measured `threeStar.gate` (41) with the reason it is that number and not 65 (§7).

---

## 3. The three source facts that needed explicit handling

**Level 30 — periodicity over many ticks.** The check states sixteen consecutive enabled ticks whose expectations are
exactly `0,1,0,1,…` (eight whole periods, every consecutive pair differing), then four ticks with `enable` low that
must all read the `1` the last enabled tick left, then four more that resume the beat from that held value
(`1 XOR 1 = 0` first). A second script check holds `enable` low from reset for eight ticks and demands `0` throughout.
The test measures that shape *out of the check data* — the enabled ticks must be `0..15`, their expectations must be
`i % 2` with eight highs and eight lows and no two equal in a row; the held ticks must be `16..19` and all expect the
tick-15 value; the resumed ticks `20..23` must expect `0,1,0,1`. It then grades three circuits against it: the
reference passes, a clock that never ticks fails at tick 1 (`expected 1, actual 0`), and an **ungated** oscillator
(`mem1` with `value = NOT out`) satisfies all sixteen beats and fails at **tick 16**, the first held tick
(`expected 1, actual 0`).

**Level 34 — the change of kind.** Spec 3.1 forbids a bus protocol (`不做总线协议（多驱动仲裁）`), `validateGraph` reports a
second wire on one input pin as a `multiple-drivers` **error**, and nothing in the kernel arbitrates between drivers.
The level is reframed as "exactly one driver is active at a time": `out` equals the selected line. Both the **brief**
(both languages) and the **data comment** say this plainly — the brief carries 没有总线协议 / 多驱动 / 仲裁 and
"no bus protocol" / "multi-driver" / "arbitration"; the comment carries the source's own 共享数据传输线路的概念, the
intact phrase 多驱动仲裁, `3.1`, the word `kind`, and `driver selection`. The test asserts every one of those strings,
in both the brief and the extracted comment.

**Level 37 — the definition of 装满, and the coverage that asserts it.** The brief states the definition
(256 cells, `addr` 0–255, every address writable and read back). The check is 513 steps: step 0 (tick 0, no edge)
asserts the post-`reset` state; steps 1–256 write a **distinct** byte into every address 0..255 with `load` high, one
edge each, asserting the byte on the output on the same step; steps 257–512 re-read every address with `load` **low**
and `d` driven with the **complement** of the stored byte, after all 256 writes have happened. The values come from
`boxByte(k) = (k*7 + 1) & 0xff`, a bijection of 0..255, so no two cells hold the same value. The test asserts: 513
steps; write step *i* has `addr = i`, `load = 1`, `d = expected`; the 256 written bytes are **all distinct**; read
step *i* has `addr = i`, `load = 0`, `d = ~expected`; and every address reads back exactly what was written into it.
Two circuits are graded against it: a single `reg8` that ignores `addr` fails on the **first** read-back (tick 257,
with `expected` the byte address 0 was written with), and a wire from `d` — which passes all 256 write steps — fails at
that same step because `d` is the complement of the expected byte.

---

## 4. Stability (level 28)

The reference genuinely contains a feedback loop: `validateGraph` reports `feedback-loop` (severity *warning* — legal,
because only the simulator can tell whether a loop with storage settles), it has no error-severity issue, and
`new Simulation(compile(graph, registry), registry).reset()` completes without throwing. The same graph is graded and
passes.

The other side is asserted directly against the kernel, three times: a cross-coupled NOR latch wired from `and`/`nor`
gates (the textbook latch with no storage element in it), a single `NOT` feeding itself, and two `NOT`s in a ring. Each
must have no validation *error* (so it is a legal document, not a malformed graph), must throw `UnstableCircuitError`
from `reset()`/`settle()`, and must fail the level with a failure record whose `reason` is `'unstable'`. Asserting only
that the reference passes would have proved nothing about loops, which is why both directions are in the test.

`mem1` (the packaged latch, whose pins *are* level 28's pins) is also graded: it passes, at 0/0/tick 4 — i.e. it would
beat the level's gate/delay target if it were offered, which is precisely why it is not (see §5).

---

## 5. Palettes: what each level offers, and the four withholdings

The batch inherits batch 2's rule: offer the parts unlocked at or before the level whose pins can **attach**, plus the
level's own rewards, **minus** any part that is not its own reward and would **answer the level by itself**.

- **Level 28 withholds `mem1`.** `mem1` is unlocked (chapter 1's level 12 rewards it), its pins are exactly
  `set`/`value` → `out`, and one drop-in would answer the level while hiding the loop the source's own line asks the
  player to build. The test asserts it is absent from the palette *and* measures that it would pass at 0/0/tick 4.
  It is offered from level 35 on, whose concept *is* the packaged conditional write.
- **Level 38 withholds `counter8`.** Unlocked by level 36, not level 38's own reward, pins exactly `en`/`reset` →
  `out`. Offered it would score 0 gates / 0 delay in one component, and would make the source's own ≤ 65-gate
  achievement vacuous — the same argument batch 2 used for `add8` on level 22. The test asserts it is absent and
  measures the drop-in (0/0/tick 263). `add8` *is* offered, as the correct-but-costlier alternative (72 gates /
  1 delay, one star).
- **`ram8` is not listed on level 28** although it is that level's reward: every pin there is one bit wide, so an
  eight-bit part has nothing to attach to (batch 1's level-14 reason). The reward is still handed out; level 37 uses it.
- **`counter8` is listed on level 36** (its own reward, and it cannot answer a conditional write: it has no way to take
  a byte in). It is not listed on level 37 (it is not a holder) — the storage parts offered there are the ones that can
  hold a byte (`delay8`, `mem1`, `reg8`, `ram8`).

The test walks `CH1_PART1 + CH1_PART2 + CH2_BATCH1 + CH2_BATCH2 + CH2_BATCH3 + CH2_BATCH4` in order, adding each
level's rewards before checking its own palette, and asserts every listed part is unlocked at or before that level;
it also asserts every reference instance's def is in its level's `allowedComponents` (the same pair of checks
`batch1`/`batch3` use, which together imply the app's computed palette can build every reference).

---

## 6. What was tested (126 tests in the new file), and the results

Structural: indices `[28…38]`, chapter 2, the `ch2-<index>-<slug>` ids, `pinsOf` per the brief's table, the checker
kind per the brief (2 truth-table + 1 fuzz + 8 script levels, level 30 with two scripts), names in both languages in
the source's order, non-empty briefs/hints, briefs that do **not** copy the source's Chinese concept lines verbatim,
palette gating both ways, the vacuity invariant (five-branch copy, so an empty script or a script that expects nothing
is a failure), the rewards table, the truth tables' contents (31: XOR; 32: AND; 34: selection over four vectors), the
fuzz metadata (integer non-zero seed, 256 rounds, exactly the level's pins), the brief strings for level 34 and level
37, level 38's step-by-step script shape (265 steps, ticks monotonically non-decreasing, `255 → 0` at the wrap, the
`en=1 & reset=1` step expecting 0, the final same-tick re-read), and the `counter8` withholding.

Behavioural: every reference passes with three stars; **`threeStar` equals the reference's measured metrics exactly**
for all eleven; every reference is buildable from its level's palette list; all eleven plausible-wrong circuits are
graded-and-wrong (failures non-empty, 0 stars) with the specific first failure asserted where it is informative
(level 29's two-tick delay fails at tick 1; level 30's free-runner at tick 16 and the stuck clock at tick 1; level 35's
always-loading latch at tick 1; level 37's address-ignoring register and its `d`-wire at tick 257; level 38's
no-reset counter at tick 1); an empty circuit fails all eleven levels without throwing; the level-28 stability block
(both directions, §4); level 30's periodicity block (§3); level 37's full-range block (§3); level 33's fuzz coverage
(both `sel` values appear well over 50 times each in the level's own fixed-seed 256 rounds, the sequence repeats
exactly on a second run, more than 100 distinct vectors, and `out ← a` fails on the first round whose `sel` is high,
with the failure's round, vector, expectation and actual all checked); and the "what each answer costs" measurements:

- level 29: `delay8`, eight 1-bit delay lines, and a `reg8` with `load` high **tie** at 0/0/4, three stars;
- level 36: eight `mem1`s **tie** `reg8` at 0/0/6;
- level 32: the `switch` part **ties** the `and` at 2/1/0 — measured, so offering the part the level is named after
  costs nothing;
- level 35: the hand-built loop is correct and costs 8 gates / 3 delay units, one star (the packaged `mem1` is the
  floor because storage is free on both metrics);
- level 31: the sum-of-products spelling is 9 gates / 3 delay units, one star against the XOR's 4/1;
- levels 33 and 34: the hand-built selector is **25** gates (three NANDs per bit plus one shared inverter) but three
  components deep, so it is one star — declined by the **delay** column, not the gate one;
- level 38: the `add8(x, 0, 1)` counter is 72 gates / 1 delay, one star.

Results: focused file **126/126 passed**; full suite **803/803 passed in 22 files**; `tsc --noEmit` **exit 0** with no
diagnostics; `pnpm build` **exit 0** (34 modules, `dist/assets/index-B6n3qmhT.js` 60.76 kB).

---

## 7. TDD evidence

1. **RED 1** — the test file was written first (1739 lines, importing `CH2_BATCH4`), then run:
   `Cannot find module '../../src/levels/content/ch2/batch4'`, 0 tests, exit 1.
   Log: `task-11-logs\task-11-red-1-module-missing.log`.
2. **Implementation** — `batch4.ts` written (levels, data comments, generated scripts).
3. **RED 2** — the first run against the level data: **5 failed / 120 passed**, and every failure was a real defect in
   my own work, caught by the test:
   - level 30's comment lacked the literal `周期`; level 34's comment had `多驱动仲裁` split across two `*` lines by a
     line wrap; the module header said "SAME tick" where the test looked for "same tick" (three marker failures);
   - the level-31 "correct but costlier" alternative used `xnor(a, inv)`, which is the **complement** of the function
     the level asks for — a wrong claim, replaced by the sum-of-products spelling (9 gates / 3 delay), and the run
     showed all four rows mismatching;
   - the gate-built selector was expected to be 33 gates; it measures **25** (a NAND is one NAND equivalent, so the
     eight bits really do share one inverter), which also corrected the level's comment: the target declines that
     construction on **delay**, not on gates.
   Log: `task-11-logs\task-11-red-2-assertions.log`.
4. **GREEN** — 126/126; focused log `task-11-logs\task-11-green-focused.log`, plus the post-self-review re-run
   `task-11-logs\task-11-green-focused-after-review.log`.
5. The scratch semantics test had its own RED/GREEN pair before any level was authored:
   `task-11-scratch-semantics-1-guess.log` → `task-11-scratch-semantics-2-verified.log`.

---

## 8. Log files (all beside this report, in `task-11-logs\`)

| file | what it is |
|---|---|
| `task-11-red-1-module-missing.log` | TDD RED: the test exists, the level data does not |
| `task-11-red-2-assertions.log` | TDD RED: 5 assertion failures against the first implementation |
| `task-11-green-focused.log` | focused GREEN: 126/126 |
| `task-11-green-focused-after-review.log` | focused GREEN after the self-review comment fixes: 126/126 |
| `task-11-full-suite.log`, `task-11-full-suite-final.log` | full suite: 22 files, 803 tests passed (final run is post-commit) |
| `task-11-tsc.log` | `pnpm exec tsc --noEmit`: no diagnostics, exit 0 |
| `task-11-build.log`, `task-11-build-final.log` | `pnpm build` (tsc + vite build): exit 0 |
| `task-11-scratch-semantics-1-guess.log` | my first (wrong) reading of the script semantics — RED |
| `task-11-scratch-semantics-2-verified.log` | the verified semantics: storage defs, rings, full-range RAM — GREEN |

Absolute directory:
`D:\Documents\turing-complete\.superpowers\sdd\2026-09-25-turing-complete-phase1\task-11-logs\`

---

## 9. Self-review findings (all fixed before the commit)

1. **A dangling sentence** in level 28's comment ("The 1-bit `ram8`... --") — rewritten as a clean paragraph about the
   reward being awarded but not listed.
2. **A stale claim** after the XNOR correction: level 31's `threeStar` comment still said "`xnor` is 5 and one star";
   it now names the sum-of-products spelling (9 / 3).
3. **A stale number** in level 33's `threeStar` comment ("the gate-built 33/3 alternative") — corrected to 25/3, and
   its paragraph now says the delay column, not the gate column, is what declines the hand-built selector.
4. **An overstatement** in level 37's comment ("two specific circuits are graded"): only the address-ignoring register
   was in the `wrong` map. I added the `d`-wire counterexample as its own test rather than weakening the sentence.
5. **An overstatement** in level 38's comment ("65 appears nowhere else in this replica") — it now says 65 is recorded
   as the source's achievement and is not the level's `threeStar.gate` nor any number it grades on.
6. **A wrong count** in the module header ("THREE THINGS" over a list of four) and in level 38's comment ("the third
   time" batch 2's rule is used — it is the fourth, after levels 22, 24 and 28).
7. **A wrong tick count** in level 35's comment ("over eight ticks" for a six-tick script).
8. A describe-block title ("the storage levels tie the constructions they measure") that contradicted its own
   level-35 case (a one-star answer); renamed to "what each level accepts, and what that answer costs".
9. Reviewed the 11 references, all 11 counterexamples and every "measured" number in the prose against the assertions
   that pin them; no remaining number in either file is unmeasured.

---

## 10. Concerns / rulings a reviewer may want to revisit

1. **Level 38's `threeStar.gate` is 41, not 65 — and I believe that is the correct reading, but it is the one place
   the instructions could be read the other way.** The task says "map it to a measured `threeStar.gate` and say in the
   comment that the source's number is an achievement, not a pass condition"; the acceptance rule also says
   `threeStar` must equal the reference's measured metrics **exactly**. Those two together force the target to be the
   measurement (41). The design spec's §5.4 note ("这些数值直接成为对应关卡的 `targets.threeStar` 门槛") suggests the
   literal 65, and the two readings cannot both hold unless the reference is engineered to measure exactly 65 — I
   measured the natural constructions and none lands there (a bare incrementer + `reg8` is 41; the `add8` version is
   72). I followed batch 2's precedent (level 21's "5 components" → measured 15; level 22's "≤ 35" → measured 17),
   which is also the only reading consistent with the exact-equality assertion. **If the controller wants
   `threeStar.gate = 65`, the change is two lines** (`threeStar.gate: 65` in `batch4.ts`, and that level's entry in
   the exact-equality block relaxed to "meets the bound"), and the comment would need its "not this level's
   `threeStar.gate`" sentence reworded. I did not make that change because it would have broken the stated
   acceptance criterion.
2. **Level 28 does not offer `mem1`**, although the task's context notes that `mem1` is available from chapter 1's
   level 12. Withholding is batch 2's palette rule (it is not the level's own reward and it answers the level in one
   drop), it is what makes level 28's "build the loop" lesson and its settling assertion real, and both `mem1` and the
   loop are measured in the test. **If the intent was that level 28 must offer it**, the change is one line
   (`...GATES_1BIT, ...SWITCH_1, 'mem1', ...LEVEL_IO`) plus deleting two assertions; the target (8/3) and the reference
   would not move — `mem1` would simply join as a three-star answer.
3. **`mux8`'s gate price is higher than a hand-built mux** (32 vs 25) because the def's documented cell prices one
   inverter per bit while a hand-built 8-bit mux shares one. Nothing in this task's scope can change a def's
   `gateCost` (`src/core/` is out of scope), and the level's target is still the reference's own measurement: the part
   wins on **stars and score** (32 + 4 = 36 against 25 + 12 = 37) because it is one node and the built version is
   three. This is recorded in level 33's comment and measured in the test rather than hidden.
4. **Coincidences created by the brief's own table**, documented in both levels' comments and the module header:
   levels 28 and 35 ask for the same storage rule (different pin names, different framing, different checks), and
   levels 33 and 34 have the same shape, function and target (33 fuzz-graded, 34 table-graded).
5. **`tick` targets are large on the range-walking levels** (level 37: 512; level 38: 263). The metric is the last
   tick the level's own script drives, so it is identical for every correct circuit and cannot deny a player three
   stars; it does inflate those levels' scores (`score = gate + delay*4 + tick*8`) relative to the rest of the
   chapter. If the chapter ever wants a tick *budget* rather than a tick *record*, these two levels are where a
   `threeStar.tick` lower than the script's last tick would have to be introduced deliberately.
6. **The batch is not joined.** `src/levels/content/ch2/index.ts` still lists batch 1 alone, so levels 28–38 are
   reachable only through their own test file — the same state batches 2 and 3 are in. The assembly task will need
   `REFERENCE_SOLUTIONS` entries for these eleven ids in `test/levels/level-buildability.test.ts` (that file derives
   its walk from `LEVELS` + `CH2_LEVELS` and fails if a shipped level has no filed reference). I verified the
   property it will check — every reference def is unlocked at or before its level and listed in `allowedComponents`
   — so the references will survive that walk, but the entries themselves are outside this task's file scope.

---

# Task 11 follow-up — review fixes for chapter 2, levels 13–27

Worktree: `D:\Documents\turing-complete\.worktrees\phase1` (branch `phase1`).
Start state: `650d19c`. The assembly task committed `e0e8a2d` while this pass was running (an amend of its own
`a5939fa`; the amend is what put this pass's level-26 test back out of the index — see *Coordination* below).
Commit: **`698daa3` — fix(levels): correct the full_adder and decoder availability notes** (5 files: the four in
scope, plus `test/levels/ch2-batch3.test.ts`).
Left uncommitted and modified, as instructed: `.superpowers/sdd/2026-09-25-turing-complete-phase1/progress.md`.

**No `threeStar` value changed.** Every target still equals its reference's measured metrics, and every
counterexample still fails — both asserted by the existing blocks, not claimed here.

## Fix 1 — the `full_adder` note is now history plus the live facts (three places)

* `src/levels/content/ch2/batch2.ts:56-82` — the module note that said **NO DEF OF THAT ID IS REGISTERED** now
  records: the def did not exist when the batch was authored; `523a7b9` ("feat(defs): register the full_adder that
  level 20 rewards") added it to `src/core/defs/index.ts` as a `logic1` gate, pins `a:1 b:1 cin:1 -> sum:1 cout:1`,
  priced `gateCost: FULL_ADDER` — 9 NAND equivalents, the exported `wide.ts` constant that also prices `add8` as
  eight of it — and `DEF_IDS` carries it. It states where the part is offered (20 and 22), that level 21 withholds it
  and why, and that both decisions the old note handed a later task are taken. Nothing false is left about the id
  being invisible to palettes; that paragraph is explicitly framed as history.
* `src/levels/content/ch2/batch2.ts:350-359` — level 20's comment ("`full_adder`'S DEF WAS MISSING WHEN THIS LEVEL WAS
  AUTHORED AND IS NOT NOW") carries the same facts at the level that rewards it.
* `test/levels/ch2-batch2.test.ts:59-62` — the test file's header bullet no longer says "not registered yet".
* `test/levels/ch2-batch2.test.ts:515-523` — new test `rewards an id the registry actually implements`: level 20's
  reward list is `['full_adder']` **and** `registry.has('full_adder')` is true. That is the assertion that would have
  caught the old note, and it cannot go stale in either direction without failing.

## Fix 2 — `full_adder` offered at level 20 **and 22**, withheld at 21; ruling, comments and data agree

**Choice: (a).** One instance of `full_adder` is a **1-bit** part (`a:1 b:1 cin:1 -> sum:1 cout:1`) against level
22's 8-bit I/O, so it cannot answer the level by itself; eight of them plus the carry chain between them **are** the
cascade the level exists to teach, and that is the same standard the palette rule's subtraction is written against
("a part that would answer the level by itself"). Withholding it here was therefore the one withholding the file's
own rule did not license, and it left a registered, priced part offered by exactly one level.

Why the target does not become trivial, and the numbers that make the claim checkable (all measured, in the test
file rather than asserted in prose):

| construction | gate | delay | stars vs target 120/17 |
|---|---|---|---|
| the hand-wired reference (8 × 5 standard cells) | 120 | 17 | 3 |
| the drop-in (8 × `full_adder`, 8 × 9) | 72 | 8 | 3 |

The drop-in is **cheaper** than the reference, so the target does **not** separate the two constructions — and the
level's comment now says so outright instead of implying otherwise: `threeStar` is the reference solution's own
measurement, the reference is a correct ripple adder, and the drop-in is another correct ripple adder. What the level
teaches is the eight-stage carry chain and the ninth bit, and both constructions have to be wired into exactly that.
The lesson the drop-in **would** void (five components, gate 15) is level 21's, and level 21 is where the part is
still withheld.

* `src/levels/content/ch2/batch2.ts:492-524` — level 22's "WHY THE PALETTE WITHHOLDS ONE PART AND OFFERS ANOTHER",
  with the measurement above and the amended-ruling history.
* `src/levels/content/ch2/batch2.ts:539-554` — the palette itself gains `'full_adder'` (and the byte operators, Fix
  4). `add8` stays withheld for the original reason (exactly this level's I/O shape, one drop-in, 72/1).
* `src/levels/content/ch2/batch2.ts:569-576` — the `threeStar` comment points a reader who lands on the number at
  the drop-in's measurement.
* `src/levels/content/ch2/batch2.ts:400-430` — level 21's comment is rewritten as **the settled decision**, not an
  argument against an old ruling: one drop-in is that level's exact I/O, so it would score the level without the five
  components the level exists to teach; at the registered 9-NAND cell it measures 9 gates and 1 delay against the
  15-and-3 target, i.e. three stars for a part the player never builds. It also records why the old rationale failed
  ("level 22's lesson is the cascade" is downstream of level 21, not an argument about it), and that the part is
  offered at 20 and 22 instead.
* `src/levels/content/ch2/batch2.ts:409-414` — the clause the reviewer read literally is gone. It now says what is
  true: the source's 5 is a **component** count, 15 is a **NAND-equivalent** count, the target counts the latter, so
  six cheap parts (six NAND equivalents) are inside 15 and **pass**; what the target separates is the standard cell's
  15 from any correct spelling costing more NAND equivalents.
* `test/levels/ch2-batch2.test.ts:467-513` — the palette test now asserts `L22` contains `full_adder` and all seven
  byte operators, still omits `add8`, and `L21` still omits `full_adder`.
* `test/levels/ch2-batch2.test.ts:829-853` — new: the withheld drop-in on level 21 measures `{gate: 9, delay: 1,
  tick: 0}` and scores **3 stars** (the amendment's reason, measured).
* `test/levels/ch2-batch2.test.ts:870-906` — new: the level-22 drop-in measures `{gate: 72, delay: 8, tick: 0}` and
  scores 3 stars while the reference measures `{gate: 120, delay: 17, tick: 0}` and still equals `threeStar`.

I **agree** with the amendment: the old 20–21 ruling offered the part on the one level it answers outright, and its
rationale did not reach level 21 at all. The alternative (b) was rejected because it needs a promise about a later
chapter that no data currently supports, and because it would leave `full_adder` offered by a single level for the
rest of the shipped game.

## Fix 3 — level 26's unrecorded seam: recorded, with the measurement

* `src/levels/content/ch2/batch3.ts:47-72` — the module header's claim that the batch has exactly one
  own-reward-answered level is replaced by a paragraph naming **both**: level 25's `decoder1` (1 gate, 1 delay,
  three stars — exactly the target) and level 26's `decoder3` (measured, below). Both are the own-reward half of the
  rule rather than exceptions, and the paragraph records that neither reward is withdrawn and why.
* `src/levels/content/ch2/batch3.ts:539-559` — level 26's new data-comment paragraph: one instance of its **own**
  reward, wired straight from `sel` to the level's output, scores `gate: 27, delay: 1, tick: 0` and **three stars**
  against the level's `27 / 3 / 0` target. It ties the gate count and beats the depth, and the comment says why that
  27 is not a coincidence: the registered part's `gateCost` **is** the shared minterm tree the level teaches
  (3 NOTs + 4 ANDs + 8 ANDs), while the target's depth of 3 is a hand-wired tree's path and the part publishes in one
  node. The paragraph also records the decision **not** to withdraw it: no other level in the chapter lists
  `decoder3`, so withdrawing it here would leave a registered, priced part that no level offers — the same
  dead-content defect level 22's `full_adder` decision exists to avoid — while the own-reward rule deliberately
  offers a level its own rewards (level 13's `splitter` needs it).
* `test/levels/ch2-batch3.test.ts:1156-1189` — new test, modelled on level 25's at `:1134`: it asserts the reward is
  offered, grades a single `decoder3` instance against `ch2-26-3-bit-decoder`, and compares its metrics with the
  level's `threeStar` (drop-in 27/1/0 against the target 27/3/0 = the reference's own 27/3/0; gates tie, delay is
  lower, three stars).

**Measured (level 26):** `decoder3` drop-in `{gate: 27, delay: 1, tick: 0}`, failures `[]`, 3 stars; target and
reference `{gate: 27, delay: 3, tick: 0}`.

**Chose recording over withdrawal.** Withdrawal is permitted by the brief, but it would be the worse of the two: the
part is the level's own reward and the lesson's own subject, `paletteDefsFor` offering a level its own rewards is the
deliberate rule that makes level 13's parity puzzle buildable, and withdrawing `decoder3` at 26 leaves it in **no**
palette anywhere.

## Fix 4 — level 22's palette now matches the rule the file states

* `src/levels/content/ch2/batch2.ts:539-554` — `...BYTE_AND_OR`, `'xor8'`, `'xnor8'`, `'not8'` added, so the seven
  byte operators levels 18/19 unlocked are offered at 22 as they are at 23, 24 and 27. They attach to this level's
  pins and none of them can add, so they were excluded by nothing the rule describes.
* `src/levels/content/ch2/batch2.ts:517-524` — the level's own sentence ("Everything else on the player's wide shelf
  is offered") now names the seven and is the palette the code builds.
* `src/levels/content/ch2/batch2.ts:34-54` — the rule is restated as what the code actually does, in three
  categories: the **shelf it inherits** (the named lists), **plus its own rewards**, **minus** any part that is not
  its own reward and would answer the level by itself. The shelf category explicitly records that a shelf is
  *curated*, not "everything the player holds" — `mem1`, chapter 1's stateful bit part, is unlocked from level 12 and
  listed by no level in this batch (nothing here ticks a clock), while `delay_line` is carried although nothing here
  can use it. That is the third documented category the reviewer asked for, named on the one part that witnesses it,
  so the note no longer describes a palette the code does not build.
* `src/levels/content/ch2/batch2.ts:123` — the `BYTE_AND_OR` doc now says it is offered by levels 18, 19 and 22.
* `test/levels/ch2-batch2.test.ts:467-513` — the new assertions pin the seven operators at 22.

## Fix 5 — `wide.ts`, text only (no def's behaviour, pins, `cost` or `gateCost` touched)

* `src/core/defs/wide.ts:845-853` — the decoder section note no longer recommends `1 << sel`. It states the published
  value as `2 ** sel` and records the level data's spelling as a quotation of the same contract, with the reason the
  two diverge: a 5-bit select reaches bit 31 and `<<` converts through int32 (see `createDecoderDef`).
* `src/core/defs/wide.ts:864-875` — the width-5 rationale no longer says `2 ** 5 = 32` is "the widest value a
  `number` carries exactly". It now says w = 5 is a 32-bit output because of the project's 32-bit port carrier
  (`MAX_WIDE_WIDTH`), and that JavaScript integers are exact to `2 ** 53`, so a wider decoder is not an arithmetic
  impossibility — it is a part whose output pin this project has no carrier for. Conclusion (width 5, 32-bit output)
  unchanged.
* `src/core/defs/wide.ts:270-272` — **disclosed extra**: `toUint`'s comment carried a third instance of the same
  false claim ("Four bytes is all a `number` carries exactly"). Reworded to the 32-bit carrier. Same file, same
  class of error, no behaviour change.

## Fix 6 — the SOURCED/AUTHORED blur at level 26

* `src/levels/content/ch2/batch3.ts:516-527` — level 26's SOURCED clause is now only what the source gives (name,
  position, three-to-eight decoding). The generator clause moved into AUTHORED, explicitly labelled a mechanism of
  this replica: "`decoder3` is `createDecoderDef(3)`, the same generator as level 25's `decoder1` one width up".
* `src/levels/content/ch2/batch3.ts:426-439` — **disclosed**: level 25's comment had the identical blur in its own
  SOURCED clause ("The 2-bit decoder is therefore the same generator one width up -- registered as `decoder2`").
  The catalog fact it was attached to (the compendium lists a `2-Bit Decoder` that no level name introduces) stays
  SOURCED; the mechanism sentence moved to AUTHORED. The reviewer's allowance for `decoder2`'s sourcing is untouched.

## Tests

* Full suite: **913 passed / 913, 23 files, exit 0** (`task-11-fixes-full-suite.log`). Batch 2 is 59 tests (was 56
  before this pass: +registry check, +level-21 drop-in, +level-22 drop-in) and batch 3 is 69 (was 68: +level-26
  drop-in). `level-buildability.test.ts` (85) and `unlock-chain.test.ts` (35) — the assembly task's files, untouched
  here — pass with the new level-22 palette.
* Targets: `three-star targets are the reference solutions own metrics` in both batch tests, plus `grader.test.ts`'s
  shipped-level walk, still pass unchanged. Level 22's target was re-measured and is still `120 / 17 / 0`
  (`test/levels/ch2-batch2.test.ts:830-842`, `:902-905`).
* Counterexamples: both `plausible wrong circuits fail` blocks are unchanged and still green, as are the fuzz
  round/vector replications.
* New fix-specific coverage: the registry check (`ch2-batch2.test.ts:515`), the level-21 withheld drop-in
  (`:829`), the level-22 offered drop-in (`:870`), the level-26 own-reward drop-in (`ch2-batch3.test.ts:1156`), and
  the palette assertions (`ch2-batch2.test.ts:467`).
* `tsc --noEmit`: exit 0, no output (`task-11-fixes-tsc.log`). `pnpm build`: exit 0, vite built
  `dist/assets/index-Cx4ms12B.js` 98.35 kB (`task-11-fixes-build.log`).

## Commands (from the worktree; `$node` / `$pnpm` are the two absolute paths in the brief)

```powershell
& $node $pnpm test test/levels/ch2-batch2.test.ts test/levels/ch2-batch3.test.ts   # -> task-11-fixes-focused.log
& $node $pnpm test                                                                 # -> task-11-fixes-full-suite.log
& $node $pnpm exec tsc --noEmit                                                    # -> task-11-fixes-tsc.log
& $node $pnpm build                                                                # -> task-11-fixes-build.log
```

Focused: 128 passed (batch 2: 59, batch 3: 69), exit 0. Full: `Test Files 23 passed (23)`, `Tests 913 passed (913)`,
exit 0. Both logs are in this directory.

## Coordination and disclosed extras

1. **The assembly task's amend reverted this pass's test edit out of the index.** I added the level-26 test to
   `test/levels/ch2-batch3.test.ts` at 03:41; the assembly task committed `a5939fa` at 03:42 and then amended it to
   `e0e8a2d` at ~03:44, and the amended tree no longer carried the test, so I re-staged it and amended my own commit
   to include it (`698daa3` now holds 5 files). The full suite was re-run **after** the amend, on exactly the
   committed tree. Nothing else of the assembly task's work was touched; `level-buildability.test.ts`,
   `unlock-chain.test.ts`, `test/fixtures/ch2-references.ts`, `src/levels/content/index.ts` and
   `src/levels/content/ch2/index.ts` are untouched by this commit.
2. **`src/levels/content/ch2/batch3.ts:94`** — the header's "NOT JOINED YET" paragraph became false the moment the
   assembly task's `ch2/index.ts` listed all four batches. It is replaced with a state-independent statement (the
   chapter is assembled in `ch2/index.ts`, the only `src/` module that imports a batch file).
3. **`src/levels/content/ch2/batch3.ts:487`** — one sentence added to level 25's own-reward paragraph pointing at
   level 26, so the two recorded prices read as one rule.
4. **`src/core/defs/wide.ts:270`** — the third `number`-exactness claim (Fix 5, above).
5. **Log names**: my first three runs reused the generic `task-11-{full-suite,tsc,build}.log` names, which the
   earlier task-11 report also cites; this pass's outputs are all in `task-11-fixes-*.log`, and the generic names now
   hold this pass's output too (older `-final` logs are untouched).

## Concerns

1. **Fix 2(a) is a judgement call about what "trivial" means for level 22.** With `full_adder` offered, the level's
   gate target is no longer the cheapest known construction (72 < 120), so a player who sees the part in their
   palette can score it more cheaply than the reference. My reading is that this does not trivialise the level — the
   eight-stage carry chain and the ninth bit still have to be wired, and the five-component lesson lives at level 21,
   where the part stays withheld — but the opposite reading is defensible, and the remedy would be option (b):
   withdraw the part again and record it as a level-20 convenience, at the cost of leaving it offered by one level
   only (which is the dead content this fix removes).
2. **`full_adder` is still offered by no level in batches 3 and 4** (levels 23–38). That is not dead content — 20 and
   22 offer it, and no level in 23–38 has one-bit adder pins — and the module note now says a later chapter that
   wants it in its palettes makes a new decision rather than inheriting one.
3. **`mem1` is documented but not solved.** It is unlocked by chapter 1's level 12 and offered by no level until
   batch 4's latch levels. Fix 4 asked for the third category to be named, and it is (batch 2's module note); no
   palette was changed for it, since that would move data no review flagged.
4. **No target was restated and none was re-measured except level 22's**, which is unchanged at `120 / 17 / 0`; the
   two new drop-in measurements (level 21's 9/1, level 22's 72/8, level 26's 27/1) are additions, not restatements.
