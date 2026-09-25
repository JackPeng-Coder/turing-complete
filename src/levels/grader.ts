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

/**
 * Total NAND-equivalent gates of the circuit: the GATE metric (spec §5.4,
 * "电路 + 自定义组件 + 宽位组件全部展开后，NAND 等价门的总数").
 *
 * It counts `def.gateCost`, NOT `def.cost`. The two fields are different metrics
 * on purpose: `cost` is the per-node DELAY unit that `delayOf` charges, and a
 * wide component is deliberately one unit of delay (spec §3.2) while expanding
 * to many NAND equivalents here -- an `add8` is 1 delay but 72 gates.
 *
 * The `?? def.cost` fallback is for defs whose two values genuinely agree and are
 * zero on both: a rail, a level connector, a wire-like packer, a storage element.
 * It is NOT the 1-bit default -- a 1-bit `and` is 2 NAND equivalents and an `or`
 * is 3 (see the basis table in `defs/index.ts`), and those gates state their own
 * counts. `test/core/registry.test.ts` fails if a gate ever stops stating one.
 */
export function gateCost(graph: Graph, registry: Registry): number {
  let total = 0;
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    total += def.gateCost ?? def.cost;
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
