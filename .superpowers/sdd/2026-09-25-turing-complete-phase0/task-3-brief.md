## Task 3: 组件定义与注册表（core/registry.ts、core/defs/index.ts）

**Files:**
- Create: `src/core/registry.ts`, `src/core/defs/index.ts`, `src/core/fields.ts`
- Test: `test/core/registry.test.ts`

**Interfaces:**
- Consumes: `src/core/signal.ts` 的 `PortValue`
- Produces:
  - `interface PinDef { readonly id: string; readonly width: number; readonly label?: { zh: string; en: string } }`
  - `interface EvalContext { readonly tick: number }`
  - `interface ComponentDef { readonly id: string; readonly name: { zh: string; en: string }; readonly category: ComponentCategory; readonly inputs: readonly PinDef[]; readonly outputs: readonly PinDef[]; readonly cost: number; readonly sequential: boolean; readonly evaluate?: (i: readonly PortValue[], o: PortValue[], ctx: EvalContext) => void; readonly clockEdge?: (i: readonly PortValue[], o: PortValue[], s: Uint8Array, ctx: EvalContext) => void; readonly stateBytes: number; readonly hidden?: boolean }`
  - `type ComponentCategory = 'logic1' | 'memory1' | 'wide' | 'io' | 'display' | 'probe' | 'level'`
  - `interface Registry { get(id: string): ComponentDef; has(id: string): boolean; all(): readonly ComponentDef[]; byCategory(c: ComponentCategory): readonly ComponentDef[]; register(def: ComponentDef): void; readonly size: number }`
  - `function createRegistry(defs?: readonly ComponentDef[]): Registry`
  - `function packBits(bits: readonly Bit[]): number` — `bits[0]` 是最低位
  - `function unpackBits(value: number, count: number): Bit[]`
  - `function extractField(value: number, offset: number, width: number): number`
  - `function insertField(value: number, offset: number, width: number, field: number): number`
  - `const BASE_DEFS: readonly ComponentDef[]`

- [ ] **Step 1: 写失败测试 `test/core/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import { extractField, insertField, packBits, unpackBits } from '../../src/core/fields';

describe('registry', () => {
  it('registers every base def and can look them up', () => {
    const r = createRegistry(BASE_DEFS);
    expect(r.size).toBe(BASE_DEFS.length);
    for (const id of DEF_IDS) expect(r.has(id)).toBe(true);
    expect(r.get('nand').name.zh).toBe('与非门');
  });

  it('throws on unknown component ids', () => {
    const r = createRegistry(BASE_DEFS);
    expect(() => r.get('does-not-exist')).toThrow(/unknown component/i);
  });

  it('rejects duplicate ids', () => {
    const r = createRegistry([]);
    r.register(BASE_DEFS[0]!);
    expect(() => r.register(BASE_DEFS[0]!)).toThrow(/duplicate/i);
  });

  it('filters by category', () => {
    const r = createRegistry(BASE_DEFS);
    const logic = r.byCategory('logic1').map((d) => d.id);
    expect(logic).toContain('nand');
    expect(logic).toContain('xor');
    expect(logic).not.toContain('const_on');
  });
});

describe('base defs', () => {
  const r = createRegistry(BASE_DEFS);

  it('marks exactly the storage elements as sequential', () => {
    const sequential = r.all().filter((d) => d.sequential).map((d) => d.id);
    expect(sequential.sort()).toEqual(['delay_line', 'mem1']);
  });

  it('hides the level IO plumbing from the palette but keeps it registered', () => {
    const plumbing = r.all().filter((d) => d.category === 'level');
    expect(plumbing.map((d) => d.id).sort()).toEqual(['level_input', 'level_output']);
    expect(plumbing.every((d) => d.hidden === true)).toBe(true);
    expect(r.get('level_input').cost).toBe(0);
    expect(r.get('level_output').cost).toBe(0);
  });

  it('gives every def at least one output and no duplicate pin ids', () => {
    for (const d of r.all()) {
      expect(d.outputs.length, d.id).toBeGreaterThan(0);
      const ids = [...d.inputs, ...d.outputs].map((p) => p.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
    }
  });

  it('marks sources as zero cost and gates as one', () => {
    expect(r.get('const_on').cost).toBe(0);
    expect(r.get('const_off').cost).toBe(0);
    for (const id of ['nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor', 'and3', 'or3']) {
      expect(r.get(id).cost, id).toBe(1);
    }
  });

  it('evaluates NAND', () => {
    const def = r.get('nand');
    for (const [a, b, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      const out: (number | Uint8Array)[] = [0];
      def.evaluate!([a, b], out, { tick: 0 });
      expect(out[0], `nand(${a},${b})`).toBe(want);
    }
  });

  it('evaluates the 3-input gates', () => {
    const and3 = r.get('and3');
    const or3 = r.get('or3');
    const o1: (number | Uint8Array)[] = [0];
    and3.evaluate!([1, 1, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(1);
    and3.evaluate!([1, 0, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(0);
    or3.evaluate!([0, 0, 1], o1, { tick: 0 });
    expect(o1[0]).toBe(1);
    or3.evaluate!([0, 0, 0], o1, { tick: 0 });
    expect(o1[0]).toBe(0);
  });

  it('evaluates XOR and XNOR', () => {
    const xor = r.get('xor');
    const xnor = r.get('xnor');
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const ox: (number | Uint8Array)[] = [0];
      xor.evaluate!([a, b], ox, { tick: 0 });
      expect(ox[0], `xor(${a},${b})`).toBe(a ^ b);
      const on: (number | Uint8Array)[] = [0];
      xnor.evaluate!([a, b], on, { tick: 0 });
      expect(on[0], `xnor(${a},${b})`).toBe(a ^ b ? 0 : 1);
    }
  });

  it('propagates undefined inputs as zero', () => {
    const nand = r.get('nand');
    const out: (number | Uint8Array)[] = [0];
    nand.evaluate!([0, undefined as unknown as number], out, { tick: 0 });
    expect(out[0]).toBe(1);
  });

  it('delay_line samples its input on the clock edge, starting at 0', () => {
    const def = r.get('delay_line');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    out[0] = 0;
    def.clockEdge!([1], out, state, { tick: 0 });
    expect(state[0]).toBe(1);
    expect(out[0]).toBe(0); // output still holds the pre-edge value
    def.evaluate!([1], out, { tick: 0 });
    expect(out[0]).toBe(1);
  });

  it('mem1 holds its value until write is asserted on a clock edge', () => {
    const def = r.get('mem1');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    // inputs: [set, value]
    def.clockEdge!([0, 1], out, state, { tick: 0 });
    expect(state[0]).toBe(0);
    def.clockEdge!([1, 1], out, state, { tick: 1 });
    expect(state[0]).toBe(1);
    def.evaluate!([0, 0], out, { tick: 1 });
    expect(out[0]).toBe(1);
  });
});

describe('fields', () => {
  it('packs bit arrays low-bit-first', () => {
    expect(packBits([1, 0, 1])).toBe(0b101);
    expect(packBits([])).toBe(0);
    expect(packBits([1, 1, 1, 1, 1, 1, 1, 1])).toBe(255);
  });

  it('unpacks to bit arrays', () => {
    expect(unpackBits(0b101, 3)).toEqual([1, 0, 1]);
    expect(unpackBits(0, 2)).toEqual([0, 0]);
  });

  it('extracts and inserts fields', () => {
    const instr = 0b11_000101; // opcode 0b11, arg 5
    expect(extractField(instr, 0, 6)).toBe(5);
    expect(extractField(instr, 6, 2)).toBe(3);
    const withNewArg = insertField(instr, 0, 6, 63);
    expect(extractField(withNewArg, 0, 6)).toBe(63);
    expect(extractField(withNewArg, 6, 2)).toBe(3);
  });

  it('rejects out-of-range inserts', () => {
    expect(() => insertField(0, 0, 2, 4)).toThrow(/range/i);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/registry.test.ts`
Expected: FAIL — 无法解析 `../../src/core/registry`

- [ ] **Step 3: 实现 `src/core/registry.ts`**

```ts
import type { PortValue } from './signal';

export type ComponentCategory =
  | 'logic1'
  | 'memory1'
  | 'wide'
  | 'io'
  | 'display'
  | 'probe'
  | 'level';

export interface PinDef {
  readonly id: string;
  readonly width: number;
  readonly label?: { zh: string; en: string };
}

export interface EvalContext {
  readonly tick: number;
}

export interface ComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly category: ComponentCategory;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /** Gate cost when the circuit is expanded. Sources cost 0, gates cost 1. */
  readonly cost: number;
  /** Storage elements sample on the clock edge and do not add combinational delay. */
  readonly sequential: boolean;
  /** Combinational transfer function. Must be pure: reads inputs, writes outputs. */
  readonly evaluate?: (inputs: readonly PortValue[], outputs: PortValue[], ctx: EvalContext) => void;
  /** Storage update, applied at the clock edge from pre-edge inputs. */
  readonly clockEdge?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array,
    ctx: EvalContext,
  ) => void;
  /** Bytes of private state per instance. 0 for pure combinational defs. */
  readonly stateBytes: number;
  /** Hidden from the palette (used by level plumbing). */
  readonly hidden?: boolean;
}

export interface Registry {
  readonly size: number;
  get(id: string): ComponentDef;
  has(id: string): boolean;
  all(): readonly ComponentDef[];
  byCategory(category: ComponentCategory): readonly ComponentDef[];
  register(def: ComponentDef): void;
}

export function createRegistry(defs: readonly ComponentDef[] = []): Registry {
  const map = new Map<string, ComponentDef>();
  const registry: Registry = {
    get size() {
      return map.size;
    },
    get(id: string): ComponentDef {
      const def = map.get(id);
      if (!def) throw new Error(`unknown component: ${id}`);
      return def;
    },
    has: (id: string) => map.has(id),
    all: () => [...map.values()],
    byCategory: (category) => [...map.values()].filter((d) => d.category === category),
    register(def: ComponentDef): void {
      if (map.has(def.id)) throw new Error(`duplicate component id: ${def.id}`);
      map.set(def.id, def);
    },
  };
  for (const def of defs) registry.register(def);
  return registry;
}
```

- [ ] **Step 4: 实现 `src/core/fields.ts`**

```ts
import type { Bit } from './signal';

/** Packs bits low-bit-first: bits[0] becomes bit 0 of the result. */
export function packBits(bits: readonly Bit[]): number {
  let out = 0;
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) out |= 1 << i;
  return out >>> 0;
}

export function unpackBits(value: number, count: number): Bit[] {
  const out: Bit[] = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = ((value >>> i) & 1) as Bit;
  return out;
}

export function extractField(value: number, offset: number, width: number): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  return (value >>> offset) & mask;
}

export function insertField(
  value: number,
  offset: number,
  width: number,
  field: number,
): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  if (field < 0 || field > mask) {
    throw new RangeError(`field ${field} out of range for width ${width}`);
  }
  const cleared = value & ~(mask << offset);
  return (cleared | (field << offset)) >>> 0;
}
```

- [ ] **Step 5: 实现 `src/core/defs/index.ts`**

```ts
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

const source = (id: string, zh: string, en: string, value: 0 | 1): ComponentDef => ({
  id,
  name: { zh, en },
  category: 'logic1',
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

  {
    id: 'delay_line',
    name: { zh: '延迟线', en: 'Delay Line' },
    category: 'memory1',
    inputs: [{ id: 'in', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    cost: 0,
    sequential: true,
    stateBytes: 1,
    evaluate: (_i, o, _ctx) => {
      // The held value is published by the kernel before settle(); eval keeps
      // the output stable by reading what the kernel already wrote.
    },
    clockEdge: (i, _o, state) => {
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
      // published by the kernel from private state
    },
    clockEdge: (i, _o, state) => {
      if (i[0] === 1) state[0] = i[1] === 1 ? 1 : 0;
    },
  },
];
```

> `delay_line` 与 `mem1` 的输出在 `settle()` 期间由内核从 `state` 发布（见 Task 5）。它们的 `evaluate` 是空操作，这是刻意的：输出只由状态决定，不由当前输入组合决定。

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm test test/core/registry.test.ts`
Expected: PASS — 14 passed

- [ ] **Step 7: 提交**

```bash
git add src/core/registry.ts src/core/fields.ts src/core/defs/index.ts test/core/registry.test.ts
git commit -m "feat(core): add component registry, base defs and bit fields"
```

---

