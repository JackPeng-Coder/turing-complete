import { describe, expect, it } from 'vitest';
import {
  applyGrade,
  emptyProgress,
  isUnlocked,
  paletteDefsFor,
  resumePointOf,
  unlockedComponents,
} from '../../src/app/progress';
import type { GradeResult } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';

/**
 * Fixture note (brief conflict, see task-10-report.md): the brief's own copy of
 * this fixture cannot satisfy the brief's own `paletteDefsFor` expectations.
 *
 * `paletteDefsFor(progress, levels, level)` is `level.allowedComponents`
 * filtered by what is unlocked, so:
 *  - `other` must actually offer the plumbing, otherwise its palette is empty
 *    and the "filters the level list down to what is unlocked" test can never
 *    see `level_input` / `level_output`;
 *  - passing `level` must unlock `nand`, otherwise the second expectation's
 *    `nand` can never appear. The brief rewarded only `not`.
 * Both expectations below are kept exactly as the brief wrote them.
 */
const level: LevelSpec = {
  id: 'ch1-02-nand-gate',
  chapter: 1,
  index: 2,
  name: { zh: '与非门', en: 'NAND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'level_input', 'level_output'],
  io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
  checks: [],
  rewards: { components: ['nand', 'not'] },
};

const other: LevelSpec = { ...level, id: 'ch1-03-not-gate', index: 3, allowedComponents: ['nand', 'not', 'level_input', 'level_output'] };
const levels = [level, other];

const pass: GradeResult = {
  passed: true,
  metrics: { gate: 2, delay: 2, tick: 0 },
  score: 10,
  stars: 3,
  failures: [],
  issues: [],
};

describe('isUnlocked', () => {
  const order = ['a', 'b', 'c'];
  it('unlocks the first level from the start', () => {
    expect(isUnlocked(emptyProgress(), 'a', order)).toBe(true);
  });
  it('locks later levels until the previous one passes', () => {
    expect(isUnlocked(emptyProgress(), 'b', order)).toBe(false);
  });
  it('unlocks the next level once the previous one passes', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(isUnlocked(p, 'b', order)).toBe(true);
    expect(isUnlocked(p, 'c', order)).toBe(false);
  });
  it('throws for ids outside the order', () => {
    expect(() => isUnlocked(emptyProgress(), 'zzz', order)).toThrow(/unknown level/i);
  });
});

describe('resumePointOf', () => {
  const order = ['a', 'b', 'c'];
  const pass: GradeResult = {
    passed: true,
    metrics: { gate: 1, delay: 1, tick: 0 },
    score: 5,
    stars: 3,
    failures: [],
    issues: [],
  };

  it('starts at the first level', () => {
    expect(resumePointOf(emptyProgress(), order)).toBe('a');
  });

  it('advances past a passed level', () => {
    const p = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    expect(resumePointOf(p, order)).toBe('b');
  });

  it('stays at the newest level when everything is passed', () => {
    const p1 = applyGrade(emptyProgress(), { ...level, id: 'a' }, pass);
    const p2 = applyGrade(p1, { ...level, id: 'b' }, pass);
    const p3 = applyGrade(p2, { ...level, id: 'c' }, pass);
    expect(resumePointOf(p3, order)).toBe('c');
  });

  it('rejects an empty level order instead of returning undefined', () => {
    // "the last level when all are passed" needs a last level to exist; an
    // empty chapter list would otherwise answer `undefined` behind a `string`
    // return type.
    expect(() => resumePointOf(emptyProgress(), [])).toThrow(/empty level order/);
  });
});

describe('unlockedComponents', () => {
  it('always offers the starter components so a level is never unbuildable', () => {
    const unlocked = unlockedComponents(emptyProgress(), levels);
    expect(unlocked.has('level_input')).toBe(true);
    expect(unlocked.has('level_output')).toBe(true);
    expect(unlocked.has('nand')).toBe(false);
  });

  it('adds a reward only after its level is passed', () => {
    const p = applyGrade(emptyProgress(), level, pass);
    expect(unlockedComponents(p, levels).has('not')).toBe(true);
  });

  it('paletteDefsFor filters the level list down to what is unlocked', () => {
    expect(paletteDefsFor(emptyProgress(), levels, other)).toEqual([
      'level_input',
      'level_output',
    ]);
    const p = applyGrade(emptyProgress(), level, pass);
    expect(paletteDefsFor(p, levels, other)).toEqual(['nand', 'not', 'level_input', 'level_output']);
  });
});

describe('applyGrade', () => {
  it('does not mutate the input progress', () => {
    const before = emptyProgress();
    const after = applyGrade(before, level, pass);
    expect(before.levels[level.id]).toBeUndefined();
    expect(after.levels[level.id]?.passed).toBe(true);
  });

  it('keeps the best score only when it improves', () => {
    const better: GradeResult = { ...pass, metrics: { gate: 1, delay: 1, tick: 0 }, score: 5, stars: 3 };
    const worse: GradeResult = { ...pass, metrics: { gate: 9, delay: 9, tick: 9 }, score: 99, stars: 1 };
    const a = applyGrade(emptyProgress(), level, pass);
    const b = applyGrade(a, level, better);
    expect(b.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    const c = applyGrade(b, level, worse);
    expect(c.levels[level.id]?.best).toEqual({ gate: 1, delay: 1, tick: 0 });
    expect(c.levels[level.id]?.stars).toBe(3);
  });

  it('ignores a failed attempt', () => {
    const failed: GradeResult = { ...pass, passed: false, stars: 0, score: 0 };
    const p = applyGrade(emptyProgress(), level, failed);
    expect(p.levels[level.id]).toBeUndefined();
  });
});
