import type { Graph } from '../../src/core/graph';
import { build, type Node } from './build';

/**
 * Chapter 2's reference solutions, in ONE place.
 *
 * WHY THIS FILE EXISTS. Each batch's test file used to own its own
 * `solutions` map, and the whole-set walk (`test/levels/level-buildability.test.ts`)
 * carried handwritten copies of chapter 1's twelve and chapter 2's first five,
 * because it has to hand `paletteDefsFor` a circuit per shipped level and a test
 * file may not reach into another test file. When chapters were joined the walk
 * needed all 26 chapter-2 circuits, and 22 more copies is 22 more things that can
 * go stale -- which is exactly what the walk exists to catch. So the copies moved
 * here and the batch tests import them back.
 *
 * NOTHING IS LOST BY SHARING. The old split's purpose was that a stale copy
 * fails loudly, and each batch test still grades every circuit in its own map
 * against its own levels (`reference solutions pass with three stars`,
 * `three-star targets are the reference solutions own metrics`, `reference
 * solutions are buildable from the palette they are graded against`). The walk
 * grades all 38 again against the shipped set. One definition, three graders: a
 * circuit that stops passing its level fails in the batch test that owns it, and
 * a circuit the assembled palette cannot build fails in the walk.
 *
 * WHAT IS HERE AND WHAT IS NOT. Only the circuits that PASS a level -- the ones
 * the three-star targets were measured from. The plausible-wrong and
 * correct-but-expensive alternatives stay in the batch test files that assert
 * they fail or score one star, because those are that file's argument, not a
 * reference. ONE alternative lives here instead, and its own note says why:
 * `handWiredAdderReference` is level 22's FORMER reference -- it still passes the
 * level and scores one star now -- so it is filed beside the cascade that replaced
 * it, which is the one comparison a reader of that level has to be able to make.
 * The few other alternatives a batch test borrows for its own counterexample
 * blocks are exported below for the same reason the references are.
 *
 * The per-batch maps exist so each batch test keeps grading exactly its own
 * levels; `CH2_REFERENCES` is their union, in index order, which is what the
 * whole-set walk walks.
 */

// ---------------------------------------------------------------------------
// Shared wiring helpers
// ---------------------------------------------------------------------------

/**
 * The eight `stem<bit>` ids a byte-wide maker is fed, low bit first.
 *
 * Every batch used to define its own copy of this three-line function; all four
 * were identical, so there is one now. It is exported because the batch tests'
 * counterexample circuits build byte-wide parts with it too.
 */
export function bits(stem: string): string[] {
  return Array.from({ length: 8 }, (_, bit) => `${stem}${bit}`);
}

// ---------------------------------------------------------------------------
// Levels 13-17 (batch 1): scalar logic and counting
// ---------------------------------------------------------------------------

export const CH2_BATCH1_REFERENCES: Record<string, () => Graph> = {
  // splitter + three XORs: one per pair, then the pair results.
  'ch2-13-odd-number-of-signals': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'xor', id: 'p01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'xor', id: 'p23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'xor', id: 'parity', from: ['p01', 'p23'] },
      { kind: 'output', from: 'parity' },
    ]),
  // (a&b) | (c&d) | ((a|b)&(c|d)): the six pairs, in three terms.
  'ch2-14-double-trouble': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'and', id: 'ab', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'cd', from: ['c', 'd'] },
      { kind: 'part', def: 'or', id: 'a_or_b', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'c_or_d', from: ['c', 'd'] },
      { kind: 'part', def: 'and', id: 'cross', from: ['a_or_b', 'c_or_d'] },
      { kind: 'part', def: 'or3', id: 'at_least_two', from: ['ab', 'cd', 'cross'] },
      { kind: 'output', from: 'at_least_two' },
    ]),
  // Two half adders, then the two partial sums added the same way.
  'ch2-15-binary-racer': () =>
    build([
      { kind: 'input', name: 'a', width: 4 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'xor', id: 's01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'and', id: 'c01', from: ['sp.b0', 'sp.b1'] },
      { kind: 'part', def: 'xor', id: 's23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'and', id: 'c23', from: ['sp.b2', 'sp.b3'] },
      { kind: 'part', def: 'xor', id: 'bit0', from: ['s01', 's23'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['s01', 's23'] },
      { kind: 'part', def: 'xor', id: 'carries', from: ['c01', 'c23'] },
      { kind: 'part', def: 'xor', id: 'bit1', from: ['carries', 'carry'] },
      { kind: 'part', def: 'and', id: 'bit2', from: ['c01', 'c23'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['bit0', 'bit1', 'bit2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // The same tree, on four separate pins.
  'ch2-16-counting-signals': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'input', name: 'd' },
      { kind: 'part', def: 'xor', id: 's01', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'c01', from: ['a', 'b'] },
      { kind: 'part', def: 'xor', id: 's23', from: ['c', 'd'] },
      { kind: 'part', def: 'and', id: 'c23', from: ['c', 'd'] },
      { kind: 'part', def: 'xor', id: 'bit0', from: ['s01', 's23'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['s01', 's23'] },
      { kind: 'part', def: 'xor', id: 'carries', from: ['c01', 'c23'] },
      { kind: 'part', def: 'xor', id: 'bit1', from: ['carries', 'carry'] },
      { kind: 'part', def: 'and', id: 'bit2', from: ['c01', 'c23'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['bit0', 'bit1', 'bit2', 'z', 'z', 'z', 'z', 'z'],
      },
      { kind: 'output', width: 3, from: 'mk' },
    ]),
  // A left shift is wiring: every bit of a moves up one slot, bit 0 is 0.
  'ch2-17-double-the-number': () =>
    build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'part', def: 'splitter', id: 'sp', from: ['a'] },
      { kind: 'part', def: 'const_off', id: 'z', from: [] },
      {
        kind: 'part',
        def: 'maker',
        id: 'mk',
        from: ['z', 'sp.b0', 'sp.b1', 'sp.b2', 'sp.b3', 'sp.b4', 'sp.b5', 'sp.b6'],
      },
      { kind: 'output', width: 8, from: 'mk' },
    ]),
};

// ---------------------------------------------------------------------------
// Levels 18-22 (batch 2): the byte operators and the adders
// ---------------------------------------------------------------------------

/**
 * `a | b`, bit by bit: two splitters, eight one-bit ORs, one maker.
 *
 * 8 x 3 = 24 NAND equivalents at depth 1. The `or8` this level's own reward
 * hands out ties it exactly (24 and 1 on the same basis), which batch 2's
 * `the byte operators tie the circuits the levels ask for` asserts.
 */
export function byteOrReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({
      kind: 'part',
      def: 'or',
      id: `o${bit}`,
      from: [`sa.b${bit}`, `sb.b${bit}`],
    });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('o') });
  nodes.push({ kind: 'output', from: 'mk', width: 8 });
  return build(nodes);
}

/** `~a`, bit by bit: one splitter, eight NOTs, one maker. 8 gates at depth 1. */
export function byteNotReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
  ];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'not', id: `n${bit}`, from: [`sa.b${bit}`] });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('n') });
  nodes.push({ kind: 'output', from: 'mk', width: 8 });
  return build(nodes);
}

/**
 * One full adder out of five gates: `sum` is the two XORs, `cout` is the OR of
 * the two carry terms. This is the construction level 21's source achievement
 * names (five components), which is why it is written the long way rather than
 * as `add8` or a registered `full_adder` -- neither is offered on that level.
 */
function fullAdderNodes(bit: string, a: string, b: string, cin: string): Node[] {
  return [
    { kind: 'part', def: 'xor', id: `t${bit}`, from: [a, b] },
    { kind: 'part', def: 'and', id: `g${bit}`, from: [a, b] },
    { kind: 'part', def: 'xor', id: `s${bit}`, from: [`t${bit}`, cin] },
    { kind: 'part', def: 'and', id: `p${bit}`, from: [`t${bit}`, cin] },
    { kind: 'part', def: 'or', id: `c${bit}`, from: [`g${bit}`, `p${bit}`] },
  ];
}

/** Level 21's reference: that one full adder, on the level's three pins. */
export function fullAdderReference(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'b' },
    { kind: 'input', name: 'cin' },
    ...fullAdderNodes('', 'a', 'b', 'cin'),
    { kind: 'output', name: 'OUT_sum', from: 's' },
    { kind: 'output', name: 'OUT_cout', from: 'c' },
  ]);
}

/**
 * Level 22's reference: EIGHT `full_adder` INSTANCES in a ripple chain.
 *
 * This is the construction the level's own palette makes possible -- `full_adder`
 * is level 20's reward and level 22 offers it -- and it is the circuit that
 * level's `threeStar` is measured from: eight instances at the registered 9 NAND
 * equivalents each are 72 gates, and the carry chain is one component per bit, so
 * the delay is 8. The splitters, the maker and the level pins are free on both
 * metrics.
 *
 * IT REPLACED THE HAND-WIRED CHAIN BELOW, which used to be the reference at
 * 120/17. Once the part was registered (`523a7b9`) and offered here, the shipped
 * target was dominated by a cheaper legal solution -- 8 x 9 = 72 on a path eight
 * deep beats 120 on a path seventeen deep on both scored metrics -- so the target
 * could no longer be what level 22's comment claimed it was. The old circuit is
 * kept as `handWiredAdderReference` below and is still graded: it passes the
 * level and scores one star now, which is the target separating the two
 * constructions the way a target should.
 *
 * Every number in level 22's `threeStar` comes from this circuit measured by
 * `grade()`, and batch 2's `three-star targets are the reference solutions own
 * metrics` is what holds the data to it. Exported because that batch test
 * measures this circuit directly as well.
 */
export function rippleAdderReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'cin' },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
  ];
  let carry = 'cin';
  const sums: string[] = [];
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push({
      kind: 'part',
      def: 'full_adder',
      id: `fa${bit}`,
      from: [`sa.b${bit}`, `sb.b${bit}`, carry],
    });
    // `full_adder`'s outputs are `sum` and `cout` rather than one `out`, so both
    // edges of the chain spell their pin.
    sums.push(`fa${bit}.sum`);
    carry = `fa${bit}.cout`;
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: sums });
  nodes.push({ kind: 'output', name: 'OUT_out', from: 'mk', width: 8 });
  nodes.push({ kind: 'output', name: 'OUT_cout', from: carry, width: 1 });
  return build(nodes);
}

/**
 * The alternative level 22 used to file as its reference: eight hand-built full
 * adders in the same ripple chain.
 *
 * Each stage is the five-component construction level 21 teaches -- XOR, AND,
 * XOR, AND, OR -- so the chain is 8 x (4 + 2 + 4 + 2 + 3) = 120 NAND equivalents
 * on a carry path of 3 + 2 x 7 = 17. It is a correct eight-bit adder and it still
 * passes the level; what changed is that it is no longer the reference and no
 * longer three stars, because the shipped target is the cascade's own 72/8. That
 * is the measurement behind level 22's "documented alternative" paragraph and the
 * assertion in `test/levels/ch2-batch2.test.ts`.
 */
export function handWiredAdderReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'cin' },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
  ];
  let carry = 'cin';
  for (let bit = 0; bit < 8; bit += 1) {
    nodes.push(...fullAdderNodes(String(bit), `sa.b${bit}`, `sb.b${bit}`, carry));
    carry = `c${bit}`;
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('s') });
  nodes.push({ kind: 'output', name: 'OUT_out', from: 'mk', width: 8 });
  nodes.push({ kind: 'output', name: 'OUT_cout', from: carry, width: 1 });
  return build(nodes);
}

export const CH2_BATCH2_REFERENCES: Record<string, () => Graph> = {
  'ch2-18-byte-or': byteOrReference,
  'ch2-19-byte-not': byteNotReference,
  // sum = a XOR b, carry = a AND b: two gates, the smallest half adder there is.
  'ch2-20-half-adder': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'xor', id: 'sum', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'carry', from: ['a', 'b'] },
      { kind: 'output', name: 'OUT_sum', from: 'sum' },
      { kind: 'output', name: 'OUT_carry', from: 'carry' },
    ]),
  'ch2-21-full-adder': fullAdderReference,
  'ch2-22-adding-bytes': rippleAdderReference,
};

// ---------------------------------------------------------------------------
// Levels 23-27 (batch 3): two's complement, decoders and the logic engine
// ---------------------------------------------------------------------------

/**
 * Level 23's reference: the magnitude of a two's-complement byte.
 *
 * `abs(a) = (a XOR m) + m`, where `m` is the sign bit spread over all eight
 * positions: for a non-negative `a` the mask is 0 and this is `a + 0`; for a
 * negative one it is `(255 - a) + 1`, which is `-a` modulo 256. The `+ m` is the
 * whole trick -- subtracting 255 and adding 1 are the same eight-bit operation,
 * so the sign bit itself is the carry-in.
 *
 * Measured: one `xor8` (32) and one `add8` (72) = 104 NAND equivalents, two
 * gates deep; the splitter and the maker that spread the sign are wiring and
 * cost nothing on either metric.
 */
function absReference(): Graph {
  const sign = 'sa.b7';
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    {
      kind: 'part',
      def: 'maker',
      id: 'mask',
      from: Array.from({ length: 8 }, () => sign),
    },
    { kind: 'part', def: 'xor8', id: 'flip', from: ['a', 'mask'] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'add8', id: 'plus', from: ['flip', 'z', sign] },
    { kind: 'output', from: 'plus', width: 8 },
  ]);
}

/**
 * Level 24's reference: the level's own lesson, invert and add one.
 *
 * `~a + 1` with the byte NOT and the byte adder -- 8 + 72 = 80 NAND
 * equivalents, two gates deep. This is the construction the level's teaching
 * line names, and (per its data comment) the palette withholds `neg8`, whose
 * documented cell IS this circuit (8 NOTs + 8 full adders) and which would
 * therefore tie it on gates and beat it on delay.
 */
function negateReference(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'not8', id: 'flip', from: ['a'] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'add8', id: 'plus', from: ['flip', 'z', 'one'] },
    { kind: 'output', from: 'plus', width: 8 },
  ]);
}

/**
 * Level 25's reference: bit 0 is `NOT sel`, bit 1 is `sel`.
 *
 * One NAND equivalent, one gate deep: the Maker that packs the two bits into the
 * level's 2-bit output is wiring.
 */
function oneBitDecoderReference(): Graph {
  return build([
    { kind: 'input', name: 'sel' },
    { kind: 'part', def: 'not', id: 'n', from: ['sel'] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'maker', id: 'mk', from: ['n', 'sel', 'z'] },
    { kind: 'output', from: 'mk', width: 2 },
  ]);
}

/**
 * Level 26's reference: the two-level tree.
 *
 * The low two select bits are decoded into four minterms (`b2` is not needed
 * yet), and each of those is then combined with `b2` or its inverse -- three
 * NOTs, four ANDs, eight ANDs = 27 NAND equivalents, three gates deep. The flat
 * alternative, eight 3-input ANDs each taking all three literals, is 35 gates
 * on a path two deep, and the level's target is what separates them (batch 3
 * measures it in `the decode targets separate the constructions they measure`).
 */
function threeBitDecoderReference(): Graph {
  const s0 = 'sp.b0';
  const s1 = 'sp.b1';
  const s2 = 'sp.b2';
  const nodes: Node[] = [
    { kind: 'input', name: 'sel', width: 3 },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['sel'] },
    { kind: 'part', def: 'not', id: 'n0', from: [s0] },
    { kind: 'part', def: 'not', id: 'n1', from: [s1] },
    { kind: 'part', def: 'not', id: 'n2', from: [s2] },
    // The four minterms of the low pair, in one-hot order.
    { kind: 'part', def: 'and', id: 'lo0', from: ['n0', 'n1'] },
    { kind: 'part', def: 'and', id: 'lo1', from: [s0, 'n1'] },
    { kind: 'part', def: 'and', id: 'lo2', from: ['n0', s1] },
    { kind: 'part', def: 'and', id: 'lo3', from: [s0, s1] },
  ];
  for (let out = 0; out < 8; out += 1) {
    nodes.push({
      kind: 'part',
      def: 'and',
      id: `o${out}`,
      from: [`lo${out % 4}`, out < 4 ? 'n2' : s2],
    });
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: bits('o') });
  nodes.push({ kind: 'output', from: 'mk', width: 8 });
  return build(nodes);
}

/** How one reference-shaped logic engine differs from the level's spec. */
export interface EngineOptions {
  /** Where the shift amount comes from: the spec's low three bits, or the whole byte. */
  readonly amount?: 'low3' | 'byte';
  /** What opcode 7 computes: the spec's arithmetic shift, or the logical one. */
  readonly op7?: 'ashr' | 'logical';
  /** Wire opcode `k`'s output to the next opcode's result instead of its own. */
  readonly breakOp?: number;
}

/** One 2:1 mux in gates: `NAND(NAND(a, ~s), NAND(b, s))`, with `~s` shared. */
function muxNodes(id: string, a: string, b: string, s: string, ns: string): Node[] {
  return [
    { kind: 'part', def: 'nand', id: `${id}a`, from: [a, ns] },
    { kind: 'part', def: 'nand', id: `${id}b`, from: [b, s] },
    { kind: 'part', def: 'nand', id: `${id}o`, from: [`${id}a`, `${id}b`] },
  ];
}

/**
 * Level 27's reference: all eight results, then a 2:1-mux tree per bit.
 *
 * Eight results are computed in parallel from the level's own inputs -- `and8`,
 * `or8`, `xor8`, `not8`, `add8`, `add8(a, ~b, 1)`, `shift_l8` and `ashr8` -- and
 * each output bit is selected by a three-level tree of 2:1 muxes driven by
 * `op0`, `op1`, `op2` in that order. Fifty-six muxes at three NANDs each plus
 * the three inverters of the op bits is 171 gate equivalents on top of the 497
 * the eight results cost.
 *
 * The shift amount is `b`'s low three bits and costs no gate: a splitter hands
 * out `b0..b2` and a maker packs them back with zeroes above.
 *
 * The three options are what batch 3's counterexample blocks vary -- the level's
 * own reference takes all three defaults, which is why this is exported.
 */
export function logicEngine(options: EngineOptions = {}): Graph {
  const amountId = 'amt';
  const amountRef = options.amount === 'byte' ? 'b' : amountId;
  const nodes: Node[] = [
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'op', width: 8 },
    { kind: 'part', def: 'splitter', id: 'sa', from: ['a'] },
    { kind: 'part', def: 'splitter', id: 'sb', from: ['b'] },
    { kind: 'part', def: 'splitter', id: 'sop', from: ['op'] },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    // The three opcode bits and their inverses, shared by all 56 muxes.
    { kind: 'part', def: 'not', id: 'nop0', from: ['sop.b0'] },
    { kind: 'part', def: 'not', id: 'nop1', from: ['sop.b1'] },
    { kind: 'part', def: 'not', id: 'nop2', from: ['sop.b2'] },
    // The eight results, in opcode order.
    { kind: 'part', def: 'and8', id: 'r0', from: ['a', 'b'] },
    { kind: 'part', def: 'or8', id: 'r1', from: ['a', 'b'] },
    { kind: 'part', def: 'xor8', id: 'r2', from: ['a', 'b'] },
    { kind: 'part', def: 'not8', id: 'r3', from: ['a'] },
    { kind: 'part', def: 'add8', id: 'r4', from: ['a', 'b', 'z'] },
    { kind: 'part', def: 'not8', id: 'nbb', from: ['b'] },
    { kind: 'part', def: 'add8', id: 'r5', from: ['a', 'nbb', 'one'] },
    // `b & 7` as wiring: the low three bits, zeroes above.
    { kind: 'part', def: 'maker', id: amountId, from: ['sb.b0', 'sb.b1', 'sb.b2', 'z'] },
    { kind: 'part', def: 'shift_l8', id: 'r6', from: ['a', amountRef] },
    {
      kind: 'part',
      def: options.op7 === 'logical' ? 'shift_r8' : 'ashr8',
      id: 'r7',
      from: ['a', amountRef],
    },
  ];

  // One splitter per result, so every bit of every result can be selected.
  const results = Array.from({ length: 8 }, (_, op) => `r${op}`);
  if (options.breakOp !== undefined) {
    // A wiring change, not a new part: opcode k's mux input becomes opcode
    // (k + 1)'s result, which is what makes this a circuit wrong on exactly one
    // opcode. The result it no longer uses stays in the graph (and in the gate
    // count) with its output unread.
    results[options.breakOp] = `r${(options.breakOp + 1) % 8}`;
  }
  for (let op = 0; op < 8; op += 1) {
    nodes.push({ kind: 'part', def: 'splitter', id: `s${op}`, from: [results[op]!] });
  }

  const selects = [
    { s: 'sop.b0', ns: 'nop0' },
    { s: 'sop.b1', ns: 'nop1' },
    { s: 'sop.b2', ns: 'nop2' },
  ];
  const outBits: string[] = [];
  for (let bit = 0; bit < 8; bit += 1) {
    // Level 1 pairs opcodes that differ in op0, level 2 pairs those groups by
    // op1, and level 3 -- one mux -- decides by op2.
    let level = Array.from({ length: 8 }, (_, op) => `s${op}.b${bit}`);
    for (const [stage, { s, ns }] of selects.entries()) {
      const next: string[] = [];
      for (let pair = 0; pair < level.length / 2; pair += 1) {
        const id = `mux${bit}_${stage}_${pair}`;
        nodes.push(...muxNodes(id, level[pair * 2]!, level[pair * 2 + 1]!, s, ns));
        next.push(`${id}o`);
      }
      level = next;
    }
    outBits.push(level[0]!);
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: outBits });
  nodes.push({ kind: 'output', from: 'mk', width: 8 });
  return build(nodes);
}

export const CH2_BATCH3_REFERENCES: Record<string, () => Graph> = {
  'ch2-23-negative-numbers': absReference,
  'ch2-24-signed-negator': negateReference,
  'ch2-25-1-bit-decoder': oneBitDecoderReference,
  'ch2-26-3-bit-decoder': threeBitDecoderReference,
  'ch2-27-logic-engine': () => logicEngine(),
};

// ---------------------------------------------------------------------------
// Levels 28-38 (batch 4): storage and timing
// ---------------------------------------------------------------------------

/**
 * Level 28's reference: the loop, closed through a Delay Line.
 *
 * `next = (set AND value) OR (NOT set AND out)`, with `out` the Delay Line's
 * published state -- deliberately built from two Switches rather than an AND
 * plus a NOT plus an AND, because the Switch is one delay unit while the AND
 * cell is two, and the carry path through `set` is what sets this level's delay
 * (the `switch` is offered on this level).
 *
 * Measured: `not` (1) + two `switch` (2 each) + `or` (3) = 8 NAND equivalents on
 * a path three components deep, with the Delay Line free on both metrics. The
 * graph really does contain a feedback loop -- `validateGraph` reports it as a
 * warning -- which is what makes this reference the one the level's stability
 * assertion is about.
 */
export function circularDependencyReference(): Graph {
  return build([
    { kind: 'input', name: 'set' },
    { kind: 'input', name: 'value' },
    { kind: 'part', def: 'not', id: 'nset', from: ['set'] },
    { kind: 'part', def: 'switch', id: 'take', from: ['value', 'set'] },
    { kind: 'part', def: 'switch', id: 'hold', from: ['d', 'nset'] },
    { kind: 'part', def: 'or', id: 'next', from: ['take', 'hold'] },
    { kind: 'part', def: 'delay_line', id: 'd', from: ['next'] },
    { kind: 'output', from: 'd' },
  ]);
}

/** Level 29's reference: the 8-bit Delay Line this level hands out. */
export function delayedLinesReference(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'part', def: 'delay8', id: 'd', from: ['a'] },
    { kind: 'output', width: 8, from: 'd' },
  ]);
}

/**
 * Level 30's reference: the clock source.
 *
 * `next = out XOR enable` fed back into a 1-Bit Memory whose `set` is tied high,
 * so every edge samples it. XOR with 1 is "invert", XOR with 0 is "keep", so the
 * same gate is both the oscillation and the gate -- which is why the level costs
 * one XOR (4 NAND equivalents, one delay unit deep) and nothing else.
 */
function oddTicksReference(): Graph {
  return build([
    { kind: 'input', name: 'enable' },
    { kind: 'part', def: 'const_on', id: 'one', from: [] },
    { kind: 'part', def: 'mem1', id: 'm', from: ['one', 'next'] },
    { kind: 'part', def: 'xor', id: 'next', from: ['m', 'enable'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** Level 31's reference: one XOR is conditional inversion. */
function bitInverterReference(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'inv' },
    { kind: 'part', def: 'xor', id: 'x', from: ['a', 'inv'] },
    { kind: 'output', from: 'x' },
  ]);
}

/** Level 32's reference: one AND is the conditional pass. */
function bitSwitchReference(): Graph {
  return build([
    { kind: 'input', name: 'a' },
    { kind: 'input', name: 'on' },
    { kind: 'part', def: 'and', id: 'g', from: ['a', 'on'] },
    { kind: 'output', from: 'g' },
  ]);
}

/** Level 33's and level 34's reference: the 8-Bit Multiplexer. */
function selectorReference(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'input', name: 'sel' },
    { kind: 'part', def: 'mux8', id: 'm', from: ['a', 'b', 'sel'] },
    { kind: 'output', width: 8, from: 'm' },
  ]);
}

/** Level 35's reference: the 1-Bit Memory, whose `set` is the load enable. */
function savingGracefullyReference(): Graph {
  return build([
    { kind: 'input', name: 'd' },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'mem1', id: 'm', from: ['load', 'd'] },
    { kind: 'output', from: 'm' },
  ]);
}

/** Level 36's reference: the 8-Bit Register this level's reward list introduces. */
function savingBytesReference(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'const_off', id: 'z', from: [] },
    { kind: 'part', def: 'reg8', id: 'r', from: ['d', 'load', 'z'] },
    { kind: 'output', width: 8, from: 'r' },
  ]);
}

/** Level 37's reference: the 256-byte RAM, which is the whole little box. */
function littleBoxReference(): Graph {
  return build([
    { kind: 'input', name: 'd', width: 8 },
    { kind: 'input', name: 'addr', width: 8 },
    { kind: 'input', name: 'load' },
    { kind: 'part', def: 'ram8', id: 'm', from: ['d', 'addr', 'load'] },
    { kind: 'output', width: 8, from: 'm' },
  ]);
}

/**
 * Level 38's reference: the register plus a hand-built incrementer.
 *
 * `bit0 = NOT x0`, `bit_i = x_i XOR c_i`, `c_(i+1) = x_i AND c_i` with `c_1 = x0`;
 * the last carry is never needed because there is no carry-out pin. That is one
 * NOT, seven XORs and six ANDs -- measured 41 NAND equivalents on a path seven
 * components deep -- wired into the register's `d`, with `en` on `load` and the
 * level's `reset` on `reset` (so `reset` beats `en` by the register's own rule,
 * with no extra gate).
 */
function counterReference(): Graph {
  const nodes: Node[] = [
    { kind: 'input', name: 'en' },
    { kind: 'input', name: 'reset' },
    { kind: 'part', def: 'reg8', id: 'r', from: ['mk', 'en', 'reset'] },
    { kind: 'part', def: 'splitter', id: 'sp', from: ['r'] },
    { kind: 'part', def: 'not', id: 'b0', from: ['sp.b0'] },
  ];
  const outBits = ['b0'];
  let carry = 'sp.b0';
  for (let bit = 1; bit < 8; bit += 1) {
    nodes.push({ kind: 'part', def: 'xor', id: `b${bit}`, from: [`sp.b${bit}`, carry] });
    outBits.push(`b${bit}`);
    if (bit < 7) {
      nodes.push({ kind: 'part', def: 'and', id: `c${bit}`, from: [`sp.b${bit}`, carry] });
      carry = `c${bit}`;
    }
  }
  nodes.push({ kind: 'part', def: 'maker', id: 'mk', from: outBits });
  nodes.push({ kind: 'output', width: 8, from: 'r' });
  return build(nodes);
}

export const CH2_BATCH4_REFERENCES: Record<string, () => Graph> = {
  'ch2-28-circular-dependency': circularDependencyReference,
  'ch2-29-delayed-lines': delayedLinesReference,
  'ch2-30-odd-ticks': oddTicksReference,
  'ch2-31-bit-inverter': bitInverterReference,
  'ch2-32-bit-switch': bitSwitchReference,
  'ch2-33-input-selector': selectorReference,
  'ch2-34-the-bus': selectorReference,
  'ch2-35-saving-gracefully': savingGracefullyReference,
  'ch2-36-saving-bytes': savingBytesReference,
  'ch2-37-little-box': littleBoxReference,
  'ch2-38-counter': counterReference,
};

// ---------------------------------------------------------------------------
// The whole chapter
// ---------------------------------------------------------------------------

/**
 * All 26 chapter-2 references, levels 13-38 in order.
 *
 * Order is not decorative: `test/levels/level-buildability.test.ts` walks this
 * map's keys against `LEVEL_ORDER`, so a missing level here is a hole in that
 * walk rather than a silent pass.
 */
export const CH2_REFERENCES: Record<string, () => Graph> = {
  ...CH2_BATCH1_REFERENCES,
  ...CH2_BATCH2_REFERENCES,
  ...CH2_BATCH3_REFERENCES,
  ...CH2_BATCH4_REFERENCES,
};
