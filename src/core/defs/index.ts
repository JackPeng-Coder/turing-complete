import type { ComponentDef } from '../registry';
import { WIDE_DEF_IDS, WIDE_STORAGE_DEFS, WIDE_STORAGE_DEF_IDS, createWideDefs } from './wide';

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
 * Every def id the game ships: phase 0's one-bit parts, then the wide family --
 * the operators, then the storage parts.
 *
 * The wide ids are not repeated here -- `wide.ts` owns them next to the defs
 * they name, and `test/core/defs-wide.test.ts` pins that each list agrees with
 * the defs it registers, so a wide def can never be registered under an id that
 * level data cannot spell.
 */
export const DEF_IDS = [
  ...PHASE0_DEF_IDS,
  ...WIDE_DEF_IDS,
  ...WIDE_STORAGE_DEF_IDS,
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
];
