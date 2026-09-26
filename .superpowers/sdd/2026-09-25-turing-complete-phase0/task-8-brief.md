## Task 8: 第 1 章第 1–6 关内容与参考解

**Files:**
- Create: `src/levels/tables.ts`, `src/levels/content/ch1/part1.ts`, `src/levels/content/index.ts`
- Modify: `src/levels/index.ts`（导出 `LEVEL_ORDER`、`LEVELS`、`getLevel`）
- Test: `test/levels/ch1-part1.test.ts`

**Interfaces:**
- Consumes: `LevelSpec`、`grade`、`Registry`
- Produces:
  - `src/levels/tables.ts`：`function truthTable(expected: Record<string, (inputs: Record<string, number>) => number>): TruthTableCheck`
  - `const CH1_PART1: readonly LevelSpec[]`（第 1–6 关，顺序即 `index` 1..6）
  - `src/levels/index.ts`：`export const LEVELS: readonly LevelSpec[]`、`export const LEVEL_ORDER: readonly string[]`、`export function getLevel(id: string): LevelSpec`

> **为什么关卡数据里的真值表要显式写出来**：Task 6 已经把「没有 rows 的 truth-table」定为硬错误。让每个关卡用 `truthTable()` 生成完整的行，关卡文件就成了可读的规格说明——你会直接看到 AND 的四行，而不是「某个函数大概算对了」。这是本计划里唯一一处冗长换取可审查性的取舍，值得。

- [ ] **Step 1: 写 `src/levels/tables.ts`**

```ts
import type { PinSpec, TruthRow, TruthTableCheck } from './spec';

export interface LevelIo {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

function enumerateInputs(io: LevelIo): Array<Record<string, number>> {
  const bits = io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  for (let n = 0; n < 2 ** bits; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of io.inputs) {
      row[pin.id] = (n >>> offset) & ((1 << pin.width) - 1);
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds a complete truth table from one function per output pin.
 * Throws if a declared output pin has no function, so a typo cannot silently
 * produce a table that never checks that pin.
 */
export function truthTable(
  io: LevelIo,
  expected: Readonly<Record<string, (inputs: Record<string, number>) => number>>,
): TruthTableCheck {
  for (const pin of io.outputs) {
    if (typeof expected[pin.id] !== 'function') {
      throw new Error(`truthTable: no expectation given for output pin "${pin.id}"`);
    }
  }
  for (const key of Object.keys(expected)) {
    if (!io.outputs.some((pin) => pin.id === key)) {
      throw new Error(`truthTable: "${key}" is not an output pin of this level`);
    }
  }
  const rows: TruthRow[] = enumerateInputs(io).map((inputs) => {
    const outputs: Record<string, number> = {};
    for (const pin of io.outputs) {
      outputs[pin.id] = expected[pin.id]!(inputs) & ((1 << pin.width) - 1);
    }
    return { inputs, outputs };
  });
  return { kind: 'truth-table', rows };
}
```

> `truthTable` 需要 `io`，而 `io` 又写在关卡里，所以调用点是 `checks: [truthTable(IO, { out: ... })]`：先把该关的 `io` 提成一个 `const IO`，再复用。下面每个关卡都按这个写法。

- [ ] **Step 2: 写 `src/levels/content/ch1/part1.ts`**

```ts
import { truthTable } from '../../tables';
import type { LevelSpec } from '../../spec';

/**
 * Chapter 1, levels 1-6.
 *
 * Ordering note: the source material lists NOR (5) before OR (6), but NOR's
 * standard solutions need OR, or they need NOT+NAND which arrives even later.
 * To keep the "a level only uses already-unlocked parts" rule absolute, OR and
 * NOR are swapped here. All text is original.
 */
const IO_1 = { inputs: [], outputs: [{ id: 'out', width: 1 }] };
const IO_2 = {
  inputs: [
    { id: 'a', width: 1 },
    { id: 'b', width: 1 },
  ],
  outputs: [{ id: 'out', width: 1 }],
};
const IO_1IN = { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] };

export const CH1_PART1: readonly LevelSpec[] = [
  {
    id: 'ch1-01-crude-awakening',
    chapter: 1,
    index: 1,
    name: { zh: '原力觉醒', en: 'Crude Awakening' },
    brief: {
      zh: '飞船的舱门认电不认人。给输出一个恒定的高电平，门就会开。',
      en: 'The airlock only understands voltage. Hold the output high and it opens.',
    },
    hint: {
      zh: '调色板里有「高电平」和「关卡输出」，把它们连起来。',
      en: 'The palette has Constant On and Level Output. Wire them together.',
    },
    allowedComponents: ['const_on', 'const_off', 'level_input', 'level_output'],
    io: IO_1,
    checks: [truthTable(IO_1, { out: () => 1 })],
    threeStar: { gate: 0, delay: 0, tick: 0 },
    rewards: { components: ['nand'] },
  },
  {
    id: 'ch1-02-nand-gate',
    chapter: 1,
    index: 2,
    name: { zh: '与非门', en: 'NAND Gate' },
    brief: {
      zh: '监督者给了你一块芯片：只有两个输入同时为高时，输出才是低。它叫与非门。',
      en: 'The Overseer hands you one chip: its output drops low only when both inputs are high.',
    },
    hint: {
      zh: '关卡输入要用「关卡输入」元件接出来，实例名必须是 IN_a 和 IN_b；输出实例名是 OUT。',
      en: 'Drive the level inputs from Level Input parts named IN_a and IN_b; the output is OUT.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['not'] },
  },
  {
    id: 'ch1-03-not-gate',
    chapter: 1,
    index: 3,
    name: { zh: '非门', en: 'NOT Gate' },
    brief: {
      zh: '把输入翻转过来。只有一个输入引脚 a 的时候，与非门会变成什么？',
      en: 'Invert the input. What does a NAND become when it has only one input to look at?',
    },
    hint: {
      zh: '把同一个信号接到与非门的两个输入上。',
      en: 'Feed the same signal into both NAND inputs.',
    },
    allowedComponents: ['nand', 'level_input', 'level_output'],
    io: IO_1IN,
    checks: [truthTable(IO_1IN, { out: ({ a }) => (a ? 0 : 1) })],
    threeStar: { gate: 1, delay: 1, tick: 0 },
    rewards: { components: ['and'] },
  },
  {
    id: 'ch1-04-and-gate',
    chapter: 1,
    index: 4,
    name: { zh: '与门', en: 'AND Gate' },
    brief: {
      zh: '与门就是与非门再翻一次。两个输入都为高时输出才为高。',
      en: 'An AND is a NAND flipped back. High only when both inputs are high.',
    },
    hint: { zh: '与非门的输出接一个非门。', en: 'Put a NOT after the NAND.' },
    allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a && b ? 1 : 0) })],
    threeStar: { gate: 2, delay: 2, tick: 0 },
    rewards: { components: ['or'] },
  },
  {
    id: 'ch1-05-or-gate',
    chapter: 1,
    index: 5,
    name: { zh: '或门', en: 'OR Gate' },
    brief: {
      zh: '任意一个输入为高，输出就为高。德摩根说：先把两个输入都翻过来，再用与非门。',
      en: 'High when either input is high. De Morgan says: invert both inputs, then NAND.',
    },
    hint: { zh: 'NOT(a) NAND NOT(b) 就是 a OR b。', en: 'NOT(a) NAND NOT(b) is exactly a OR b.' },
    allowedComponents: ['nand', 'not', 'and', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 1 : 0) })],
    threeStar: { gate: 3, delay: 2, tick: 0 },
    rewards: { components: ['nor'] },
  },
  {
    id: 'ch1-06-nor-gate',
    chapter: 1,
    index: 6,
    name: { zh: '或非门', en: 'NOR Gate' },
    brief: {
      zh: '或门之后再翻一次。两个输入都为低时输出才为高。',
      en: 'An OR flipped. High only when both inputs are low.',
    },
    hint: { zh: '或门的输出接一个非门。', en: 'Put a NOT after the OR.' },
    allowedComponents: ['nand', 'not', 'and', 'or', 'level_input', 'level_output'],
    io: IO_2,
    checks: [truthTable(IO_2, { out: ({ a, b }) => (a || b ? 0 : 1) })],
    threeStar: { gate: 4, delay: 3, tick: 0 },
    rewards: { components: ['const_on', 'const_off'] },
  },
];
```

- [ ] **Step 2: 写测试夹具 `test/fixtures/build.ts` 与测试 `test/levels/ch1-part1.test.ts`**

`test/fixtures/build.ts`——参考解靠它从一行声明生成电路，避免每个测试手写十几个 `addInstance`：

```ts
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';

export const registry = createRegistry(BASE_DEFS);

export type Node =
  | { readonly kind: 'input'; readonly name: string }
  | { readonly kind: 'part'; readonly def: string; readonly id: string; readonly from: readonly string[] }
  | { readonly kind: 'output'; readonly name?: string; readonly from: string };

/**
 * Builds a circuit from a flat declaration list.
 *
 * `from` entries resolve as: a level input name (`IN_<name>.out`), a part id
 * (`.out`), or an explicit `"partId.pin"`. When a part has more inputs than
 * `from` entries, the last entry is reused -- that is how a NOT gets wired
 * from a single source.
 *
 * Level inputs are instances named `IN_<name>`; level outputs are instances
 * named `OUT` (single output) or `OUT_<name>` (multi-output).
 */
export function build(nodes: readonly Node[]): Graph {
  const g = emptyGraph();
  const inputIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const outputIds = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind === 'input') {
      inputIds.set(node.name, addInstance(g, 'level_input', 0, 0, `IN_${node.name}`).id);
    } else if (node.kind === 'part') {
      partIds.set(node.id, addInstance(g, node.def, 120, 0).id);
    } else {
      const name = node.name ?? 'OUT';
      outputIds.set(name, addInstance(g, 'level_output', 240, 0, name).id);
    }
  }

  const resolve = (ref: string): { inst: string; port: string } => {
    const [head, pin] = ref.split('.') as [string, string?];
    const inputId = inputIds.get(head!);
    if (inputId) return { inst: inputId, port: 'out' };
    const partId = partIds.get(head!);
    if (!partId) throw new Error(`build: unknown reference "${ref}"`);
    return { inst: partId, port: pin ?? 'out' };
  };

  for (const node of nodes) {
    if (node.kind !== 'part') continue;
    const inst = partIds.get(node.id)!;
    const def = registry.get(node.def);
    def.inputs.forEach((pin, index) => {
      const ref = node.from[Math.min(index, node.from.length - 1)];
      if (ref === undefined) return;
      connect(g, resolve(ref), { inst, port: pin.id });
    });
  }

  for (const node of nodes) {
    if (node.kind !== 'output') continue;
    const inst = outputIds.get(node.name ?? 'OUT')!;
    connect(g, resolve(node.from), { inst, port: 'in' });
  }

  return g;
}
```

`test/levels/ch1-part1.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/core/graph';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { grade } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART1.map((l) => [l.id, l]));

describe('chapter 1 levels 1-6', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART1.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    // level_input / level_output are plumbing and always available
    const unlocked = new Set<string>(['level_input', 'level_output']);
    for (const level of CH1_PART1) {
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
    }
  });
});

const solutions: Record<string, () => Graph> = {
  'ch1-01-crude-awakening': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  'ch1-02-nand-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'b'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-03-not-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'a'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-04-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  'ch1-05-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'not', id: 'n1', from: ['a'] },
      { kind: 'part', def: 'not', id: 'n2', from: ['b'] },
      { kind: 'part', def: 'nand', id: 'g', from: ['n1', 'n2'] },
      { kind: 'output', from: 'g' },
    ]),
  'ch1-06-nor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'n1', from: ['o1'] },
      { kind: 'output', from: 'n1' },
    ]),
};

/** Circuits that a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  // NAND without the final inverter
  'ch1-04-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g', from: ['a', 'b'] },
      { kind: 'output', from: 'g' },
    ]),
  // NOT(NAND) is AND, not OR
  'ch1-05-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  // two NANDs in series is AND, not NOR
  'ch1-06-nor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'g1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'g2', from: ['g1'] },
      { kind: 'output', from: 'g2' },
    ]),
  // a constant ignores its inputs entirely
  'ch1-02-nand-gate': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  // inverting the input is NOT, not NAND
  'ch1-03-not-gate': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
};

describe('reference solutions pass with three stars', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      const result = grade(make(), registry, level);
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.stars, `metrics=${JSON.stringify(result.metrics)}`).toBe(3);
    });
  }
});

describe('plausible wrong circuits fail', () => {
  for (const [id, make] of Object.entries(wrong)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      expect(grade(make(), registry, level).passed).toBe(false);
    });
  }
});

describe('an empty circuit fails every level instead of throwing', () => {
  for (const level of CH1_PART1) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/levels/ch1-part1.test.ts`
Expected: PASS — 19 passed（2 个结构性测试 + 6 个参考解 + 5 个反例 + 6 个空电路）

> 若 `reference solutions pass with three stars` 失败，**先改关卡数据的三星门槛，不要改测试**——门槛是用来描述最优解的，不是用来描述任意解的。但如果是拓扑写错了（比如 NOR 用 NOT(NAND) 搭），那是参考解错了，改参考解。

- [ ] **Step 5: 写 `src/levels/content/index.ts` 与 `src/levels/index.ts`**

`src/levels/content/index.ts`：

```ts
import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';

export const ALL_LEVELS: readonly LevelSpec[] = [...CH1_PART1];
```

`src/levels/index.ts`：

```ts
import { ALL_LEVELS } from './content/index';
import type { LevelSpec } from './spec';

export const LEVELS: readonly LevelSpec[] = ALL_LEVELS;
export const LEVEL_ORDER: readonly string[] = LEVELS.map((l) => l.id);

const byId = new Map(LEVELS.map((l) => [l.id, l]));

export function getLevel(id: string): LevelSpec {
  const level = byId.get(id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

export function levelsOfChapter(chapter: number): readonly LevelSpec[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

export type { LevelSpec };
```

- [ ] **Step 6: 运行全部测试**

Run: `pnpm test`
Expected: PASS — 全部通过

- [ ] **Step 7: 提交**

```bash
git add src/levels/content src/levels/index.ts test/levels/ch1-part1.test.ts
git commit -m "feat(levels): add chapter 1 levels 1-6 with reference solutions"
```

---

