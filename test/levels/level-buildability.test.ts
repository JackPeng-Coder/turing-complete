import { describe, expect, it } from 'vitest';
import {
  STARTER_COMPONENTS,
  applyGrade,
  emptyProgress,
  paletteDefsFor,
  unlockedComponents,
  type Progress,
} from '../../src/app/progress';
import type { Graph } from '../../src/core/graph';
import { CH2_LEVELS } from '../../src/levels/content/ch2/index';
import { CH3_LEVELS } from '../../src/levels/content/ch3/index';
import { grade, type GradeResult } from '../../src/levels/grader';
import { LEVELS, LEVEL_ORDER } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';
import { CH2_REFERENCES } from '../fixtures/ch2-references';
import { CH3_REFERENCES } from '../fixtures/ch3-references';

/**
 * The whole-set machine check: can the palette the app hands a first-time player
 * build every shipped level's own reference solution, and does every shipped
 * level offer only parts it has earned?
 *
 * WHY THIS FILE EXISTS. Both defects it catches were found by reading, not by a
 * test. Level 16's reference needs `splitter`, and `splitter` is level 16's own
 * reward: `paletteDefsFor` offered the rewards of PASSED levels only, so a
 * first-time palette could not build the level at all. `mem1` is the 1-bit
 * memory chapter 2's latch level builds from, and it was rewarded by no level
 * anywhere, so it could never reach a palette. The per-chapter tests could not
 * see the first -- they assert a reference against `level.allowedComponents`,
 * never against the palette the app computes -- and nothing walked the shipped
 * set as a whole for the second.
 *
 * THE WALK IS DERIVED, NOT LISTED. The level set comes from `LEVELS` /
 * `LEVEL_ORDER` (`src/levels/index.ts`) and the palette comes from
 * `paletteDefsFor` itself; re-deriving `unlockedComponents` filtered by
 * `allowedComponents` here would let this check and the app drift apart, which
 * is the failure mode it exists to catch.
 *
 * BOTH CHAPTERS ARE JOINED NOW, so the shipped set is `LEVELS` -- all 49 ids, no
 * filter and no sibling list. This file used to carry a `NOT_JOINED_YET` slice
 * (`CH2_LEVELS` filtered against `LEVEL_ORDER`) that covered chapter 2's
 * written-but-unreachable levels; `content/index.ts` now appends that same
 * array, the filter matched nothing, and it is gone. The join is asserted rather
 * than assumed, by the `the assembled set` block below: 49 levels, chapter-2
 * indices 14-39 contiguous and unique, and no id twice.
 *
 * THE REFERENCE SOLUTIONS COME FROM TWO PLACES, and the asymmetry is scope
 * rather than taste. Chapter 2's 26 graphs moved to
 * `test/fixtures/ch2-references.ts`, which the four batch tests now share (that
 * file's header explains the move); chapter 1's thirteen are still written out
 * below, because this task may not edit the chapter-1 test files that own them.
 * Either way the copies cannot rot quietly: the tests below grade every filed
 * reference against the level it is filed under, and the walk fails loudly if
 * one stops passing.
 */

/**
 * Every level the repository ships, in the game's order.
 *
 * `LEVELS` IS the game's order -- `levels/index.ts` re-exports `ALL_LEVELS`,
 * which is chapter 1 followed by chapter 2 -- so nothing here re-sorts or
 * re-filters it. A walk that derived its own order could agree with itself while
 * disagreeing with the app, which is the failure this file exists to catch.
 */
const SHIPPED: readonly LevelSpec[] = LEVELS;

/** The shipped level with this id, or a loud failure -- `find` returns `undefined`. */
function specOf(id: string): LevelSpec {
  const level = SHIPPED.find((entry) => entry.id === id);
  if (!level) throw new Error(`no shipped level ${id}`);
  return level;
}

/** The reference solution filed for this level, or a loud failure. */
function solutionFor(id: string): () => Graph {
  const make = REFERENCE_SOLUTIONS[id];
  if (!make) throw new Error(`no reference solution filed for ${id}`);
  return make;
}

/**
 * A pass record for the walks below.
 *
 * The metrics are placeholders and deliberately so: this progress exists to
 * answer "what has the player unlocked by the time they reach level N", and
 * `applyGrade` is the app's own way of writing a pass. Grading the references
 * here would conflate "the palette can build the reference" with "the reference
 * still passes", which is a separate test on purpose.
 */
const PASSED: GradeResult = {
  passed: true,
  metrics: { gate: 0, delay: 0, tick: 0 },
  score: 0,
  stars: 3,
  failures: [],
  issues: [],
};

/** What the player has once every shipped level up to and including `index` is passed. */
function progressThrough(index: number): Progress {
  let progress = emptyProgress();
  for (const level of SHIPPED.slice(0, index + 1)) progress = applyGrade(progress, level, PASSED);
  return progress;
}

/**
 * What the player has when they first open `SHIPPED[index]`: every level BEFORE
 * it passed, the level itself untouched.
 *
 * The level itself must stay unpassed -- that is the whole point. With it
 * passed, its own rewards would arrive through the passed-levels path and this
 * walk could not tell "the palette offers the level its own rewards" from "the
 * player has already finished it"; level 13's defect lived in exactly that gap.
 */
function progressBefore(index: number): Progress {
  return progressThrough(index - 1);
}

/** The palette the app gives a player who has just reached `SHIPPED[index]`. */
function paletteAt(index: number): Set<string> {
  const level = SHIPPED[index];
  if (!level) throw new Error(`no shipped level at index ${index}`);
  return new Set(paletteDefsFor(progressBefore(index), SHIPPED, level));
}

/**
 * Every shipped level's reference solution.
 *
 * Chapter 1's thirteen are copied from the test files that own them (see this
 * file's header for why the copy exists and what keeps it honest) and are the
 * graphs each level's three-star target was measured from, which is what makes
 * "the palette can build the reference" the right thing to assert: the reference
 * is the circuit a player is expected to reach, so a palette that cannot build
 * it cannot pass the level. Chapter 2's 26 are the shared fixture's, one entry
 * per level in index order.
 */
const REFERENCE_SOLUTIONS: Record<string, () => Graph> = {
  'ch1-01-humble-beginnings': () =>
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
  'ch1-06-or-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'not', id: 'n1', from: ['a'] },
      { kind: 'part', def: 'not', id: 'n2', from: ['b'] },
      { kind: 'part', def: 'nand', id: 'g', from: ['n1', 'n2'] },
      { kind: 'output', from: 'g' },
    ]),
  // De Morgan, not OR + NOT: OR is level 6's part in the 2.x chapter and NOR is
  // level 5's, so the reference is the spelling the levels before it unlock --
  // NOT(a) AND NOT(b), the same function at the same 4 gates on a path two deep.
  'ch1-05-nor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'not', id: 'n1', from: ['a'] },
      { kind: 'part', def: 'not', id: 'n2', from: ['b'] },
      { kind: 'part', def: 'and', id: 'g', from: ['n1', 'n2'] },
      { kind: 'output', from: 'g' },
    ]),
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
  // Chapter 1's penultimate level: XOR into a NOT. `xor` is level 9's reward and
  // `not` level 2's, so the palette can build it long before this level.
  'ch1-12-xnor-gate': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'part', def: 'xor', id: 'x1', from: ['a', 'b'] },
      { kind: 'part', def: 'not', id: 'n1', from: ['x1'] },
      { kind: 'output', from: 'n1' },
    ]),
  // Chapter 1's capstone: the three pairwise ANDs into one 3-input OR. Both parts
  // are chapter-1 rewards (`and` at level 4, `or3` at level 10).
  'ch1-13-logic-exam': () =>
    build([
      { kind: 'input', name: 'a' },
      { kind: 'input', name: 'b' },
      { kind: 'input', name: 'c' },
      { kind: 'part', def: 'and', id: 'ab', from: ['a', 'b'] },
      { kind: 'part', def: 'and', id: 'ac', from: ['a', 'c'] },
      { kind: 'part', def: 'and', id: 'bc', from: ['b', 'c'] },
      { kind: 'part', def: 'or3', id: 'any2', from: ['ab', 'ac', 'bc'] },
      { kind: 'output', from: 'any2' },
    ]),
  // Straight wires: chapter 2's opener, which the 2.x realignment moved out of
  // chapter 1. Its reference is the shared fixture's, like the rest of the
  // chapter's -- writing a second copy here would be free to drift from it.
  // Chapter 2, levels 14-39, from the shared fixture the batch tests also use.
  ...CH2_REFERENCES,
  // Chapter 3, levels 40-49, likewise -- and here the fixture matters more than
  // it did for chapter 2. All three chapter-3 levels in a batch share ONE
  // reference graph (`overtureMachine`, `computeUnitGraph`, ...), parameterised
  // by `options`; the fixture is what holds those parameter defaults still, so
  // this walk is checking the palette against the same graph the batch tests
  // measured their three-star targets from. A copy pasted here instead would be
  // free to drift from the measured one, and the drift would read as a pass.
  ...CH3_REFERENCES,
};

describe('the assembled set is chapter 1, then 2, then 3, in order', () => {
  it('ships 49 levels with no id twice', () => {
    // The join's arithmetic, and the two halves of it. A duplicate id would not
    // change either length -- `LEVEL_ORDER` is a list of ids, so the game would
    // simply have two levels by that name and one of them unreachable -- which
    // is exactly why uniqueness is asserted rather than implied by the count.
    expect(LEVELS.length).toBe(49);
    expect(LEVEL_ORDER.length).toBe(49);
    expect(new Set(LEVEL_ORDER).size).toBe(49);
  });

  it('keeps chapter 2 whole, in index order, exactly where its own join put it', () => {
    // `CH2_LEVELS` is the chapter's own entry point (`content/ch2/index.ts`), so
    // this is the claim that matters about the join: what the chapter says it
    // exports, in the order it says it, is what the game's order contains --
    // nothing lost, nothing reordered, nothing doubled.
    const inGame = LEVELS.filter((level) => level.chapter === 2);
    // The chapter's export is compared as a SET of ids rather than as a sequence,
    // which is the 2.x shape rather than a relaxation: the four batches hold
    // scattered slices of the chapter's numbering (batch 1 is 14, 15, 16, 18, 21)
    // and `content/index.ts` sorts the joined set by index, so the game plays the
    // chapter in the campaign's order while `CH2_LEVELS` stays in the authors'
    // batch order. The index walk below is what pins the order; this pins that
    // nothing was lost or doubled on the way in.
    expect([...inGame].map((level) => level.id).sort()).toEqual(
      [...CH2_LEVELS].map((level) => level.id).sort(),
    );
    expect(inGame).toHaveLength(26);
    // Contiguous AND unique: 14..39 with no gap and no repeat, which is what
    // `isUnlocked` (the immediate predecessor) assumes when it walks the order.
    expect(inGame.map((level) => level.index)).toEqual(
      Array.from({ length: 26 }, (_, offset) => 14 + offset),
    );
    expect(new Set(inGame.map((level) => level.index)).size).toBe(26);
  });

  it('keeps chapter 3 whole, in index order, exactly where its own join put it', () => {
    // Chapter 3's version of the claim above, and the one that would have caught
    // its actual defect: the nine levels were written, compiled and passed their
    // own three batch tests while `content/index.ts` never named the chapter, so
    // none of them was reachable. A batch test cannot catch that -- it imports
    // its batch by path, so it passes either way. This one walks the game.
    const inGame = LEVELS.filter((level) => level.chapter === 3);
    expect(inGame.map((level) => level.id)).toEqual(CH3_LEVELS.map((level) => level.id));
    expect(inGame).toHaveLength(10);
    // Contiguous AND unique: 40..49 with no gap and no repeat, which is what
    // `isUnlocked` (the immediate predecessor) assumes when it walks the order.
    expect(inGame.map((level) => level.index)).toEqual(
      Array.from({ length: 10 }, (_, offset) => 40 + offset),
    );
    expect(new Set(inGame.map((level) => level.index)).size).toBe(10);
  });

  it('puts chapters 1 and 2 first, and nothing after chapter 3', () => {
    // "Appends; does not merge or interleave" has two failure directions, and
    // only one of them was ever asserted before chapter 3 existed: a later
    // chapter landing inside an earlier one. The other is an earlier chapter
    // landing after a later one -- which a bare `slice(0, 12)` cannot see -- so
    // the claim is now stated over the whole order rather than its head.
    expect(LEVELS.filter((level) => level.chapter === 1)).toHaveLength(13);
    expect(LEVEL_ORDER.slice(0, 13)).toEqual(
      LEVELS.filter((level) => level.chapter === 1).map((level) => level.id),
    );
    expect(LEVEL_ORDER.slice(13, 39)).toEqual(
      LEVELS.filter((level) => level.chapter === 2).map((level) => level.id),
    );
    expect(LEVEL_ORDER.slice(39)).toEqual(
      LEVELS.filter((level) => level.chapter === 3).map((level) => level.id),
    );
  });
});

describe('every shipped level can build its own reference solution', () => {
  it('files a reference solution for every shipped level', () => {
    // The walk below can only prove something about the levels it has a graph
    // for, so a level shipped without one is a hole in the check, not a pass.
    expect(Object.keys(REFERENCE_SOLUTIONS).sort()).toEqual(SHIPPED.map((level) => level.id).sort());
  });

  it('grades every filed reference against the level it is filed under', () => {
    // This is what keeps the copies above honest: a reference that no longer
    // passes its own level is a stale copy, and the walk below would then be
    // asserting buildability of a circuit the level does not accept.
    for (const level of SHIPPED) {
      const result = grade(solutionFor(level.id)(), registry, level);
      expect(result.failures, `${level.id}: ${JSON.stringify(result.failures)}`).toEqual([]);
      expect(result.passed, level.id).toBe(true);
    }
  });

  for (const [index, level] of SHIPPED.entries()) {
    it(level.id, () => {
      const palette = paletteAt(index);
      for (const inst of solutionFor(level.id)().instances) {
        expect(
          palette.has(inst.def),
          `${level.id} uses ${inst.def}, which its palette does not offer (palette: ${[...palette].join(', ')})`,
        ).toBe(true);
      }
    });
  }
});

describe('no shipped level offers a part it has not earned', () => {
  for (const [index, level] of SHIPPED.entries()) {
    it(level.id, () => {
      // "Earned" is at-or-before, not strictly before: a level may offer the
      // parts its own rewards hand out -- level 16's parity puzzle needs the
      // splitter it rewards -- while still offering nothing from a later level.
      const earned = new Set<string>(STARTER_COMPONENTS);
      for (const atOrBefore of SHIPPED.slice(0, index + 1)) {
        for (const def of atOrBefore.rewards?.components ?? []) earned.add(def);
      }
      for (const def of level.allowedComponents) {
        expect(
          earned.has(def),
          `${level.id} offers ${def}, which no level at or before it rewards`,
        ).toBe(true);
      }

      // The other half of the same rule, on the same walk: the palette is what
      // the level offers intersected with what is unlocked, so a part the level
      // does not offer cannot reach the player however thoroughly the rest of
      // the game has unlocked it. Level 13 is the witness -- it rewards `mem1`
      // and does not list it, and its palette is unchanged by that.
      const palette = paletteAt(index);
      for (const def of palette) {
        expect(
          level.allowedComponents.includes(def),
          `${level.id} offers ${def} in its palette but not in allowedComponents`,
        ).toBe(true);
      }
    });
  }
});

describe('chapter 1 palettes are unchanged by offering a level its own rewards', () => {
  const chapter1 = SHIPPED.filter((level) => level.chapter === 1);

  it('has no chapter-1 level listing its own reward', () => {
    // This is exactly what makes the rule a no-op for chapter 1: the names the
    // rule adds for a level are filtered straight back out by that level's own
    // `allowedComponents`, so every chapter-1 palette is bit-identical.
    for (const level of chapter1) {
      const own = new Set(level.rewards?.components ?? []);
      const listed = level.allowedComponents.filter((def) => own.has(def));
      expect(listed, `${level.id} lists its own reward ${listed.join(', ')}`).toEqual([]);
    }
  });

  it('draws every chapter-1 reference from parts an earlier level rewards', () => {
    // The stronger half of the same claim: chapter 1's references are buildable
    // without the level's own rewards at all, which is what chapter 1 shipped
    // with. `unlockedComponents` on the progress before the level is that set.
    for (const [index, level] of SHIPPED.entries()) {
      if (level.chapter !== 1) continue;
      const before = unlockedComponents(progressBefore(index), SHIPPED);
      for (const inst of solutionFor(level.id)().instances) {
        expect(
          before.has(inst.def),
          `${level.id} uses ${inst.def}, which only its own reward unlocks`,
        ).toBe(true);
      }
    }
  });
});

describe('the latch part chapter 2 builds from is reachable', () => {
  it('hands mem1 to the player by the end of chapter 1', () => {
    // `mem1` (`src/core/defs/index.ts`) is the 1-bit memory chapter 2's latch
    // level builds from. It was rewarded by NO level, so `unlockedComponents`
    // could never contain it and no palette could ever offer it. This is the
    // whole-set guard for that: whatever level finally rewards it, it must be at
    // or before the level that lists it, and by the end of chapter 1 it is in
    // the player's hands.
    const lastChapter1 = SHIPPED.reduce(
      (last, level, index) => (level.chapter === 1 ? index : last),
      -1,
    );
    expect(lastChapter1, 'no chapter-1 level is shipped').toBeGreaterThanOrEqual(0);
    const owned = unlockedComponents(progressThrough(lastChapter1), SHIPPED);
    expect(owned.has('mem1'), 'mem1 is unlocked by no shipped level').toBe(true);
  });

  it('does not put mem1 in the capstone palette that rewards it', () => {
    // The asymmetry on real data: chapter 1's capstone rewards `mem1` without
    // listing it, so its own palette is exactly what it was and the player meets
    // the part on the first level that asks for it -- not before.
    const index = SHIPPED.findIndex((level) => level.id === 'ch1-13-logic-exam');
    expect(index, 'ch1-13-logic-exam is not shipped').toBeGreaterThanOrEqual(0);
    const level = specOf('ch1-13-logic-exam');
    expect(level.rewards?.components ?? []).toContain('mem1');
    expect(paletteAt(index).has('mem1')).toBe(false);
  });
});
