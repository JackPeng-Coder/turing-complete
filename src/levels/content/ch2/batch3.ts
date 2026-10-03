import type { FuzzVector, LevelSpec } from '../../spec';
// `LevelIo` -- the pin shape -- is `tables.ts`'s; `checks.ts` exports an
// unrelated runtime interface of the same name (the bound simulation), so the
// two must not be confused.
import { truthTable, type LevelIo } from '../../tables';

/**
 * Chapter 2, levels 23-27: two's complement, the decoders and the eight-bit
 * logic engine -- the batch where a byte stops being eight wires and starts
 * being a signed number, and where a level with an instruction set appears.
 *
 * WHAT THE SOURCE FIXES, AND WHAT IT DOES NOT. As in batches 1 and 2: the
 * compendium gives each of these levels exactly three things -- its name
 * (English and Chinese), its place in the chapter, and one line of teaching
 * concept. It gives no ports, no widths, no pass conditions, no targets and no
 * rewards. Everything else below is this replica's design, derived from the name
 * and that one line -- so every level carries a data comment split into
 * `SOURCED` and `AUTHORED`, and `test/levels/ch2-batch3.test.ts` fails if either
 * marker is missing. No number in this file may be presented as the source's
 * own.
 *
 * THREE THINGS THIS BATCH OWES A READER, and each says so in its own level
 * comment rather than only here:
 *
 *  * LEVEL 23 CHANGES THE SOURCE LEVEL'S KIND. The source's level of this name
 *    is a 限时小游戏 -- a timed mini-game, played against a clock, with no
 *    circuit specification of any sort. This replica is a circuit game and
 *    cannot host a typing game, so the level becomes a two's-complement
 *    arithmetic circuit: the concept the mini-game taught (read a negative
 *    number) is kept, the form is replaced. That is a deliberate change of kind,
 *    not a translation, and it is recorded as such -- batch 1 did the same thing
 *    to level 15 (`Binary Racer`, the other timed mini-game in the chapter).
 *  * LEVEL 25'S DECODER COMES IN WIDTHS, ONE PART PER WIDTH -- and the kernel
 *    has no per-instance knob that stands in for that. The family is generated
 *    (`decoder1` / `decoder2` / `decoder3`, one `createDecoderDef(w)` each), so
 *    the level's brief names the ids a player drops in rather than a width
 *    parameter; that level's comment records the rejected mechanism and the
 *    resolution, because an earlier revision of this batch shipped the wrong
 *    story (`params.width = 2` giving the catalog's 2-bit decoder).
 *  * LEVEL 27 HAS AN AUTHORED INSTRUCTION SET. The source says only "用或门和非门
 *    构建完整逻辑运算集" -- build the complete set of logical operations -- and
 *    enumerates no opcodes at all. The eight values in that level's comment, and
 *    in its brief for the player, are therefore this plan's design, and the test
 *    file measures all eight one at a time rather than trusting a random
 *    sequence to cover them.
 *
 * THE PALETTE RULE, inherited from batch 2 and used once more here: a level
 * offers the parts its shelf carries and the player has unlocked at or before it,
 * plus its own rewards, MINUS any part that is not its own reward and would
 * answer the level by itself. Level 24 uses that subtraction on `neg8` -- one
 * component with exactly the level's I/O shape, whose documented cell IS the
 * circuit the level teaches -- and says so in its own comment. `full_adder`
 * (level 20's reward, registered, and offered by levels 20 and 22) stays out of
 * every palette here, and nothing in this batch needs it: levels 23, 24 and 27
 * are byte-wide, and the two decoder levels select rather than add, so no target
 * in this batch is measured from a part a level would rather have answered with.
 *
 * ALL THREE LEVELS IN THIS BATCH ARE ANSWERED BY THEIR OWN REWARDS, one width
 * apart, and each says so in its own comment rather than leaving a reader to find
 * it: `ch2-35` offers `decoder1` (one drop-in scores the target exactly -- 1 gate,
 * 1 delay, three stars), `ch2-36` offers `decoder2` (measured at 10 gates, 1
 * delay, three stars against that level's 10-and-2 target: the drop-in ties the
 * gate count and beats the depth) and `ch2-37` offers `decoder3` (measured at 27
 * gates, 1 delay, three stars against that level's 27-and-3 target, the same tie
 * and the same reason -- the registered part's minterm tree IS the tree each level
 * teaches). Offering a level its own rewards before it is passed is batch 2's
 * own-reward half of the rule -- level 13's splitter and level 20's `full_adder`
 * are the same case -- rather than an exception to it, so these are recorded prices
 * and not holes: the drop-in is what a player who already owns the part can reach
 * for, and each level still teaches the circuit it hands out. No reward is
 * withdrawn, and `ch2-37`'s comment gives the reason: withdrawing a decoder there
 * would leave a registered part that no level offers at all, which is the
 * dead-content defect level 22's `full_adder` decision exists to avoid.
 *
 * THE DECODER REWARDS NAME DEFS THAT NOW EXIST. The three-width family was
 * reward DATA when this batch was written -- a legal state rather than a hole,
 * because a reward is an id, the unlock walk is over ids, and `ui/palette` drops
 * an id `registry.has` refuses. It has since been registered (`DECODER_DEF_IDS`:
 * `decoder1` / `decoder2` / `decoder3`, generated per width in
 * `src/core/defs/wide.ts`), and no number in this file moved when it landed: every
 * reference in the test file is wired from gates, so the levels do not depend on
 * the parts they hand out. All three widths now have a level of their own as well
 * (`ch2-35` rewards `decoder1`, `ch2-36` -- added by the 2.x realignment -- rewards
 * `decoder2`, `ch2-37` rewards `decoder3`), so no registered member of the family
 * is dead content; `ch2-35`'s comment still records why `decoder2` is not in THAT
 * level's palette, which is a different question from whether it is handed out.
 *
 * EVERY LEVEL HERE IS PURELY COMBINATIONAL, so `tick` is 0 on every three-star
 * target, for the same reason batches 1 and 2 state it: no check in this batch
 * ever ticks the clock, so the metric is genuinely 0 and its target can never be
 * what denies a player three stars. The metrics that do the work here are `gate`
 * and `delay`, and every target below is the reference solution's own measured
 * score -- `three-star targets are the reference solutions own metrics` in the
 * test file is what holds that to a number rather than a promise.
 *
 * JOINED THROUGH ONE PLACE: the chapter is assembled in `ch2/index.ts`, the only
 * module under `src/` that imports a batch file, so this file reaches the game
 * through that list and through nothing else; its own test grades it directly.
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

/** The wide operators batch 1's levels 15-17 unlocked. */
const WIDE_OPS = ['less_u', 'equal8', 'add8', 'mul8'] as const;

/** The bit-sliced byte operators batch 2's levels 18 and 19 unlocked. */
const BYTE_OPS = ['and8', 'or8', 'nand8', 'nor8', 'xor8', 'xnor8', 'not8'] as const;

/** Level 22's reward: a conditional pass, one bit and one byte wide. */
const SWITCHES = ['switch', 'switch8'] as const;

/**
 * The pin shapes this batch uses, so a level's io is one named constant instead
 * of two lines of literal in the middle of a spec.
 *
 * The decoder family spends one line per width, and the widths are ADJACENT and
 * in order: 1 -> 2, 2 -> 4, 3 -> 8. The output width is `2 ** sel`, so no two of
 * them can share a constant, which is also why the parts are separate defs
 * (`createDecoderDef(w)` in `core/defs/wide.ts`) rather than one part with a
 * width parameter.
 */
const IO_A8_OUT8: LevelIo = { inputs: [{ id: 'a', width: 8 }], outputs: [{ id: 'out', width: 8 }] };
const IO_SEL1_OUT2: LevelIo = {
  inputs: [{ id: 'sel', width: 1 }],
  outputs: [{ id: 'out', width: 2 }],
};
const IO_SEL2_OUT4: LevelIo = {
  inputs: [{ id: 'sel', width: 2 }],
  outputs: [{ id: 'out', width: 4 }],
};
const IO_SEL3_OUT8: LevelIo = {
  inputs: [{ id: 'sel', width: 3 }],
  outputs: [{ id: 'out', width: 8 }],
};
/**
 * A fuzz seed per level: the level's index in the high byte and the byte width
 * in the low one, exactly as batch 2 seeds its three.
 *
 * Fixed literals, not drawn ones: the same seed produces the same vectors on
 * every run and on every board edit, which is what makes a fuzz level's coverage
 * a fact about the level rather than about the run. Distinct values, so one
 * level's sequence is never another's.
 *
 * There used to be a third seed here, for the level the 2.x realignment removed
 * from this batch; the constants it needed went with it.
 */
const SEED_23 = 0x2308;
const SEED_24 = 0x2408;
/**
 * The signed value of an eight-bit two's-complement pattern.
 *
 * The whole of what levels 23 and 24 teach, written once: the top bit is the
 * sign, so a pattern of 128 or more is that pattern minus 256. The bit never
 * leaves this function -- both levels publish an eight-bit PATTERN again, which
 * is the contract every port in the kernel has (a port carries 0..255 and
 * `assertWidth` accepts nothing else).
 */
function signedByte(pattern: number): number {
  const byte = pattern & 0xff;
  return byte < 0x80 ? byte : byte - 0x100;
}

/**
 * Level 23's expectation: how far the byte is from zero.
 *
 * `0x01 -> 1`, `0xff -> 1`, `0x80 -> 128`. The one pattern to note is `0x80`:
 * the most negative byte is also the one whose magnitude needs the sign bit's
 * own position, and it fits (128 is representable) -- which is why this level
 * can publish a magnitude at all.
 */
const MAGNITUDE_OF_SIGNED_BYTE = (v: FuzzVector): number => Math.abs(signedByte(v.a ?? 0));

/**
 * Level 24's expectation: the low eight bits of `-a`.
 *
 * `0x80` negated is `0x80` again -- the one pattern two's complement cannot
 * reflect -- and the mask is what states that as arithmetic rather than as a
 * wrap-around the reader has to work out.
 */
const NEGATED_BYTE = (v: FuzzVector): number => (-signedByte(v.a ?? 0)) & 0xff;

export const CH2_BATCH3: readonly LevelSpec[] = [
  /**
   * ch2-29-negative-numbers -- Negative Numbers / 负数
   *
   * SOURCED: the name in both languages, its position (the 23rd level), and the
   * concept -- two's-complement representation (二进制补码), i.e. reading a byte
   * as a signed number. AND the form the source gives it: its level of this name
   * is a 限时小游戏, a timed mini-game with NO circuit specification at all -- no
   * ports, no gates, no pass condition.
   *
   * AUTHORED, AND THE FIRST THING IT RECORDS IS A CHANGE OF KIND. This replica
   * cannot host a game played against a clock, so the level is rebuilt as a
   * two's-complement arithmetic circuit: the concept the mini-game taught is
   * kept and the form is replaced, which is a deliberate change of the level's
   * kind rather than a translation of it. This is one of the three places in
   * this phase where a level's kind changes, and -- like batch 1's level 15,
   * the chapter's other timed mini-game -- it says so here rather than only in
   * the module header.
   *
   * The rest is authored too: the `a:8 -> out:8` shape; the function itself
   * (publish the MAGNITUDE of the byte read as two's complement -- a reading of
   * the sign, which is what the level is for, and deliberately not the negation
   * level 24 asks for); the fuzz check (the brief fixes its kind, its 256 rounds
   * and its fixed-seed rule; the seed, the pin maps and the expectation function
   * are written here); the measured three-star target; and the `div8` reward.
   *
   * THE REFERENCE THE TARGET IS MEASURED FROM is `add8(xor8(a, m), 0, m0)`,
   * where `m` is the sign bit spread over the whole byte and `m0` is that same
   * bit as the carry-in: `a XOR m` is `a` or `~a`, and adding `m` finishes the
   * job because subtracting 255 and adding 1 are the same eight-bit operation.
   * That is one `xor8` (32) and one `add8` (72) = 104 NAND equivalents on a path
   * two gates deep, and the maker and splitter that spread the sign are wiring
   * and cost nothing on either metric.
   *
   * WHAT THE TARGET SEPARATES, measured in the test file rather than asserted
   * here: the textbook `(a XOR m) - m`, spelled with a byte NOT of the mask
   * (112 gates, still two deep, one star), and the bit-serial spelling -- eight
   * XORs spreading the sign, then a carry-only ripple with no adder in it --
   * which is SMALLER (78 gates) and nine gates deep (one star). The level's own
   * answer is the one that is both cheap and shallow, which is what three stars
   * means here: the byte adder is two components where the ripple is fifteen, and
   * it is more than four times shallower.
   */
  {
    id: 'ch2-29-negative-numbers',
    chapter: 2,
    index: 29,
    name: { zh: '负数', en: 'Negative Numbers' },
    brief: {
      zh: '八位输入 a 是一个二进制补码数：最高位是符号位，a 小于 128 时它就是这个数本身，否则它的值是 a−256（0xFF 就是 −1）。输出这个数到 0 的距离：0x01→1，0xFF→1，0x80→128。',
      en: "Eight-bit input a is a two's-complement number: the top bit is the sign, so a below 128 is that number itself and anything else is a − 256 (0xFF is −1). Publish how far it is from zero: 0x01 gives 1, 0xFF gives 1, 0x80 gives 128.",
    },
    hint: {
      zh: '符号位就是第 7 位。把它铺满整个字节当作掩码 m：a 异或 m 得到 a 或 ~a，再把符号位本身当作进位加进去——在 8 位里减 255 和加 1 是一回事。',
      en: "The sign is bit 7. Spread it over the whole byte as a mask m: a XOR m is either a or ~a, and feeding the sign bit itself in as the carry finishes it, because subtracting 255 and adding 1 are the same thing in eight bits.",
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_OPS,
      'neg8',
      ...SWITCHES,
      'div8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_23,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: MAGNITUDE_OF_SIGNED_BYTE },
      },
    ],
    // Measured: `xor8` (32) and `add8` (72) = 104 NAND equivalents, two gates
    // deep -- see the paragraph above for what the two numbers separate.
    threeStar: { gate: 104, delay: 2, tick: 0 },
    rewards: { components: ['div8'] },
  },

  /**
   * ch2-31-signed-negator -- Signed Negator / 相反数
   *
   * SOURCED: the name in both languages, its position (24th), and the concept --
   * the two's-complement negation, "invert and add one".
   *
   * AUTHORED: the `a:8 -> out:8` shape; the fuzz check (seed, 256 rounds, and the
   * expectation `-signedByte(a) & 0xff`, which is where the mask is load-bearing
   * rather than decorative: Javascript's `-` on the byte 0 would be `-0` and on
   * 0x80 would be `-128`, and the kernel refuses an expectation that does not fit
   * its pin instead of reducing it); the measured three-star target; the three
   * rewards; and the palette.
   *
   * WHY THE PALETTE WITHHOLDS `neg8`, which is batch 2's palette rule used
   * exactly once more: `neg8` is not this level's own reward, it has precisely
   * this level's I/O shape, and its documented cell IS the circuit this level
   * teaches -- NOT the byte (8) plus the byte adder (72) = the same 80 NAND
   * equivalents, on one unit of delay instead of two. Offered, it would tie the
   * reference on gates and beat it on delay in a single drop, and the "invert and
   * add one" lesson would be pointless. Batch 2's level 22 withheld `add8` for
   * the same reason; level 23 offers `neg8` because there it does NOT answer the
   * level (a magnitude is not a negation).
   *
   * THE TARGET IS THE LESSON'S OWN CIRCUIT: `add8(not8(a), 0, 1)` -- 8 + 72 = 80
   * NAND equivalents, two gates deep. `nand8(a, a)` ties it exactly (one NAND per
   * bit is one NOT per bit on the same basis). What the target separates is
   * measured in the test file: the same function spelled with a byte XOR against
   * `const8` (104 gates, one star), and the bit-serial incrementer -- eight NOTs
   * and a carry-only ripple, 54 gates and nine gates deep -- which is smaller
   * than this circuit and one star for being more than four times deeper.
   */
  {
    id: 'ch2-31-signed-negator',
    chapter: 2,
    index: 31,
    name: { zh: '数值反转', en: 'Signed Negator' },
    brief: {
      zh: '八位输入 a。输出它的相反数：按补码的规则取反再加一，也就是 −a 的低八位。0x01 变成 0xFF；0x80 取负之后还是 0x80——−128 的相反数溢出回了它自己。',
      en: "Eight-bit input a. Publish its opposite: invert and add one, the two's-complement rule, which is the low eight bits of −a. 0x01 becomes 0xFF, and 0x80 stays 0x80 -- negating −128 overflows back onto itself.",
    },
    hint: {
      zh: '取反加一：先用 8 位非门把每一位翻过来，再用 8 位加法器加 1——另一个操作数接低电平，进位端接高电平。',
      en: 'Invert and add one: flip every bit with an 8-bit NOT, then add 1 with the 8-bit adder -- the other operand tied low, the carry-in tied high.',
    },
    allowedComponents: [
      ...GATES_1BIT,
      ...BYTE_WIRING,
      ...WIDE_OPS,
      ...BYTE_OPS,
      ...SWITCHES,
      'div8',
      'less_s',
      'shift_l8',
      'shift_r8',
      ...LEVEL_IO,
    ],
    io: IO_A8_OUT8,
    checks: [
      {
        kind: 'fuzz',
        seed: SEED_24,
        rounds: 256,
        inputs: { a: (sample) => sample.a ?? 0 },
        outputs: { out: NEGATED_BYTE },
      },
    ],
    // Measured: `not8` (8) plus `add8` (72) = 80 NAND equivalents on a path two
    // gates deep. See the comment above for the drop-in the palette withholds and
    // for the alternatives the test file measures.
    threeStar: { gate: 80, delay: 2, tick: 0 },
    rewards: { components: ['less_s', 'shift_l8', 'shift_r8'] },
  },

  /**
   * ch2-35-1-bit-decoder -- 1 Bit Decoder / 1 位解码器
   *
   * SOURCED: the name in both languages, its position (25th), and the concept --
   * one-to-two decoding: one select bit, two one-hot outputs. ALSO SOURCED, from
   * the catalog rather than from a level name: the compendium's component list for
   * this chapter has `decoder1`, `decoder2` and `decoder3`. (When this level was
   * written, no level name introduced the catalog's `2-Bit Decoder`; the 2.x
   * realignment gave it one -- `ch2-36-2-bit-decoder`, which rewards `decoder2` --
   * and this sentence is kept current rather than left as it was.)
   *
   * AUTHORED: the `sel:1 -> out:2` shape; the two rows (built by `truthTable`,
   * which refuses to leave a declared output pin uncompared); the measured
   * three-star target (ONE NAND equivalent on a path one gate deep: bit 0 is a
   * `not` of the select bit, bit 1 is the select bit, and the `maker` that packs
   * the two bits into the level's 2-bit output is wiring); the palette; and the
   * MECHANISM the catalog entry is realised by, which is this replica's design
   * rather than the source's: the 2-bit decoder is the same generator one width
   * up -- registered as `decoder2` -- rather than a second hand-written part,
   * which is what this level's brief tells the player.
   *
   * THE WIDTH QUESTION, RESOLVED -- recorded because a reviewer will ask, and
   * because an earlier revision of this file answered it wrongly. The registered
   * family is generated PER WIDTH: `createDecoderDef(w)` builds one part with
   * `sel: w` in and `out: 2 ** w` out, `DECODER_WIDTHS` registers w = 1, 2 and
   * 3, and the ids that come out are `decoder1`, `decoder2` and `decoder3`. The
   * brief says exactly that: the decoder comes in widths, one part each, and a
   * player who wants a 4-output decoder drops in `decoder2`.
   *
   * WHY `params.width` IS NOT, AND CANNOT BE, THE MECHANISM -- kept here so
   * nobody tries it again. `params.width` is the only per-instance knob the
   * kernel has, and it resolves a pin as `inst.params.width ?? pin.width` for
   * EVERY pin of the instance (`src/core/net.ts`, `effectiveWidth`): one width
   * literal covers the whole part. A def declaring `sel: 1 / out: 2` compiled at
   * `params.width = 2` therefore has BOTH pins two bits wide -- `sel: 2 /
   * out: 2`, which is not the catalog's 2-bit decoder (`sel: 2 / out: 4`). A
   * decoder's two pins MUST differ (the output count is `2 ** width`), so no
   * instance knob can express one; the width has to be a parameter of the DEF,
   * which is exactly how `createWideDefs(width)` builds the operators and
   * `createDecoderDef(width)` builds this family. `params.width` moves a part's
   * pins together; it can never move them apart.
   *
   * WHY `decoder2` IS NOT IN THIS LEVEL'S PALETTE, although the brief mentions
   * it. Two reasons, either of which would be enough. (1) No level has unlocked it
   * YET: a palette part is one the chapter has already handed out, and `decoder2`
   * belongs to the NEXT level of this batch (`ch2-36-2-bit-decoder`, added by the
   * 2.x realignment, which rewards it and is the only palette that offers it) --
   * `test/levels/ch2-batch3.test.ts` walks the unlock order and refuses a palette
   * entry nothing has unlocked by then, and at this level it has not been. (2) It
   * would answer this level by itself: `decoder2`'s select pin is two bits and the
   * level's `sel` is one, so the second select bit is simply unwired (an unwired
   * pin reads 0) and `out`'s low two bits are `1 << sel` -- this level's whole
   * two-row table, from a part the player never builds. The brief names it as the
   * next level's part, not as an answer here.
   *
   * `decoder1` IS OFFERED HERE, AND THAT IS THE OWN-REWARD RULE RATHER THAN A
   * CONTRADICTION OF THE PARAGRAPH ABOVE. Batch 2's palette rule subtracts only
   * parts that are NOT the level's own reward, and `paletteDefsFor` hands a level
   * its own rewards before it is passed (level 13's `splitter` and level 20's
   * `full_adder` are the same case) -- so a player CAN drop `decoder1` straight
   * in and score the target exactly: measured, `gate: 1, delay: 1, tick: 0`,
   * three stars, the same numbers the NOT-and-Maker reference scores, because a
   * one-NAND tree and the one NOT it is built from are the same one gate. That is
   * the price of the rule rather than an oversight, and it is why the reward stays
   * listed: the level teaches the part it hands out, and the drop-in is what a
   * player who already owns it uses to replay. `decoder2` is a different case --
   * it is not this level's reward at all -- which is the whole of the distinction.
   * Level 26 is the same case one width up (`decoder3` answers that level in one
   * drop for 27 gates and 1 delay, recorded in its own comment and measured in the
   * test file), and the module header names both.
   */
  {
    id: 'ch2-35-1-bit-decoder',
    chapter: 2,
    index: 35,
    name: { zh: '二进制译码', en: '1 Bit Decoder' },
    brief: {
      zh: '解码器把一个选择值变成一条为高的输出线，而且是按宽度分档的：一档一颗元件。这一关要做的是 decoder1，也就是 1 位选择、2 路输出的那一颗——sel 为 0 时第 0 位为高（out 读作 1），sel 为 1 时第 1 位为高（out 读作 2）。2 位选择、4 路输出的那一颗是 decoder2，也就是源资料目录里的「2 位解码器」：它是下一关的题目，这一关的 sel 只有一位，还用不上它。',
      en: 'A decoder turns a select value into one high output line, and it comes in widths: one part per width. This level asks for decoder1, the 1-to-2 form -- sel 0 lights bit 0 (out reads 1) and sel 1 lights bit 1 (out reads 2). The 2-to-4 form is decoder2, the catalog\'s 2-bit decoder: the next level builds it, and this level\'s sel is only one bit wide, so it has no use for the part yet.',
    },
    hint: {
      zh: '两个输出位里，第 0 位就是 sel 取反，第 1 位就是 sel 本身；用位合并器把这两条线拼成 2 位，一个非门就够了。',
      en: 'Of the two output bits, bit 0 is sel inverted and bit 1 is sel itself. Pack those two wires into two bits with a Maker: one NOT gate is the whole circuit.',
    },
    allowedComponents: [...GATES_1BIT, 'maker', 'decoder1', ...LEVEL_IO],
    io: IO_SEL1_OUT2,
    checks: [truthTable(IO_SEL1_OUT2, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // Measured: one `not` (1 NAND equivalent) on a path one gate deep, with the
    // maker free -- the floor for any circuit that has to invert one bit.
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['decoder1'] },
  },

  /**
   * ch2-36-2-bit-decoder -- 2 Bit Decoder / 2-4 译码器
   *
   * SOURCED: the name in both languages and its position -- the 36th level,
   * between the 1-bit and the 3-bit decoder. The dossier gives this level no
   * concept line at all: the width is the whole of it.
   *
   * AUTHORED: the `sel:2 -> out:4` shape and its single packed output; the four
   * rows; the palette; the measured three-star target; and the `decoder2` reward,
   * which no level handed out before this one existed. THE OUTPUT SHAPE IS THE
   * FAMILY'S, chosen rather than inherited: both sibling levels publish one packed
   * `out` that is `2 ** sel` bits wide and written by a Maker, so this one does the
   * same instead of publishing four 1-bit pins. Two reasons, and the second is the
   * deciding one -- three levels that decode into three different output shapes
   * would be three different puzzles, and `decoder2`, the part this level exists to
   * hand out, is registered with exactly `sel:2 -> out:4` (`createDecoderDef(2)`,
   * `src/core/defs/wide.ts`), so the packed shape is what makes the drop-in a
   * drop-in rather than a rewiring exercise.
   *
   * THE REFERENCE IS THE SHARED-MINTERM TREE AT WIDTH 2: one NOT per select bit,
   * four two-literal ANDs, one Maker -- 2 x 1 + 4 x 2 = 10 NAND equivalents on a
   * path two components deep, with the splitter, the Maker and the level pins free
   * on both metrics. It is the 3-bit level's tree one width down, which is what the
   * family teaches: decode the select value once into minterms, do not rebuild the
   * literals per output line.
   *
   * `decoder2` IS OFFERED HERE, AND IT ANSWERS THE LEVEL IN ONE DROP -- the same
   * recorded price the two sibling widths pay. One instance scores the gate target
   * exactly, because the registered part's minterm tree IS the tree this level
   * teaches: measured, `gate: 10, delay: 1` against this level's 10-and-2 target,
   * so it ties the gates and beats the depth (the hand-wired tree is two components
   * deep, the part publishes in one node). Withdrawing it was the alternative and is
   * refused for the reason the 3-bit level's comment gives one width up: offering a
   * level its own reward is batch 2's rule, and a registered, priced part that no
   * level offers at all is the dead-content defect that rule exists on the other
   * side of.
   */
  {
    id: 'ch2-36-2-bit-decoder',
    chapter: 2,
    index: 36,
    name: { zh: '2-4 译码器', en: '2 Bit Decoder' },
    brief: {
      zh: '两位选择输入 sel，四位输出 out。sel 的取值决定 out 的哪一位为高：sel=0 点亮第 0 位（out 读作 1），sel=1 点亮第 1 位（读作 2），sel=2 点亮第 2 位（读作 4），sel=3 点亮第 3 位（读作 8）；其余三位都是 0。',
      en: 'Two select bits, four output bits. The value of sel decides which bit of out goes high: sel 0 lights bit 0 (out reads 1), sel 1 lights bit 1 (2), sel 2 lights bit 2 (4) and sel 3 lights bit 3 (8). The other three bits stay 0.',
    },
    hint: {
      zh: '把 sel 拆成 b0、b1 两位，各自取反得到四条字面量线，再用四个与门拼出四种组合（每个与门恰好对应一个 sel 取值），最后用位合并器拼成四位。两个非门加四个与门，10 个 NAND 等价门。',
      en: 'Split sel into b0 and b1 and invert each, giving four literal wires. Four ANDs then produce the four minterms -- one per select value -- and a Maker packs them into four bits. Two NOTs and four ANDs, 10 NAND equivalents in all.',
    },
    allowedComponents: [...GATES_1BIT, 'splitter', 'maker', 'decoder2', ...LEVEL_IO],
    io: IO_SEL2_OUT4,
    checks: [truthTable(IO_SEL2_OUT4, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // Measured: 2 NOTs (1 each) + 4 ANDs (2 each) = 10 NAND equivalents on a path
    // two components deep, with the splitter, the maker and the level pins free on
    // both metrics. `decoder2`, this level's own reward, ties the gate count and
    // beats the depth -- the recorded price in the comment above.
    threeStar: { gate: 10, delay: 2, tick: 0 },
    rewards: { components: ['decoder2'] },
  },

  /**
   * ch2-37-3-bit-decoder -- 3 Bit Decoder / 3 位解码器
   *
   * SOURCED: the name in both languages, its position (26th), and the concept --
   * three-to-eight decoding: three select bits, one of eight output lines high.
   *
   * AUTHORED: the `sel:3 -> out:8` shape; the eight rows; the measured three-star
   * target; and the palette. The palette offers `splitter` and `maker` because
   * this level's pins are wide enough to attach to them -- the 3-bit select has
   * to be split before any gate can read one of its bits, and the eight one-bit
   * results have to be packed back into the level's 8-bit output. (Level 25 has
   * one-bit pins and offers neither.) THE PART'S DEFINITION IS AUTHORED TOO, and
   * it is a mechanism of this replica rather than a fact about the source:
   * `decoder3` is `createDecoderDef(3)`, the same generator as level 25's
   * `decoder1` one width up -- see that level's note on the family.
   *
   * THE REFERENCE IS THE TWO-LEVEL TREE, and that is the level's lesson: decode
   * the low two select bits into four minterms (two NOTs and four ANDs), then
   * combine each minterm with the top select bit or its inverse (one more NOT and
   * eight ANDs) -- 3 + 8 + 16 = 27 NAND equivalents on a path three gates deep.
   * The obvious flat alternative, eight 3-input ANDs each taking all three
   * literals, is 3 + 8 x 4 = 35 gates on a path two deep; it is correct, it is
   * measured in the test file, and the gate target is what makes it one star. So
   * the target says what the level teaches: share the low decode, do not rebuild
   * it eight times.
   *
   * `decoder3` IS OFFERED HERE, AND IT ANSWERS THE LEVEL IN ONE DROP-IN -- the
   * same recorded price level 25 pays for `decoder1`, one width up, and stated as
   * a measurement rather than a worry: one instance of this level's OWN reward,
   * wired straight from `sel` to the level's output, scores `gate: 27, delay: 1,
   * tick: 0` and three stars against this level's 27-and-3 target. The 27 is not a
   * coincidence and is worth reading twice: the registered part's `gateCost` IS
   * the shared minterm tree this level teaches (3 NOTs, 4 ANDs, 8 ANDs), so the
   * drop-in ties the gate target exactly and beats its depth, because the target's
   * 3 is a hand-wired tree's path while the part publishes in one node.
   *
   * WITHDRAWING THE PART WAS THE ALTERNATIVE AND IS REFUSED DELIBERATELY. A level
   * offering its own reward is batch 2's rule rather than a loophole (level 13's
   * `splitter` cannot build its own level without it, and level 20 offers the
   * `full_adder` it hands out), so the part stays -- and the cost of withdrawing
   * is worse than the price of keeping it: no other level in this chapter lists
   * `decoder3` either, so removing it here would leave a registered, priced part
   * that NO level offers at all, which is the dead-content defect level 22's
   * `full_adder` decision exists to avoid. What the level still teaches is the
   * tree it hands out; what the drop-in buys is a one-drop replay for a player who
   * can already see the part in their palette, which the reward rule accepts on
   * every level it applies to and level 25's comment sets out at length.
   */
  {
    id: 'ch2-37-3-bit-decoder',
    chapter: 2,
    index: 37,
    name: { zh: '3-8 译码器', en: '3 Bit Decoder' },
    brief: {
      zh: '三位选择输入 sel，八位输出 out。sel 的取值决定 out 的哪一位为高：sel=0 点亮第 0 位，sel=1 点亮第 1 位，……sel=7 点亮第 7 位；其余七位都是 0。',
      en: 'Three select bits, eight output bits. The value of sel decides which bit of out goes high: sel 0 lights bit 0, sel 1 lights bit 1, and so on to sel 7 lighting bit 7. The other seven bits stay 0.',
    },
    hint: {
      zh: '先把低两位解成 4 路（两级深度），再让每一路按最高位分成上下两半——8 路输出共用同一次低位解码，一共 27 个 NAND 等价门。八个人手一个三路与门直接展开要 35 个，门更多。',
      en: 'Decode the low two bits into four lines first, then split each of those into two by the top bit: one shared low decode for all eight outputs, 27 NAND equivalents in all. Eight flat 3-input ANDs cost 35, which is more.',
    },
    allowedComponents: [...GATES_1BIT, 'splitter', 'maker', 'decoder3', ...LEVEL_IO],
    io: IO_SEL3_OUT8,
    checks: [truthTable(IO_SEL3_OUT8, { out: ({ sel }) => 1 << (sel ?? 0) })],
    // Measured: the two-level tree -- 3 NOTs + 4 ANDs + 8 ANDs = 27 NAND
    // equivalents -- on a path three gates deep. The flat 3-input-AND decode is
    // 35 and 2, which is the one-star alternative the test file measures.
    threeStar: { gate: 27, delay: 3, tick: 0 },
    rewards: { components: ['decoder3'] },
  },

];
