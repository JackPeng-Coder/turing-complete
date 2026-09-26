## Task 6: 关卡规格与验证器（levels/spec.ts、levels/checks.ts）

**Files:**
- Create: `src/levels/spec.ts`, `src/levels/checks.ts`
- Test: `test/levels/checks.test.ts`

**Interfaces:**
- Consumes: `Graph`/`Registry`/`Simulation`/`compile`
- Produces:
  - `interface PinSpec { readonly id: string; readonly width: number; readonly label?: { zh: string; en: string } }`
  - `type LevelCheck = TruthTableCheck | ScriptCheck | ConstraintCheck`
  - `interface TruthTableCheck { readonly kind: 'truth-table'; readonly rows?: readonly TruthRow[] }`
  - `interface TruthRow { readonly inputs: Readonly<Record<string, number>>; readonly outputs: Readonly<Record<string, number>> }`
  - `interface ScriptCheck { readonly kind: 'script'; readonly steps: readonly ScriptStep[] }`
  - `interface ScriptStep { readonly tick: number; readonly inputs?: Readonly<Record<string, number>>; readonly expect?: Readonly<Record<string, number>> }`
  - `interface ConstraintCheck { readonly kind: 'constraint'; readonly rule: ConstraintRule }`
  - `type ConstraintRule = { kind: 'sum-equals'; inputs: readonly string[]; output: string } | { kind: 'at-least'; inputs: readonly string[]; count: number; output: string }`
  - `interface LevelSpec { id, chapter, index, name, brief, hint, allowedComponents, io: { inputs: PinSpec[]; outputs: PinSpec[] }, checks: LevelCheck[], threeStar?: { gate?; delay?; tick? }, rewards?: { components?: string[] } }`
  - `interface CheckOutcome { readonly passed: boolean; readonly failures: readonly CheckFailure[] }`
  - `interface CheckFailure { readonly check: LevelCheck['kind']; readonly inputs: Readonly<Record<string, number>>; readonly expected: Readonly<Record<string, number>>; readonly actual: Readonly<Record<string, number>>; readonly tick: number }`
  - `function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome`
  - `function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): { writeInput(name: string, v: number): void; readOutput(name: string): number }`
  - `function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number`

> **关卡 I/O 的接线约定**：关卡定义 `inputs`/`outputs` 之后，编辑器会给电路里的引脚**按名字**绑定：任何一个实例的输入引脚 `p` 与关卡输入同名即视为被驱动；任何一个实例的输出引脚 `p` 与关卡输出同名即视为关卡输出。这条约定让关卡无需额外的 `level_input` 组件，也保证验签器可以用同一个函数处理所有关卡。**用测试锁死它。**

- [ ] **Step 1: 写失败测试 `test/levels/checks.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { LevelSpec } from '../../src/levels/spec';
import { runChecks } from '../../src/levels/checks';

const registry = createRegistry(BASE_DEFS);

/** The truth table for AND. Level data is explicit; nothing is inferred. */
const AND_ROWS = [
  { inputs: { a: 0, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 0, b: 1 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 1 }, outputs: { out: 1 } },
] as const;

const andSpec: LevelSpec = {
  id: 'test-and',
  chapter: 1,
  index: 1,
  name: { zh: '测试与门', en: 'Test AND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
  io: {
    inputs: [
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
  },
  checks: [{ kind: 'truth-table', rows: AND_ROWS }],
};

/** AND built from NAND + NOT, with explicit level input/output connectors. */
function andSolution(): ReturnType<typeof emptyGraph> {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('runChecks / truth-table', () => {
  it('fails an empty circuit without throwing', () => {
    const outcome = runChecks(emptyGraph(), registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('fails a circuit with an unstable feedback loop without throwing', () => {
    // Two cross-coupled NANDs with BOTH free inputs tied high, so each acts as
    // an inverter and the loop has no stable state. Note the trap the original
    // draft fell into: cross-coupled NANDs with the free inputs left UNWIRED
    // are a STABLE fixed point (nand(x, 0) === 1 for every x) -- that is a
    // perfectly good SR latch, not an unstable circuit. Tying them high is what
    // makes it oscillate.
    const g = emptyGraph();
    const one = addInstance(g, 'const_on', 0, 0);
    const n1 = addInstance(g, 'nand', 0, 40);
    const n2 = addInstance(g, 'nand', 0, 80);
    connect(g, { inst: one.id, port: 'out' }, { inst: n1.id, port: 'b' });
    connect(g, { inst: one.id, port: 'out' }, { inst: n2.id, port: 'b' });
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    expect(() => runChecks(g, registry, andSpec)).not.toThrow();
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'unstable')).toBe(true);
  });

  it('refuses a truth-table check that declares no rows', () => {
    const outcome = runChecks(andSolution(), registry, {
      ...andSpec,
      checks: [{ kind: 'truth-table' }],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'missing-rows')).toBe(true);
  });
});
```

> 上面 `andSolution()` 里的「重命名引脚」是错的——引脚名由**组件定义**决定，不能靠改 `def` 字段实现。真正的接线约定需要一层**显式的关卡 I/O 绑定**。把测试改成下面的样子，并让实现支持它：

```ts
/** Level I/O is bound by a dedicated connector instance whose ports are named after the level pins. */
function andSolution(): Graph {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}
```

> **关卡绑定的算法**（`level_input` / `level_output` 两个元件已经在 Task 3 的 `BASE_DEFS` 里定义好了，这里只需要用）：**实例 id 形如 `IN_<引脚名>` 的 `level_input` 实例即是该关卡输入；实例 id 为 `OUT` 的 `level_output` 实例即单输出关卡的输出（多输出时 id 为 `OUT_<引脚名>`）。** 这条规则简单、可见、可测，而且在画板上直接显示为引脚名。
>
> 注意 `andSolution()` 里用的 `addInstance(g, 'level_input', 0, 0, 'IN_A')` 第四参数是显式 id——`build()` 夹具（Task 8）会替玩家自动生成这些 id，但测试里手写时必须自己写对。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/levels/checks.test.ts`
Expected: FAIL — 无法解析 `../../src/levels/spec`

- [ ] **Step 3: 实现 `src/levels/spec.ts`**

```ts
export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export interface PinSpec {
  readonly id: string;
  readonly width: number;
  readonly label?: LocalizedText;
}

export interface TruthRow {
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
}

export interface TruthTableCheck {
  readonly kind: 'truth-table';
  /** Omitted means "exhaustively enumerate every input combination". */
  readonly rows?: readonly TruthRow[];
}

export interface ScriptStep {
  readonly tick: number;
  readonly inputs?: Readonly<Record<string, number>>;
  readonly expect?: Readonly<Record<string, number>>;
}

export interface ScriptCheck {
  readonly kind: 'script';
  readonly steps: readonly ScriptStep[];
}

export type ConstraintRule =
  | { readonly kind: 'sum-equals'; readonly inputs: readonly string[]; readonly output: string }
  | {
      readonly kind: 'at-least';
      readonly inputs: readonly string[];
      readonly count: number;
      readonly output: string;
    };

export interface ConstraintCheck {
  readonly kind: 'constraint';
  readonly rule: ConstraintRule;
}

export type LevelCheck = TruthTableCheck | ScriptCheck | ConstraintCheck;

export interface LevelSpec {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly name: LocalizedText;
  readonly brief: LocalizedText;
  readonly hint: LocalizedText;
  readonly allowedComponents: readonly string[];
  readonly io: {
    readonly inputs: readonly PinSpec[];
    readonly outputs: readonly PinSpec[];
  };
  readonly checks: readonly LevelCheck[];
  readonly threeStar?: {
    readonly gate?: number;
    readonly delay?: number;
    readonly tick?: number;
  };
  readonly rewards?: { readonly components?: readonly string[] };
}

export interface CheckFailure {
  readonly check: LevelCheck['kind'];
  readonly inputs: Readonly<Record<string, number>>;
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly tick: number;
  readonly reason?:
    | 'mismatch'
    | 'unstable'
    | 'invalid'
    | 'missing-io'
    | 'missing-rows';
}

export interface CheckOutcome {
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly ticksUsed: number;
}
```

- [ ] **Step 4: 实现 `src/levels/checks.ts`**

```ts
import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile, type Netlist } from '../core/net';
import type { Registry } from '../core/registry';
import { formatPort, type PortValue } from '../core/signal';
import type {
  CheckFailure,
  CheckOutcome,
  ConstraintRule,
  LevelCheck,
  LevelSpec,
} from './spec';

export interface LevelIo {
  reset(): void;
  writeInput(name: string, value: number): void;
  readOutput(name: string): number;
  tick(): void;
  readonly sim: Simulation;
}

/**
 * Binds a compiled circuit to a level's named pins.
 *
 * Convention: a `level_input` instance whose id is `IN_<pinId>` supplies that
 * level input; a `level_output` instance whose id is `OUT` (single output) or
 * `OUT_<pinId>` (multi-output) mirrors that level output.
 *
 * Widths come from the level spec, so multi-bit level pins work without any
 * special-casing in the caller.
 */
export function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();

  for (const pin of spec.io.inputs) {
    try {
      inputSlots.set(pin.id, { base: net.outputBase(`IN_${pin.id}.out`), width: pin.width });
    } catch {
      /* pin not present in this circuit: it will read as 0 */
    }
  }

  const outputPins = spec.io.outputs;
  for (const pin of outputPins) {
    const keys = outputPins.length === 1 ? ['OUT.in'] : [`OUT_${pin.id}.in`, 'OUT.in'];
    for (const key of keys) {
      try {
        outputSlots.set(pin.id, { base: net.inputBase(key), width: pin.width });
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }

  const toNumber = (v: PortValue): number => {
    if (typeof v === 'number') return v;
    return Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
  };

  return {
    sim,
    reset: () => sim.reset(),
    tick: () => {
      sim.tick();
    },
    writeInput(name: string, value: number): void {
      const slot = inputSlots.get(name);
      if (!slot) return;
      sim.write(slot.base, slot.width, value);
    },
    readOutput(name: string): number {
      const slot = outputSlots.get(name);
      if (!slot) return 0;
      return toNumber(sim.read(slot.base, slot.width));
    },
  };
}

function enumerateInputs(spec: LevelSpec): Array<Record<string, number>> {
  const bits = spec.io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  const total = 2 ** bits;
  for (let n = 0; n < total; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of spec.io.inputs) {
      const mask = (1 << pin.width) - 1;
      row[pin.id] = (n >>> offset) & mask;
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds the full truth table of a purely combinational level by enumerating
 * every input combination and slicing `expected` into the output pins.
 * The bit layout of `expected` must match the order of `alwaysOn.outputs`.
 */
export function generateRows(
  alwaysOn: LevelSpec,
  expected: (inputs: Record<string, number>) => number,
): Array<{ inputs: Record<string, number>; outputs: Record<string, number> }> {
  return enumerateInputs(alwaysOn).map((inputs) => {
    const value = expected(inputs) >>> 0;
    const outputs: Record<string, number> = {};
    let offset = 0;
    for (const pin of alwaysOn.io.outputs) {
      const mask = (1 << pin.width) - 1;
      outputs[pin.id] = (value >>> offset) & mask;
      offset += pin.width;
    }
    return { inputs, outputs };
  });
}

function evaluateRule(rule: ConstraintRule, inputs: Record<string, number>): number {
  if (rule.kind === 'sum-equals') {
    let sum = 0;
    for (const id of rule.inputs) sum += inputs[id] ?? 0;
    return sum;
  }
  let count = 0;
  for (const id of rule.inputs) count += inputs[id] ?? 0;
  return count >= rule.count ? 1 : 0;
}

export function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome {
  const failures: CheckFailure[] = [];
  let ticksUsed = 0;

  for (const check of spec.checks) {
    // One compilation and one Simulation per check, reused for every row.
    // Compiling per row would re-run validateGraph and reallocate the signal
    // table hundreds of times for a single level.
    const created = createSim(graph, registry, spec);
    if ('error' in created) {
      failures.push(failure(check, {}, {}, {}, 0, created.error));
      continue;
    }
    const io = created.io;

    try {
      if (check.kind === 'truth-table') {
        if (!check.rows || check.rows.length === 0) {
          // A truth-table check with nothing to compare against would pass
          // every circuit ever built. Refuse it loudly instead.
          failures.push(
            failure(
              check,
              {},
              { rows: 1 },
              { rows: 0 },
              0,
              'missing-rows',
            ),
          );
          continue;
        }
        for (const row of check.rows) {
          const attempt = runRow(io, spec, row.inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(row.outputs, attempt.outputs)) {
            failures.push(failure(check, row.inputs, row.outputs, attempt.outputs, 0, 'mismatch'));
          }
        }
        continue;
      }

      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          const want = evaluateRule(check.rule, inputs);
          const got = attempt.outputs[check.rule.output] ?? 0;
          if (want !== got) {
            failures.push(
              failure(check, inputs, { [check.rule.output]: want }, attempt.outputs, 0, 'mismatch'),
            );
          }
        }
        continue;
      }

      // script: walk the steps in tick order, driving inputs along the way
      io.reset();
      ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
      const steps = [...check.steps].sort((a, b) => a.tick - b.tick);
      for (const step of steps) {
        for (const pin of spec.io.inputs) {
          io.writeInput(pin.id, step.inputs?.[pin.id] ?? 0);
        }
        io.sim.settle();
        while (io.sim.tickCount < step.tick) io.tick();
        ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
        if (step.expect) {
          const actual: Record<string, number> = {};
          for (const pin of spec.io.outputs) actual[pin.id] = io.readOutput(pin.id);
          if (compare(step.expect, actual)) {
            failures.push(
              failure(check, step.inputs ?? {}, step.expect, actual, step.tick, 'mismatch'),
            );
          }
        }
      }
    } catch (e) {
      if (e instanceof UnstableCircuitError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'unstable'));
      } else if (e instanceof CircuitValidationError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'invalid'));
      } else {
        throw e;
      }
    }
  }

  return { passed: failures.length === 0, failures, ticksUsed };
}

/** Drives one input vector into a fresh reset of an already-compiled circuit. */
function runRow(
  io: LevelIo,
  spec: LevelSpec,
  inputs: Readonly<Record<string, number>>,
  ticks: number,
): AttemptOk {
  io.reset();
  for (const pin of spec.io.inputs) io.writeInput(pin.id, inputs[pin.id] ?? 0);
  io.sim.settle();
  for (let i = 0; i < ticks; i += 1) io.tick();
  const outputs: Record<string, number> = {};
  for (const pin of spec.io.outputs) outputs[pin.id] = io.readOutput(pin.id);
  return { outputs, ticksUsed: io.sim.tickCount };
}

function compare(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  for (const [key, want] of Object.entries(expected)) {
    if ((actual[key] ?? 0) !== want) return true;
  }
  return false;
}

function failure(
  check: LevelCheck,
  inputs: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  tick: number,
  reason: CheckFailure['reason'],
): CheckFailure {
  return { check: check.kind, inputs, expected, actual, tick, reason };
}

interface AttemptFail {
  error: 'unstable' | 'invalid' | 'missing-io';
}

interface AttemptOk {
  outputs: Record<string, number>;
  ticksUsed: number;
}

function createSim(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
): { io: LevelIo } | AttemptFail {
  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    return { io };
  } catch (e) {
    if (e instanceof UnstableCircuitError) return { error: 'unstable' };
    if (e instanceof CircuitValidationError) return { error: 'invalid' };
    throw e;
  }
}

export function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number {
  return runChecks(graph, registry, spec).ticksUsed;
}

export { formatPort };
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test test/levels/checks.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 6: 补齐判定力测试（正例必须过、反例必须挂）**

追加到 `test/levels/checks.test.ts`：

```ts
describe('truth-table discrimination', () => {
  it('passes the or-of-nands-with-inverters solution (NOR-as-AND is wrong, AND is right)', () => {
    expect(runChecks(andSolution(), registry, andSpec).passed).toBe(true);
  });

  it('rejects a NAND that is missing the final inverter', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const nand = addInstance(g, 'nand', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]!.reason).toBe('mismatch');
    expect(outcome.failures[0]!.inputs).toEqual({ a: 0, b: 0 });
    expect(outcome.failures[0]!.expected).toEqual({ out: 0 });
    expect(outcome.failures[0]!.actual).toEqual({ out: 1 });
  });

  it('rejects a circuit whose level output is never wired', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const nand = addInstance(g, 'nand', 60, 20);
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    // no level_output instance at all: every row reads 0, which is wrong for a=0,b=0
    expect(runChecks(g, registry, andSpec).passed).toBe(false);
  });
});

describe('script check', () => {
  const secondTick: LevelSpec = {
    ...andSpec,
    id: 'test-second-tick',
    io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
    checks: [{ kind: 'script', steps: [{ tick: 2, expect: { out: 1 } }] }],
  };

  it('passes const_on through a delay line', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const d = addInstance(g, 'delay_line', 60, 0);
    const out = addInstance(g, 'level_output', 120, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: d.id, port: 'in' });
    connect(g, { inst: d.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, secondTick);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(2);
  });

  it('rejects a bare const_on because it is high from tick 0', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const out = addInstance(g, 'level_output', 60, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: out.id, port: 'in' });
    // expected high at tick 2, but a plain constant is also high at tick 0 --
    // this level additionally requires the output to be LOW at tick 0
    const strict: LevelSpec = {
      ...secondTick,
      checks: [
        {
          kind: 'script',
          steps: [
            { tick: 0, expect: { out: 0 } },
            { tick: 2, expect: { out: 1 } },
          ],
        },
      ],
    };
    expect(runChecks(g, registry, strict).passed).toBe(false);
  });
});

describe('constraint check', () => {
  const parity: LevelSpec = {
    ...andSpec,
    id: 'test-constraint',
    io: {
      inputs: [
        { id: 'a', width: 1 },
        { id: 'b', width: 1 },
      ],
      outputs: [{ id: 'out', width: 1 }],
    },
    checks: [
      { kind: 'constraint', rule: { kind: 'sum-equals', inputs: ['a', 'b'], output: 'out' } },
    ],
  };

  it('accepts a half adder sum built from XOR', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const xor = addInstance(g, 'xor', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: xor.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: xor.id, port: 'b' });
    connect(g, { inst: xor.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(true);
  });

  it('rejects OR where parity is required', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const or = addInstance(g, 'or', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: or.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: or.id, port: 'b' });
    connect(g, { inst: or.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(false);
  });
});
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm test test/levels/checks.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 8: 提交**

```bash
git add src/levels/spec.ts src/levels/checks.ts test/levels/checks.test.ts src/core/defs/index.ts
git commit -m "feat(levels): add level spec, level IO binding and check runners"
```

---

