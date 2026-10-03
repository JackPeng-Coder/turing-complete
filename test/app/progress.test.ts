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

/**
 * A level that hands out nothing, offering one part (`xor`) that no level in
 * this fixture rewards.
 *
 * `rewards` is dropped rather than set to `undefined`: `exactOptionalPropertyTypes`
 * distinguishes an absent key from a present-but-undefined one, and the app reads
 * it with `level.rewards?.components ?? []`. Without this third level the
 * "filters down to what is unlocked" assertion cannot be stated at all any more,
 * because `level` and `other` both reward parts they list (see the tests below).
 */
const { rewards: _ownRewards, ...unrewarded } = level;
const gated: LevelSpec = {
  ...unrewarded,
  id: 'ch1-04-and-gate',
  index: 4,
  allowedComponents: ['xor', 'level_input', 'level_output'],
};

const levels = [level, other, gated];

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

  /**
   * Developer mode opens every level, from a save with nothing passed in it --
   * which is the whole point of it: the levels after the one you are stuck on
   * are the ones you cannot reach by playing.
   */
  it('opens every level in developer mode', () => {
    const fresh = emptyProgress();
    for (const id of order) expect(isUnlocked(fresh, id, order, true), id).toBe(true);
    // ...and an unknown id is still an error: the flag opens gates, it does not
    // make the level list unbounded.
    expect(() => isUnlocked(fresh, 'zzz', order, true)).toThrow(/unknown level/i);
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

  it('is unaffected by developer mode: where you are is not a gate', () => {
    // The flag has no parameter here on purpose. Dev mode opens the map; it does
    // not decide which level the app opens on, and a resume point that moved
    // when a debug switch flipped would be a second, hidden meaning for it.
    expect(resumePointOf(emptyProgress(), order)).toBe('a');
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

  it('does not treat an unpassed level own reward as earned', () => {
    // The "a level may build with its own rewards" rule lives in `paletteDefsFor`
    // and only there. If it leaked into this function, a save would gain parts
    // from levels the player has never passed -- and every later level's gating
    // would be measured against parts nobody earned.
    expect(unlockedComponents(emptyProgress(), levels).has('nand')).toBe(false);
  });
});

describe('paletteDefsFor', () => {
  it('filters the level list down to what is unlocked', () => {
    // `xor` is offered by `gated` and rewarded by nobody, so it is filtered out;
    // the plumbing is in the starter set and survives. (This assertion used to be
    // stated with `other`, whose own rewards now put `nand`/`not` in its palette
    // -- the next test is that rule, and `gated` is what keeps this one about
    // filtering alone.)
    expect(paletteDefsFor(emptyProgress(), levels, gated)).toEqual([
      'level_input',
      'level_output',
    ]);
  });

  it('offers a level its own rewards, before they are earned', () => {
    // A level's own reward is offered to BUILD with: the player meets the part in
    // the level that needs it. Level 13 is the case this exists for -- its parity
    // puzzle cannot be built without the `splitter` it rewards, because every
    // chapter-1 part has 1-bit pins and a wire from a 4-bit input copies bit 0
    // alone -- so without this rule a first-time palette cannot solve the level
    // it is a palette for.
    expect(paletteDefsFor(emptyProgress(), levels, other)).toEqual([
      'nand',
      'not',
      'level_input',
      'level_output',
    ]);
  });

  it('keeps a reward the level does not offer out of its palette', () => {
    // The other half of the rule, and the reason it is safe: the level's own list
    // is still the upper bound. `not` is `level`'s own reward, so the rule above
    // unlocks it -- and it stays out anyway, because that level does not list it.
    const palette = paletteDefsFor(emptyProgress(), levels, level);
    expect(palette).toEqual(['nand', 'level_input', 'level_output']);
    expect(palette).not.toContain('not');
  });

  /**
   * Developer mode opens the LOCK, and only the lock: the level's own list stays
   * the answer, so the palette a developer gets on level 40 is the palette level
   * 40 was designed around rather than every part in the game. Without this half
   * the flag is useless -- open level 47 with a starter palette and there is
   * nothing to build it out of -- and with more than this half it stops being a
   * way to reach a level and becomes a different game.
   */
  it('offers every part a level lists, in developer mode', () => {
    expect(paletteDefsFor(emptyProgress(), levels, gated, true)).toEqual([
      'xor',
      'level_input',
      'level_output',
    ]);
    expect(paletteDefsFor(emptyProgress(), levels, level, true)).toEqual([
      'nand',
      'level_input',
      'level_output',
    ]);
  });

  it('adds a passed level rewards to the next level palette', () => {
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
