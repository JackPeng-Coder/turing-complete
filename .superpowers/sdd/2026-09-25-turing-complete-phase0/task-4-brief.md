## Task 4: 电路文档模型（core/graph.ts）

**Files:**
- Create: `src/core/graph.ts`
- Test: `test/core/graph.test.ts`

**Interfaces:**
- Consumes: `src/core/registry.ts` 的 `Registry`
- Produces:
  - `interface Instance { readonly id: string; readonly def: string; x: number; y: number; rot: 0 | 1 | 2 | 3; readonly params: Record<string, number> }`
  - `interface WireEnd { readonly inst: string; readonly port: string }`
  - `interface Wire { readonly id: string; readonly from: WireEnd; readonly to: WireEnd }`
  - `interface Graph { level?: string; instances: Instance[]; wires: Wire[]; customComponents: CustomComponentDef[] }`
  - `interface CustomComponentDef { readonly id: string; readonly name: { zh: string; en: string }; readonly inputs: readonly PinDef[]; readonly outputs: readonly PinDef[]; readonly body: Graph }`
  - `function emptyGraph(level?: string): Graph`
  - `function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance`
  - `function removeInstance(g: Graph, id: string): void`
  - `function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire`
  - `function disconnect(g: Graph, wireId: string): void`
  - `function cloneGraph(g: Graph): Graph`
  - `function nextId(prefix: string, existing: readonly { id: string }[]): string`
  - `function validateGraph(g: Graph, registry: Registry): GraphIssue[]`
  - `interface GraphIssue { readonly severity: 'error' | 'warning'; readonly code: 'unknown-def' | 'unknown-instance' | 'unknown-port' | 'multiple-drivers' | 'dangling-input' | 'feedback-loop'; readonly message: { zh: string; en: string }; readonly inst?: string; readonly port?: string }`

- [ ] **Step 1: 写失败测试 `test/core/graph.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  addInstance,
  cloneGraph,
  connect,
  disconnect,
  emptyGraph,
  nextId,
  removeInstance,
  validateGraph,
} from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';

const registry = createRegistry(BASE_DEFS);

describe('graph construction', () => {
  it('adds instances with generated ids', () => {
    const g = emptyGraph('ch1-01');
    const a = addInstance(g, 'nand', 10, 20);
    const b = addInstance(g, 'nand', 30, 40);
    expect(a.id).not.toBe(b.id);
    expect(g.instances).toHaveLength(2);
    expect(a.rot).toBe(0);
  });

  it('clones deeply so mutations do not leak', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const copy = cloneGraph(g);
    copy.instances[0]!.x = 999;
    copy.instances.push(addInstance(copy, 'not', 1, 1));
    expect(g.instances).toHaveLength(1);
    expect(a.x).toBe(0);
  });

  it('removes an instance together with its wires', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(g.wires).toHaveLength(1);
    removeInstance(g, a.id);
    expect(g.instances).toHaveLength(1);
    expect(g.wires).toHaveLength(0);
  });

  it('disconnects a single wire', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    const w = connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    disconnect(g, w.id);
    expect(g.wires).toHaveLength(0);
    expect(g.instances).toHaveLength(2);
  });

  it('generates non-colliding ids', () => {
    const existing = [{ id: 'i1' }, { id: 'i3' }];
    expect(nextId('i', existing)).toBe('i4');
    expect(nextId('i', [])).toBe('i1');
  });
});

describe('validateGraph', () => {
  it('accepts a well-formed circuit', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(validateGraph(g, registry)).toHaveLength(0);
  });

  it('reports unknown defs', () => {
    const g = emptyGraph();
    addInstance(g, 'warp_drive', 0, 0);
    const issues = validateGraph(g, registry);
    expect(issues.map((i) => i.code)).toContain('unknown-def');
  });

  it('reports wires that point at missing instances', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'out' }, to: { inst: 'ghost', port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-instance');
  });

  it('reports wires that point at missing ports', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'nope' }, to: { inst: b.id, port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-port');
  });

  it('reports two drivers on one input pin', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    const c = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: c.id, port: 'a' });
    connect(g, { inst: b.id, port: 'out' }, { inst: c.id, port: 'a' });
    const issues = validateGraph(g, registry);
    const md = issues.filter((i) => i.code === 'multiple-drivers');
    expect(md).toHaveLength(1);
    expect(md[0]!.inst).toBe(c.id);
    expect(md[0]!.port).toBe('a');
  });

  it('reports dangling inputs and feedback loops', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    connect(g, { inst: b.id, port: 'out' }, { inst: a.id, port: 'a' });
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    const codes = validateGraph(g, registry).map((i) => i.code);
    expect(codes).toContain('feedback-loop');
    expect(codes).toContain('dangling-input');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/graph.test.ts`
Expected: FAIL — 无法解析 `../../src/core/graph`

- [ ] **Step 3: 实现 `src/core/graph.ts`**

```ts
import type { PinDef, Registry } from './registry';

export interface Instance {
  readonly id: string;
  readonly def: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  readonly params: Record<string, number>;
}

export interface WireEnd {
  readonly inst: string;
  readonly port: string;
}

export interface Wire {
  readonly id: string;
  readonly from: WireEnd;
  readonly to: WireEnd;
}

export interface CustomComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  readonly body: Graph;
}

export interface Graph {
  level?: string;
  instances: Instance[];
  wires: Wire[];
  customComponents: CustomComponentDef[];
}

export type IssueCode =
  | 'unknown-def'
  | 'unknown-instance'
  | 'unknown-port'
  | 'multiple-drivers'
  | 'dangling-input'
  | 'feedback-loop';

export interface GraphIssue {
  readonly severity: 'error' | 'warning';
  readonly code: IssueCode;
  readonly message: { zh: string; en: string };
  readonly inst?: string;
  readonly port?: string;
}

export function emptyGraph(level?: string): Graph {
  const g: Graph = { instances: [], wires: [], customComponents: [] };
  if (level !== undefined) g.level = level;
  return g;
}

export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const m = /^(\d+)$/.exec(item.id.slice(prefix.length));
    if (item.id.startsWith(prefix) && m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance {
  const inst: Instance = {
    id: id ?? nextId('i', g.instances),
    def,
    x,
    y,
    rot: 0,
    params: {},
  };
  g.instances.push(inst);
  return inst;
}

export function removeInstance(g: Graph, id: string): void {
  g.instances = g.instances.filter((i) => i.id !== id);
  g.wires = g.wires.filter((w) => w.from.inst !== id && w.to.inst !== id);
}

export function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire {
  const wire: Wire = { id: id ?? nextId('w', g.wires), from, to };
  g.wires.push(wire);
  return wire;
}

export function disconnect(g: Graph, wireId: string): void {
  g.wires = g.wires.filter((w) => w.id !== wireId);
}

export function cloneGraph(g: Graph): Graph {
  const copy: Graph = {
    instances: g.instances.map((i) => ({ ...i, params: { ...i.params } })),
    wires: g.wires.map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
    customComponents: g.customComponents.map((c) => ({
      id: c.id,
      name: { ...c.name },
      inputs: c.inputs.map((p) => ({ ...p })),
      outputs: c.outputs.map((p) => ({ ...p })),
      body: cloneGraph(c.body),
    })),
  };
  if (g.level !== undefined) copy.level = g.level;
  return copy;
}
```

`validateGraph` 的实现放在同一文件：

```ts
function pinIds(pins: readonly PinDef[]): Set<string> {
  return new Set(pins.map((p) => p.id));
}

export function validateGraph(g: Graph, registry: Registry): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Instance>();
  for (const inst of g.instances) byId.set(inst.id, inst);

  /** output pins that are driven, per instance */
  const driverCount = new Map<string, number>();

  const defOf = (inst: Instance) => {
    if (registry.has(inst.def)) return registry.get(inst.def);
    issues.push({
      severity: 'error',
      code: 'unknown-def',
      inst: inst.id,
      message: { zh: `未知元件类型：${inst.def}`, en: `Unknown component type: ${inst.def}` },
    });
    return null;
  };

  const defs = new Map<string, ReturnType<Registry['get']> | null>();
  for (const inst of g.instances) defs.set(inst.id, defOf(inst));

  const drivenInputs = new Map<string, string[]>();
  for (const wire of g.wires) {
    const fromInst = byId.get(wire.from.inst);
    const toInst = byId.get(wire.to.inst);
    if (!fromInst || !toInst) {
      issues.push({
        severity: 'error',
        code: 'unknown-instance',
        message: {
          zh: `导线 ${wire.id} 指向不存在的元件`,
          en: `Wire ${wire.id} points at a missing instance`,
        },
      });
      continue;
    }
    const fromDef = defs.get(fromInst.id);
    const toDef = defs.get(toInst.id);
    if (fromDef && !pinIds(fromDef.outputs).has(wire.from.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: fromInst.id,
        port: wire.from.port,
        message: {
          zh: `${fromDef.name.zh} 没有输出引脚 ${wire.from.port}`,
          en: `${fromDef.name.en} has no output pin ${wire.from.port}`,
        },
      });
      continue;
    }
    if (toDef && !pinIds(toDef.inputs).has(wire.to.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: toInst.id,
        port: wire.to.port,
        message: {
          zh: `${toDef.name.zh} 没有输入引脚 ${wire.to.port}`,
          en: `${toDef.name.en} has no input pin ${wire.to.port}`,
        },
      });
      continue;
    }
    const key = `${toInst.id}.${wire.to.port}`;
    const list = drivenInputs.get(key) ?? [];
    list.push(wire.id);
    drivenInputs.set(key, list);
    const outKey = `${fromInst.id}.${wire.from.port}`;
    driverCount.set(outKey, (driverCount.get(outKey) ?? 0) + 1);
  }

  for (const [key, wires] of drivenInputs) {
    if (wires.length > 1) {
      const [instId, port] = key.split('.') as [string, string];
      issues.push({
        severity: 'error',
        code: 'multiple-drivers',
        inst: instId,
        port,
        message: {
          zh: `输入引脚 ${port} 被 ${wires.length} 根导线同时驱动`,
          en: `Input pin ${port} is driven by ${wires.length} wires`,
        },
      });
    }
  }

  // dangling inputs + feedback loops (iterative DFS over instance graph)
  const adjacency = new Map<string, string[]>();
  for (const inst of g.instances) adjacency.set(inst.id, []);
  for (const wire of g.wires) {
    if (byId.has(wire.from.inst) && byId.has(wire.to.inst)) {
      adjacency.get(wire.from.inst)!.push(wire.to.inst);
    }
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const inst of g.instances) color.set(inst.id, WHITE);
  const loopNodes = new Set<string>();
  for (const root of g.instances) {
    if (color.get(root.id) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    color.set(root.id, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.id)!;
      if (frame.next < neighbours.length) {
        const nb = neighbours[frame.next]!;
        frame.next += 1;
        const c = color.get(nb);
        if (c === WHITE) {
          color.set(nb, GREY);
          stack.push({ id: nb, next: 0 });
        } else if (c === GREY) {
          loopNodes.add(nb);
          loopNodes.add(frame.id);
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  if (loopNodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'feedback-loop',
      message: {
        zh: '电路中存在反馈回路；若其中没有存储元件，仿真将无法稳定',
        en: 'The circuit has a feedback loop; without a storage element in it the simulation cannot settle',
      },
    });
  }

  for (const inst of g.instances) {
    const def = defs.get(inst.id);
    if (!def) continue;
    for (const pin of def.inputs) {
      if (!drivenInputs.has(`${inst.id}.${pin.id}`)) {
        issues.push({
          severity: 'warning',
          code: 'dangling-input',
          inst: inst.id,
          port: pin.id,
          message: {
            zh: `${def.name.zh} 的输入引脚 ${pin.id} 未接线（默认读取 0）`,
            en: `Input pin ${pin.id} of ${def.name.en} is not wired (reads 0)`,
          },
        });
      }
    }
  }

  return issues;
}
```

> `driverCount` 目前只在 `validateGraph` 内累计、未产生 issue（多驱动已由 `drivenInputs` 捕获）。保留它是为了让「一个输出驱动多个输入」这条合法路径有显式记录，后续做扇出限制时直接用它。TS 的 `noUnusedLocals` 未开启，因此不会报错。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/core/graph.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 5: 提交**

```bash
git add src/core/graph.ts test/core/graph.test.ts
git commit -m "feat(core): add editable circuit graph model and validator"
```

---

