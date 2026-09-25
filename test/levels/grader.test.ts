import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { delayOf } from '../../src/core/net';
import { createRegistry, type ComponentDef } from '../../src/core/registry';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import type { LevelSpec } from '../../src/levels/spec';
import type { Metrics } from '../../src/levels/grader';
import { SCORE_WEIGHTS, gateCost, grade, scoreOf, starsOf } from '../../src/levels/grader';
import { build } from '../fixtures/build';

const registry = createRegistry(BASE_DEFS);

/**
 * A def with the two cost fields set independently, for the tests that have to
 * see which one `gateCost()` reads. `gateCost` is spread in conditionally
 * because `exactOptionalPropertyTypes` distinguishes an absent key from an
 * explicit `undefined`.
 */
function defWithCosts(id: string, cost: number, gateCostValue?: number): ComponentDef {
  return {
    id,
    name: { zh: id, en: id },
    category: 'logic1',
    inputs: [],
    outputs: [{ id: 'out', width: 1 }],
    cost,
    ...(gateCostValue === undefined ? {} : { gateCost: gateCostValue }),
    sequential: false,
    stateBytes: 0,
    evaluate: (_i, o) => {
      o[0] = 0;
    },
  };
}

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

  it('reads gateCost when a def states it and cost when it does not', () => {
    const r = createRegistry([
      defWithCosts('one-nand-part', 1), // no gateCost: falls back to cost
      defWithCosts('mux-part', 1, 4), // one unit of delay, four NAND equivalents
    ]);
    const g = emptyGraph();
    addInstance(g, 'one-nand-part', 0, 0);
    addInstance(g, 'mux-part', 0, 40);
    expect(gateCost(g, r)).toBe(5);
  });

  it('separates the gate metric from the delay metric on a wide part', () => {
    // One `and8` between two 8-bit level inputs and a level output: ONE node, so
    // ONE unit of delay (spec §3.2 -- a wide component, an 8-bit adder included,
    // is still 1), while the gate metric expands it to 16 NAND equivalents
    // (spec §5.4). This is the assertion that fails if the two fields are ever
    // conflated again: charging `gateCost` into `cost` breaks the delay line,
    // and summing `cost` in `gateCost()` breaks the gate line.
    const g = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'part', def: 'and8', id: 'g', from: ['a', 'b'] },
      { kind: 'output', name: 'OUT', width: 8, from: 'g' },
    ]);
    const def = registry.get('and8');
    expect(def.cost).toBe(1);
    expect(def.gateCost).toBe(16);
    expect(delayOf(g, registry)).toBe(1);
    expect(gateCost(g, registry)).toBe(def.gateCost);
    expect(gateCost(g, registry)).toBe(16);
    expect(gateCost(g, registry)).toBeGreaterThan(1);
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
    // The brief wrote this fixture as `{ ...andSpec, threeStar: undefined }`,
    // which `tsc` rejects under `exactOptionalPropertyTypes: true`: an explicit
    // `undefined` is not the same as a missing key. Dropping the key by
    // destructuring expresses the intent (a level with no declared targets)
    // without weakening the assertion.
    const { threeStar: _targets, ...noTargetSpec } = andSpec;
    expect(starsOf({ gate: 99, delay: 99, tick: 9 }, noTargetSpec, true)).toBe(1);
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

// ---------------------------------------------------------------------------
// Phase-0 regression: the twelve chapter-1 reference solutions, frozen.
// ---------------------------------------------------------------------------

/**
 * The chapter-1 reference circuits, restated from the same declarations
 * `ch1-part1.test.ts` / `ch1-part2.test.ts` build. They are copied rather than
 * imported because each of those files keeps its `solutions` local, and their
 * own assertion is "passes with three stars" -- true for a whole class of
 * metric changes. THIS file owns the numbers, and it is the only file in this
 * change's scope that can hold them.
 */
const ch1Reference: Record<string, () => Graph> = {
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
  'ch1-07-always-on': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  'ch1-08-second-tick': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'part', def: 'delay_line', id: 'd1', from: ['src'] },
      { kind: 'part', def: 'delay_line', id: 'd2', from: ['d1'] },
      { kind: 'output', from: 'd2' },
    ]),
  'ch1-09-xor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'nand', id: 'n1', from: ['a', 'b'] },
      { kind: 'part', def: 'nand', id: 'n2', from: ['a', 'n1'] },
      { kind: 'part', def: 'nand', id: 'n3', from: ['b', 'n1'] },
      { kind: 'part', def: 'nand', id: 'n4', from: ['n2', 'n3'] },
      { kind: 'output', from: 'n4' },
    ]),
  'ch1-10-bigger-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'o2', from: ['o1', 'c'] },
      { kind: 'output', from: 'o2' },
    ]),
  'ch1-11-bigger-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'a1', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'a2', from: ['a1', 'c'] },
      { kind: 'output', from: 'a2' },
    ]),
  'ch1-12-binary-racer': () =>
    build([
      { kind: 'input', name: 'b3' },
      { kind: 'input', name: 'b2' },
      { kind: 'input', name: 'b1' },
      { kind: 'input', name: 'b0' },
      { kind: 'output', name: 'OUT_out3', from: 'b3' },
      { kind: 'output', name: 'OUT_out2', from: 'b2' },
      { kind: 'output', name: 'OUT_out1', from: 'b1' },
      { kind: 'output', name: 'OUT_out0', from: 'b0' },
    ]),
};

/**
 * The metrics and score of each reference solution, captured from the PRE-CHANGE
 * tree (commit `a57908a`, before `gateCost` existed) and asserted as literals.
 *
 * A number moving here is a finding against the change that moved it, NOT a
 * number to re-baseline: phase-0 defs state no `gateCost`, so the gate metric
 * falls back to their `cost` and every one of these twelve results must be
 * byte-identical. If a future wide-family edit moves one of these, the metric
 * has leaked out of the wide defs and into phase 0 -- which is the whole thing
 * the `cost` / `gateCost` split exists to prevent.
 */
const CH1_REFERENCE: Record<string, { readonly metrics: Metrics; readonly score: number }> = {
  'ch1-01-crude-awakening': { metrics: { gate: 0, delay: 0, tick: 0 }, score: 0 },
  'ch1-02-nand-gate': { metrics: { gate: 1, delay: 1, tick: 0 }, score: 5 },
  'ch1-03-not-gate': { metrics: { gate: 1, delay: 1, tick: 0 }, score: 5 },
  'ch1-04-and-gate': { metrics: { gate: 2, delay: 2, tick: 0 }, score: 10 },
  'ch1-05-or-gate': { metrics: { gate: 3, delay: 2, tick: 0 }, score: 11 },
  'ch1-06-nor-gate': { metrics: { gate: 2, delay: 2, tick: 0 }, score: 10 },
  'ch1-07-always-on': { metrics: { gate: 0, delay: 0, tick: 0 }, score: 0 },
  // Sequential-only: no combinational depth at all, and the two delay lines
  // show up as ticks instead.
  'ch1-08-second-tick': { metrics: { gate: 0, delay: 0, tick: 3 }, score: 24 },
  'ch1-09-xor-gate': { metrics: { gate: 4, delay: 3, tick: 0 }, score: 16 },
  'ch1-10-bigger-or-gate': { metrics: { gate: 2, delay: 2, tick: 0 }, score: 10 },
  'ch1-11-bigger-and-gate': { metrics: { gate: 2, delay: 2, tick: 0 }, score: 10 },
  'ch1-12-binary-racer': { metrics: { gate: 0, delay: 0, tick: 0 }, score: 0 },
};

describe('phase-0 regression: the chapter-1 reference scores do not move', () => {
  const levels = [...CH1_PART1, ...CH1_PART2];
  const byId = new Map(levels.map((l) => [l.id, l]));

  it('covers all twelve chapter-1 levels, with the same ids', () => {
    expect(levels).toHaveLength(12);
    expect(Object.keys(ch1Reference).sort()).toEqual(levels.map((l) => l.id).sort());
    expect(Object.keys(CH1_REFERENCE).sort()).toEqual(levels.map((l) => l.id).sort());
  });

  for (const [id, make] of Object.entries(ch1Reference)) {
    it(`${id} grades to its frozen metrics and score`, () => {
      const level = byId.get(id) as LevelSpec;
      const frozen = CH1_REFERENCE[id]!;
      const result = grade(make(), registry, level);
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.metrics).toEqual(frozen.metrics);
      expect(result.score).toBe(frozen.score);
      // The frozen score and the frozen metrics have to agree with each other,
      // so a typo in either literal cannot pass as "one of them is right".
      expect(result.score).toBe(scoreOf(frozen.metrics));
    });

    it(`${id} still meets every three-star target`, () => {
      const level = byId.get(id) as LevelSpec;
      const result = grade(make(), registry, level);
      const target = level.threeStar;
      expect(target, `${id} declares no three-star targets`).toBeDefined();
      if (target?.gate !== undefined) {
        expect(result.metrics.gate, `${id} gate`).toBeLessThanOrEqual(target.gate);
      }
      if (target?.delay !== undefined) {
        expect(result.metrics.delay, `${id} delay`).toBeLessThanOrEqual(target.delay);
      }
      if (target?.tick !== undefined) {
        expect(result.metrics.tick, `${id} tick`).toBeLessThanOrEqual(target.tick);
      }
      expect(result.stars, `metrics=${JSON.stringify(result.metrics)}`).toBe(3);
    });
  }
});
