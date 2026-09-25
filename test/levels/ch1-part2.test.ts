import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/core/graph';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { grade } from '../../src/levels/grader';
import { LEVEL_ORDER, getLevel, levelsOfChapter } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART2.map((l) => [l.id, l]));

/**
 * What the game hands the player before the first puzzle. Kept in sync with
 * `test/levels/ch1-part1.test.ts`, which pins level 1's palette to this set.
 *
 * Levels 7-12 cannot be gated on their own rewards alone: level 8's Delay Line
 * and levels 9-11's gates are handed out by part 1, so the gating walk below
 * starts from the starter set and walks the WHOLE chapter.
 */
const STARTER_COMPONENTS: readonly string[] = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
];

describe('chapter 1 levels 7-12', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART2.map((l) => l.index)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of [...CH1_PART1, ...CH1_PART2]) {
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
    }
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH1_PART2) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      for (const check of level.checks) {
        if (check.kind === 'truth-table') {
          expect(check.rows?.length ?? 0, `${level.id} has an empty truth table`).toBeGreaterThan(0);
        } else if (check.kind === 'script') {
          expect(check.steps.length, `${level.id} has an empty script`).toBeGreaterThan(0);
        }
      }
    }
  });
});

const solutions: Record<string, () => Graph> = {
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

/** Circuits that a player would plausibly build and that must be rejected. */
const wrong: Record<string, () => Graph> = {
  // a constant cannot depend on its inputs
  'ch1-12-binary-racer': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', name: 'OUT_out3', from: 'src' },
      { kind: 'output', name: 'OUT_out2', from: 'src' },
      { kind: 'output', name: 'OUT_out1', from: 'src' },
      { kind: 'output', name: 'OUT_out0', from: 'src' },
    ]),
  // one delay line is one tick of latency, not two
  'ch1-08-second-tick': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'part', def: 'delay_line', id: 'd1', from: ['src'] },
      { kind: 'output', from: 'd1' },
    ]),
  // OR where XOR is required
  'ch1-09-xor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'output', from: 'o1' },
    ]),
  // AND where 3-input OR is required
  'ch1-10-bigger-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'a1', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'a2', from: ['a1', 'c'] },
      { kind: 'output', from: 'a2' },
    ]),
  // OR where 3-input AND is required
  'ch1-11-bigger-and-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'or', id: 'o1', from: ['a', 'b'] },
      { kind: 'part', def: 'or', id: 'o2', from: ['o1', 'c'] },
      { kind: 'output', from: 'o2' },
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

describe('reference solutions are buildable from the palette they are graded against', () => {
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      const offered = new Set(level.allowedComponents);
      for (const inst of make().instances) {
        expect(offered.has(inst.def), `${id} uses ${inst.def}, which its palette omits`).toBe(true);
      }
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
  for (const level of CH1_PART2) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});

describe('the chapter 1 registry', () => {
  it('orders the whole chapter by level id', () => {
    expect(LEVEL_ORDER).toEqual([...CH1_PART1, ...CH1_PART2].map((l) => l.id));
  });

  it('resolves a level from either half of the chapter', () => {
    expect(getLevel('ch1-07-always-on')).toBe(CH1_PART2[0]);
    expect(getLevel('ch1-12-binary-racer')).toBe(CH1_PART2[5]);
  });

  it('lists chapter 1 as all twelve levels', () => {
    expect(levelsOfChapter(1).map((l) => l.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(levelsOfChapter(2)).toEqual([]);
  });
});
