import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/core/graph';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { grade } from '../../src/levels/grader';
import { LEVEL_ORDER, getLevel, levelsOfChapter } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { truthTable } from '../../src/levels/tables';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART1.map((l) => [l.id, l]));

/**
 * What the game hands the player before the first puzzle.
 *
 * `level_input` / `level_output` are plumbing: always available, never unlocked
 * by a reward. The two constant sources are starter parts -- level 1's puzzle is
 * "hold the output high", and it has no predecessor level to unlock a source
 * from, so the constants are part of the starting palette rather than a reward.
 * (Level 6 lists them again; by then it is a no-op. The progress layer's
 * `PLUMBING` needs to grow to match this set, or level 1's palette is empty of
 * anything that can drive its output.)
 */
const STARTER_COMPONENTS: readonly string[] = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
];

describe('chapter 1 levels 1-6', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART1.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    // level_input / level_output are plumbing and always available; the two
    // constants are the starter palette level 1 itself is built from. See
    // STARTER_COMPONENTS for why they cannot come from an earlier reward.
    const unlocked = new Set<string>(STARTER_COMPONENTS);
    for (const level of CH1_PART1) {
      for (const def of level.allowedComponents) {
        expect(unlocked.has(def), `${level.id} offers locked component ${def}`).toBe(true);
      }
      for (const def of level.rewards?.components ?? []) unlocked.add(def);
    }
  });

  it('starts the player on exactly the level-1 palette', () => {
    // Pins the starter set down: widening level 1's palette means deciding
    // whether the new part is a starter or a reward.
    const first = CH1_PART1[0];
    expect(first?.allowedComponents).toBeDefined();
    expect([...(first?.allowedComponents ?? [])].sort()).toEqual([...STARTER_COMPONENTS].sort());
  });

  it('gives every level a check with something to compare', () => {
    for (const level of CH1_PART1) {
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

describe('truthTable', () => {
  const IO = { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] };

  it('enumerates one row per input combination', () => {
    const check = truthTable(IO, { out: ({ a }) => (a ? 1 : 0) });
    expect(check.kind).toBe('truth-table');
    expect(check.rows?.map((row) => row.inputs.a)).toEqual([0, 1]);
  });

  it('throws when a declared output pin has no expectation', () => {
    expect(() => truthTable(IO, {})).toThrow(/no expectation given for output pin "out"/);
  });

  it('throws when an expectation names a pin that is not an output', () => {
    expect(() => truthTable(IO, { out: () => 0, extra: () => 1 })).toThrow(
      /"extra" is not an output pin/,
    );
  });

  it('masks an expectation to the width of its pin', () => {
    const wide = { inputs: [], outputs: [{ id: 'out', width: 2 }] };
    expect(truthTable(wide, { out: () => 7 }).rows?.[0]?.outputs.out).toBe(3);
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
  for (const level of CH1_PART1) {
    it(level.id, () => {
      const result = grade(build([]), registry, level);
      expect(result.passed).toBe(false);
      expect(result.stars).toBe(0);
    });
  }
});

describe('the level registry', () => {
  it('orders chapter 1 by level id', () => {
    expect(LEVEL_ORDER).toEqual(CH1_PART1.map((l) => l.id));
  });

  it('resolves a level by id and rejects an unknown one', () => {
    expect(getLevel('ch1-01-crude-awakening')).toBe(CH1_PART1[0]);
    expect(() => getLevel('ch1-99-nope')).toThrow(/unknown level: ch1-99-nope/);
  });

  it('lists a chapter by number', () => {
    expect(levelsOfChapter(1).map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(levelsOfChapter(2)).toEqual([]);
  });
});
