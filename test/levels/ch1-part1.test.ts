import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import type { Graph } from '../../src/core/graph';
import { DEFAULT_FUZZ_ROUNDS } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { grade } from '../../src/levels/grader';
import { LEVEL_ORDER, getLevel, levelsOfChapter } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { truthTable } from '../../src/levels/tables';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART1.map((l) => [l.id, l]));

/**
 * The always-available set is imported, not restated: `STARTER_COMPONENTS` in
 * `src/app/progress.ts` is the same constant `paletteDefsFor` filters each
 * level's palette with, so this test grades the gating against exactly what the
 * player is offered. A local copy with a "keep in sync" comment is not an
 * invariant -- this file and `ch1-part2.test.ts` used to carry one each.
 *
 * It holds the level I/O plumbing plus the two constant sources: level 1's
 * puzzle is "hold the output high" and it has no predecessor level to unlock a
 * source from, so the constants are starter parts rather than a reward.
 */

describe('chapter 1 levels 1-6', () => {
  it('exposes six levels in order', () => {
    expect(CH1_PART1.map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gates every part behind a component unlocked earlier', () => {
    // The starter set is the initial palette; see its doc comment above for why
    // the constants are in it and cannot come from an earlier reward.
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
    // Every kind `LevelCheck` declares is handled, and the final `else` refuses a
    // kind this file does not know instead of falling out of the loop. This loop
    // used to handle only `truth-table` and `script` with no `else`, so a
    // `constraint`, a `fuzz` or a `custom` check -- and any kind a newer kernel
    // adds -- passed it vacuously. The same five branches are in
    // `ch1-part2.test.ts` and in `ch2-batch1.test.ts`, whose copy is itself
    // tested against synthetic vacuous checks (hoisting all three into one
    // fixture would need a file outside this task's declared scope).
    for (const level of CH1_PART1) {
      expect(level.checks.length, `${level.id} has no checks`).toBeGreaterThan(0);
      for (const check of level.checks) {
        if (check.kind === 'truth-table') {
          expect(check.rows?.length ?? 0, `${level.id} has an empty truth table`).toBeGreaterThan(0);
        } else if (check.kind === 'script') {
          expect(check.steps.length, `${level.id} has an empty script`).toBeGreaterThan(0);
        } else if (check.kind === 'constraint') {
          expect(
            check.rule.inputs.length,
            `${level.id} has a constraint with no inputs`,
          ).toBeGreaterThan(0);
          if (check.rule.kind === 'at-least') {
            // A count of 0 is satisfied by every input vector, so the rule would
            // compare nothing.
            expect(
              check.rule.count,
              `${level.id} has an at-least constraint every vector satisfies`,
            ).toBeGreaterThan(0);
          }
        } else if (check.kind === 'fuzz') {
          // `rounds` is optional by contract -- omitting it means
          // `DEFAULT_FUZZ_ROUNDS` -- so the invariant is on the EFFECTIVE count,
          // read from the checker's own constant. A check that would run no
          // rounds compares nothing; restating the default here would let the
          // two drift.
          const rounds = check.rounds ?? DEFAULT_FUZZ_ROUNDS;
          expect(
            Number.isInteger(rounds) && rounds > 0,
            `${level.id} declares fuzz rounds=${String(check.rounds)}`,
          ).toBe(true);
          // A pin with no function bound to it is a pin the check never
          // compares, in either direction.
          for (const pin of level.io.inputs) {
            expect(
              typeof check.inputs[pin.id],
              `${level.id} has no fuzz input function for pin ${pin.id}`,
            ).toBe('function');
          }
          for (const pin of level.io.outputs) {
            expect(
              typeof check.outputs[pin.id],
              `${level.id} has no fuzz expectation for pin ${pin.id}`,
            ).toBe('function');
          }
        } else if (check.kind === 'custom') {
          expect(
            typeof check.id === 'string' && check.id !== '',
            `${level.id} has a custom check with no id to look up`,
          ).toBe(true);
        } else {
          throw new Error(
            `${level.id} has a check of unknown kind ${String((check as { kind?: unknown }).kind)}`,
          );
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
  // The assembled registry is the whole of chapter 1: this file's levels are its
  // first half and `ch1-part2.test.ts` appends the rest and owns the
  // whole-chapter assertions. Scoping these to part 1's own length keeps them
  // just as strict about order and ids without pinning the chapter's total size,
  // which is not this file's business.
  it('orders chapter 1 by level id', () => {
    expect(LEVEL_ORDER.slice(0, CH1_PART1.length)).toEqual(CH1_PART1.map((l) => l.id));
  });

  it('resolves a level by id and rejects an unknown one', () => {
    expect(getLevel('ch1-01-crude-awakening')).toBe(CH1_PART1[0]);
    expect(() => getLevel('ch1-99-nope')).toThrow(/unknown level: ch1-99-nope/);
  });

  it('lists a chapter by number', () => {
    expect(levelsOfChapter(1).slice(0, CH1_PART1.length).map((l) => l.index)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    // `expect(levelsOfChapter(2)).toEqual([])` used to sit here. It was a claim
    // about the UNJOINED chapter -- true only while chapter 2 was written but not
    // appended -- and chapter assembly made it false by construction
    // (`content/index.ts` appends chapter 2's 26 levels, 13-38). Nothing about
    // chapter 1's registry changed, and chapter 2's shape is asserted where it
    // belongs: contiguous indices and the whole-set join check in
    // `test/levels/unlock-chain.test.ts` and
    // `test/levels/level-buildability.test.ts`.
  });
});
