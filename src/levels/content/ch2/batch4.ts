import type { LevelSpec, ScriptStep, TruthRow } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation), so the
// two must not be confused.
import { truthTable, type LevelIo } from '../../tables';

/**
 * Chapter 2, levels 28-38: the storage and timing half of the chapter -- the
 * latch, the delay, the clock source, the selector, the register, the RAM and
 * the counter. It is the first chapter-2 batch the `script` checker carries.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. As in batches 1-3: the
 * compendium gives each of these levels exactly three things -- its name (English
 * and Chinese), its place in the chapter, and one line of teaching concept. It
 * gives no ports, no widths, no pass conditions, no targets and no rewards.
 * Everything else below is this replica's design, derived from the name and that
 * one line -- so every level carries a data comment split into `SOURCED` and
 * `AUTHORED`, and `test/levels/ch2-batch4.test.ts` fails if either marker is
 * missing. No number in this file may be presented as the source's own.
 *
 * THE `script` CHECKER'S TICK SEMANTICS ARE LOAD-BEARING, and they are not the
 * obvious reading -- every script below is written to them. `runChecks` walks a
 * check's steps in tick order, and for each step it writes the step's inputs and
 * calls `settle()` BEFORE it advances the clock to that step's tick
 * (`levels/checks.ts`, the script branch: `while (io.sim.tickCount < step.tick)
 * io.tick()`). Two consequences:
 *
 *  * `tick` is an ABSOLUTE target, and the edges a step runs are the difference
 *    from the previous step's tick. A step at tick 0 runs NO edge at all, so its
 *    `expect` reads the post-`reset` state -- which is why every walk below
 *    starts with a tick-0 step and starts writing one tick in.
 *  * a step's inputs drive the edges that REACH that step's tick, so an `expect`
 *    at tick T reads the value the edge into T just sampled. A delay line
 *    therefore reads exactly like a wire while the input changes at every step,
 *    and the only way a script can show that a value is HELD is a second step at
 *    the SAME tick: no edge runs, the inputs change, and the OLD value must
 *    still be on the output. Levels 28, 29, 35, 36 and 38 each carry such a
 *    pair, and the test file measures that they do -- a wire, a two-tick delay
 *    and a register that ignores its load enable all fail on exactly those
 *    steps.
 *
 * DIVIDING THE WORK WITH THE KERNEL, since a level is pure data (Global
 * Constraint 7) and cannot ask for either of these itself:
 *
 *  * STABILITY IS AN OUTCOME OF `settle()`, NOT A CHECK KIND. A combinational
 *    loop exhausts `SETTLE_LIMIT` and raises `UnstableCircuitError`, which
 *    `runChecks` turns into an `unstable` failure; a loop broken by a storage
 *    element settles. Level 28 is the level about that, and it says so in its
 *    brief, because there is no `stable` check to author.
 *  * PERIODICITY IS A PROPERTY OF AN EXPECTATION SEQUENCE, not of one tick.
 *    Level 30's check asserts sixteen alternating ticks and four held ones; a
 *    check that asserted a single tick would pass a circuit that was simply
 *    stuck high.
 *
 * FOUR THINGS THIS BATCH OWES A READER, and each says so in its own level
 * comment rather than only here:
 *
 *  * LEVEL 30 HAS NO COMPUTABLE SPEC IN THE SOURCE AT ALL -- "构建振荡电路
 *    （时钟信号发生器）" gives no period, no duty cycle and no gating rule -- so
 *    the period, the hold-when-disabled rule and the sixteen-tick run are this
 *    replica's design, and the check's assertion of them is the level.
 *  * LEVEL 34 CHANGES THE SOURCE LEVEL'S KIND. The source says only "共享数据
 *    传输线路的概念" and spec 3.1 forbids a bus protocol ("不做总线协议（多驱动
 *    仲裁）"), so a literal shared/tri-state bus is unimplementable by design in
 *    this engine; the level teaches driver selection instead, and both its
 *    comment and its brief say so plainly.
 *  * LEVEL 37 HAS AN AUTHORED DEFINITION OF 装满. The source gives one line and
 *    no capacity, no address width and no definition of "full"; this replica
 *    defines it as all 256 bytes of a `ram8` being addressable and writable with
 *    every address reading back what was written, states that definition in the
 *    brief, and asserts it over the whole range.
 *  * LEVEL 38 CARRIES THE SOURCE'S ACHIEVEMENT, as a record rather than a pass
 *    condition: "成就：≤ 65 个门". See that level's comment for the mapping and
 *    for why 65 is not this level's `threeStar.gate`.
 *
 * THE PALETTE RULE, inherited from batch 2 and stated once more because this
 * batch uses it twice: a level offers the parts unlocked at or before it whose
 * pins can attach to something on it, plus its own rewards, MINUS any part that
 * is not its own reward and would answer the level by itself. Level 28 withholds
 * `mem1` (its pins ARE the level's pins, and it would hide the loop the level
 * teaches) and level 38 withholds `counter8` (the same, one drop-in counter).
 * Both are measured in the test file, neither is listed anywhere it would answer
 * the level, and both comments say which rule is being applied. The "plus its own
 * rewards" half is bounded too: a level lists its own rewards only where those
 * pins can ATTACH, which is why level 28 -- one bit wide throughout -- hands out
 * `ram8` without listing it (batch 1's level-14 reason), exactly as chapter 1's
 * capstone rewards `mem1` without listing it.
 *
 * STORAGE IS FREE ON BOTH METRICS BY RULING, and that decides what several
 * targets in this batch can be. `delay8`, `reg8`, `counter8` and `ram8` state no
 * `gateCost` and cost no delay unit (`core/defs/wide.ts`, the storage section
 * note: the gate metric measures what the PLAYER built, and a storage element
 * cuts the combinational path in both directions). So the floor for a level whose
 * answer is an unlocked storage part is that part's own 0/0, and this file states
 * that floor rather than the price of rebuilding the part from gates -- levels
 * 29, 35, 36 and 37 do exactly that, and each of their comments says what the
 * hand-built alternative measures, because a player who builds the loop instead
 * of dropping the part in should know why it scores one star.
 *
 * TWO COINCIDENCES THE BRIEF'S OWN TABLE CREATES, recorded here so a reviewer
 * does not read them as slips:
 *
 *  * levels 28 and 35 ask for the same storage rule under different pin names
 *    (`set`/`value` against `d`/`load`). They are framed differently -- 28 is
 *    where the loop is built and its palette withholds the packaged part; 35 is
 *    where the packaged part is used -- and their checks assert different things.
 *  * levels 33 and 34 have the same shape and the same behaviour. 33 is the byte
 *    selector graded by 256 fuzz vectors; 34 is the shared line graded by a
 *    four-row truth table. Batch 1 recorded the same coincidence for levels 15
 *    and 16.
 *
 * JOINED: this batch is the fourth and last slice of `CH2_LEVELS`
 * (`ch2/index.ts`), which `content/index.ts` appends to chapter 1, so these
 * eleven levels ship as levels 28-38 of the game's own `LEVELS`. All four
 * batches are joined, which is what makes chapter 2 the 26 levels at indices
 * 13-38; `test/levels/unlock-chain.test.ts` holds that to a number. Each batch
 * test imports its own batch and every earlier one, and the two cross-cutting
 * tests -- `level-buildability.test.ts` and `unlock-chain.test.ts` -- reach the
 * whole chapter through `ch2/index.ts`, the module that joins the four.
 */

/**
 * The one-bit shelf every level here draws from: chapter 1's gates, its two
 * constants and the delay line, in the order chapter 1 hands them out.
 * `delay_line` is level 28's storage element -- the only one that can break a
 * one-bit loop without also being the level's answer.
 */
const GATES_1BIT = [
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'const_on',
  'const_off',
  'delay_line',
] as const;

/** The level's own plumbing: always in the palette, never unlocked (`defs/index.ts`). */
const LEVEL_IO = ['level_input', 'level_output'] as const;

/** What batch 1's level 13 unlocked: the two byte packers and the byte constant. */
const BYTE_WIRING = ['splitter', 'maker', 'const8'] as const;

/**
 * Level 22's one-bit conditional pass. It is a 1-bit part with 1-bit pins, so it
 * attaches on every one-bit level in this batch; this file offers it wherever a
 * "take this or keep that" choice is part of the level (28, 30, 31, 32, 35) and
 * leaves it off the byte-wide ones, where a player would reach for gates anyway.
 */
const SWITCH_1 = ['switch'] as const;

/**
 * The five pin shapes this batch uses, so a level's io is one named constant
 * instead of six lines of literal in the middle of a spec.
 */
const IO_SET_VALUE_OUT: LevelIo = {
  inputs: [
    { id: 'set', width: 1 },
    { id: 'value', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };
const IO_ENABLE_OUT: LevelIo = {
  inputs: [{ id: 'enable', width: 1 }],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A1_INV1_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'inv', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A1_ON1_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'on', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A8_B8_SEL1_OUT8: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    { id: 'sel', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_D1_LOAD1_OUT1: LevelIo = {
  inputs: [
    { id: 'd', width: 1 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_D8_LOAD1_OUT8: LevelIo = {
  inputs: [
    { id: 'd', width: 8 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_D8_ADDR8_LOAD1_OUT8: LevelIo = {
  inputs: [
    { id: 'd', width: 8 },
    { id: 'addr', width: 8 },
    { id: 'load', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_EN1_RESET1_OUT8: LevelIo = {
  inputs: [
    { id: 'en', width: 1 },
    { id: 'reset', width: 1 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};

/**
 * Level 33's fuzz seed: the level's index in the high byte and the byte width in
 * the low one, exactly as batches 2 and 3 seed their levels.
 *
 * A fixed literal, not a drawn one: the same seed produces the same 256 vectors
 * on every run and on every board edit, which is what makes the level's coverage
 * -- that both `sel` values are driven, many times each -- a fact about the level
 * rather than about the run. The test file measures it against this literal.
 */
const SEED_33 = 0x3308;

/**
 * The four vectors level 34's table states, and the rule they publish.
 *
 * Four rows rather than 2^17 combinations, which is the brief's shape for this
 * level: it states WHO DRIVES THE LINE, at a scale a reader can check by eye,
 * while the byte-wide coverage belongs to level 33's fuzz check. Both `sel`
 * values appear on the same pair of operands, so the table separates "the
 * selected line" from "always the first" and "always the second", and the two
 * operand pairs are asymmetric patterns, so a circuit that shuffled the bits
 * within the byte would fail one of them.
 */
const BUS_VECTORS: readonly { readonly a: number; readonly b: number; readonly sel: number }[] = [
  { a: 0x00, b: 0xff, sel: 0 },
  { a: 0x0f, b: 0xf0, sel: 0 },
  { a: 0x00, b: 0xff, sel: 1 },
  { a: 0x0f, b: 0xf0, sel: 1 },
];

/** The bus rule the level teaches: exactly the selected line reaches `out`. */
function selectedLine(a: number, b: number, sel: number): number {
  return sel === 1 ? b : a;
}

/** Level 34's four rows, with each row's output stated by the rule above. */
const BUS_ROWS: readonly TruthRow[] = BUS_VECTORS.map(({ a, b, sel }) => ({
  inputs: { a, b, sel },
  outputs: { out: selectedLine(a, b, sel) },
}));

/**
 * The byte level 37 writes into address `k`.
 *
 * `k * 7 + 1` modulo 256 is a bijection (7 is odd, so it is invertible), so no
 * two addresses hold the same byte. That is what makes an address decode which
 * aliases two cells -- or ignores `addr` altogether -- visible: the read-back
 * pass decides one address at a time, and the byte it expects there is one no
 * other address was written with. `k = 73` is the single address this stores a 0
 * in, and it is one of 256 expectations rather than the whole test.
 */
function boxByte(k: number): number {
  return (k * 7 + 1) & 0xff;
}

/**
 * Level 37's script: write all 256 addresses, then read all 256 back.
 *
 * THE CHECK THAT MAKES "装满" MEAN SOMETHING, and the reason it is generated
 * rather than written out. Step `k + 1` (one clock edge each, starting one tick
 * in because a step at tick 0 runs no edge) writes `boxByte(k)` into address `k`
 * with `load` high, and asserts the byte on the output on the same step. Steps
 * 257..512 then re-read every address with `load` LOW and `d` driven with the
 * COMPLEMENT of the stored byte, after all 256 writes have happened -- so the
 * pass proves the box holds 256 bytes at once rather than that the last one
 * written can be read, and every read would have to come back as `~stored` for a
 * wire from `d` to pass a single one of them.
 */
function littleBoxSteps(): ScriptStep[] {
  const steps: ScriptStep[] = [
    { tick: 0, inputs: { d: 0, addr: 0, load: 0 }, expect: { out: 0 } },
  ];
  for (let addr = 0; addr < 256; addr += 1) {
    steps.push({
      tick: addr + 1,
      inputs: { d: boxByte(addr), addr, load: 1 },
      expect: { out: boxByte(addr) },
    });
  }
  for (let addr = 0; addr < 256; addr += 1) {
    steps.push({
      tick: 257 + addr,
      inputs: { d: ~boxByte(addr) & 0xff, addr, load: 0 },
      expect: { out: boxByte(addr) },
    });
  }
  return steps;
}

/**
 * Level 38's script: reset, 256 enabled edges, the wrap, and the precedence of
 * `reset` over `en`.
 *
 * 265 steps. The run from tick 2 to tick 257 is 256 consecutive edges whose
 * expectations are the count itself, so the check walks every byte and comes
 * back to 0 at exactly 256: a counter that wrapped at 128, or that saturated at
 * 255, fails one of those 256 expectations rather than a hand-picked one. Tick
 * 260 then asserts `reset` over `en` on an edge where BOTH are high and the
 * count is 2 -- if the enable won, the output would be 3. The last two steps sit
 * on tick 263: the first runs the edge that resumes the count, the second runs
 * no edge at all and must still read 1, which is what a circuit that counted
 * combinationically would fail.
 */
function counterSteps(): ScriptStep[] {
  const steps: ScriptStep[] = [
    { tick: 0, inputs: { en: 0, reset: 1 }, expect: { out: 0 } },
    // One edge with `reset` and `en` both high: the clear wins, so this reads 0.
    { tick: 1, inputs: { en: 1, reset: 1 }, expect: { out: 0 } },
  ];
  for (let edge = 1; edge <= 256; edge += 1) {
    steps.push({ tick: edge + 1, inputs: { en: 1, reset: 0 }, expect: { out: edge & 0xff } });
  }
  steps.push({ tick: 258, inputs: { en: 1, reset: 0 }, expect: { out: 1 } });
  steps.push({ tick: 259, inputs: { en: 1, reset: 0 }, expect: { out: 2 } });
  steps.push({ tick: 260, inputs: { en: 1, reset: 1 }, expect: { out: 0 } });
  steps.push({ tick: 261, inputs: { en: 0, reset: 0 }, expect: { out: 0 } });
  steps.push({ tick: 262, inputs: { en: 0, reset: 0 }, expect: { out: 0 } });
  steps.push({ tick: 263, inputs: { en: 1, reset: 0 }, expect: { out: 1 } });
  steps.push({ tick: 263, inputs: { en: 0, reset: 0 }, expect: { out: 1 } });
  return steps;
}

/**
 * Level 30's two scripts: the beat, the hold, and the resumption; then the held-low
 * case on its own.
 *
 * Sixteen enabled ticks whose expectations alternate 0/1/0/1 -- eight whole
 * periods, because "the output has a period" is not measurable from one tick --
 * followed by four ticks with `enable` low that must all read the 1 the last
 * enabled tick left, and four more that resume the beat from that held value
 * (a falling edge first: `1 XOR 1` is 0). The second script holds `enable` low
 * from reset for eight ticks and demands 0 throughout, which is the other way a
 * clock source fails: an oscillator with no gate on it satisfies the first
 * script's first sixteen ticks and fails at tick 16, and it fails this one at
 * tick 1.
 */
const OSCILLATOR_STEPS: readonly ScriptStep[] = [
  ...Array.from({ length: 16 }, (_, tick) => ({
    tick,
    inputs: { enable: 1 },
    expect: { out: tick % 2 },
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    tick: 16 + i,
    inputs: { enable: 0 },
    expect: { out: 1 },
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    tick: 20 + i,
    inputs: { enable: 1 },
    expect: { out: i % 2 },
  })),
];

/** The held-low half: `enable` low from reset, so a gated source never moves. */
const HELD_LOW_STEPS: readonly ScriptStep[] = Array.from({ length: 8 }, (_, tick) => ({
  tick,
  inputs: { enable: 0 },
  expect: { out: 0 },
}));

export const CH2_BATCH4: readonly LevelSpec[] = [
  /**
   * ch2-28-circular-dependency -- Circular Dependency / 循环依赖
   *
   * SOURCED: the name in both languages, its position (the 28th level, and the
   * first of the chapter's storage half), and the source's one-line concept --
   * '引入反馈回路概念，构建基本锁存器' (introduce the idea of a feedback loop and
   * build a basic latch). It gives no ports, no widths, no pass condition, no
   * target and no reward.
   *
   * AUTHORED (this replica's design): the `set:1 value:1 -> out:1` shape; the
   * nine-step script; the measured three-star target; the `ram8` reward; and the
   * palette. The check's shape is decided by `runChecks`'s tick semantics (module
   * note): a step's inputs are written and settled before its tick advances, so
   * the step at tick 1 reads the bit the edge into tick 1 just sampled, and the
   * four same-tick pairs are what prove the bit is HELD rather than passed
   * through -- a circuit that published `set ? value : 0` would fail at tick 0,
   * long before the loop is under test.
   *
   * STABILITY, WHICH IS THIS LEVEL'S CORE ASSERTION AND HAS NO CHECK KIND OF ITS
   * OWN. A purely combinational loop never reaches a fixed point: `settle()`
   * exhausts `SETTLE_LIMIT` and raises `UnstableCircuitError`, which `runChecks`
   * records as an `unstable` failure, so a latch built out of gates alone cannot
   * pass this level however it is wired. The reference really does contain a
   * loop -- `validateGraph` reports `feedback-loop` (a warning, because only the
   * simulator can say whether a loop with storage in it settles) -- and it
   * settles. The test file asserts both sides directly against `settle()`, not
   * through "the level passed": the reference settles, and a cross-coupled NOR
   * latch, a NOT feeding itself and two NOTs in a ring all throw
   * `UnstableCircuitError`. Asserting only that the reference passes would prove
   * nothing about loops at all.
   *
   * WHY THE PALETTE WITHHOLDS `mem1`, the one part that would answer this level
   * in a single drop. `mem1` is unlocked (chapter 1's capstone rewards it), it
   * is not this level's own reward, and its pins ARE this level's pins --
   * `set`/`value` in, `out` out -- so batch 2's rule applies exactly (level 22's
   * `add8`, level 24's `neg8`): a part that is not the level's own reward and
   * would answer the level by itself is offered nowhere on it. Dropping it in
   * would hide the loop the source's line asks the player to build, which is the
   * whole level. It is measured in the test file rather than argued about: it
   * passes, for 0 gates and 0 delay, and level 35 -- whose concept is the
   * packaged conditional write -- offers it.
   *
   * THE TARGET is the reference's own measured metrics: 8 NAND equivalents, 3
   * delay units, tick 4 (the last tick the script drives). The reference builds
   * the choice out of two `switch` parts and an `or` rather than an AND/NOT/AND
   * mux: `switch` is the part this level's hint names. It is not a cheaper cell
   * -- the registered `and` is `cost: 1` / `gateCost: 2`, exactly `switch`'s pair
   * (`core/defs/index.ts`, `core/defs/wide.ts`), so the AND/NOT/AND mux measures
   * the same 8/3; only a hand-built AND (a NAND into a NOT) costs two delay
   * units. The path through `set` is what sets this level's delay.
   *
   * `ram8` is this level's reward and is deliberately not in its palette: every
   * pin here is one bit wide, so an eight-bit part has nothing to attach to
   * (batch 1's level-14 reason), exactly as chapter 1's capstone rewards `mem1`
   * without listing it. The reward is still handed out -- it is what level 37's
   * little box is built from.
   */
  {
    id: 'ch2-28-circular-dependency',
    chapter: 2,
    index: 28,
    name: { zh: '循环依赖', en: 'Circular Dependency' },
    brief: {
      zh: '这一关要做的是一块会记住一位的电路。时钟沿到来时：set 为高就把 value 存下来，set 为低就保持原来那一位，无论 value 在这一拍是什么。输出从 0 开始。注意：只用逻辑门绕成的回路在本引擎里永远不会稳定（会报「不稳定回路」），回路里必须有一个存储元件。',
      en: 'This level is a circuit that remembers one bit. On a clock edge: set high stores value, set low keeps the bit it already had whatever value says. The output starts at 0. Note: a loop made only of gates never settles in this engine -- it is reported as an unstable loop -- so the loop has to contain a storage element.',
    },
    hint: {
      zh: '把输出接回自己的输入，中间放一条延迟线：回路经过存储元件就稳定了。「set 为高时取 value，否则取输出自己」是一次二选一——一个非门把 set 取反，两个开关分别送出 value 与输出自己，再用一个或门合起来，接进延迟线的输入。',
      en: 'Close the loop from the output back into its own input through a Delay Line: a loop that passes through a storage element settles. "Take value while set is high, otherwise take the output" is one two-way choice -- invert set with a NOT, pass value and the output through two Switches, OR the two results and feed that into the Delay Line.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_SET_VALUE_OUT,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { set: 0, value: 0 }, expect: { out: 0 } },
          // No edge has run yet, so a circuit that mirrored set/value would show
          // 1 here: this step is the "it is storage, not logic" assertion.
          { tick: 0, inputs: { set: 1, value: 1 }, expect: { out: 0 } },
          { tick: 1, inputs: { set: 1, value: 1 }, expect: { out: 1 } },
          { tick: 1, inputs: { set: 0, value: 0 }, expect: { out: 1 } },
          { tick: 2, inputs: { set: 0, value: 0 }, expect: { out: 1 } },
          { tick: 2, inputs: { set: 1, value: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { set: 1, value: 0 }, expect: { out: 0 } },
          { tick: 3, inputs: { set: 0, value: 1 }, expect: { out: 0 } },
          { tick: 4, inputs: { set: 0, value: 1 }, expect: { out: 0 } },
        ],
      },
    ],
    // Measured: `not` (1) + two `switch` (2 each) + `or` (3) = 8 NAND equivalents,
    // with the delay line free on both metrics and a path three components deep
    // (NOT -> switch -> OR). See the comment above for what the construction and
    // the palette withholding are for.
    threeStar: { gate: 8, delay: 3, tick: 4 },
    rewards: { components: ['ram8'] },
  },

  /**
   * ch2-29-delayed-lines -- Delayed Lines / 延迟线
   *
   * SOURCED: the name in both languages, its position (29th), and the concept --
   * '信号延迟一拍输出': a signal that comes out one tick late. No ports, no
   * widths, no pass condition, no target and no reward.
   *
   * AUTHORED: the `a:8 -> out:8` shape; the ten-step script; the measured target;
   * the `reg8`/`delay8` rewards; and the palette.
   *
   * THE SAME-TICK PAIRS ARE THE LEVEL'S WHOLE TEST, and they exist because of the
   * tick semantics in the module note. The step at tick T drives `a` and then
   * advances to T, so the byte sampled at that edge is the byte the same step
   * drove -- which means a delay line reads exactly like a wire if the input
   * changes at every step. The step that repeats tick T with a NEW byte on `a`
   * and still demands the OLD one is what tells them apart: no edge runs between
   * the two, so a wire shows the new byte and a delay shows the stored one. The
   * test file grades all three shapes against this script -- a wire fails at
   * tick 0, one tick of delay passes, two ticks of delay fail at tick 1.
   *
   * THREE SPELLINGS TIE ON BOTH METRICS, asserted in the test file rather than
   * claimed here: the `delay8` this level hands out, eight 1-bit `delay_line`s
   * behind a splitter and a maker, and a `reg8` with its `load` tied high all
   * measure 0 gates / 0 delay / tick 4. Storage is free on both metrics by the
   * chapter's ruling (module note), so this level's target is the floor, and what
   * the level teaches is the tick rather than a particular part.
   */
  {
    id: 'ch2-29-delayed-lines',
    chapter: 2,
    index: 29,
    name: { zh: '延迟线', en: 'Delayed Lines' },
    brief: {
      zh: '八位输入 a。每一个时钟沿把当时 a 上的字节存下来，输出就变成它；两个时钟沿之间无论 a 怎么变，输出都不动。输出从 0 开始。',
      en: 'Eight-bit input a. Each clock edge stores the byte that is on a, and the output becomes it; between two edges the output does not move, however a changes. It starts at 0.',
    },
    hint: {
      zh: '一颗 8 位延迟线就是答案：它的输出永远是上一个时钟沿采到的字节。也可以用八条一位延迟线并排——位拆分器拆开 a、八条各存一位、位合并器拼回一个字节——或者把 8 位寄存器的 load 接成高电平。',
      en: 'One 8-Bit Delay Line is the answer: its output is always the byte the last clock edge sampled. Eight 1-bit Delay Lines side by side do the same (split a, store one bit each, pack them back), and so does the 8-Bit Register with its load pin tied high.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, 'delay8', 'reg8', ...LEVEL_IO],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { a: 0x00 }, expect: { out: 0x00 } },
          { tick: 0, inputs: { a: 0x5a }, expect: { out: 0x00 } },
          { tick: 1, inputs: { a: 0x5a }, expect: { out: 0x5a } },
          { tick: 1, inputs: { a: 0xa5 }, expect: { out: 0x5a } },
          { tick: 2, inputs: { a: 0xa5 }, expect: { out: 0xa5 } },
          { tick: 2, inputs: { a: 0x00 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { a: 0x00 }, expect: { out: 0x00 } },
          { tick: 3, inputs: { a: 0xff }, expect: { out: 0x00 } },
          { tick: 4, inputs: { a: 0xff }, expect: { out: 0xff } },
          { tick: 4, inputs: { a: 0x00 }, expect: { out: 0xff } },
        ],
      },
    ],
    // Measured: the `delay8` reference is 0 NAND equivalents and 0 delay units
    // (a storage element is free on both), and the tick metric is the last tick
    // the script drives. The eight-delay-line and register spellings measure the
    // same pair -- see the comment above.
    threeStar: { gate: 0, delay: 0, tick: 4 },
    rewards: { components: ['reg8', 'delay8'] },
  },

  /**
   * ch2-30-odd-ticks -- Odd Ticks / 奇变偶不变
   *
   * SOURCED: the name in both languages, its position (30th), and the concept,
   * which is the whole of what the source says: '构建振荡电路（时钟信号发生器）' --
   * build an oscillating circuit, a clock-signal generator. It gives NO period,
   * NO duty cycle and NO rule for what a disabled clock does.
   *
   * AUTHORED, and everything computable here is authored because of that: the
   * `enable:1 -> out:1` shape; the period (two ticks: high for one, low for the
   * next); the rule that `enable` low HOLDS the output rather than clearing it
   * (nothing in the source gates the clock at all, and "hold" is what makes a
   * clock source stoppable and restartable without losing its phase); the
   * sixteen-tick alternating run, the four held ticks and the four resumed ones
   * the first script states, and the eight held-low ticks the second one states;
   * the measured target; and the palette.
   *
   * PERIODICITY IS THE ASSERTION, AND ONE TICK WOULD PROVE NOTHING. A single
   * "tick 1 is high" would be satisfied by a wire to the rail; what the check
   * states is a regular alternation -- 周期性 (periodicity), a period of two
   * ticks -- across sixteen consecutive ticks: eight whole periods, every
   * consecutive pair differing. Four ticks follow with `enable` low that must all
   * read the value the last enabled tick left, and four more that resume the beat
   * from it. The test file measures that shape out of the check data and grades
   * three circuits against it: the reference passes, a clock that never ticks
   * fails at tick 1, and an UNGATED oscillator -- one that flips whatever
   * `enable` says -- satisfies all sixteen beats and fails at tick 16, the first
   * held tick, with `expected 1, actual 0`.
   *
   * `out XOR enable` IS BOTH HALVES IN ONE GATE: XOR with 1 inverts (the beat)
   * and XOR with 0 keeps (the hold), and the enable is the gate. The reference is
   * that XOR plus a 1-Bit Memory whose `set` is tied high so it samples every
   * edge -- 4 NAND equivalents on a path one delay unit deep, measured. `mem1` is
   * offered here although level 28 withholds it: the level's answer is the XOR
   * and the storage together, so neither part answers it alone.
   */
  {
    id: 'ch2-30-odd-ticks',
    chapter: 2,
    index: 30,
    name: { zh: '奇变偶不变', en: 'Odd Ticks' },
    brief: {
      zh: '这是本章的时钟源：电路自己产生节拍。enable 为高时，每来一个时钟沿输出就翻转一次（0、1、0、1……一直交替）；enable 为低时输出停在当时的值上，不再翻转，enable 回来之后从停下的地方接着走。输出从 0 开始。',
      en: "This is the chapter's clock source: a circuit that makes its own beat. While enable is high the output flips on every clock edge (0, 1, 0, 1, ... alternating); while enable is low the output stops where it is instead of flipping, and when enable comes back the beat resumes from the value it held. It starts at 0.",
    },
    hint: {
      zh: '「翻转」是与 1 异或，「保持」是与 0 异或，而 enable 正好就是那个 0 或 1：把输出与 enable 异或，一次运算两件事都做好了。再让延迟线或 1 位存储器在每个时钟沿采样这个结果即可——存储元件发布的是自己保存的值而不是输入，所以这个回路是稳定的。',
      en: 'Flipping is XOR with 1, holding is XOR with 0, and enable is that 0 or 1: XOR the output with enable and one gate does both jobs. Let a Delay Line or a 1-Bit Memory sample the result on every clock edge -- the storage element publishes what it holds rather than its input, so the loop settles.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, 'mem1', ...LEVEL_IO],
    io: IO_ENABLE_OUT,
    checks: [
      { kind: 'script', steps: OSCILLATOR_STEPS },
      { kind: 'script', steps: HELD_LOW_STEPS },
    ],
    // Measured: one `xor` (4 NAND equivalents) on a path one delay unit deep,
    // with the 1-Bit Memory and the constant free on both metrics. The tick
    // metric is the last tick the longer script drives.
    threeStar: { gate: 4, delay: 1, tick: 23 },
  },

  /**
   * ch2-31-bit-inverter -- Bit Inverter / 1 位取反器
   *
   * SOURCED: the name in both languages, its position (31st), and the concept --
   * '使用 XOR 进行位翻转': use XOR to flip a bit.
   *
   * AUTHORED: the `a:1 inv:1 -> out:1` shape -- the source names the gate and not
   * the pins, so which one is the control and which is the data is this file's
   * choice, and `inv` is the control; the four rows, built by `truthTable`, which
   * refuses a table that leaves a declared output pin uncompared; the measured
   * target; and the palette (one-bit parts only: every pin here is one bit wide,
   * so the wide parts levels 9-27 unlocked have nothing to attach to -- batch 1's
   * level-14 reason).
   *
   * THE TARGET SEPARATES ONE CORRECT ANSWER FROM ANOTHER, measured in the test
   * file rather than asserted here: `xor(a, inv)` is 4 NAND equivalents -- the
   * classic four-NAND cell -- on a path one gate deep, while the sum-of-products
   * spelling of the same function, `(a AND NOT inv) OR (NOT a AND inv)`, is 9
   * NAND equivalents on a path three components deep: correct, and one star. The
   * `xor` part is offered because it is a chapter-1 part every level here already
   * owns; it TIES this target rather than beating it, so offering it costs the
   * level nothing.
   *
   * `switch` is offered and is not useful here: it is a 1-bit conditional pass,
   * which is level 32's function rather than this one, and batch 1/2 offered
   * plenty of parts a level cannot use.
   */
  {
    id: 'ch2-31-bit-inverter',
    chapter: 2,
    index: 31,
    name: { zh: '1 位取反器', en: 'Bit Inverter' },
    brief: {
      zh: 'inv 是一位控制信号：inv 为 1 时把 a 取反，inv 为 0 时把 a 原样送出去。四种输入组合都要对。',
      en: 'inv is a one-bit control: when it is 1 the output is a inverted, when it is 0 the output is a unchanged. All four input combinations have to be right.',
    },
    hint: {
      zh: '异或就是「可以选择要不要取反」：a 异或 inv，inv 为 1 时结果翻过来，为 0 时结果就等于 a。四个与非门就能拼出一个异或。',
      en: 'XOR is exactly "invert, or not, as you choose": a XOR inv flips when inv is 1 and equals a when inv is 0. Four NANDs make an XOR.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_A1_INV1_OUT1,
    checks: [truthTable(IO_A1_INV1_OUT1, { out: ({ a, inv }) => (a ?? 0) ^ (inv ?? 0) })],
    // Measured: one `xor` (4 NAND equivalents) on a path one gate deep, with the
    // two level pins as the sources. The sum-of-products spelling is 9 and 3, one
    // star -- see the comment above.
    threeStar: { gate: 4, delay: 1, tick: 0 },
  },

  /**
   * ch2-32-bit-switch -- Bit Switch / 1 位开关
   *
   * SOURCED: the name in both languages, its position (32nd), and the concept --
   * '条件通断信号（类似与门但可级联省或门）': a conditional pass, like an AND gate
   * but cascadeable in a way that saves OR gates.
   *
   * AUTHORED: the `a:1 on:1 -> out:1` shape; the four rows; the measured target;
   * and the palette.
   *
   * THE PART IS OLD NEWS BY THE TIME THIS LEVEL ARRIVES, and this comment is where
   * that is recorded. The source teaches `switch` here -- its own level 32 is
   * literally named Bit Switch -- but this replica slides the part from chapter 1
   * into chapter 2 (spec 3.3) and the level data unlocks it, with `switch8`, at
   * level 22, the 8-bit adder whose ripple carry chain needs the conditional pass;
   * level 28's reference is built from two of them. So the player has held `switch`
   * for ten levels when this level opens, and level 32 is a RE-TEACH rather than an
   * introduction: what it verifies is that the player can put the behaviour on the
   * pins (`on` high passes `a`, `on` low holds 0) rather than that they can meet a
   * new part. Nothing else about the level changes for it -- the four rows, the
   * 2/1 target and the palette are as they were, and
   * `test/levels/unlock-chain.test.ts` pins the unlock at level 22.
   *
   * THE SOURCE'S "LIKE AN AND GATE" IS MEASURED RATHER THAN ASSERTED, and that is
   * what makes it safe for this level to offer the part it is named after:
   * `and(a, on)` is 2 NAND equivalents on one delay unit, and the registered
   * `switch` part is exactly the same 2/1, so the test file grades both and
   * asserts the tie. A player who reads the level's name and drops the Switch in
   * gets the same circuit and the same score as a player who builds the AND,
   * which is the honest way to teach that the two are one thing. Nothing else in
   * the palette is needed: one AND is the whole level.
   */
  {
    id: 'ch2-32-bit-switch',
    chapter: 2,
    index: 32,
    name: { zh: '1 位开关', en: 'Bit Switch' },
    brief: {
      zh: 'on 为 1 时把 a 放过去，on 为 0 时输出被按住为 0——不管 a 是什么。这就是条件通断，四种组合都要对。',
      en: 'While on is 1 the value of a passes through; while on is 0 the output is held at 0 whatever a says. That is a conditional pass, and all four combinations have to be right.',
    },
    hint: {
      zh: '与门的真值表就是它：两个输入都为高才输出高，所以 on 为 0 时输出必然是 0。开关元件（switch）就是同一个电路、同一个价格。',
      en: 'The AND truth table is exactly that: high only when both inputs are high, so on = 0 forces the output to 0. The Switch part is the same circuit at the same price.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, ...LEVEL_IO],
    io: IO_A1_ON1_OUT1,
    checks: [truthTable(IO_A1_ON1_OUT1, { out: ({ a, on }) => (a ?? 0) & (on ?? 0) })],
    // Measured: one `and` (2 NAND equivalents) on a path one gate deep. The
    // `switch` part measures the same pair -- see the comment above.
    threeStar: { gate: 2, delay: 1, tick: 0 },
  },

  /**
   * ch2-33-input-selector -- Input Selector / 数据选择器
   *
   * SOURCED: the name in both languages, its position (33rd), and the concept --
   * '2-to-1 多路复用器（MUX）': a 2-to-1 multiplexer. No ports, no widths, no pass
   * condition, no target and no reward.
   *
   * AUTHORED: the `a:8 b:8 sel:1 -> out:8` shape; the fuzz check (the brief fixes
   * its kind, its 256 rounds and its fixed-seed discipline; the seed, the pin
   * maps and the expectation function are written here); the measured target; the
   * `mux8` reward; and the palette.
   *
   * WHY THIS LEVEL IS FUZZED WHERE LEVEL 34 IS TABLED: 2^17 input vectors cannot
   * be written out as rows, and a byte selector is exactly the kind of circuit
   * where one mis-wired bit costs half the vectors. The seed is a fixed literal
   * (`0x3308`: the level index in the high byte, the byte width in the low one,
   * as batches 2 and 3 seed theirs), so the coverage is a fact about the level.
   * The test file measures it: how many of the 256 rounds drive `sel` low and how
   * many drive it high (both well over fifty -- either branch alone would leave
   * half the circuit ungraded), that the sequence repeats exactly on a second
   * run, and that `out <- a` fails on the first round whose `sel` is high.
   *
   * THE REFERENCE IS THE PART THIS LEVEL HANDS OUT. `mux8` is 8 x 4-NAND 2:1
   * muxes = 32 NAND equivalents on a path one delay unit deep, and it is in this
   * level's palette by the app's own-reward rule (a level's own rewards are
   * offered on it, `paletteDefsFor`).
   *
   * WHAT THE TARGET ACTUALLY SEPARATES, measured in the test file for this level
   * and level 34 rather than asserted here, and the answer is not the obvious
   * one: a hand-built selector -- one NOT of `sel` shared by all eight bits, then
   * three NANDs per bit (a NAND is ONE NAND equivalent, so a shared inverter
   * really is shared) -- measures 25 gates on a path THREE components deep. It is
   * therefore CHEAPER on gates than the part's own documented cell, which prices
   * one inverter per bit, and it still scores one star: the delay column is what
   * declines it, because `mux8` is a single node and the built version is three.
   * The level's target is the part's own metrics, and the part wins on score
   * (32 + 4 = 36 against 25 + 12 = 37) as well as on stars. Nothing here denies
   * three stars to a construction that meets both bounds.
   */
  {
    id: 'ch2-33-input-selector',
    chapter: 2,
    index: 33,
    name: { zh: '数据选择器', en: 'Input Selector' },
    brief: {
      zh: '两路八位数据 a 和 b，一位选择信号 sel。sel 为 0 时输出 a，sel 为 1 时输出 b——整字节一起选，没被选中的那一路一位都不许漏过去。',
      en: 'Two eight-bit data inputs a and b and one select bit sel. sel 0 publishes a and sel 1 publishes b, all eight bits at once, and not one bit of the unselected line may leak through.',
    },
    hint: {
      zh: '每一位都是一次二选一：sel 为 0 取 a 的那一位，为 1 取 b 的那一位。位拆分器把两个字节各拆成八位，八组各选一次，再用位合并器拼回一个字节；本关奖励的 8 位多路选择器（mux8）正是这个电路。',
      en: 'Every bit is one two-way choice: bit i of a when sel is 0, bit i of b when sel is 1. Split both bytes, choose eight times, and pack the eight results back into a byte; the 8-Bit Multiplexer this level hands out is exactly that circuit.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...SWITCH_1, 'mux8', ...LEVEL_IO],
    io: IO_A8_B8_SEL1_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_33,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
          sel: (sample) => sample.sel ?? 0,
        },
        // No mask is needed and none is written: the result is one of the two
        // operands, both of which are already inside the pin.
        outputs: { out: (v) => ((v.sel ?? 0) === 1 ? (v.b ?? 0) : (v.a ?? 0)) },
      },
    ],
    // Measured: `mux8` is 8 x MUX2 = 32 NAND equivalents on a path one delay
    // unit deep. The hand-built 25/3 selector is one star too -- see the comment.
    threeStar: { gate: 32, delay: 1, tick: 0 },
    rewards: { components: ['mux8'] },
  },

  /**
   * ch2-34-the-bus -- The bus / 总线
   *
   * SOURCED: the name in both languages, its position (34th), and the source's
   * concept, which is one line and nothing else: '共享数据传输线路的概念' -- the
   * idea of a data line that several sources share. No ports, no widths, no
   * arbitration rule, no pass condition, no target and no reward.
   *
   * AUTHORED, AND THE FIRST THING IT RECORDS IS A CHANGE OF KIND. The source's
   * concept is not computable as written in this engine, and not because this
   * replica skipped it. Spec 3.1 forbids a bus protocol, in its own words
   * 不做总线协议（多驱动仲裁）. `validateGraph` reports a second wire on one input
   * pin as a `multiple-drivers` ERROR, and nothing in the kernel resolves which
   * of several drivers owns a line. A literal shared/tri-state bus is therefore
   * unimplementable BY DESIGN.
   * The level is reframed as the bus's other half: exactly one driver is active
   * at a time, so `out` equals the line `sel` selects. In other words this level
   * teaches driver selection, and its brief tells the player the same thing in
   * both languages rather than pretending the source's line is a circuit spec.
   * This is one of the three places in this phase where a level's kind knowingly
   * changes, and it is recorded as such.
   *
   * AUTHORED (the rest): the `a:8 b:8 sel:1 -> out:8` shape; the four-row table
   * and its vectors; the measured target; and the palette.
   *
   * THE TABLE IS FOUR ROWS BY THE BRIEF'S DECISION, not for want of a generator:
   * this level states the RULE at a scale a reader can check by eye, and the
   * byte-wide coverage is level 33's fuzz check. Both `sel` values appear on the
   * same pair of operands (so the table separates "the selected line" from
   * "always the first" and "always the second"), and the two operand pairs are
   * asymmetric byte patterns, so a circuit that shuffled bits within the byte
   * would fail one of the four.
   *
   * THE FUNCTION IS LEVEL 33'S, WHICH IS THE BRIEF'S OWN TABLE RATHER THAN A
   * SLIP: one shape, one behaviour, two frames -- 33 is the byte selector graded
   * by 256 random vectors, 34 is the shared line graded by a four-row truth
   * table. (Batch 1 recorded the same coincidence for levels 15 and 16.) The
   * reference is `mux8`, unlocked by level 33 and offered here, and it measures
   * exactly the metrics level 33's target states, because it is the same circuit;
   * the hand-built selector measures the same 25 gates / 3 delay units / one star
   * here as it does there, and level 33's comment is where that measurement is
   * written out.
   */
  {
    id: 'ch2-34-the-bus',
    chapter: 2,
    index: 34,
    name: { zh: '总线', en: 'The bus' },
    brief: {
      zh: '总线是多路信号共享的一条数据线。本引擎没有总线协议，也不做多驱动仲裁：一个输入引脚只能被一根线驱动，几路信号同时抢一条线在这里是不允许的。所以这一关教的是总线的另一半——任何时刻只有一路驱动有效。sel 为 0 时总线上是 a，sel 为 1 时是 b，没被选中的那一路完全不出现。',
      en: 'A bus is one data line that several sources share. This engine has no bus protocol and does no multi-driver arbitration: one input pin is driven by exactly one wire, so several sources fighting over a single line is not something this engine can run. This level therefore teaches the other half of a bus -- exactly one driver is active at any moment. With sel 0 the line carries a, with sel 1 it carries b, and the unselected line does not appear at all.',
    },
    hint: {
      zh: '每一位都是一次二选一：被选中的那一路到达输出，另一路一位也不许混进来。8 位多路选择器（mux8）就是一次字节级的二选一；也可以自己用与非门搭，只是更贵。',
      en: 'Every bit is one two-way choice: the selected line reaches the output and the other may not mix in a single bit. The 8-Bit Multiplexer is that choice at byte scale; it can also be built from NANDs, at a higher price.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...SWITCH_1, 'mux8', ...LEVEL_IO],
    io: IO_A8_B8_SEL1_OUT8,
    checks: [{ kind: 'truth-table', rows: BUS_ROWS }],
    // Measured: the same `mux8` as level 33 -- 32 NAND equivalents, one delay
    // unit, no ticks (a purely combinational level). See the comment above.
    threeStar: { gate: 32, delay: 1, tick: 0 },
  },

  /**
   * ch2-35-saving-gracefully -- Saving Gracefully / 优雅存储
   *
   * SOURCED: the name in both languages, its position (35th), and the concept --
   * '1 位锁存器/寄存器（条件写入）': a one-bit latch or register, written
   * conditionally.
   *
   * AUTHORED: the `d:1 load:1 -> out:1` shape; the eleven-step script and its
   * same-tick pairs; the measured target; and the palette.
   *
   * THE SAME STORAGE RULE AS LEVEL 28 UNDER DIFFERENT PIN NAMES, which is the
   * brief's own table rather than a slip: 28 reads `set`/`value` and this level
   * reads `d`/`load`, and both ask for "store the data bit while the enable is
   * high, hold it otherwise". They are framed differently and their checks assert
   * different things -- 28 is where the LOOP is built, its check asserts that the
   * loop settles, and its palette withholds the packaged part; this level is
   * where the packaged part is USED, and its script walks load low/high/low across
   * six ticks, each tick stating both its edge and the no-edge re-read that
   * follows it. The test file grades the hand-built loop against this level too,
   * and it is correct for one star.
   *
   * `mem1` IS OFFERED HERE AND IS THE REFERENCE. Its `set` pin is the write enable
   * and its `value` pin is the data, so `load` and `d` wire straight into it --
   * which is exactly the source's concept, a one-bit register with a conditional
   * write. The measured target (0 gates / 0 delay / tick 5) is therefore that
   * part's own metrics, and storage is free on both metrics by the chapter's
   * ruling (module note): the unlocked part IS the floor, and rebuilding it from
   * gates is a correct answer worth one star. The test file measures the built
   * version too (one delay line, two switches, a NOT and an OR: 8 gates, 3 delay
   * units), so the price of building the loop rather than dropping the part in is
   * a number in this batch rather than a sentence.
   */
  {
    id: 'ch2-35-saving-gracefully',
    chapter: 2,
    index: 35,
    name: { zh: '优雅存储', en: 'Saving Gracefully' },
    brief: {
      zh: '一位的条件写入。load 为高时，时钟沿把 d 存下来；load 为低时输出保持不动，d 在这一拍说什么都不算。输出从 0 开始。',
      en: 'A one-bit conditional write. While load is high a clock edge stores d; while load is low the output keeps its bit and d has no say. It starts at 0.',
    },
    hint: {
      zh: '1 位存储器（mem1）就是这块东西：set 是写入使能、value 是数据，把 load 接到 set、d 接到 value 即可。也可以自己搭——输出经过一条延迟线回到输入，「load 为高取 d、否则取输出自己」用两个开关加一个或门——只是门多一些。',
      en: 'The 1-Bit Memory is exactly this part: its set pin is the write enable and its value pin is the data, so wire load to set and d to value. It can be built by hand as well -- the output returns through a Delay Line and two Switches plus an OR choose between d and the output -- for more gates.',
    },
    allowedComponents: [...GATES_1BIT, ...SWITCH_1, 'mem1', ...LEVEL_IO],
    io: IO_D1_LOAD1_OUT1,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { d: 0, load: 0 }, expect: { out: 0 } },
          // No edge has run: a latch that published `load ? d : 0` would show 1.
          { tick: 0, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 1, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 1, inputs: { d: 1, load: 1 }, expect: { out: 0 } },
          { tick: 2, inputs: { d: 1, load: 1 }, expect: { out: 1 } },
          { tick: 2, inputs: { d: 0, load: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { d: 0, load: 0 }, expect: { out: 1 } },
          { tick: 3, inputs: { d: 0, load: 1 }, expect: { out: 1 } },
          { tick: 4, inputs: { d: 0, load: 1 }, expect: { out: 0 } },
          { tick: 4, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
          { tick: 5, inputs: { d: 1, load: 0 }, expect: { out: 0 } },
        ],
      },
    ],
    // Measured: the `mem1` reference is 0 NAND equivalents and 0 delay units (a
    // storage element is free on both) with tick 5 as the script's last tick. The
    // hand-built loop is 8 gates and 3 delay units, one star -- see the comment.
    threeStar: { gate: 0, delay: 0, tick: 5 },
  },

  /**
   * ch2-36-saving-bytes -- Saving Bytes / 存储一字节
   *
   * SOURCED: the name in both languages, its position (36th), and the concept --
   * '8 位寄存器': an eight-bit register. No ports, no widths, no pass condition,
   * no target and no reward.
   *
   * AUTHORED: the `d:8 load:1 -> out:8` shape; the fourteen-step script and its
   * same-tick pairs; the measured target; the `counter8` reward; and the palette.
   *
   * THE REFERENCE IS THE REGISTER THIS LEVEL'S REWARD LIST NAMES: `reg8` with
   * `reset` tied low is 0 gates and 0 delay on the chapter's ruling, and the
   * target is its own measured metrics. The bit-sliced alternative -- eight 1-Bit
   * Memories with `load` on all eight `set` pins, behind a splitter and a maker --
   * measures exactly the same pair, and the test file grades both and asserts the
   * tie rather than picking one and calling it the answer.
   *
   * `counter8` IS HANDED OUT HERE AND IS OFFERED IN THIS LEVEL'S OWN PALETTE. It
   * cannot answer the level -- it has no way to take a byte IN, which is the whole
   * of what this level asks for -- so offering it is the app's own-reward rule
   * rather than a shortcut. Level 38, whose answer it IS, does not offer it; that
   * level's comment records why.
   *
   * The script's same-tick pairs are the level's test of "hold" (module note): the
   * step that repeats a tick with a different byte on `d` and still demands the
   * stored one is failed by a wire and passed by a register, and the level's
   * counterexample in the test file is exactly that wire.
   */
  {
    id: 'ch2-36-saving-bytes',
    chapter: 2,
    index: 36,
    name: { zh: '存储一字节', en: 'Saving Bytes' },
    brief: {
      zh: '把一位的条件写入扩到八位：load 为高时，时钟沿把整个字节 d 存下来；load 为低时输出保持上一个存入的字节。输出从 0 开始。',
      en: 'The same conditional write one byte wide: while load is high a clock edge stores all eight bits of d; while load is low the output keeps the byte it stored. It starts at 0.',
    },
    hint: {
      zh: '8 位寄存器（reg8）的 d 和 load 就是这两个引脚，把 reset 接低电平即可。也可以用八颗 1 位存储器并排：load 同时接到八颗的 set 上，每颗存 d 的一位。两条路在本关的评分上一模一样。',
      en: 'The 8-Bit Register has exactly these pins -- d and load, with reset tied low. Eight 1-Bit Memories side by side do the same job: wire load to all eight set pins and each stores one bit of d. Both routes score the same on this level.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'delay8',
      'mem1',
      'reg8',
      'counter8',
      ...LEVEL_IO,
    ],
    io: IO_D8_LOAD1_OUT8,
    checks: [
      {
        kind: 'script',
        steps: [
          { tick: 0, inputs: { d: 0x00, load: 0 }, expect: { out: 0x00 } },
          { tick: 0, inputs: { d: 0xa5, load: 0 }, expect: { out: 0x00 } },
          { tick: 1, inputs: { d: 0xa5, load: 0 }, expect: { out: 0x00 } },
          { tick: 1, inputs: { d: 0xa5, load: 1 }, expect: { out: 0x00 } },
          { tick: 2, inputs: { d: 0xa5, load: 1 }, expect: { out: 0xa5 } },
          { tick: 2, inputs: { d: 0x00, load: 0 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { d: 0x00, load: 0 }, expect: { out: 0xa5 } },
          { tick: 3, inputs: { d: 0x00, load: 1 }, expect: { out: 0xa5 } },
          { tick: 4, inputs: { d: 0x00, load: 1 }, expect: { out: 0x00 } },
          { tick: 4, inputs: { d: 0xff, load: 0 }, expect: { out: 0x00 } },
          { tick: 5, inputs: { d: 0xff, load: 0 }, expect: { out: 0x00 } },
          { tick: 5, inputs: { d: 0xff, load: 1 }, expect: { out: 0x00 } },
          { tick: 6, inputs: { d: 0xff, load: 1 }, expect: { out: 0xff } },
          { tick: 6, inputs: { d: 0x5a, load: 0 }, expect: { out: 0xff } },
        ],
      },
    ],
    // Measured: the `reg8` reference is 0 NAND equivalents (the storage element
    // and the constant are both free on the gate metric) and 0 delay units, with
    // tick 6 as the script's last tick. Eight 1-Bit Memories measure the same
    // pair -- see the comment above.
    threeStar: { gate: 0, delay: 0, tick: 6 },
    rewards: { components: ['counter8'] },
  },

  /**
   * ch2-37-little-box -- Little Box / 小盒子
   *
   * SOURCED: the name in both languages, its position (37th), and the source's
   * concept, which is one line and nothing else: '刚好装满存储空间的电路设计' -- a
   * circuit design that exactly fills its storage space. The source gives NO
   * capacity, NO address width, and NO definition of what "full" means.
   *
   * AUTHORED, AND WHAT IT DEFINES IS THE LEVEL. This replica defines the level as
   * `d:8 addr:8 load:1 -> out:8` over a `ram8`'s 256 bytes, and defines 装满
   * ("full") as: ALL 256 addresses are addressable and writable, and every
   * address reads back what was written into it. That definition is the level's
   * contract, it is stated in the brief in both languages, and the check asserts
   * it over the whole range rather than sampling it.
   *
   * THE CHECK COVERS THE WHOLE RANGE, WHICH IS THE POINT OF THE DEFINITION: 513
   * steps. The first 256 write a distinct byte into every address 0-255, one
   * clock edge each (`boxByte` is a bijection of 0..255, so no two cells hold the
   * same value), and assert the byte on the output on the same step; the last 256
   * re-read every address with `load` LOW and `d` driven with the COMPLEMENT of
   * the stored byte, after all 256 writes have happened. So the pass proves the
   * box holds all 256 bytes at once rather than that the most recent write can be
   * read, and a circuit that passed `d` through to `out` would fail every one of
   * the 256 read steps. A check that touched two addresses would not test "full",
   * and both shapes are graded in the test file: a single register that ignores
   * `addr` fails on the first read-back (with `expected` the byte address 0 was
   * written with), and a wire from `d` fails on that same step, because `d` is
   * the complement of the byte the level expects.
   *
   * THE REFERENCE IS `ram8`, unlocked by level 28: 0 gates, 0 delay, and tick 512
   * -- the script's last tick. Storage is free on both metrics (module note), a
   * 256-byte memory is the one part that can BE a 256-byte box, and the brief
   * says the other way honestly: 256 bytes of one-bit latches would work and
   * would be a board-sized circuit. That is why this level has no gate target to
   * fight: the level is about the address range, and the range is what the check
   * measures.
   */
  {
    id: 'ch2-37-little-box',
    chapter: 2,
    index: 37,
    name: { zh: '小盒子', en: 'Little Box' },
    brief: {
      zh: '一个装得满满的小盒子：256 个格子，每格一个字节。addr 是格子号（0 到 255）；load 为高时，时钟沿把 d 写进 addr 指定的那一格；输出永远显示 addr 指定的那一格里的字节，不需要时钟沿。本关要的就是「装满」：256 个地址每一个都能写进去、都能原样读回来。',
      en: 'A little box that is completely full: 256 cells, one byte each. addr is the cell number (0 through 255); while load is high a clock edge writes d into the cell addr names, and the output always shows the byte in the cell addr names, with no clock edge needed. What this level asks for is "full": every one of the 256 addresses can be written and read back unchanged.',
    },
    hint: {
      zh: '8 位存储器（ram8）就是这 256 个格子：d、addr、load 三个引脚的名字与本关完全一致，输出直接接到 out。用别的元件凑出 256 个字节的存储倒也不是不行，只是要在这块板子上放非常多的东西。',
      en: 'The 8-Bit RAM is this box: its d, addr and load pins are named exactly as this level names them, and its output wires straight to out. Building 256 bytes of storage out of smaller parts is not impossible, but it takes a great many components on this board.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'delay8',
      'mem1',
      'reg8',
      'ram8',
      ...LEVEL_IO,
    ],
    io: IO_D8_ADDR8_LOAD1_OUT8,
    checks: [{ kind: 'script', steps: littleBoxSteps() }],
    // Measured: the `ram8` reference is 0 NAND equivalents and 0 delay units (a
    // storage element is free on both; the read path following `addr` is still a
    // sequential element's own output on the delay graph), and the tick metric is
    // the script's last tick -- 256 writes and 256 read-backs.
    threeStar: { gate: 0, delay: 0, tick: 512 },
  },

  /**
   * ch2-38-counter -- Counter / 计数器
   *
   * SOURCED: the name in both languages, its position (38th, the last level of
   * the chapter), the concept -- '自增寄存器': a register that increments itself
   * -- AND the source's own achievement note, quoted in full: '成就：≤ 65 个门'
   * (achievement: no more than 65 gates).
   *
   * AUTHORED: the `en:1 reset:1 -> out:8` shape; the 265-step script; the measured
   * target; and the palette.
   *
   * HOW THE ACHIEVEMENT IS RECORDED, AND WHAT IT IS NOT. The source's note is an
   * achievement, not a pass condition: it grades no circuit here, and nothing in
   * this file treats 65 as this level's `threeStar.gate`. It is also a count of
   * BASIC LOGIC GATES in the source's own metric, while this replica's `gate`
   * metric counts NAND equivalents (spec 5.4; the basis table is in
   * `core/defs/index.ts`), and those two are not the same quantity -- batch 2 made
   * exactly this distinction for level 21's five components and level 22's delay
   * of 35. What `threeStar.gate` carries is the MEASURED NAND-equivalent count of
   * this replica's own reference solution: 41, which is inside the source's 65 by
   * any reading of it. So 65 is recorded in this comment as the source's
   * achievement -- an achievement, not a pass condition -- and it is not this
   * level's `threeStar.gate`, nor any number this level grades a circuit on.
   *
   * THE PALETTE WITHHOLDS `counter8`, THE ONE PART THAT ANSWERS THIS LEVEL IN A
   * SINGLE DROP: it is unlocked by level 36, it is not this level's own reward, and
   * its pins (`en`/`reset` -> `out`) are exactly this level's -- batch 2's rule
   * (level 22's `add8`, level 24's `neg8`, and level 28's `mem1` earlier in this
   * batch), used once more here. Offered, it would score 0 gates and 0 delay
   * (storage is free on both metrics) in one component, which would both answer
   * the level and make the source's own achievement vacuous. The test file
   * measures that drop-in -- it passes, at 0/0/tick 263 -- and asserts it is not
   * in the palette. The increment has to be built here.
   *
   * THE REFERENCE IS THE REGISTER PLUS A HAND-BUILT INCREMENTER: `bit0 = NOT x0`,
   * `bit_i = x_i XOR c_i`, `c_(i+1) = x_i AND c_i` with `c_1 = x0`, and the last
   * carry is never built because there is no carry-out pin -- one NOT, seven XORs
   * and six ANDs, measured 41 NAND equivalents on a path seven components deep.
   * `en` goes to the register's `load` and the level's `reset` to its `reset`, so
   * the decided precedence (reset beats load/en, `core/defs/wide.ts`) is the
   * register's own and costs no gate. The alternative the palette DOES offer is
   * `add8(x, 0, 1)`: correct, 72 gates, one delay unit deep, one star -- the
   * target states both metrics, and the test file measures it.
   *
   * WRAP AND PRECEDENCE ARE BOTH ASSERTED IN THE CHECK. 256 consecutive enabled
   * edges walk the count through every byte and back to 0 at exactly 256 (a
   * counter that wrapped at 128, or that saturated at 255, fails one of those 256
   * expectations rather than a hand-picked one); the discarded carry IS the wrap,
   * because nine bits do not fit an eight-bit register; and the step where `reset`
   * and `en` are both high while the count is 2 expects 0 -- a register that let
   * the enable win would read 3. The final two steps sit on the same tick to prove
   * the count does not move without an edge.
   */
  {
    id: 'ch2-38-counter',
    chapter: 2,
    index: 38,
    name: { zh: '计数器', en: 'Counter' },
    brief: {
      zh: '一个自己会数数的寄存器。reset 为高时，时钟沿把它清成 0——reset 比 en 优先，两者同时为高时清零；否则 en 为高时加一，en 为低时保持不动。加到 255 之后再走一拍就回到 0：八位装不下 256，于是绕回来。输出从 0 开始。',
      en: 'A register that counts by itself. While reset is high a clock edge clears it to 0 -- reset beats en, so both high means a clear; otherwise en high adds one and en low holds. One edge past 255 it comes back to 0: eight bits cannot hold 256, so the count wraps. It starts at 0.',
    },
    hint: {
      zh: '「加一」就是把当前值加 1：第 0 位取反；往上每一位是「本位与下面传来的进位异或」，而进位是「本位与下面的进位相与」。把这个结果接回 8 位寄存器的 d，en 接 load、reset 接 reset，寄存器自己就成了计数器——清零与使能的优先级由寄存器本身的引脚决定，不需要额外的门。',
      en: "Adding one means: bit 0 is the inverse of the old bit 0, every higher bit is the old bit XOR the carry coming from below, and that carry is the old bit AND the carry below it. Feed the result back into the register's d, wire en to load and reset to reset, and the register counts by itself -- the register's own pins already give reset priority over the enable, with no extra gate.",
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'add8',
      'delay8',
      'mem1',
      'mux8',
      'reg8',
      'ram8',
      ...LEVEL_IO,
    ],
    io: IO_EN1_RESET1_OUT8,
    checks: [{ kind: 'script', steps: counterSteps() }],
    // Measured: one `not` (1) + seven `xor` (28) + six `and` (12) = 41 NAND
    // equivalents, with the register, the splitter and the maker free, a path
    // seven components deep (the carry chain), and tick 263 as the script's last
    // tick. The source's "≤ 65 gates" is recorded in the comment above as an
    // achievement and is NOT this number.
    threeStar: { gate: 41, delay: 7, tick: 263 },
  },
];
