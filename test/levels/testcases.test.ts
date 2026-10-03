import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph, type Graph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { grade } from '../../src/levels/grader';
import { testCases } from '../../src/levels/checks';
import { getLevel, LEVELS } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';

/**
 * The case list the bottom panel lays out and the test button plays.
 *
 * Two things are being pinned here, and the second is the one that matters.
 *
 * The first is coverage: every level that declares cases it can be shown case by
 * case must produce them, with values that fit the pins they name, and a level
 * whose vectors live inside its checker must say so rather than invent a column.
 *
 * The second is DRIFT. `testCases` is a second derivation of "what this level
 * tests", next to the one `runChecks` performs when it grades, and a second
 * derivation is a thing that can fall out of step. If it did, the panel would
 * animate a test the level never runs -- a demonstration that proves nothing,
 * which is worse than no demonstration, because it looks like evidence. So the
 * last test drives every shipped level's IO through the REAL checker, with a
 * circuit that computes nothing, and requires every vector the checker reports
 * as wrong to be one of the cases this list declares, with the same expectation.
 */
const registry = createRegistry(BASE_DEFS);

/**
 * The level's own IO and nothing else: every declared input placed, every
 * declared output placed, and not one wire between them.
 *
 * This is the cheapest circuit that can be graded at all -- `bindLevelIo` binds a
 * circuit to its level by instance id, so a board with no level IO is refused
 * with `missing-io` before a single vector is driven, which would make the drift
 * test below vacuous on every level at once.
 */
function ioOnly(level: LevelSpec): Graph {
  const g = emptyGraph(level.id);
  for (const pin of level.io.inputs) {
    const inst = addInstance(g, 'level_input', 0, 0, `IN_${pin.id}`);
    inst.params.width = pin.width;
  }
  const single = level.io.outputs.length === 1;
  level.io.outputs.forEach((pin, index) => {
    const inst = addInstance(g, 'level_output', 240, index * 96, single ? 'OUT' : `OUT_${pin.id}`);
    inst.params.width = pin.width;
  });
  return g;
}

/** Two authored vectors as the same thing, ignoring key order. */
function sameVector(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

function fits(value: number, width: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 2 ** width - 1;
}

describe('the case list a level declares', () => {
  it('produces cases for every kind that declares them, and a reason for the rest', () => {
    const kinds = new Map<string, string>();
    for (const level of LEVELS) {
      const check = level.checks[0];
      const plan = testCases(level);
      const kind = check && typeof check.kind === 'string' ? check.kind : 'none';
      kinds.set(level.id, plan.kind);
      if (plan.kind === 'none') {
        // Only the two kinds whose vectors are the checker's own business may
        // report that they cannot be played; a truth table that produced no
        // columns would be a silent hole in the panel.
        expect(
          ['program', 'custom'],
          `${level.id} (${kind}) declares cases it cannot lay out`,
        ).toContain(plan.reason);
      }
    }
    // Every shipped check kind is represented, so a level added later without a
    // case list shows up as a missing kind rather than as a missing level.
    expect([...kinds.values()].filter((k) => k === 'cases').length).toBeGreaterThan(20);
  });

  it('never lists a value that does not fit the pin it names', () => {
    for (const level of LEVELS) {
      const plan = testCases(level);
      if (plan.kind !== 'cases') continue;
      for (const [index, item] of plan.cases.entries()) {
        for (const [pin, value] of Object.entries(item.inputs)) {
          const spec = level.io.inputs.find((candidate) => candidate.id === pin);
          expect(spec, `${level.id} case ${index}: ${pin} is not an input pin`).toBeDefined();
          expect(fits(value, spec!.width), `${level.id} case ${index}: ${pin}=${value}`).toBe(true);
        }
        for (const [pin, value] of Object.entries(item.expected)) {
          const spec = level.io.outputs.find((candidate) => candidate.id === pin);
          expect(spec, `${level.id} case ${index}: ${pin} is not an output pin`).toBeDefined();
          expect(fits(value, spec!.width), `${level.id} case ${index}: ${pin}=${value}`).toBe(true);
        }
      }
    }
  });

  it('declares one case per row, per enumerated input, per round and per step', () => {
    // The counts are the level data's own, read here rather than restated, so a
    // level that gains a row changes this test's expectation with it. A level
    // with more than one check is left to the join test below.
    for (const level of LEVELS) {
      if (level.checks.length !== 1) continue;
      const plan = testCases(level);
      if (plan.kind !== 'cases') continue;
      const check = level.checks[0]!;
      if (check.kind === 'truth-table') {
        expect(plan.cases, level.id).toHaveLength(check.rows?.length ?? 0);
      } else if (check.kind === 'script') {
        expect(plan.cases, level.id).toHaveLength(check.steps.length);
      } else if (check.kind === 'constraint') {
        const bits = level.io.inputs.reduce((total, pin) => total + pin.width, 0);
        expect(plan.cases, level.id).toHaveLength(2 ** bits);
      } else if (check.kind === 'fuzz') {
        expect(plan.cases.length, level.id).toBeGreaterThan(0);
      }
    }
  });

  /**
   * What `reset` means, which is the whole difference between a menu of cases and
   * a recording of one. A combinational level drives every vector into a circuit
   * the checker has just cleared; a script's steps are one run, and only its
   * first step starts from a cleared circuit.
   */
  it('clears the circuit before every row of a table', () => {
    for (const level of LEVELS) {
      if (level.checks.some((check) => check.kind !== 'truth-table')) continue;
      const plan = testCases(level);
      if (plan.kind !== 'cases') continue;
      expect(
        plan.cases.filter((item) => !item.reset),
        level.id,
      ).toEqual([]);
    }
  });

  it('clears the circuit once at each script’s front, and nowhere else', () => {
    // `ch2-23-odd-cycles` declares TWO scripts, which is the case that catches a
    // "reset the first case only" reading of the rule: the second script runs
    // from a cleared circuit too, exactly as `runChecks` resets per check.
    const level = getLevel('ch2-23-odd-cycles');
    expect(level.checks.map((check) => check.kind)).toEqual(['script', 'script']);
    const plan = testCases(level);
    expect(plan.kind).toBe('cases');
    const cases = plan.kind === 'cases' ? plan.cases : [];
    const sizes = level.checks.map((check) => (check.kind === 'script' ? check.steps.length : 0));
    expect(cases.map((item) => item.reset)).toEqual([
      true,
      ...Array<boolean>(sizes[0]! - 1).fill(false),
      true,
      ...Array<boolean>(sizes[1]! - 1).fill(false),
    ]);
  });

  it('reports why a program level has nothing to lay out', () => {
    const level = getLevel('ch3-49-turing-complete');
    expect(level.checks[0]!.kind).toBe('program');
    expect(testCases(level)).toEqual({ kind: 'none', reason: 'program' });
  });

  it('survives level data that is not a check at all', () => {
    // It is called from the panel's render path, on every store change, with data
    // that reaches the kernel untyped. A throw here takes the board down.
    const level = getLevel('ch1-04-and-gate');
    const broken = {
      ...level,
      checks: [null, 7, { kind: 'nope' }, { kind: 'fuzz' }, { kind: 'truth-table' }],
    } as unknown as LevelSpec;
    expect(() => testCases(broken)).not.toThrow();
    expect(testCases(broken)).toEqual({ kind: 'none', reason: 'empty' });
  });
});

describe('the case list and the checker agree', () => {
  it('reports every wrong vector the checker finds as one of the declared cases', () => {
    const compared = new Set<string>();
    for (const level of LEVELS) {
      const plan = testCases(level);
      const cases = plan.kind === 'cases' ? plan.cases : [];
      const result = grade(ioOnly(level), registry, level);
      for (const failure of result.failures) {
        if (failure.reason !== 'mismatch') continue;
        const matched = cases.some(
          (item) =>
            sameVector(item.inputs, failure.inputs) && sameVector(item.expected, failure.expected),
        );
        expect(
          matched,
          `${level.id}: the checker drove ${JSON.stringify(failure.inputs)} expecting ` +
            `${JSON.stringify(failure.expected)}, which is not a case the panel declares`,
        ).toBe(true);
        compared.add(failure.check);
      }
    }
    // ...and the comparison really happened, for every kind that has vectors to
    // compare. A list that had quietly become empty would satisfy the loop above
    // without proving anything.
    expect([...compared].sort()).toEqual(['constraint', 'fuzz', 'script', 'truth-table']);
  });
});
