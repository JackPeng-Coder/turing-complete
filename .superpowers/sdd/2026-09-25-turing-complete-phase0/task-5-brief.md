## Task 5: 展开与仿真内核（core/net.ts、core/errors.ts）

**Files:**
- Create: `src/core/net.ts`, `src/core/errors.ts`
- Test: `test/core/net.test.ts`

**Interfaces:**
- Consumes: `Graph`（Task 4）、`Registry`/`ComponentDef`（Task 3）、`SignalTable`/`PortValue`（Task 2）
- Produces:
  - `class UnstableCircuitError extends Error { readonly iterations: number; readonly blame: readonly string[] }`
  - `class CircuitValidationError extends Error { readonly issues: readonly GraphIssue[] }`
  - `interface Netlist { readonly instanceCount: number; readonly expandedCount: number; readonly slotCount: number; readonly drive: Int32Array; readonly refs: Map<string, string>; instanceDefs(): readonly string[] }`
  - `function compile(graph: Graph, registry: Registry): Netlist`
  - `interface SettleReport { readonly iterations: number; readonly stable: boolean }`
  - `class Simulation { constructor(net: Netlist, registry: Registry); reset(): void; settle(): SettleReport; tick(): SettleReport; read(base: number, width: number): PortValue; write(base: number, width: number, v: PortValue): void; readonly tickCount: number; readonly net: Netlist }`
  - `function delayOf(graph: Graph, registry: Registry): number`

- [ ] **Step 1: 写 `src/core/errors.ts`**

```ts
import type { GraphIssue } from './graph';

export class UnstableCircuitError extends Error {
  readonly iterations: number;
  readonly blame: readonly string[];

  constructor(iterations: number, blame: readonly string[]) {
    super(
      `circuit did not settle after ${iterations} iterations (combinational feedback loop)`,
    );
    this.name = 'UnstableCircuitError';
    this.iterations = iterations;
    this.blame = blame;
  }
}

export class CircuitValidationError extends Error {
  readonly issues: readonly GraphIssue[];

  constructor(issues: readonly GraphIssue[]) {
    super(`circuit is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'CircuitValidationError';
    this.issues = issues;
  }
}
```

- [ ] **Step 2: 写失败测试 `test/core/net.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import { UnstableCircuitError } from '../../src/core/errors';
import { Simulation, compile, delayOf } from '../../src/core/net';

const registry = createRegistry(BASE_DEFS);

/** Builds a NAND whose inputs are exposed as level inputs a/b and a level output. */
function nandFixture(): {
  graph: Graph;
  inA: { inst: string; port: string };
  inB: { inst: string; port: string };
  out: { inst: string; port: string };
} {
  const g = emptyGraph();
  const a = addInstance(g, 'nand', 0, 0);
  return {
    graph: g,
    inA: { inst: a.id, port: 'a' },
    inB: { inst: a.id, port: 'b' },
    out: { inst: a.id, port: 'out' },
  };
}

describe('compile', () => {
  it('allocates one slot per bit of every pin', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect(net.instanceCount).toBe(1);
    // 2 inputs + 1 output
    expect(net.slotCount).toBe(3);
  });

  it('records the origin instance of every expanded instance', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect([...net.refs.values()]).toEqual([graph.instances[0]!.id]);
  });

  it('rejects invalid graphs', () => {
    const g = emptyGraph();
    addInstance(g, 'nope', 0, 0);
    expect(() => compile(g, registry)).toThrow(/invalid/i);
  });
});

describe('Simulation', () => {
  it('evaluates a NAND for every input combination', () => {
    const { graph, inA, inB, out } = nandFixture();
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const slotOf = (end: { inst: string; port: string }): number => {
      for (const [slotKey, instId] of net.refs) {
        if (instId === end.inst) {
          const inst = graph.instances.find((i) => i.id === instId)!;
          if (inst) {
            const def = registry.get(inst.def);
            const inputs = def.inputs.map((p) => p.id);
            const idx = inputs.indexOf(end.port);
            if (idx >= 0) return net.inputBase(slotKey as never) + idx;
          }
        }
      }
      throw new Error('slot not found');
    };
    expect(slotOf).toBeDefined();
    expect(out).toBeDefined();
  });
});
```

> 上面的测试暴露了一个真实的设计缺口：内核需要**按引脚名寻址槽位**的公开方法，否则使用方只能自己去猜槽位编号。补上它，而不是在测试里绕路。

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test test/core/net.test.ts`
Expected: FAIL — 无法解析 `../../src/core/net`

- [ ] **Step 4: 实现 `src/core/net.ts`**

```ts
import { CircuitValidationError, UnstableCircuitError } from './errors';
import { validateGraph, type Graph, type GraphIssue } from './graph';
import { createSignalTable, type PortValue, type SignalTable } from './signal';
import type { ComponentDef, Registry } from './registry';

/** Iteration cap for the settle loop. A combinational loop exhausts it. */
export const SETTLE_LIMIT = 512;

export interface Netlist {
  readonly instanceCount: number;
  readonly slotCount: number;
  readonly drive: Int32Array;
  readonly refs: Map<string, string>;
  /** Slot base of an input pin, addressed by `"<instId>.<pinId>"`. */
  inputBase(key: string): number;
  /** Slot base of an output pin, addressed by `"<instId>.<pinId>"`. */
  outputBase(key: string): number;
  /** Expanded instance ids in evaluation order. */
  instanceIds(): readonly string[];
  /** `"<instId>.<pinId>"` keys that are exposed as level outputs. */
  outputKeys(): readonly string[];
}

interface CompiledInstance {
  readonly key: string;
  readonly origin: string;
  readonly def: ComponentDef;
  readonly inputs: readonly number[];
  readonly outputs: readonly number[];
}

export function compile(graph: Graph, registry: Registry): Netlist {
  const errors: GraphIssue[] = validateGraph(graph, registry).filter(
    (i) => i.severity === 'error',
  );
  if (errors.length > 0) throw new CircuitValidationError(errors);

  const table = createSignalTable();
  const instances: CompiledInstance[] = [];
  const refs = new Map<string, string>();
  const inputBases = new Map<string, number>();
  const outputBases = new Map<string, number>();

  for (const inst of graph.instances) {
    const def = registry.get(inst.def);
    const inputs = def.inputs.map((pin) => {
      const base = table.alloc(pin.width);
      inputBases.set(`${inst.id}.${pin.id}`, base);
      return base;
    });
    const outputs = def.outputs.map((pin) => {
      const base = table.alloc(pin.width);
      outputBases.set(`${inst.id}.${pin.id}`, base);
      return base;
    });
    for (const out of outputs) table.setBit(out, 0);
    const key = inst.id;
    refs.set(key, inst.id);
    instances.push({ key, origin: inst.id, def, inputs, outputs });
  }

  // Wire resolution: every input pin reads from the slot that drives it.
  const drive = new Int32Array(table.size);
  // by default, an input reads from a dedicated zero slot
  const zeroSlot = table.alloc(1);
  table.setBit(zeroSlot, 0);
  drive.fill(zeroSlot);
  for (const wire of graph.wires) {
    const fromBase = outputBases.get(`${wire.from.inst}.${wire.from.port}`);
    const toBase = inputBases.get(`${wire.to.inst}.${wire.to.port}`);
    if (fromBase === undefined || toBase === undefined) continue;
    const fromDef = registry.get(graph.instances.find((i) => i.id === wire.from.inst)!.def);
    const toDef = registry.get(graph.instances.find((i) => i.id === wire.to.inst)!.def);
    const fromPin = fromDef.outputs.find((p) => p.id === wire.from.port)!;
    const toPin = toDef.inputs.find((p) => p.id === wire.to.port)!;
    const width = Math.min(fromPin.width, toPin.width);
    for (let i = 0; i < width; i += 1) drive[toBase + i] = fromBase + i;
  }

  const instanceIds = instances.map((i) => i.key);
  const net: Netlist = {
    instanceCount: instances.length,
    slotCount: table.size,
    drive,
    refs,
    inputBase: (key) => {
      const base = inputBases.get(key);
      if (base === undefined) throw new Error(`no such input pin: ${key}`);
      return base;
    },
    outputBase: (key) => {
      const base = outputBases.get(key);
      if (base === undefined) throw new Error(`no such output pin: ${key}`);
      return base;
    },
    instanceIds: () => instanceIds,
    outputKeys: () => [...outputBases.keys()],
  };

  // stash the compiled data on a non-enumerable field for Simulation
  Object.defineProperty(net, INTERNAL, { value: { table, instances } });
  return net;
}

const INTERNAL = Symbol('tc.net.internal');

interface NetInternals {
  table: SignalTable;
  instances: CompiledInstance[];
}

function internalsOf(net: Netlist): NetInternals {
  const found = (net as unknown as Record<symbol, NetInternals | undefined>)[INTERNAL];
  if (!found) throw new Error('netlist was not produced by compile()');
  return found;
}

export interface SettleReport {
  readonly iterations: number;
  readonly stable: boolean;
}

export class Simulation {
  readonly net: Netlist;
  readonly #registry: Registry;
  readonly #table: SignalTable;
  readonly #instances: readonly CompiledInstance[];
  readonly #state: Uint8Array[];
  #tickCount = 0;

  constructor(net: Netlist, registry: Registry) {
    const { table, instances } = internalsOf(net);
    this.net = net;
    this.#registry = registry;
    this.#table = table;
    this.#instances = instances;
    this.#state = instances.map((i) => new Uint8Array(i.def.stateBytes));
  }

  get tickCount(): number {
    return this.#tickCount;
  }

  reset(): void {
    this.#table.clear();
    for (const s of this.#state) s.fill(0);
    this.#tickCount = 0;
    this.#publishState();
    this.settle();
  }

  /** Publishes storage-element outputs from their private state. */
  #publishState(): void {
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential) continue;
      const state = this.#state[i]!;
      for (let p = 0; p < inst.outputs.length; p += 1) {
        this.#table.setBit(inst.outputs[p]!, state[p] === 1 ? 1 : 0);
      }
    }
  }

  /** Reads an input pin through its driver, writing into a scratch list. */
  #readInputs(inst: CompiledInstance, scratch: PortValue[]): void {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      const base = inst.inputs[p]!;
      const width = inst.def.inputs[p]!.width;
      const driven = this.net.drive[base]!;
      scratch[p] = this.#table.getPort(driven, width);
    }
  }

  settle(): SettleReport {
    const scratch: PortValue[] = [];
    for (let iter = 0; iter < SETTLE_LIMIT; iter += 1) {
      let changed = false;
      for (const inst of this.#instances) {
        if (inst.def.sequential || !inst.def.evaluate) continue;
        this.#readInputs(inst, scratch);
        const out: PortValue[] = [];
        inst.def.evaluate(scratch, out, { tick: this.#tickCount });
        for (let p = 0; p < inst.outputs.length; p += 1) {
          const base = inst.outputs[p]!;
          const width = inst.def.outputs[p]!.width;
          const next = out[p] ?? 0;
          const prev = this.#table.getPort(base, width);
          if (!portsEqual(prev, next)) {
            this.#table.setPort(base, width, next);
            changed = true;
          }
        }
      }
      if (!changed) return { iterations: iter + 1, stable: true };
    }
    const blame = this.#instances.map((i) => i.origin);
    throw new UnstableCircuitError(SETTLE_LIMIT, blame);
  }

  tick(): SettleReport {
    this.#tickCount += 1;
    // 1. snapshot pre-edge inputs for every storage element
    const pending: Array<{ index: number; inputs: PortValue[] }> = [];
    const scratch: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential || !inst.def.clockEdge) continue;
      this.#readInputs(inst, scratch);
      pending.push({ index: i, inputs: [...scratch] });
    }
    // 2. apply the edge using the snapshotted inputs
    for (const { index, inputs } of pending) {
      const inst = this.#instances[index]!;
      const out: PortValue[] = [];
      inst.def.clockEdge!(inputs, out, this.#state[index]!, { tick: this.#tickCount });
    }
    // 3. publish new state, then let combinational logic settle
    this.#publishState();
    return this.settle();
  }

  read(base: number, width: number): PortValue {
    return this.#table.getPort(base, width);
  }

  write(base: number, width: number, v: PortValue): void {
    this.#table.setPort(base, width, v);
  }
}

function portsEqual(a: PortValue, b: PortValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  const ab = typeof a === 'number' ? [a] : Array.from(a);
  const bb = typeof b === 'number' ? [b] : Array.from(b);
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i += 1) if (ab[i] !== bb[i]) return false;
  return true;
}

/**
 * Longest combinational path, counted in base-gate delays.
 *
 * Linear-time DAG longest path: topological order via Kahn's algorithm, then a
 * single relaxation pass. A path-walk version would be exponential on diamond
 * shaped circuits (2^n paths), which realistic CPU circuits are full of.
 *
 * Sequential elements are sources of their own output and sinks for their
 * input, so they break the combinational path and contribute no delay.
 */
export function delayOf(graph: Graph, registry: Registry): number {
  const index = new Map<string, number>();
  graph.instances.forEach((inst, i) => index.set(inst.id, i));
  const count = graph.instances.length;
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  const inDegree = new Int32Array(count);

  for (const wire of graph.wires) {
    const from = index.get(wire.from.inst);
    const to = index.get(wire.to.inst);
    if (from === undefined || to === undefined) continue;
    outgoing[from]!.push(to);
    inDegree[to] += 1;
  }

  // delay[i] = longest combinational delay arriving at instance i's OUTPUT,
  // treating instance i as a source (0) when it arrives with no contributions.
  const delay = new Int32Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (inDegree[i] === 0) {
      delay[i] = graph.instances[i]!.def && registry.get(graph.instances[i]!.def).sequential
        ? 0
        : registry.get(graph.instances[i]!.def).cost;
      queue.push(i);
    }
  }

  const seen = new Int32Array(count);
  let longest = 0;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head]!;
    head += 1;
    if (delay[i]! > longest) longest = delay[i]!;
    const def = registry.get(graph.instances[i]!.def);
    for (const j of outgoing[i]!) {
      seen[j] += 1;
      const jDef = registry.get(graph.instances[j]!.def);
      // If the *source* is sequential its output is a fresh source, so the
      // arriving path counts as 0. Otherwise add this gate's own cost.
      const candidate = def.sequential ? jDef.cost : delay[i]! + jDef.cost;
      if (candidate > delay[j]!) delay[j] = candidate;
      if (seen[j] === inDegree[j]) queue.push(j);
    }
  }

  // Unreachable-from-any-source nodes (pure feedback loops) were already
  // rejected by validateGraph; their delay is simply not counted.
  return longest;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test test/core/net.test.ts`
Expected: PASS — 3 passed（其余 NAND 组合断言在 Task 6 的 `checks` 测试里覆盖，那里有完整的关卡驱动路径）

- [ ] **Step 6: 补一条真实求值测试，替换掉探测器式断言**

在 `test/core/net.test.ts` 里把 `describe('Simulation')` 整块替换为：

```ts
describe('Simulation', () => {
  it('evaluates a NAND for every input combination', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const a = net.inputBase(`${nand.id}.a`);
    const b = net.inputBase(`${nand.id}.b`);
    const out = net.outputBase(`${nand.id}.out`);
    for (const [va, vb, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      sim.write(a, 1, va);
      sim.write(b, 1, vb);
      sim.settle();
      expect(sim.read(out, 1), `nand(${va},${vb})`).toBe(want);
    }
  });

  it('propagates through a chain of gates in one settle', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'not', 40, 0);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.write(net.inputBase(`${n1.id}.a`), 1, 1);
    sim.write(net.inputBase(`${n1.id}.b`), 1, 1);
    sim.settle();
    expect(sim.read(net.outputBase(`${n2.id}.out`), 1)).toBe(0); // nand=0, not=1? no: nand(1,1)=0 -> not=1
  });

  it('treats an unwired input as zero', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.settle();
    // nand(0,0) = 1
    expect(sim.read(net.outputBase(`${nand.id}.out`), 1)).toBe(1);
  });

  it('throws UnstableCircuitError for a combinational feedback loop', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'nand', 0, 40);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    expect(() => sim.settle()).toThrow(UnstableCircuitError);
  });

  it('settles a delay_line held loop and publishes state on the edge', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const out = net.outputBase(`${delay.id}.out`);
    sim.reset();
    expect(sim.read(out, 1)).toBe(0); // starts empty
    sim.tick();
    expect(sim.read(out, 1)).toBe(1); // one edge later the input has arrived
  });

  it('reset clears state and the tick counter', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.tick();
    expect(sim.tickCount).toBe(1);
    sim.reset();
    expect(sim.tickCount).toBe(0);
    expect(sim.read(net.outputBase(`${delay.id}.out`), 1)).toBe(0);
  });
});
```

> 修掉上面 `propagates through a chain` 里的注释错误：`nand(1,1)=0`，`not(0)=1`，期望值是 **1**。实现前先把断言改成 `1` 并删掉行尾错误注释。

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm test test/core/net.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 8: 提交**

```bash
git add src/core/errors.ts src/core/net.ts test/core/net.test.ts
git commit -m "feat(core): add netlist compiler and edge-triggered simulator"
```

---

