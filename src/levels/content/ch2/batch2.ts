import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation), so the
// two must not be confused.
import { truthTable, type LevelIo } from '../../tables';

/**
 * Chapter 2, levels 19, 22, 25, 26 and 27: the byte-wide operators and the adders
 * -- the batch where eight-bit arithmetic begins, and where the `fuzz` checker
 * (levels 25, 26 and 27) carries a level.
 *
 * THE BATCH WAS RENUMBERED AND GAINED A LEVEL. The 2.x realignment moved these
 * levels to their global indices (19, 22, 25, 26 and 27), retired the 8-bit OR
 * level that used to open the batch, and added `ch2-25-byte-nand` at the head of
 * it. That new level is not a new puzzle so much as an old reward's new home: the
 * four byte operators `and8` / `or8` / `nand8` / `nor8` were the retired level's
 * hand-out, and a part no level rewards can never reach a palette, so the family
 * moved to the byte NAND level and is offered by every level below that needs it.
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
 *  * level 22's is "仅用 5 个蓝色元件" (only 5 blue components). This replica has
 *    no blue-component system -- "blue" parts are the player's own
 *    custom/blueprint components, which arrive in a later phase -- so the
 *    achievement is mapped to a measured `threeStar.gate` threshold, and the
 *    reference is the five-component circuit the achievement describes. The
 *    mapping is stated in that level's comment and measured in the test file.
 *  * level 27's is "延迟 ≤ 35". 35 is recorded in that level's comment as the
 *    source's reference value; `threeStar` is this replica's own measurement of
 *    its reference solution -- the eight-`full_adder` cascade, 72 gates and 8
 *    delay -- and the comment says so.
 *
 * THE PALETTE RULE, spelled out once because the batches after this one inherit
 * it. Three things build a level's palette, and nothing else:
 *
 *  * THE SHELF IT INHERITS -- the named lists below, which are what earlier
 *    levels handed down: `GATES_1BIT`, `BYTE_WIRING`, `WIDE_OPS`, and the byte
 *    operators levels 25 and 26 unlock. A shelf is curated rather than
 *    "everything the player holds": `mem1`, chapter 1's stateful bit part, is
 *    unlocked from level 12 and no level in this batch lists it, because no check
 *    here ever ticks a clock -- while `delay_line` is on the shelf anyway, because
 *    chapter 1's palettes offered it.
 *  * PLUS THE LEVEL'S OWN REWARDS, offered before it is passed. Level 16's
 *    splitter is the case that named the rule, level 25 offers the four byte
 *    operators it hands out, and level 19 offers the `full_adder` it rewards.
 *  * MINUS any part that is not its own reward and would answer the level by
 *    itself. Two levels here use that subtraction and both say so in their own
 *    comments: level 27 withholds `add8` (level 21's reward, exactly this level's
 *    I/O shape, one drop-in), and level 22 withholds `full_adder` (one drop-in is
 *    that level's exact I/O). Level 27 OFFERS `full_adder`, because there one
 *    instance is not an answer -- eight of them and the carry chain between them
 *    are the cascade the level teaches -- which is the same standard the
 *    subtraction is written against.
 *
 * `full_adder`: HISTORY, AND THE LIVE FACTS. This note used to say that NO DEF OF
 * THAT ID WAS REGISTERED, which was true when this batch was authored and false
 * from `523a7b9` onwards -- the commit that registered the def. It did not exist
 * then: a reward is data, so level 19 could hand out an id nothing implemented,
 * and the part was invisible rather than illegal (`paletteDefsFor` intersects a
 * palette with the unlocked set, and `ui/palette.ts` drops ids `registry.has`
 * refuses). `523a7b9`, "feat(defs): register the full_adder that level 20
 * rewards", added it to `src/core/defs/index.ts` as a `logic1` gate with pins
 * `a:1 b:1 cin:1 -> sum:1 cout:1`, priced `gateCost: FULL_ADDER` -- 9 NAND
 * equivalents, the exported `wide.ts` constant that also prices `add8` as eight
 * of it -- and `DEF_IDS` carries it. Where it is offered is settled too, and the
 * two levels are the two halves of the rule above: level 19, its own reward, where
 * tying `cin` low makes it a 9-gate one-star alternative to that level's 6; and
 * level 27, the cascade that consumes it, where eight instances measure 72 gates
 * and 8 delay and are the circuit that level's `threeStar` is now measured from
 * (it used to be the hand-wired chain's 120/17, which is the documented
 * alternative there and scores one star). Level 22 is the one level that withholds
 * it, and its comment states the reason: there one instance is the level's exact
 * I/O and would score the 15-gate target that the source's five-component
 * achievement maps to.
 *
 * WHAT THE TASK THAT REGISTERED THE DEF OWED, and where each answer landed: the
 * two decisions this note used to leave open are both taken, and the second one
 * was taken twice. The part is offered at levels 19 and 27. Level 22's target WAS
 * re-measured from the cascade in the end: `threeStar` is the reference solution's
 * own measurement, the cascade is the reference now, and the hand-wired chain that
 * used to hold that title is kept as the documented alternative -- correct at
 * 120/17, and one star, because the target is the cascade's 72/8. The reason is
 * the one this note recorded and did not act on at the time: a shipped target that
 * a cheaper legal solution beats is not the target its own comment claims. A
 * later chapter that wants `full_adder` in its palettes makes a new decision;
 * nothing in this batch is waiting on one.
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

/** What batch 1's level 16 unlocked: the two byte packers and the byte constant. */
const BYTE_WIRING = ['splitter', 'maker', 'const8'] as const;

/** The wide operators batch 1's levels 15-17 unlocked. None of them is byte logic. */
const WIDE_OPS = ['less_u', 'equal8', 'add8', 'mul8'] as const;

/**
 * The four byte operators the batch teaches at its head, offered by levels 25, 26
 * and 27 alike.
 *
 * They were `ch2-18-byte-or`'s reward until the 2.x realignment retired that
 * level. A reward is data, so the family could simply have been deleted with it --
 * and that is exactly what must not happen: `and8`, `or8`, `nand8` and `nor8` are
 * registered, priced, and named by the design spec's chapter-2 unlock row, and a
 * part no level hands out can never appear in a palette. `ch2-25-byte-nand` is
 * where they are handed out now.
 */
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
 * a fact about the level rather than about the run. Distinct values, so one
 * level's sequence is never another's.
 *
 * `SEED_25` is the new level's, and it is the convention read literally: level 25,
 * eight-bit pins. The other two kept the values they were authored with when the
 * realignment renumbered their levels (`ch2-26-byte-not` still draws 0x1908 and
 * `ch2-27-adding-bytes` 0x2208), which is deliberate rather than an oversight: a
 * seed is a sequence, not a label, so re-deriving one from a new index would
 * silently change which vectors the level covers. The retired 8-bit OR level's
 * `SEED_18` is gone with the level -- an unused literal is a build error here
 * (`noUnusedLocals`), which is the compiler doing this cleanup's job for it.
 */
const SEED_19 = 0x1908;
const SEED_22 = 0x2208;
const SEED_25 = 0x2508;

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
   * ch2-19-half-adder -- Half Adder / 半加器
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
   * `full_adder`'S DEF WAS MISSING WHEN THIS LEVEL WAS AUTHORED AND IS NOT NOW.
   * The id was reward data with nothing behind it at the time, so no palette could
   * show it; `523a7b9` registered the def in `src/core/defs/index.ts` at 9 NAND
   * equivalents, on the `FULL_ADDER` basis `wide.ts` also prices `add8` with. Who
   * offers it is decided as well -- this level, its own reward, and level 22, the
   * cascade it exists for; the module note carries the history and points at the
   * measurement. Offering it HERE cannot loosen the target: a full adder with
   * `cin` tied low is 9 NAND equivalents against this level's 6, so it is the same
   * kind of one-star alternative batch 1 recorded for `add8(a, a)` on level 21.
   * Level 22 is the one level that withholds the part, and its comment says why.
   */
  {
    id: 'ch2-19-half-adder',
    chapter: 2,
    index: 19,
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
   * ch2-22-full-adder -- Full Adder / 全加器
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
   * those five components, so the mapping is a measurement rather than a claim.
   * Note what the mapped number is and is not: the source's 5 is a COMPONENT
   * count, 15 is a NAND-equivalent count, and the target counts the latter -- so
   * it does not punish a sixth component as such. Six parts worth six NAND
   * equivalents are inside 15 and pass; what the target separates is the standard
   * cell's 15 from any correct spelling of the same function that costs more NAND
   * equivalents than that.
   *
   * WHY `full_adder` IS NOT OFFERED HERE -- SETTLED, after an earlier ruling that
   * offered it on levels 21 and 22 was amended to drop 21. The clause that never
   * reached this level was "level 27's lesson is the cascade": level 27's cascade
   * is downstream of this level, not an argument about it. What decides it is this
   * level's own achievement. One instance of the part is EXACTLY this level's I/O
   * (`a:1 b:1 cin:1 -> sum:1 cout:1`), so a drop-in would score the level without
   * the five components it exists to teach, and at the registered 9-NAND cell it
   * measures 9 gates and 1 delay against the 15-and-3 target -- three stars for a
   * part the player never builds, which is what makes the five-component lesson
   * vacuous rather than merely easier. So the part is offered at level 19, its own
   * reward, and at level 22, where eight of them are the cascade the level asks
   * for -- and withheld here, the one place it would answer the puzzle on its own.
   * `neg8` is left out for batch 1's level-14 reason: every pin here is one bit
   * wide, so an eight-bit part has nothing to attach to.
   */
  {
    id: 'ch2-22-full-adder',
    chapter: 2,
    index: 22,
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
   * ch2-25-byte-nand -- Byte NAND / 单字节与非
   *
   * SOURCED: the name in both languages, its position (the 25th level, the twelfth
   * of chapter 2), and the dossier's one-line concept -- 8 位位运算, the bitwise
   * operators at byte width. As everywhere in this batch: no ports, no widths, no
   * pass condition and no reward come from the source.
   *
   * AUTHORED: the `a:8 b:8 -> out:8` shape; the fuzz check (seed, 256 rounds, and
   * the masked expectation); the palette; the measured three-star target; and the
   * four rewards, which are the retired `ch2-18-byte-or`'s -- see the module note
   * above and the `BYTE_AND_OR` helper for why the family moved here rather than
   * disappearing with its level.
   *
   * THE FUNCTION IS ONE NAND PER BIT, which is why this is the family's head rather
   * than one of its members: `and8` / `or8` / `nand8` / `nor8` are four spellings
   * of the same bit-sliced idea, and NAND is the gate the whole game's cost basis
   * is denominated in. The reference is a splitter per operand, eight `nand`s and a
   * maker: 8 NAND equivalents on a path one component deep, with the packers and
   * the level pins free on both metrics.
   *
   * THE FOUR BYTE OPERATORS ARE OFFERED, AND THAT IS THE OWN-REWARD RULE RATHER
   * THAN AN ACCIDENT. `paletteDefsFor` hands a level its own rewards before it is
   * passed, so a player can drop `nand8` straight in -- and it ties the reference
   * exactly, because one byte-wide NAND cell is one NAND per bit on the documented
   * basis: measured, `gate: 8, delay: 1`, the same numbers the eight-gate circuit
   * scores. Offering the other three costs the level nothing (none of them computes
   * a NAND alone, and the shelf is offered as it was earned), and what the target
   * still separates is the correct-but-costlier spelling of the same byte --
   * `nor8(a, a)`, a four-NAND cell, is 32 gates for the same answer, which is the
   * price level 26 records for its own copy of that cell. That is the same trade
   * this batch's level 27 makes for `full_adder`: a drop-in is offered when it is
   * the level's own reward, and even a tying one does not make the lesson vacuous,
   * because the lesson is the bit-sliced construction the part is short-hand for.
   */
  {
    id: 'ch2-25-byte-nand',
    chapter: 2,
    index: 25,
    name: { zh: '单字节与非', en: 'Byte NAND' },
    brief: {
      zh: '两个八位输入 a、b，一个八位输出 out。把两个字节逐位与非：只有当某一位上 a 和 b 同时为 1 时，out 的该位才是 0，其余各位都是 1。',
      en: 'Two eight-bit inputs a and b, one eight-bit output. NAND them bit by bit: a bit of out is 0 only where both a and b are 1 at that position, and 1 everywhere else.',
    },
    hint: {
      zh: '用位拆分器把 a 和 b 各拆成八位，每一位配一个与非门，八个结果再用位合并器拼回一个字节。也可以直接用这一关发给你的 nand8：一颗就是那八个与非门。',
      en: 'Split both bytes with a Splitter, NAND each pair of bits, and pack the eight results back with a Maker. Or drop in the nand8 this level hands out: one instance is exactly those eight NANDs.',
    },
    allowedComponents: [...GATES_1BIT, ...BYTE_WIRING, ...WIDE_OPS, ...BYTE_AND_OR, ...LEVEL_IO],
    io: IO_A8_B8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_25,
        rounds: 256,
        inputs: {
          a: (sample) => sample.a ?? 0,
          b: (sample) => sample.b ?? 0,
        },
        // `~(a & b)` alone is a negative int32, and the kernel refuses an
        // expectation that does not fit its pin rather than reducing it, so the
        // author's own `& 0xff` is what makes this check runnable at all -- the
        // same load-bearing mask level 26 carries in front of `~a`.
        outputs: { out: (v) => ~((v.a ?? 0) & (v.b ?? 0)) & 0xff },
      },
    ],
    // Measured: one NAND per bit -- 8 x 1 = 8 NAND equivalents -- behind a free
    // splitter per operand and a free maker, one gate deep. `nand8`, this level's
    // own reward, ties it exactly; the four-NAND-cell spellings are the ones the
    // target separates, and the comment above says which.
    threeStar: { gate: 8, delay: 1, tick: 0 },
    rewards: { components: ['and8', 'or8', 'nand8', 'nor8'] },
  },

  /**
   * ch2-26-byte-not -- Byte NOT / 8 位非
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
    id: 'ch2-26-byte-not',
    chapter: 2,
    index: 26,
    name: { zh: '单字节非门', en: 'Byte NOT' },
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
   * ch2-27-adding-bytes -- Adding Bytes / 8 位加法器
   *
   * SOURCED: the name in both languages, its position (22nd), the concept
   * (cascading one-bit adders into a byte adder), and its ACHIEVEMENT note --
   * "延迟 ≤ 35", the source's own reference value: a delay of 35 or less.
   *
   * AUTHORED: the `a:8 b:8 cin:1 -> out:8 cout:1` shape; the fuzz check (seed,
   * 256 rounds, and both expectation functions, computed from one sum so the two
   * pins cannot disagree about the overflow); the reference solution and the
   * measured three-star target; the two rewards; and the palette.
   *
   * THE REFERENCE IS EIGHT `full_adder` INSTANCES IN A RIPPLE CHAIN, AND THE
   * TARGET IS ITS OWN MEASUREMENT. One stage per bit, each stage's `cout` wired to
   * the next stage's `cin`, the eight `sum` pins packed by a maker: 8 x 9 = 72 NAND
   * equivalents on a carry path eight components deep -- the registered part's own
   * basis (`FULL_ADDER` in `wide.ts`, the same 9 that prices `add8` as eight of
   * it), measured as `gate: 72, delay: 8, tick: 0`. The splitters, the maker and
   * the level pins are free on both metrics. The source's note is an achievement,
   * so nothing here treats 35 as a pass condition or as a target: 35 is recorded
   * as the source's reference value and for nothing else, and the measured 8 is
   * below it -- agreement in spirit rather than on a shared scale, because the
   * source's "delay" is its own simulation metric on its own circuit while this
   * replica charges one unit per component on the longest combinational path. If
   * the measurement had come out above 35, this paragraph would say so and
   * `threeStar.delay` would still carry the measurement -- a target is not allowed
   * to be bent towards a number taken from another metric.
   *
   * THE HAND-WIRED CHAIN THIS LEVEL USED TO REFERENCE IS NOW THE DOCUMENTED
   * ALTERNATIVE. The old reference was eight hand-built full adders -- the
   * five-component construction level 22 teaches, 8 x (4 + 2 + 4 + 2 + 3) = 120
   * NAND equivalents on a path 3 + 2 x 7 = 17 -- and `threeStar` used to be that
   * 120/17. Registering `full_adder` (`523a7b9`) and offering it here made the
   * shipped reference DOMINATED by a cheaper legal solution: eight instances of
   * the part measure 72/8, strictly better on both scored metrics, so a 120/17
   * target could not be what this comment claimed it was -- `threeStar` is the
   * reference's measurement, and the reference was no longer the best circuit the
   * level's own palette could build. The cascade is the reference now and
   * `threeStar` is ITS measurement; the hand-wired chain stays in the reference
   * fixture (`test/fixtures/ch2-references.ts`, `handWiredAdderReference`), is
   * still graded, and now scores one star rather than three (120 > 72 and 17 > 8),
   * which is a target separating two correct constructions rather than a
   * formality. What the level teaches is unchanged: the eight-stage carry chain and
   * the ninth bit, wired the same way in both spellings.
   *
   * WHY THE PALETTE WITHHOLDS ONE PART AND OFFERS ANOTHER, which is a design
   * decision rather than an oversight:
   *
   *  * `add8`, unlocked by level 21, has EXACTLY this level's I/O shape, and one
   *    instance measures 72 gates and 1 delay. It would answer the level in a
   *    single drop, make the cascade the level teaches pointless, and make the
   *    source's own achievement value vacuous (any one-component circuit is inside
   *    a delay of 35). Withheld, and it stays withheld -- but note what that costs
   *    the target rather than hiding it: `add8` TIES the shipped reference's 72
   *    gates and beats its delay (72 and 1, measured in the test file), so the only
   *    circuit that still beats this reference is one this level's palette does not
   *    offer. It is unavailable here rather than beaten, and this comment is where
   *    that is on the record.
   *  * `full_adder`, level 19's reward, is OFFERED, because here eight of them and
   *    the carry chain between them ARE the cascade this level asks for. That is
   *    the withholding rule applied the other way round rather than contradicted:
   *    one instance is a one-bit part that cannot answer an eight-bit adder, so the
   *    cascade is the reference this level's target is measured from, not an
   *    alternative to it. The five-component lesson a drop-in WOULD void is level
   *    21's, and level 22 withholds the part for precisely that reason.
   *
   * Everything else on the player's wide shelf is offered even though no
   * combination of it adds two bytes: the seven byte operators levels 18 and 19
   * unlocked (`and8`, `or8`, `nand8`, `nor8`, `xor8`, `xnor8`, `not8`), `mul8`,
   * `less_u`, `equal8`, `neg8`, and the two switches this level itself hands out.
   * That is batch 1's rule as well -- it offers less_u and equal8 on levels that
   * cannot use them -- and the byte operators are listed here for it rather than
   * left out: their pins attach, none of them can add, and a shelf is offered as
   * it was earned.
   */
  {
    id: 'ch2-27-adding-bytes',
    chapter: 2,
    index: 27,
    name: { zh: '单字节加法', en: 'Adding Bytes' },
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
      ...BYTE_AND_OR,
      'xor8',
      'xnor8',
      'not8',
      'less_u',
      'equal8',
      'mul8',
      'full_adder',
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
    // Measured: the reference is eight `full_adder` instances in a ripple chain --
    // 8 x 9 = 72 NAND equivalents, one component per bit on the carry path so the
    // delay is 8 -- with the splitters, the maker and the level pins free. The
    // source's achievement value (35) is recorded in the comment above; the target
    // is the measurement, not that value. The hand-wired five-component chain this
    // level used to reference measures 120 and 17 and is now the documented
    // alternative: correct, inside the pass condition, and one star, because the
    // target is 72/8.
    threeStar: { gate: 72, delay: 8, tick: 0 },
    rewards: { components: ['switch8'] },
  },
];
