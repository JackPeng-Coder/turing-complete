import type { Graph, GraphIssue } from '../core/graph';
import { validateGraph } from '../core/graph';
import { delayOf, gateCostOf } from '../core/net';
import type { Registry } from '../core/registry';
import { runChecks, type PlayerProgram } from './checks';
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
 * A THIN FORWARD to `core/net.ts`, which walks the document's leaves. The body is
 * there rather than here because `compile` and `delayOf` need the same flattening
 * and the three metrics must agree about what the document contains: two copies of
 * "expand the components" would drift, and a drift here is a target that cannot be
 * reproduced by the compiler's own view of the circuit.
 *
 * It counts `def.gateCost`, NOT `def.cost`. The two fields are different metrics
 * on purpose: `cost` is the per-node DELAY unit that `delayOf` charges, and a
 * wide component is deliberately one unit of delay (spec §3.2) while expanding
 * to many NAND equivalents here -- an `add8` is 1 delay but 72 gates.
 */
export function gateCost(graph: Graph, registry: Registry): number {
  return gateCostOf(graph, registry);
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

/**
 * Grades a circuit against a level.
 *
 * `player` is the player's program text for `program` checks that read it
 * (`from: 'player'`), forwarded untouched: the grader measures and scores, and
 * what counts as a program is the checker's business. Callers that grade a level
 * whose checks are all level-authored pass nothing, exactly as before.
 */
export function grade(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
  player?: PlayerProgram,
): GradeResult {
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

  const outcome = runChecks(graph, registry, spec, player);
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
