## Task 7: 评分器（levels/grader.ts）

**Files:**
- Create: `src/levels/grader.ts`
- Test: `test/levels/grader.test.ts`

**Interfaces:**
- Consumes: `runChecks`、`delayOf`、`Registry`、`LevelSpec`
- Produces:
  - `interface Metrics { readonly gate: number; readonly delay: number; readonly tick: number }`
  - `interface GradeResult { readonly passed: boolean; readonly metrics: Metrics; readonly score: number; readonly stars: 0 | 1 | 3; readonly failures: readonly CheckFailure[]; readonly issues: readonly GraphIssue[] }`
  - `const SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const`
  - `function grade(graph: Graph, registry: Registry, spec: LevelSpec): GradeResult`
  - `function scoreOf(m: Metrics): number`
  - `function starsOf(m: Metrics, spec: LevelSpec, passed: boolean): 0 | 1 | 3`
  - `function gateCost(graph: Graph, registry: Registry): number`

- [ ] **Step 1: 写失败测试 `test/levels/grader.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { LevelSpec } from '../../src/levels/spec';
import { SCORE_WEIGHTS, gateCost, grade, scoreOf, starsOf } from '../../src/levels/grader';

const registry = createRegistry(BASE_DEFS);

const andSpec: LevelSpec = {
  id: 'test-and',
  chapter: 1,
  index: 1,
  name: { zh: '与门', en: 'AND' },
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
  checks: [
    {
      kind: 'truth-table',
      rows: [
        { inputs: { a: 0, b: 0 }, outputs: { out: 0 } },
        { inputs: { a: 0, b: 1 }, outputs: { out: 0 } },
        { inputs: { a: 1, b: 0 }, outputs: { out: 0 } },
        { inputs: { a: 1, b: 1 }, outputs: { out: 1 } },
      ],
    },
  ],
  threeStar: { gate: 2, delay: 2, tick: 0 },
};

function andSolution(): Graph {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('gateCost', () => {
  it('counts gates and ignores sources and level connectors', () => {
    expect(gateCost(andSolution(), registry)).toBe(2);
  });

  it('is zero for an empty circuit', () => {
    expect(gateCost(emptyGraph(), registry)).toBe(0);
  });
});

describe('scoreOf', () => {
  it('weights delay and ticks above gate count', () => {
    expect(SCORE_WEIGHTS.delay).toBeGreaterThan(SCORE_WEIGHTS.gate);
    expect(SCORE_WEIGHTS.tick).toBeGreaterThan(SCORE_WEIGHTS.delay);
    expect(scoreOf({ gate: 2, delay: 3, tick: 1 })).toBe(2 + 12 + 8);
  });
});

describe('starsOf', () => {
  it('is 0 when the level is not passed', () => {
    expect(starsOf({ gate: 2, delay: 2, tick: 0 }, andSpec, false)).toBe(0);
  });
  it('is 1 when passed but targets are missed', () => {
    expect(starsOf({ gate: 3, delay: 2, tick: 0 }, andSpec, true)).toBe(1);
  });
  it('is 3 when every target is met', () => {
    expect(starsOf({ gate: 2, delay: 2, tick: 0 }, andSpec, true)).toBe(3);
  });
  it('is 3 when every target is beaten', () => {
    expect(starsOf({ gate: 1, delay: 1, tick: 0 }, andSpec, true)).toBe(3);
  });
  it('is 1 when the level declares no targets', () => {
    expect(starsOf({ gate: 99, delay: 99, tick: 9 }, { ...andSpec, threeStar: undefined }, true)).toBe(1);
  });
});

describe('grade', () => {
  it('reports passed + metrics + 3 stars for the reference solution', () => {
    const result = grade(andSolution(), registry, andSpec);
    expect(result.passed).toBe(true);
    expect(result.metrics).toEqual({ gate: 2, delay: 2, tick: 0 });
    expect(result.stars).toBe(3);
    expect(result.score).toBe(2 + 8 + 0);
    expect(result.failures).toHaveLength(0);
  });

  it('never throws on an empty circuit and reports 0 stars', () => {
    const result = grade(emptyGraph(), registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.stars).toBe(0);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('never throws on an unstable circuit and marks it as a failure', () => {
    // Same fixture rule as in the checks test: the free NAND inputs must be
    // tied HIGH for the loop to oscillate. Left unwired they read 0 and the
    // circuit settles at a stable fixed point.
    const g = emptyGraph();
    const one = addInstance(g, 'const_on', 0, 0);
    const n1 = addInstance(g, 'nand', 0, 40);
    const n2 = addInstance(g, 'nand', 0, 80);
    connect(g, { inst: one.id, port: 'out' }, { inst: n1.id, port: 'b' });
    connect(g, { inst: one.id, port: 'out' }, { inst: n2.id, port: 'b' });
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    const result = grade(g, registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.reason === 'unstable')).toBe(true);
    expect(result.issues.some((i) => i.code === 'feedback-loop')).toBe(true);
  });

  it('reports graph issues alongside the grade', () => {
    const g = andSolution();
    g.instances.push({
      id: 'ghost',
      def: 'nope',
      x: 0,
      y: 0,
      rot: 0,
      params: {},
    });
    const result = grade(g, registry, andSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('unknown-def');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/levels/grader.test.ts`
Expected: FAIL — 无法解析 `../../src/levels/grader`

- [ ] **Step 3: 实现 `src/levels/grader.ts`**

```ts
import type { Graph, GraphIssue } from '../core/graph';
import { validateGraph } from '../core/graph';
import { delayOf } from '../core/net';
import type { Registry } from '../core/registry';
import { runChecks } from './checks';
import type { CheckFailure, LevelSpec } from './spec';

export interface Metrics {
  readonly gate: number;
  readonly delay: number;
  readonly tick: number;
}

export interface GradeResult {
  readonly passed: boolean;
  readonly metrics: Metrics;
  readonly score: number;
  readonly stars: 0 | 1 | 3;
  readonly failures: readonly CheckFailure[];
  readonly issues: readonly GraphIssue[];
}

export const SCORE_WEIGHTS = { gate: 1, delay: 4, tick: 8 } as const;

export function scoreOf(m: Metrics): number {
  return m.gate * SCORE_WEIGHTS.gate + m.delay * SCORE_WEIGHTS.delay + m.tick * SCORE_WEIGHTS.tick;
}

export function gateCost(graph: Graph, registry: Registry): number {
  let total = 0;
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    total += registry.get(inst.def).cost;
  }
  return total;
}

export function starsOf(m: Metrics, spec: LevelSpec, passed: boolean): 0 | 1 | 3 {
  if (!passed) return 0;
  const target = spec.threeStar;
  if (!target) return 1;
  const ok =
    (target.gate === undefined || m.gate <= target.gate) &&
    (target.delay === undefined || m.delay <= target.delay) &&
    (target.tick === undefined || m.tick <= target.tick);
  return ok ? 3 : 1;
}

export function grade(graph: Graph, registry: Registry, spec: LevelSpec): GradeResult {
  const issues = validateGraph(graph, registry);
  const fatal = issues.filter((i) => i.severity === 'error');
  if (fatal.length > 0) {
    const metrics: Metrics = { gate: 0, delay: 0, tick: 0 };
    return {
      passed: false,
      metrics,
      score: 0,
      stars: 0,
      failures: [],
      issues,
    };
  }

  const outcome = runChecks(graph, registry, spec);
  const metrics: Metrics = {
    gate: gateCost(graph, registry),
    delay: delayOf(graph, registry),
    tick: outcome.ticksUsed,
  };
  return {
    passed: outcome.passed,
    metrics,
    score: scoreOf(metrics),
    stars: starsOf(metrics, spec, outcome.passed),
    failures: outcome.failures,
    issues,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/levels/grader.test.ts`
Expected: PASS — 12 passed

- [ ] **Step 5: 提交**

```bash
git add src/levels/grader.ts test/levels/grader.test.ts
git commit -m "feat(levels): add grader with gate/delay/tick metrics and star rating"
```

---

