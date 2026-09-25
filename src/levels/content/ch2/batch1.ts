import { generateRows } from '../../checks';
import type { LevelSpec, TruthRow } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation), so the
// two must not be confused.
import { truthTable, type LevelIo } from '../../tables';

/**
 * Chapter 2, levels 13-17: scalar logic and counting -- the first batch of the
 * chapter, and the first level data in the game with multi-bit pins.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. The compendium gives each of
 * these levels exactly three things: its name (English and Chinese), its place
 * in the chapter, and one line of teaching concept. It gives no ports, no
 * widths, no pass conditions, no targets and no rewards. Everything else below
 * is this replica's design, derived from the name and that one line -- so each
 * level carries a data comment split into `SOURCED` and `AUTHORED`, and
 * `test/levels/ch2-batch1.test.ts` fails if either marker is missing. No number
 * in this file may be presented as the source's own.
 *
 * Level 13's four-bit input is the clearest case of an authored choice: the
 * source says nothing about width (see that level's comment).
 *
 * `AUTHORED` also covers the parts the task brief fixes (each level's checker
 * kind, and its rewards): those are this replica's design too, not the source's,
 * even where this file did not pick them.
 *
 * EVERY LEVEL HERE IS PURELY COMBINATIONAL, so `tick` is 0 on every three-star
 * target, for the same reason chapter 1's combinational levels state it: no
 * check in this batch ever ticks the clock, so the metric is genuinely 0 and its
 * target can never be what denies a player three stars. The metrics that do the
 * work here are `gate` and `delay`, and every target below is the reference
 * solution's own measured score -- `three-star targets are the reference
 * solutions own metrics` in the test file is what holds that to a number rather
 * than a promise.
 */

/**
 * The five pin shapes this batch uses, so a level's io is one named constant
 * instead of six lines of literal in the middle of a spec.
 */
const IO_A4_OUT1: LevelIo = { inputs: [{ id: 'a', width: 4 }], outputs: [{ id: 'out', width: 1 }] };
const IO_ABCD_OUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
    { id: 'd', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_A4_OUT3: LevelIo = { inputs: [{ id: 'a', width: 4 }], outputs: [{ id: 'out', width: 3 }] };
const IO_ABCD_OUT3: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'c', width: 1 },
    { id: 'd', width: 1 },
  ],
  outputs: [{ id: 'out', width: 3 }],
};
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };

/**
 * Rows for a level that publishes one value, enumerated by the kernel's own
 * generator.
 *
 * `generateRows(spec, expected)` walks every input combination of `spec.io` and
 * slices one whole number into `spec.io.outputs`, low pin first;
 * `truthTable(io, perPin)` is the same walk with one function per pin. A level's
 * checks are written before its spec object exists, so this hands
 * `generateRows` the one field it reads -- with the rest of the shape present
 * but empty, which is why `checks` is `[]` here and never on a level.
 *
 * Rows are built, never omitted: an omitted or empty `rows` array is a hard
 * `missing-rows` failure, not "enumerate every combination for me".
 */
function valueRows(io: LevelIo, expected: (inputs: Record<string, number>) => number): TruthRow[] {
  return generateRows(
    {
      id: '',
      chapter: 2,
      index: 0,
      name: { zh: '', en: '' },
      brief: { zh: '', en: '' },
      hint: { zh: '', en: '' },
      allowedComponents: [],
      io,
      checks: [],
    },
    expected,
  );
}

/** High bits among the low `bits` bits of `value`: the count levels 15 and 16 publish. */
function onesIn(value: number, bits: number): number {
  let count = 0;
  for (let bit = 0; bit < bits; bit += 1) if ((value >>> bit) & 1) count += 1;
  return count;
}

export const CH2_BATCH1: readonly LevelSpec[] = [
  /**
   * ch2-13-odd-number-of-signals -- ODD Number of Signals / 奇数个信号
   *
   * SOURCED: the name in both languages, its position (the 13th level, and the
   * first of chapter 2), and the source's one-line concept -- a set of signals
   * whose count is odd reads high. That is the whole of it: no ports, no widths,
   * no pass condition, no reward.
   *
   * AUTHORED (this replica's design): the input is FOUR bits wide, which is this
   * replica's choice and not the source's. 16 rows exhaust a nibble, and a wide
   * value is the natural place to meet `splitter`/`maker`. Also authored: the
   * `a:4 -> out:1` shape, the exhaustive 16-row truth table (`truthTable`, which
   * refuses to build one that leaves a declared output pin uncompared), the
   * measured three-star target, and the three rewards.
   *
   * KNOWN SEAM, recorded here because no change to level data can fix it:
   * `splitter`, `maker` and `const8` are this level's own rewards, and
   * `paletteDefsFor` (`src/app/progress.ts`) offers the rewards of PASSED levels
   * only -- so a first-time player's palette for level 13 lacks the splitter,
   * which is the only part that can expose bits 1-3 of `a` (every chapter-1 part
   * has 1-bit pins, and a wire from a 4-bit output to a 1-bit input copies bit 0
   * and nothing else). Either the level being played must also offer its own
   * rewards, or these three rewards must move to an earlier level; see
   * task-8-report.md.
   */
  {
    id: 'ch2-13-odd-number-of-signals',
    chapter: 2,
    index: 13,
    name: { zh: '奇数个信号', en: 'ODD Number of Signals' },
    brief: {
      zh: '四位输入 a 上挂着四个信号位。为高的位有奇数个时输出为高，偶数个（一个都没有也算偶数）时为低。',
      en: 'Input a carries four signal bits. Output high when an odd number of them are high, and low when the count is even -- none at all counts as even.',
    },
    hint: {
      zh: '位拆分器把 a 拆成 b0..b3；先两两异或，再把两个结果异或起来，剩下的就是奇偶性。',
      en: 'A Splitter breaks a into b0..b3. XOR them in pairs, then XOR the two results together: what is left is the parity.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'level_input',
      'level_output',
    ],
    io: IO_A4_OUT1,
    checks: [truthTable(IO_A4_OUT1, { out: ({ a }) => onesIn(a ?? 0, 4) % 2 })],
    // Measured, not guessed: the reference is a splitter plus three XORs -- 3 x
    // the four-NAND XOR cell = 12 NAND equivalents -- and the longest path is
    // two gates, because both pair-XORs sit at depth 1 and the combining XOR at
    // depth 2 while the splitter is free on both metrics.
    threeStar: { gate: 12, delay: 2, tick: 0 },
    rewards: { components: ['splitter', 'maker', 'const8'] },
  },

  /**
   * ch2-14-double-trouble -- Double Trouble / 成对的麻烦
   *
   * SOURCED: the name in both languages, its position (14th), and the concept --
   * "pairs": what the output answers is whether at least two of the signals are
   * high at the same time.
   *
   * AUTHORED (this replica's design): which pins the rule ranges over (`a`, `b`,
   * `c`, `d`), which pin it writes (`out`), the four 1-bit pins and the 1-bit
   * output themselves, the measured three-star target, and the palette. The
   * brief fixes the checker kind (`constraint`) and the rule (`at-least` 2); the
   * other rule, `sum-equals`, reduces its sum modulo the output pin's width, so
   * on this level's 1-bit `out` it would state parity -- level 13's function --
   * rather than "at least two". The palette is 1-bit parts only: every pin here
   * is one bit wide, so the wide parts levels 9-13 unlocked have nothing to
   * attach to.
   *
   * This level hands out no component at all, which is the brief's decision.
   */
  {
    id: 'ch2-14-double-trouble',
    chapter: 2,
    index: 14,
    name: { zh: '成对的麻烦', en: 'Double Trouble' },
    brief: {
      zh: '四个一位信号 a b c d。其中同时为高的至少有 2 个时输出为高，只有 0 个或 1 个时为低。',
      en: 'Four one-bit signals a, b, c, d. Output high when at least two of them are high at once, low when none or only one is.',
    },
    hint: {
      zh: '「至少两个为高」等于三组两两组合的或：a&b、c&d，还有 (a|b)&(c|d)——最后一组管的是跨过分组的那些组合。',
      en: '"At least two high" is the OR of three pair-terms: a&b, c&d, and (a|b)&(c|d) -- the last one covers every pair that crosses the two groups.',
    },
    allowedComponents: [
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
      'level_input',
      'level_output',
    ],
    io: IO_ABCD_OUT1,
    checks: [
      { kind: 'constraint', rule: { kind: 'at-least', inputs: ['a', 'b', 'c', 'd'], count: 2, output: 'out' } },
    ],
    // Measured: the reference is (a&b)|(c&d)|((a|b)&(c|d)) -- two ANDs, two ORs,
    // one more AND and a 3-input OR = 2+2+3+3+2+6 = 18 NAND equivalents -- with
    // the OR-AND-OR3 path setting the depth at 3.
    threeStar: { gate: 18, delay: 3, tick: 0 },
  },

  /**
   * ch2-15-binary-racer -- Binary Racer / 二进制速算
   *
   * SOURCED: the name in both languages, its position (15th), and the fact that
   * the source's level of this name is a TIMED binary-reading minigame -- a
   * shape a circuit game cannot host and one this replica does not try to.
   *
   * AUTHORED (this replica's design): the rebuild. The timer and the typing are
   * dropped; the concept (read a four-bit value at a glance) is kept and becomes
   * a circuit -- `a:4 -> out:3`, publishing the NUMBER OF HIGH BITS in `a`, which
   * is 0 to 4 and therefore fits three bits. That reading is the brief's ("4 bits
   * -> a 3-bit count"); the generated 16 rows, the measured three-star target and
   * the `less_u` reward are authored here.
   *
   * NOTE, because a reviewer will see it: this makes the level's function
   * identical to level 16's, which counts four separate 1-bit signals. The two
   * differ in I/O shape (a wide value that has to be split first, against four
   * pins that arrive apart) and in the lesson each is framed around, and the
   * coincidence follows from the brief's own table rather than from this file.
   * If the intent was a saturating 4-into-3-bit quantizer instead, the expectation
   * function and the reference are the only things that change.
   */
  {
    id: 'ch2-15-binary-racer',
    chapter: 2,
    index: 15,
    name: { zh: '二进制速算', en: 'Binary Racer' },
    brief: {
      zh: '四位输入 a 是一个二进制数。数出它里面有几个 1，把个数放到三位输出上：0 到 4 都装得下。',
      en: 'Input a is a four-bit binary number. Count how many of its bits are 1 and publish that count on the three-bit output: 0 through 4 all fit.',
    },
    hint: {
      zh: '先用位拆分器取到 b0..b3。两个两个半加（和是异或、进位是与），再把两个部分和半加一次；两个进位本身的和就是第 2 位。',
      en: 'Split a into b0..b3 first. Half-add them in pairs (sum is XOR, carry is AND), then half-add the two partial sums; the two carries added together are the top bit.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'less_u',
      'level_input',
      'level_output',
    ],
    io: IO_A4_OUT3,
    checks: [{ kind: 'truth-table', rows: valueRows(IO_A4_OUT3, ({ a }) => onesIn(a ?? 0, 4)) }],
    // Measured: two half adders, then the stage that adds the two partial sums
    // -- five XORs (20) and four ANDs (8) = 28 NAND equivalents -- with the
    // splitter and the maker free on both metrics and a depth of 3.
    threeStar: { gate: 28, delay: 3, tick: 0 },
    rewards: { components: ['less_u'] },
  },

  /**
   * ch2-16-counting-signals -- Counting Signals / 信号计数
   *
   * SOURCED: the name in both languages, its position (16th), and the concept --
   * adding four one-bit signals, the half-adder idea.
   *
   * AUTHORED (this replica's design): the four 1-bit pins and the 3-bit output;
   * the generated 16 rows of the same count level 15 publishes (see that level's
   * note -- the two functions coincide by the brief's own table); the measured
   * three-star target; and the `equal8` reward.
   */
  {
    id: 'ch2-16-counting-signals',
    chapter: 2,
    index: 16,
    name: { zh: '信号计数', en: 'Counting Signals' },
    brief: {
      zh: '四个彼此独立的一位信号。数出其中为高的个数，用三位二进制输出。',
      en: 'Four separate one-bit signals. Count how many are high and publish that count in three-bit binary.',
    },
    hint: {
      zh: '先半加 a 和 b、再半加 c 和 d。第 0 位是两个「和」的异或；第 1 位要把两个进位与「两个和的与」加在一起；第 2 位只在两个进位同时为高时才为高。',
      en: 'Half-add a with b, and c with d. Bit 0 is the XOR of the two sums; bit 1 adds the two carries together with the AND of the two sums; bit 2 is high only when both carries are.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'less_u',
      'equal8',
      'level_input',
      'level_output',
    ],
    io: IO_ABCD_OUT3,
    checks: [
      {
        kind: 'truth-table',
        rows: valueRows(IO_ABCD_OUT3, ({ a, b, c, d }) => (a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0)),
      },
    ],
    // Measured: level 15's tree without the splitter -- five XORs (20) and four
    // ANDs (8) = 28 NAND equivalents at depth 3, the maker free.
    threeStar: { gate: 28, delay: 3, tick: 0 },
    rewards: { components: ['equal8'] },
  },

  /**
   * ch2-17-double-the-number -- Double the Number / 加倍
   *
   * SOURCED: the name in both languages, its position (17th), and the concept --
   * a left shift by one bit is a doubling.
   *
   * AUTHORED (this replica's design): the `a:8 -> out:8` shape; the 256 generated
   * rows (2^8 -- the first level in the game whose table cannot be written out by
   * hand); the measured three-star target; and the `add8`/`mul8` rewards.
   *
   * The reference the target is measured from is WIRING, not arithmetic: a
   * `splitter` and a `maker` re-index the byte one slot up, so the level is 0
   * gates and 0 delay, and what its target says is the lesson -- shifting is
   * free, adding is not (`add8(a, a)` doubles too, for 72 gates and 1 delay, and
   * scores one star). A shift component would be the obvious tool and is
   * deliberately not unlocked until a later chapter-2 level.
   */
  {
    id: 'ch2-17-double-the-number',
    chapter: 2,
    index: 17,
    name: { zh: '加倍', en: 'Double the Number' },
    brief: {
      zh: '八位输入 a。输出它的两倍：整个字节左移一位，最低位补 0，最高位丢掉——溢出就溢出。',
      en: 'Eight-bit input a. Output twice its value: shift the whole byte one place left, fill the low bit with 0, drop the top bit. Overflow is overflow.',
    },
    hint: {
      zh: '左移是接线，不是算术：位拆分器拆开 a，位合并器把 b0..b6 接到第 1..7 位，第 0 位接低电平。',
      en: 'A left shift is wiring, not arithmetic: split a, feed b0..b6 into maker positions 1..7, and hold position 0 low.',
    },
    allowedComponents: [
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
      'splitter',
      'maker',
      'const8',
      'less_u',
      'equal8',
      'add8',
      'mul8',
      'level_input',
      'level_output',
    ],
    io: IO_A8_OUT8,
    checks: [{ kind: 'truth-table', rows: valueRows(IO_A8_OUT8, ({ a }) => ((a ?? 0) * 2) & 0xff) }],
    // Measured: the wiring reference is 0 NAND equivalents and 0 delay -- a
    // splitter, a maker and a constant are all free on both metrics -- so this
    // target is the floor itself, and `add8(a, a)` (72 gates, 1 delay) is the
    // one-star alternative the level's rewards make possible.
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['add8', 'mul8'] },
  },
];
