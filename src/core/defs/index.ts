import type { ComponentDef } from '../registry';

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

export const DEF_IDS = [
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

  // Storage elements. Their output is the value the kernel publishes from the
  // instance's private `state` before every settle -- not a function of the
  // current inputs. `Simulation.settle()` skips every `sequential` def and
  // `Simulation.tick()` calls `clockEdge` with a throwaway output array, so the
  // two functions below are unreachable in the simulator; they exist so a def
  // still behaves coherently when it is driven directly (as the unit tests do).
  {
    id: 'delay_line',
    name: { zh: '延迟线', en: 'Delay Line' },
    category: 'memory1',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (i, o) => {
      // Stand-alone re-publish of the freshly sampled value. The edge below may
      // have sampled a different value since the last settle, so this mirrors
      // the current input rather than reading `state`, which `evaluate` has no
      // access to. Never reached through the kernel.
      o[0] = i[0] === 1 ? 1 : 0;
    },
    clockEdge: (i, _o, state) => {
      // Sample, and nothing else: the output must keep the pre-edge value until
      // the kernel publishes the new state.
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
    evaluate: () => {
      // Hold: the kernel publishes `state[0]` into output slot 0. Never reached
      // through the kernel.
    },
    clockEdge: (i, o, state) => {
      if (i[0] === 1) state[0] = i[1] === 1 ? 1 : 0;
      // Mirror the held value so the def is self-consistent when driven
      // stand-alone. The kernel ignores this `o` (it re-publishes `state`).
      o[0] = state[0] === 1 ? 1 : 0;
    },
  },
];
