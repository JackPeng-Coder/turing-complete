import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation), so the
// two must not be confused.
import { truthTable, type LevelIo } from '../../tables';

/**
 * Chapter 2, levels 18-22: the byte-wide operators and the adders -- the batch
 * where eight-bit arithmetic begins, and where the `fuzz` checker (levels 18, 19
 * and 22) first carries a level.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. As in batch 1: the compendium
 * gives each of these levels exactly three things -- its name (English and
 * Chinese), its place in the chapter, and one line of teaching concept. It gives
 * no ports, no widths, no pass conditions, no targets and no rewards.
 * Everything else below is this replica's design, derived from the name and that
 * one line -- so every level carries a data comment split into `SOURCED` and
 * `AUTHORED`, and `test/levels/ch2-batch2.test.ts` fails if either marker is
 * missing. No number in this file may be presented as the source's own.
 *
 * TWO SOURCE NOTES IN THIS BATCH ARE ACHIEVEMENTS, NOT PASS CONDITIONS, and both
 * are honoured as records rather than adopted as targets:
 *
 *  * level 21's is "仅用 5 个蓝色元件" (only 5 blue components). This replica has
 *    no blue-component system -- "blue" parts are the player's own
 *    custom/blueprint components, which arrive in a later phase -- so the
 *    achievement is mapped to a measured `threeStar.gate` threshold, and the
 *    reference is the five-component circuit the achievement describes. The
 *    mapping is stated in that level's comment and measured in the test file.
 *  * level 22's is "延迟 ≤ 35". 35 is recorded in that level's comment as the
 *    source's reference value; `threeStar.delay` is this replica's own
 *    measurement of its reference solution (17), and the comment says so.
 *
 * THE PALETTE RULE, spelled out once because the batches after this one inherit
 * it: a level offers the parts unlocked at or before it whose pins can attach to
 * something on it, plus its own rewards (batch 1's level 13 offers the
 * splitter/maker/const8 it hands out, and level 18 here offers the four byte
 * operators it does), MINUS any part that is not its own reward and would answer
 * the level by itself. Two levels use that subtraction, and both say so in their
 * own comments: level 22 withholds `add8` (level 17's reward, exactly this
 * level's I/O shape, one drop-in) and `full_adder` (level 20's reward, eight of
 * them answer the cascade), and level 21 withholds `full_adder` for the same
 * reason at one bit's scale.
 *
 * THE `full_adder` SEAM, recorded here because no change to level data can fix
 * it: level 20's reward is `full_adder` -- the brief fixes that -- and NO DEF OF
 * THAT ID IS REGISTERED. `src/core/defs/index.ts` lists no `full_adder`, and the
 * only mentions of one in the project are the design spec and this note. A
 * reward is data, so the id is legal and the unlock walk treats it like any
 * other; `paletteDefsFor` intersects a level's palette with the unlocked set and
 * `ui/palette.ts` drops ids `registry.has` refuses, so the part is simply
 * invisible until a task registers the def. That task owns two decisions this
 * file deliberately leaves open rather than guessing: where the part is offered
 * (it is offered nowhere but its own level today, because on levels 21 and 22 a
 * drop-in would be a better answer than the circuit each level teaches), and
 * whether level 22's target is re-measured from an eight-instance cascade (72
 * gates and 8 delay at the documented 9-NAND full-adder cell) once it exists.
 *
 * EVERY LEVEL HERE IS PURELY COMBINATIONAL, so `tick` is 0 on every three-star
 * target, for the same reason batch 1 states it: no check in this batch ever
 * ticks the clock, so the metric is genuinely 0 and its target can never be what
 * denies a player three stars. The metrics that do the work here are `gate` and
 * `delay`, and every target below is the reference solution's own measured score
 * -- `three-star targets are the reference solutions own metrics` in the test
 * file is what holds that to a number rather than a promise.
 */

/**
 * The one-bit shelf every level in this batch draws from: chapter 1's gates, its
 * two constants and the delay line, in the order chapter 1 hands them out.
 * `delay_line` is offered because chapter 1's palettes offered it; no check in
 * this batch ticks the clock, so nothing below can use it.
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

/** The wide operators batch 1's levels 15-17 unlocked. None of them is byte logic. */
const WIDE_OPS = ['less_u', 'equal8', 'add8', 'mul8'] as const;

/** The four byte operators level 18 teaches, offered by level 18 and 19 alike. */
const BYTE_AND_OR = ['and8', 'or8', 'nand8', 'nor8'] as const;

/**
 * The five pin shapes this batch uses, so a level's io is one named constant
 * instead of two lines of literal in the middle of a spec.
 */
const IO_A8_B8_OUT8: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_A8_OUT8: LevelIo = {
  inputs: [{ id: 'a', width: 8 }],
  outputs: [{ id: 'out', width: 8 }],
};
const IO_A1_B1_SUM1_CARRY1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'carry', width: 1 },
  ],
};
const IO_A1_B1_CIN1_SUM1_COUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'cout', width: 1 },
  ],
};
const IO_A8_B8_CIN1_OUT8_COUT1: LevelIo = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'out', width: 8 },
    { id: 'cout', width: 1 },
  ],
};

/**
 * A fuzz seed per level: the level's index in the high byte and the byte width
 * in the low one.
 *
 * Fixed literals, not drawn ones: the same seed produces the same vectors on
 * every run and on every board edit, which is what makes a fuzz level's coverage
 * a fact about the level rather than about the run. Three distinct values, so
 * one level's sequence is never another's.
 */
const SEED_18 = 0x1808;
const SEED_19 = 0x1908;
const SEED_22 = 0x2208;

/**
 * The level-22 expectations, named because both pins are computed from the same
 * sum: the low byte and the ninth bit cannot disagree about whether the addition
 * overflowed, exactly as `add8`'s two pins cannot.
 *
 * Neither value masks away an authoring mistake -- the kernel refuses an
 * expectation that does not fit its pin rather than reducing it. The shift is
 * what makes "the ninth bit" fit a 1-bit pin: the vectors are inside 8- and
 * 1-bit pins, so `a + b + cin` is at most 511 and `>> 8` is exactly bit 8, with
 * nothing above it to discard.
 */
const SUM_LOW_BYTE = (v: FuzzVector): number => ((v.a ?? 0) + (v.b ?? 0) + (v.cin ?? 0)) & 0xff;
const SUM_CARRY_OUT = (v: FuzzVector): number => ((v.a ?? 0) + (v.b ?? 0) + (v.cin ?? 0)) >> 8;

export const CH2_BATCH2: readonly LevelSpec[] = [
  /**
   * ch2-18-byte-or -- Byte OR / 8 位或
   *
   * SOURCED: the name in both languages, its position (18th, and the first level
   * of the chapter to work on a whole byte), and the concept -- the byte-wide OR,
   * the one-bit OR of chapter 1 applied to every bit at once.
   *
   * AUTHORED (this replica's design): the `a:8 b:8 -> out:8` shape; the fuzz
   * check (the brief fixes its kind, its 256 rounds and its fixed-seed rule; the
   * seed, the pin maps and the expectation function are written here); the
   * measured three-star target; and the four rewards. The brief's own table is
   * what makes this the first level in the game to use `fuzz`: 2^16 input pairs
   * cannot be written out as rows, and a byte operator is exactly the kind of
   * circuit a single mis-wired bit costs you half the vectors on.
   *
   * THE REFERENCE IS WIRED, NOT DROPPED IN, AND IT COSTS THE SAME EITHER WAY:
   * eight one-bit ORs behind two splitters and one maker measure 8 x 3 = 24 NAND
   * equivalents at depth 1, and the `or8` this level hands out measures 24 and 1
   * on the very same basis. So the target below is the floor for both
   * constructions, this level's palette can offer the part it teaches without
   * weakening anything, and the test file grades both and asserts they tie --
   * which is stronger than picking one and calling it the reference.
   */
  {
    id: 'ch2-18-byte-or',
    chapter: 2,
    index: 18,
    name: { zh: '8 位或', en: 'Byte OR' },
    brief: {
      zh: '两个八位输入 a 和 b。把它们逐位相或：只要某一位在两个输入里至少有一个是 1，输出的这一位就是 1。',
      en: 'Two eight-bit inputs, a and b. OR them bit by bit: an output bit is 1 when at least one of the two inputs has a 1 in that position.',
    },
    hint: {
      zh: '位拆分器把 a、b 各拆成 b0..b7，同一个位号的两条线接进一个一位或门，八个结果再由位合并器拼回一个字节。',
      en: 'Split a and b into b0..b7 each. Feed the two wires of one bit position into one one-bit OR, then pack the eight results back into a byte with a Maker.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_AND_OR,
      ...LEVEL_IO,
    ],
    io: IO_A8_B8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_18,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0, b: (sample) => sample.b ?? 0 },
        // `a | b` cannot leave 0..255, so this expectation needs no mask: it is
        // the one operator here whose result is always inside the pin already.
        outputs: { out: (v) => (v.a ?? 0) | (v.b ?? 0) },
      },
    ],
    // Measured: the splitter and the maker are free on both metrics, so the
    // target is the eight ORs -- 8 x 3 = 24 NAND equivalents -- on a path one
    // gate deep. `or8` measures exactly the same pair (see the comment above).
    threeStar: { gate: 24, delay: 1, tick: 0 },
    rewards: { components: ['and8', 'or8', 'nand8', 'nor8'] },
  },

  /**
   * ch2-19-byte-not -- Byte NOT / 8 位非
   *
   * SOURCED: the name in both languages, its position (19th), and the concept --
   * inverting every bit of a byte.
   *
   * AUTHORED: the `a:8 -> out:8` shape; the fuzz check (seed, 256 rounds, and the
   * MASKED expectation -- load-bearing here rather than decorative, because `~a`
   * is a negative int32 and the kernel refuses an expectation that does not fit
   * its pin instead of masking it, so the author's own `& 0xff` is what makes
   * this check runnable at all); the measured three-star target; and the three
   * rewards.
   *
   * THE TARGET SEPARATES SOME CORRECT ANSWERS AND NOT OTHERS, and this comment
   * says which. Eight NOTs measure 8 NAND equivalents at depth 1, and so
   * does the `not8` this level hands out, and so does `nand8(a, a)` -- level
   * 18's reward, and the answer a player who has just met the wide family is
   * most likely to reach for, because a NAND cell is one NAND per bit on the
   * same documented basis. The three spellings are the same circuit on this
   * metric, so the target ties all three at three stars; what it does NOT admit
   * is the same function built from a four-NAND cell -- `nor8(a, a)` is
   * `~(a | a)`, a correct byte NOT for 32 gates, and one star. Both halves are
   * asserted in the test file, because a target that every correct answer met
   * would not be measuring the lesson.
   */
  {
    id: 'ch2-19-byte-not',
    chapter: 2,
    index: 19,
    name: { zh: '8 位非', en: 'Byte NOT' },
    brief: {
      zh: '一个八位输入 a。把它的每一位取反：0 变 1，1 变 0，八位一起翻过来。',
      en: 'One eight-bit input a. Invert every bit: 0 becomes 1 and 1 becomes 0, all eight at once.',
    },
    hint: {
      zh: '位拆分器拆开后，每一位各接一个非门，再合并回一个字节。也可以让每一位与 1 异或——两条路都要记得第 7 位。',
      en: 'Split it, invert each bit with its own NOT, then pack the eight results back. XORing each bit with 1 does the same job; either way, do not lose bit 7.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_AND_OR,
      'xor8',
      'xnor8',
      'not8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_19,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        // `~a` alone is -1 for a = 0, which does not fit an 8-bit pin, so the
        // mask is the expectation's definition rather than a convenience.
        outputs: { out: (v) => ~(v.a ?? 0) & 0xff },
      },
    ],
    // Measured: one NOT per bit -- 8 x 1 = 8 NAND equivalents -- behind a free
    // splitter and maker, one gate deep. `not8` ties it, and so does
    // `nand8(a, a)` (a NAND cell is one NAND per bit on the documented basis, so
    // the three spellings are the same circuit on this metric); the paragraph
    // above and the test file say what the target does and does not separate.
    threeStar: { gate: 8, delay: 1, tick: 0 },
    rewards: { components: ['xor8', 'xnor8', 'not8'] },
  },

  /**
   * ch2-20-half-adder -- Half Adder / 半加器
   *
   * SOURCED: the name in both languages, its position (20th), and the concept --
   * sum and carry, the two signals that adding two one-bit values produces.
   *
   * AUTHORED: the `a:1 b:1 -> sum:1 carry:1` shape (two output pins, so the
   * outputs bind as `OUT_sum` / `OUT_carry`); the four rows, built by
   * `truthTable`, which refuses a table that leaves a declared output pin
   * uncompared; the measured three-star target; and the `full_adder` reward. The
   * checker KIND is the brief's; the rows are this file's.
   *
   * THE ID SAYS `half-adder` AND THE REWARD DOES NOT, which is the brief's
   * decision and spec 3.3's chapter-2 list: there is no `half_adder` component,
   * and what this level hands out is the part its own lesson is one carry short
   * of.
   *
   * `full_adder` IS ALSO THE ONE REWARD IN THIS BATCH WHOSE DEF IS NOT
   * REGISTERED -- see the module note for the seam and for what the task that
   * registers it has to decide. Offering it here cannot loosen the target even
   * then: a full adder with `cin` tied low is 9 NAND equivalents against this
   * level's 6, so it is the same kind of one-star alternative batch 1 recorded
   * for `add8(a, a)` on level 17.
   */
  {
    id: 'ch2-20-half-adder',
    chapter: 2,
    index: 20,
    name: { zh: '半加器', en: 'Half Adder' },
    brief: {
      zh: '两个一位输入 a 和 b。把它们相加：和放在 sum 上，进位放在 carry 上——两个 1 相加得 0，并向高位进 1。',
      en: 'Two one-bit inputs, a and b. Add them: the sum goes on sum and the carry on carry -- one plus one is zero and carries one.',
    },
    hint: {
      zh: '和就是异或：两个输入不同时才为 1。进位是与：两个都为 1 才为 1。两条线各算各的，别让进位混进和里。',
      en: 'The sum is XOR -- 1 only when the two inputs differ. The carry is AND -- 1 only when both are. Compute them separately, and keep the carry out of the sum.',
    },
    allowedComponents: [...GATES_1BIT, 'full_adder', ...LEVEL_IO],
    io: IO_A1_B1_SUM1_CARRY1,
    checks: [
      truthTable(IO_A1_B1_SUM1_CARRY1, {
        sum: ({ a, b }) => (a ?? 0) ^ (b ?? 0),
        carry: ({ a, b }) => (a ?? 0) & (b ?? 0),
      }),
    ],
    // Measured: one XOR (4) and one AND (2) in parallel from the two level pins
    // -- 6 NAND equivalents, one gate deep. Both are standard cells on the
    // documented basis, so 6 is the floor for any all-NAND half adder.
    threeStar: { gate: 6, delay: 1, tick: 0 },
    rewards: { components: ['full_adder'] },
  },

  /**
   * ch2-21-full-adder -- Full Adder / 全加器
   *
   * SOURCED: the name in both languages, its position (21st), the concept (a
   * one-bit adder that takes the carry in), and -- the only numeric note the
   * source gives anywhere in this batch -- its ACHIEVEMENT: "仅用 5 个蓝色元件",
   * only 5 blue components.
   *
   * AUTHORED: the `a:1 b:1 cin:1 -> sum:1 cout:1` shape; the eight rows; the
   * measured three-star target; the `neg8` reward; and the palette.
   *
   * HOW THAT ACHIEVEMENT IS MAPPED, stated here because the source's note is not
   * a pass condition and this replica has no blue-component system: "blue
   * components" in the source are the player's own custom/blueprint parts, which
   * arrive in a later phase here. The note is therefore re-expressed as the
   * measured `threeStar.gate` threshold of the five-component circuit it
   * describes -- two XORs, two ANDs and an OR, which is the classic full adder:
   * 4 + 2 + 4 + 2 + 3 = 15 NAND equivalents on a path three gates deep. The
   * reference in the test file IS that circuit and is asserted to be exactly
   * those five components, so the mapping is a measurement rather than a claim,
   * and the gate target is what denies three stars to a player who spends a
   * sixth gate. Nothing in this file treats the source's number 5 as this
   * level's gate target: 5 is a component count, 15 is a NAND-equivalent count,
   * and the two are not the same quantity.
   *
   * WHY `full_adder` IS NOT OFFERED HERE EITHER (it is level 20's reward, and the
   * brief says the player uses it on the next level): one drop-in full adder
   * answers this level in a single row, which is precisely what this level's own
   * achievement asks the player NOT to do, and at the documented 9-NAND cell it
   * would be a strictly better answer than the 15 the target measures -- so the
   * target would be loose rather than tight. The part is therefore offered
   * nowhere but its own level in this batch, and the module note records the
   * decision the task that registers the def owns. `neg8` is left out for batch
   * 1's level-14 reason: every pin here is one bit wide, so an eight-bit part has
   * nothing to attach to.
   */
  {
    id: 'ch2-21-full-adder',
    chapter: 2,
    index: 21,
    name: { zh: '全加器', en: 'Full Adder' },
    brief: {
      zh: '三个一位输入 a、b、cin。先把 a 和 b 相加，再把 cin 加进来：和放 sum，向高位的进位放 cout。',
      en: 'Three one-bit inputs: a, b and cin. Add a to b, then add cin to that. The sum goes on sum and the carry out on cout.',
    },
    hint: {
      zh: '两个半加器接起来：a 与 b 半加得到中间和，中间和再与 cin 半加就是 sum；两个半加器的进位相或就是 cout。五个元件就够。',
      en: 'Two half adders in a row: half-add a with b, then half-add that result with cin to get sum; OR the two carries together for cout. Five components are enough.',
    },
    allowedComponents: [...GATES_1BIT, ...LEVEL_IO],
    io: IO_A1_B1_CIN1_SUM1_COUT1,
    checks: [
      truthTable(IO_A1_B1_CIN1_SUM1_COUT1, {
        sum: ({ a, b, cin }) => (a ?? 0) ^ (b ?? 0) ^ (cin ?? 0),
        // The same construction the reference builds, written as the function it
        // computes: the carry is "both inputs, or the carry-in gated by the two
        // inputs differing".
        cout: ({ a, b, cin }) =>
          ((a ?? 0) & (b ?? 0)) | ((cin ?? 0) & ((a ?? 0) ^ (b ?? 0))),
      }),
    ],
    // Measured: the five-component reference -- xor, and, xor, and, or -- is 15
    // NAND equivalents, and its longest path is the carry: XOR, AND, OR = depth
    // 3. The gate number is the mapping of the source's five-component
    // achievement described above.
    threeStar: { gate: 15, delay: 3, tick: 0 },
    rewards: { components: ['neg8'] },
  },

  /**
   * ch2-22-adding-bytes -- Adding Bytes / 8 位加法器
   *
   * SOURCED: the name in both languages, its position (22nd), the concept
   * (cascading one-bit adders into a byte adder), and its ACHIEVEMENT note --
   * "延迟 ≤ 35", the source's own reference value: a delay of 35 or less.
   *
   * AUTHORED: the `a:8 b:8 cin:1 -> out:8 cout:1` shape; the fuzz check (seed,
   * 256 rounds, and both expectation functions, computed from one sum so the two
   * pins cannot disagree about the overflow); the measured three-star target; the
   * two rewards; and the palette.
   *
   * THE TARGET'S DELAY IS MEASURED, NOT COPIED, AND THE SOURCE'S 35 IS NOT IT.
   * The source's note is an achievement, so nothing here treats 35 as a pass
   * condition or as a target: `threeStar` is this replica's own measurement of
   * its reference solution -- eight hand-built full adders in a ripple chain.
   * Its carry path costs three gates to reach the first carry (a XOR b, the AND
   * with `cin`, the OR that combines the two carry terms) and two per bit after
   * that (the AND with the incoming carry, then the OR), so the delay is
   * 3 + 2 x 7 = 17; the sum path is a gate shorter at the top bit. 35 is recorded
   * here as the source's reference value and for nothing else. The measured 17 is
   * below it, which is agreement in spirit rather than on a shared scale: the
   * source's "delay" is its own simulation metric on its own circuit, while this
   * replica charges one unit per component on the longest combinational path. If
   * the measurement had come out above 35, this paragraph would say so and
   * `threeStar.delay` would still carry the measurement -- a target is not
   * allowed to be bent towards a number taken from another metric.
   *
   * WHY THE PALETTE WITHHOLDS TWO PARTS, which is a design decision rather than
   * an oversight:
   *
   *  * `add8`, unlocked by level 17, has EXACTLY this level's I/O shape, and one
   *    instance measures 72 gates and 1 delay. It would answer the level in a
   *    single drop, make the cascade the level teaches pointless, and make the
   *    source's own achievement value vacuous (any one-component circuit is
   *    inside a delay of 35).
   *  * `full_adder`, level 20's reward, is withheld for the same reason one
   *    order of magnitude down: eight of them at the documented 9-NAND cell
   *    would measure 72 gates and 8 delay, which beats this level's target.
   *
   * Both are parts a later task may choose to offer; if it does, THIS LEVEL'S
   * TARGET MUST BE RE-MEASURED from that cascade in the same change, because
   * `threeStar` is the reference's own metrics and the reference would then be
   * the cascade. Everything else on the player's wide shelf is offered even
   * though no combination of it adds two bytes (mul8, less_u, equal8, neg8, and
   * the two switches this level itself hands out) -- exactly as batch 1 offers
   * less_u and equal8 on levels that cannot use them.
   */
  {
    id: 'ch2-22-adding-bytes',
    chapter: 2,
    index: 22,
    name: { zh: '8 位加法器', en: 'Adding Bytes' },
    brief: {
      zh: '两个八位输入 a、b 和一个一位输入 cin。把三者全部相加：结果的低八位放在 out 上，第九位（也就是进位）放在 cout 上。',
      en: 'Two eight-bit inputs a and b, plus a one-bit cin. Add all three: the low eight bits of the result go on out, and the ninth bit -- the carry -- goes on cout.',
    },
    hint: {
      zh: '把前面两个加法器排成一行：第 0 位吃 cin，每一位算出的进位接给下一位的 cin，最高位剩下的进位就是 cout。',
      en: 'Line the adders up in a row: bit 0 takes cin, each bit hands its carry to the next bit, and the carry left over at the top is cout.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      'less_u',
      'equal8',
      'mul8',
      'neg8',
      'switch',
      'switch8',
      ...LEVEL_IO,
    ],
    io: IO_A8_B8_CIN1_OUT8_COUT1,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_22,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
          cin: (sample) => sample.cin ?? 0,
        },
        outputs: { out: SUM_LOW_BYTE, cout: SUM_CARRY_OUT },
      },
    ],
    // Measured: eight full adders of five gates each -- 8 x (4 + 2 + 4 + 2 + 3)
    // = 120 NAND equivalents -- with the splitters, the maker and the level pins
    // free, and a ripple carry path of 3 + 2 x 7 = 17. The source's achievement
    // value (35) is recorded in the comment above; the target is the
    // measurement.
    threeStar: { gate: 120, delay: 17, tick: 0 },
    rewards: { components: ['switch', 'switch8'] },
  },
];
