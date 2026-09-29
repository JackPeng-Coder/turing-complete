import type { ComponentDef } from '../registry';
import { CPU_DEFS, CPU_DEF_IDS } from './cpu';
import {
  DECODER_DEFS,
  DECODER_DEF_IDS,
  FULL_ADDER,
  WIDE_DEF_IDS,
  WIDE_STORAGE_DEFS,
  WIDE_STORAGE_DEF_IDS,
  createWideDefs,
} from './wide';

// ---------------------------------------------------------------------------
// GATE COST: the 1-bit NAND-equivalent basis, the same one `wide.ts` prices its
// bit-sliced cells against.
//
// The unit is one 2-input NAND (spec §5.4: 展开时每个基础门的贡献 = 1). `cost`
// is the DELAY unit and stays 1 for every gate below; `gateCost` is how many
// 2-input NANDs the gate expands to in a standard all-NAND construction:
//
//   gate | NANDs | construction
//   -----|-------|------------------------------------------------------------
//   NAND |   1   | the unit
//   NOT  |   1   | NAND(a, a)
//   AND  |   2   | NAND(a, b) -> NOT
//   OR   |   3   | NOT a, NOT b, NAND(~a, ~b)                 [De Morgan]
//   NOR  |   4   | NOT(or) = OR's three NANDs plus one inverter
//   XOR  |   4   | the classic four-NAND cell
//   XNOR |   5   | XOR -> NOT
//   AND3 |   4   | AND(a, b) (2), then AND(ab, c) (2). Three cannot do it: the
//        |       | third NAND would invert a product of two signals already in
//        |       | hand, and no such product is ~(abc).
//   OR3  |   6   | NOT a, NOT b, NOT c, then a 3-input NAND (itself 3) = 6. The
//        |       | cascade or(or(a, b), c) is also 3 + 3 = 6.
//
// The tenth 1-bit gate, `full_adder`, is the largest cell on this basis:
// FULL_ADDER = 9, and `wide.ts` prices `add8` as eight of it (8 x 9 = 72). Its
// construction is written out at the def below, and the count is that file's
// exported `FULL_ADDER` constant rather than a second literal.
//
// These are documented constructions, not proven minima -- AND3 is the one with
// a minimality argument, sketched above. `cost` and `gateCost` coincide only for
// NAND and NOT, and every gate below therefore states BOTH: an `and` worth a
// single NAND equivalent was the bug this table fixes, since one bit of `and8`
// is worth 2 on the very same basis.
// ---------------------------------------------------------------------------
const NAND = 1;
const NOT = 1;
const AND = 2;
const OR = 3;
const XOR = 4;

const gate = (
  id: string,
  zh: string,
  en: string,
  inputs: number,
  /** Expected output per input pattern; the index IS the input vector. */
  table: readonly number[],
  /** NAND equivalents: 2-input NANDs in this gate's standard all-NAND cell. */
  gateCost: number,
): ComponentDef => {
  if (table.length !== 1 << inputs) {
    throw new Error(`${id}: expected ${1 << inputs} truth-table entries, got ${table.length}`);
  }
  return {
    id,
    name: { zh, en },
    category: 'logic1',
    inputs: Array.from({ length: inputs }, (_, i) => ({
      id: String.fromCharCode(97 + i),
      width: 1,
    })),
    outputs: [{ id: 'out', width: 1 }],
    // The DELAY unit, one per node (spec §3.2). The gate metric does not read
    // this -- it reads `gateCost`, whose numbers are in the table above and at
    // each call site below.
    cost: 1,
    gateCost,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      let index = 0;
      for (let p = 0; p < inputs; p += 1) index |= (i[p] === 1 ? 1 : 0) << p;
      o[0] = table[index] === 1 ? 1 : 0;
    },
  };
};

/**
 * `full_adder`: `sum = a XOR b XOR cin`, and `cout` is the majority of `a`, `b`
 * and `cin` -- high when at least two of the three are high. This is the
 * standard 1-bit full adder: the part level 20 hands out, the puzzle level 21
 * builds by hand, and the cell level 22 cascades eight of into a byte adder
 * (carry out of one stage into `cin` of the next).
 *
 * NOT BUILT WITH `gate()`. That helper produces exactly one output pin named
 * `out` from a single-output table, and this part has two named outputs the
 * level data addresses by name (`sum`, `cout`); the input count and the
 * normalisation of a pin value to 0 or 1 are the same either way.
 *
 * THE CELL, IN 2-INPUT NANDs -- 9 of them:
 *
 *   x1 = NAND(a, b)        x2 = NAND(a, x1)      x3 = NAND(b, x1)
 *   s1 = NAND(x2, x3)      = a XOR b
 *   s2 = NAND(s1, cin)     s3 = NAND(s1, s2)     s4 = NAND(cin, s2)
 *   sum = NAND(s3, s4)     = s1 XOR cin
 *   cout = NAND(x1, s2)    = ab + cin(a XOR b)
 *
 * Two four-NAND XORs (x2/x3/s1 and s2/s3/s4/sum) make eight, and the carry is
 * the ninth: `cout` reuses `x1` and `s2` -- the products already in hand --
 * instead of rebuilding them, which is what makes it `NAND(x1, s2)` rather than
 * a tenth gate. That reuse is the whole reason the count is the 9 that `add8` is
 * eight of.
 *
 * `gateCost` is `FULL_ADDER` imported from `wide.ts`, not a second literal 9:
 * the registered gate and the bit `add8` is built from are one construction, and
 * two literals for one construction is how the gate metric drifts. The delay
 * unit is 1 either way -- a 1-bit part is one node on the longest path, whatever
 * it expands to.
 */
const fullAdder: ComponentDef = {
  id: 'full_adder',
  name: { zh: '全加器', en: 'Full Adder' },
  category: 'logic1',
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
    { id: 'cin', width: 1 },
  ],
  outputs: [
    { id: 'sum', width: 1 },
    { id: 'cout', width: 1 },
  ],
  cost: 1,
  gateCost: FULL_ADDER,
  sequential: false,
  stateBytes: 0,
  evaluate: (i, o) => {
    const a = i[0] === 1 ? 1 : 0;
    const b = i[1] === 1 ? 1 : 0;
    const cin = i[2] === 1 ? 1 : 0;
    o[0] = a ^ b ^ cin;
    o[1] = a + b + cin >= 2 ? 1 : 0;
  },
};

// Constant sources carry `category: 'io'`, not `'logic1'`: they have no inputs and
// simply drive a level, so they do not belong with the gates. The registry test
// pins this down by asserting that `byCategory('logic1')` does not contain
// `const_on`. Nothing downstream groups the palette by category (the level's
// `allowedComponents` decides that), so this only affects the grouping label.
//
// 0 on BOTH metrics -- a rail is not a gate -- so this is one of the defs that
// legitimately leaves `gateCost` to the `?? cost` fallback.
const source = (id: string, zh: string, en: string, value: 0 | 1): ComponentDef => ({
  id,
  name: { zh, en },
  category: 'io',
  inputs: [],
  outputs: [{ id: 'out', width: 1 }],
  cost: 0,
  sequential: false,
  stateBytes: 0,
  evaluate: (_i, o) => {
    o[0] = value;
  },
});

const PHASE0_DEF_IDS = [
  'const_on',
  'const_off',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'delay_line',
  'mem1',
  'level_input',
  'level_output',
] as const;

/**
 * One-bit gates added after phase 0, in registration order.
 *
 * `full_adder` is a `logic1` gate exactly like the parts above -- pin-for-pin
 * one bit, priced on the same NAND basis -- but it is chapter 2's part (level
 * 20's reward), not something phase 0 shipped, so it is not spelled inside
 * `PHASE0_DEF_IDS`, whose name and order describe that set.
 */
const POST_PHASE0_DEF_IDS = ['full_adder'] as const;

/**
 * Every def id the game ships: phase 0's one-bit parts, the one-bit gate added
 * since, then the wide family -- the operators, the storage parts, and the
 * decoders -- and last the CPU family chapter 3 rewards.
 *
 * The wide ids are not repeated here -- `wide.ts` owns them next to the defs
 * they name, and `test/core/defs-wide.test.ts` pins that each list agrees with
 * the defs it registers, so a wide def can never be registered under an id that
 * level data cannot spell. The CPU ids follow the same rule with `cpu.ts` as
 * their owner, and `test/core/defs-cpu.test.ts` as their pin.
 */
export const DEF_IDS = [
  ...PHASE0_DEF_IDS,
  ...POST_PHASE0_DEF_IDS,
  ...WIDE_DEF_IDS,
  ...WIDE_STORAGE_DEF_IDS,
  ...DECODER_DEF_IDS,
  ...CPU_DEF_IDS,
] as const;

export type DefId = (typeof DEF_IDS)[number];

export const BASE_DEFS: readonly ComponentDef[] = [
  source('const_on', '高电平', 'Constant On', 1),
  source('const_off', '低电平', 'Constant Off', 0),

  // Truth tables are written out in full. The index is the input vector with
  // input `a` as bit 0, so index 0b10 means a=0, b=1. Writing them out makes
  // every gate auditable at a glance instead of requiring the reader to
  // evaluate a boolean expression in their head.
  //
  // The last argument is the gate metric (NAND equivalents, per the table
  // above); the comment on each line is that number's construction, so no count
  // here has to be taken on trust.
  gate('nand', '与非门', 'NAND', 2, [1, 1, 1, 0], NAND),
  gate('not', '非门', 'NOT', 1, [1, 0], NOT), // NAND(a, a)
  gate('and', '与门', 'AND', 2, [0, 0, 0, 1], AND), // NAND(a, b) -> NOT
  gate('or', '或门', 'OR', 2, [0, 1, 1, 1], OR), // NOT a, NOT b, NAND(~a, ~b)
  gate('nor', '或非门', 'NOR', 2, [1, 0, 0, 0], OR + NOT), // NOT(or)
  gate('xor', '异或门', 'XOR', 2, [0, 1, 1, 0], XOR), // the four-NAND cell
  gate('xnor', '同或门', 'XNOR', 2, [1, 0, 0, 1], XOR + NOT), // NOT(xor)
  // Two ANDs: AND(a, b) then AND(ab, c). AND3 is minimal at 4 (see the table).
  gate('and3', '三路与门', '3-Pin AND', 3, [0, 0, 0, 0, 0, 0, 0, 1], 2 * AND),
  // NOT a, NOT b, NOT c, then a 3-input NAND; the OR cascade also totals 6.
  gate('or3', '三路或门', '3-Pin OR', 3, [0, 1, 1, 1, 1, 1, 1, 1], 2 * OR),
  // Two named outputs, so this one is written out rather than built by `gate()`;
  // its 9-NAND cell and that count's construction are at the def.
  fullAdder,

  // Level IO plumbing. Always available in the palette; never unlocked.
  {
    id: 'level_input',
    name: { zh: '关卡输入', en: 'Level Input' },
    category: 'level',
    inputs: [],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: () => {
      // Driven directly by the level checker through the signal table.
    },
    hidden: true,
  },
  {
    id: 'level_output',
    name: { zh: '关卡输出', en: 'Level Output' },
    category: 'level',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'mirror', width: 1 }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      o[0] = i[0] ?? 0;
    },
    hidden: true,
  },

  // Storage elements. `evaluate` publishes the value held in `state` and must
  // never read its inputs; `clockEdge` samples the inputs into `state` and must
  // never write outputs. The kernel publishes state at `reset()` / `tick()`,
  // and every other settle pass goes through the generic `evaluate` path -- so
  // a delay line holds its value for a full tick instead of becoming a wire.
  {
    id: 'delay_line',
    name: { zh: '延迟线', en: 'Delay Line' },
    category: 'memory1',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // Publish the held value. NOTE: this must NOT read `i` -- a delay line
      // that mirrors its input is just a wire.
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      // Sample, and nothing else: the output keeps the pre-edge value until the
      // state is published.
      state[0] = i[0] === 1 ? 1 : 0;
    },
  },

  {
    id: 'mem1',
    name: { zh: '1 位存储器', en: '1-Bit Memory' },
    category: 'memory1',
    inputs: [
      { id: 'set', width: 1 },
      { id: 'value', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, state) => {
      // Hold: publish the stored bit and ignore both inputs.
      o[0] = state?.[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      if (i[0] === 1) state[0] = i[1] === 1 ? 1 : 0;
    },
  },

  // The wide (8-bit) family. Registered at the default width -- 8 is the only
  // width this phase opens; `createWideDefs(width)` is the hook for 16/32/64.
  //
  // The same NAND basis as the gates above, scaled by the width: `and8` is 8 x
  // AND = 16, `add8` is 8 full adders = 72. The constructions live next to each
  // def in `wide.ts`, and `test/core/defs-wide.test.ts` cross-checks its
  // per-bit cells against these 1-bit gates, so the two tables cannot drift
  // into two different bases.
  ...createWideDefs(),

  // The 8-bit storage family (task 4): a byte mux, a byte delay, a register, a
  // counter and a 256-byte RAM. Registered from a literal list rather than a
  // width generator -- a 32-bit RAM would be 4 GiB of state per instance; see
  // the section note in `wide.ts`.
  //
  // Every one of them publishes what it holds through its own `evaluate`, the
  // same call the settle sweep makes, which is what lets the kernel publish an
  // eight-bit register correctly (see `Simulation.#publishState`). They are free
  // on BOTH metrics, like the two 1-bit memories above: an asserted clear beats
  // an asserted load/en, and the counter wraps to 0 at 256.
  ...WIDE_STORAGE_DEFS,

  // The decoder family (task 10): `decoder1` (`sel:1 -> out:2`) and `decoder3`
  // (`sel:3 -> out:8`) are what chapter-2 levels 25 and 26 reward and offer in
  // their own palettes; `decoder2` is the same generator at width 2. Registered
  // at the widths their ids name rather than at the family's default width,
  // because a decoder's `out` pin is `2 ** w` bits -- the ids say which part they
  // are, and `createDecoderDef(w)` builds one. Their paper trail is in `wide.ts`:
  // the generator, the one-hot contract, and the minterm tree that prices them
  // (1 / 10 / 27 NAND equivalents at w = 1 / 2 / 3).
  ...DECODER_DEFS,

  // The CPU family (phase 2, task 2): the six parts chapter 3 rewards and level
  // 47 builds OVERTURE out of -- `alu8`, `regfile6`, `instr_decoder`, `pc8`,
  // `ram_prog`, `halt`. Registered from `cpu.ts`'s own literal id list for the
  // same reason the storage and decoder families are: no width parameter could
  // generate them, so the list lives next to the defs it names and
  // `test/core/defs-cpu.test.ts` pins the two against each other. They carry
  // `category: 'cpu'`, a family of their own -- `logic1`, `wide` and `level` are
  // each pinned exactly by tests to the family they name, and none of these six
  // is in it. `cpu.ts`'s header states the price of every one of them, and that
  // they are PARTS rather than a CPU (Global Constraint 11).
  ...CPU_DEFS,
];
