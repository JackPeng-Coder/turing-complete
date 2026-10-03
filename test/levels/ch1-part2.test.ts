import { describe, expect, it } from 'vitest';
import { STARTER_COMPONENTS } from '../../src/app/progress';
import type { Graph } from '../../src/core/graph';
import { DEFAULT_FUZZ_ROUNDS } from '../../src/levels/checks';
import { CH1_PART1 } from '../../src/levels/content/ch1/part1';
import { CH1_PART2 } from '../../src/levels/content/ch1/part2';
import { grade } from '../../src/levels/grader';
import { LEVEL_ORDER, getLevel, levelsOfChapter } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

const byId = new Map(CH1_PART2.map((l) => [l.id, l]));

/**
 * The starting palette, imported from `src/app/progress.ts` -- the same constant
 * `paletteDefsFor` uses, so this walk cannot drift from the parts the player is
 * actually offered. (`ch1-part1.test.ts` imports it too; neither file restates
 * it.)
 *
 * Levels 7-13 cannot be gated on their own rewards alone: level 8's Delay Line
 * and levels 9-13's gates are handed out by part 1 or by earlier levels in this
 * half, so the gating walk below starts from the starter set and walks the WHOLE
 * chapter.
 */

describe('chapter 1 levels 7-13', () => {
  it('exposes seven levels in order', () => {
    // Seven since the 2.x realignment: the XNOR capstone (12) and the logic exam
    // (13) joined, and the level that used to be 12 left for chapter 2.
    expect(CH1_PART2.map((l) => l.index)).toEqual([7, 8, 9, 10, 11, 12, 13]);
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
    // Every kind `LevelCheck` declares is handled, and the final `else` refuses a
    // kind this file does not know instead of falling out of the loop. This loop
    // used to handle only `truth-table` and `script` with no `else`, so a
    // `constraint`, a `fuzz` or a `custom` check -- and any kind a newer kernel
    // adds -- passed it vacuously. The same five branches are in
    // `ch1-part1.test.ts` and in `ch2-batch1.test.ts`, whose copy is itself
    // tested against synthetic vacuous checks (hoisting all three into one
    // fixture would need a file outside this task's declared scope).
    for (const level of CH1_PART2) {
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

const solutions: Record<string, () => Graph> = {
  'ch1-07-always-on': () =>
    build([
      { kind: 'part', def: 'const_on', id: 'src', from: [] },
      { kind: 'output', from: 'src' },
    ]),
  'ch1-08-second-cycle': () =>
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
  // XOR into a NOT: the construction the level's own hint names, and the cheapest
  // circuit its palette admits (4 + 1 = 5 NAND equivalents, two gates deep).
  'ch1-12-xnor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'xor', id: 'x1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'n1', from: ['x1'] },
      { kind: 'output', from: 'n1' },
    ]),
  // The shared-term majority: the three pairwise ANDs (2 each) feeding one OR3
  // (6) -- 12 NAND equivalents, two gates deep. The three-term cascade measures
  // the same 12 on a path three deep, which is what the level's target separates.
  'ch1-13-logic-exam': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'ab', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'ac', from: ['a', 'c'] },
      { kind: 'part', def: 'and', id: 'bc', from: ['b', 'c'] },
      { kind: 'part', def: 'or3', id: 'any', from: ['ab', 'ac', 'bc'] },
      { kind: 'output', from: 'any' },
    ]),
};

/**
 * Circuits that a player would plausibly build and that must be rejected.
 *
 * `ch2-14-binary-racer`'s two entries used to live in this file too, because the
 * level was chapter 1's twelfth and this half owned it. The 2.x realignment moved
 * it to chapter 2 (`src/levels/content/ch2/batch1.ts`), so the circuits moved with
 * it: a level this half no longer contains cannot be looked up in `byId` here, and
 * the loops below would grade `undefined` rather than the circuit.
 */
const wrong: Record<string, () => Graph> = {
  // one delay line is one tick of latency, not two
  'ch1-08-second-cycle': () =>
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

describe("three-star targets are the reference solutions' own metrics", () => {
  // The chapter-1 counterpart of the assertion chapter 2 carries per batch: the
  // reference must score its level's stated target EXACTLY, so a loosened target
  // (which `stars === 3` alone cannot see) fails here instead of passing silently.
  for (const [id, make] of Object.entries(solutions)) {
    it(id, () => {
      const level = byId.get(id) as LevelSpec;
      const { metrics } = grade(make(), registry, level);
      expect(level.threeStar, `measured metrics=${JSON.stringify(metrics)}`).toEqual(metrics);
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
    // Scoped to chapter 1's own thirteen, exactly as `ch1-part1.test.ts` scopes its
    // half: `LEVEL_ORDER` is the whole game now that chapters 2 and 3 are joined,
    // and the game's total length is not this file's business -- chapter 1's order
    // and ids are.
    const chapter1 = [...CH1_PART1, ...CH1_PART2].map((l) => l.id);
    expect(LEVEL_ORDER.slice(0, chapter1.length)).toEqual(chapter1);
  });

  it('resolves this half of the chapter, and reports the level that moved out of it', () => {
    expect(getLevel('ch1-07-always-on')).toBe(CH1_PART2[0]);
    expect(getLevel('ch1-13-logic-exam')).toBe(CH1_PART2[6]);
    // `ch2-14-binary-racer` used to BE `CH1_PART2[5]` -- chapter 1's capstone. The
    // 2.x realignment moved it to chapter 2, so the assertion that it resolves at
    // all is kept here, pinned to the chapter it now belongs to.
    expect(getLevel('ch2-14-binary-racer').chapter).toBe(2);
  });

  it('lists chapter 1 as all thirteen levels', () => {
    // Thirteen since the 2.x realignment, which added the XNOR capstone (12) and
    // the logic exam (13) and moved the level that used to be 12 into chapter 2.
    expect(levelsOfChapter(1).map((l) => l.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    // As in `ch1-part1.test.ts`: the `levelsOfChapter(2)` emptiness claim that
    // used to sit here described the unjoined chapter, and chapter assembly made
    // it false. Chapter 1's own listing above is what this file owns, and the
    // other chapters are covered by `test/levels/unlock-chain.test.ts`.
  });
});
