import type { ComponentDef } from '../registry';
import { WIDE_DEF_IDS, createWideDefs } from './wide';

const gate = (
  id: string,
  zh: string,
  en: string,
  inputs: number,
  /** Expected output per input pattern; the index IS the input vector. */
  table: readonly number[],
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
    cost: 1,
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
 * Every def id the game ships: phase 0's one-bit parts, then the wide family.
 *
 * The wide ids are not repeated here -- `wide.ts` owns them next to the defs
 * they name, and `test/core/defs-wide.test.ts` pins that the two lists agree, so
 * a wide def can never be registered under an id that level data cannot spell.
 */
export const DEF_IDS = [...PHASE0_DEF_IDS, ...WIDE_DEF_IDS] as const;

export type DefId = (typeof DEF_IDS)[number];

export const BASE_DEFS: readonly ComponentDef[] = [
  source('const_on', '高电平', 'Constant On', 1),
  source('const_off', '低电平', 'Constant Off', 0),

  // Truth tables are written out in full. The index is the input vector with
  // input `a` as bit 0, so index 0b10 means a=0, b=1. Writing them out makes
  // every gate auditable at a glance instead of requiring the reader to
  // evaluate a boolean expression in their head.
  gate('nand', '与非门', 'NAND', 2, [1, 1, 1, 0]),
  gate('not', '非门', 'NOT', 1, [1, 0]),
  gate('and', '与门', 'AND', 2, [0, 0, 0, 1]),
  gate('or', '或门', 'OR', 2, [0, 1, 1, 1]),
  gate('nor', '或非门', 'NOR', 2, [1, 0, 0, 0]),
  gate('xor', '异或门', 'XOR', 2, [0, 1, 1, 0]),
  gate('xnor', '同或门', 'XNOR', 2, [1, 0, 0, 1]),
  gate('and3', '三路与门', '3-Pin AND', 3, [0, 0, 0, 0, 0, 0, 0, 1]),
  gate('or3', '三路或门', '3-Pin OR', 3, [0, 1, 1, 1, 1, 1, 1, 1]),

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
  ...createWideDefs(),
];
