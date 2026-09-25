import { scoreOf } from '../levels/grader';
import type { GradeResult, Metrics } from '../levels/grader';
import type { LevelSpec } from '../levels/spec';

export interface LevelRecord {
  readonly passed: boolean;
  readonly best: Metrics | null;
  readonly stars: 0 | 1 | 3;
}

export interface Progress {
  readonly version: 1;
  readonly levels: Record<string, LevelRecord>;
}

/**
 * Always available, whatever the player has unlocked.
 *
 * This is NOT just the level I/O plumbing. Level 1 offers `const_on` and its
 * reference solution IS `const_on -> level_output`, so the constants have to be
 * available from the very first level -- they cannot come from an earlier
 * reward, because there is no earlier level. Keeping them out of this set makes
 * level 1's palette empty of anything that can drive an output, which is the
 * "level 1 is unplayable" defect this derivation exists to prevent.
 *
 * This is the single copy: the chapter-1 gating tests import it instead of
 * each seeding their own walk with a lookalike list.
 */
export const STARTER_COMPONENTS = [
  'level_input',
  'level_output',
  'const_on',
  'const_off',
] as const;

/**
 * The scoring weights, re-exported rather than redeclared.
 *
 * `levels/grader.ts` owns the formula; a second copy here would let the two
 * drift, and a drifted copy silently invalidates every level's three-star
 * target. Consumers that need the weights import them from either module and
 * get the same object.
 */
export { SCORE_WEIGHTS } from '../levels/grader';

export function emptyProgress(): Progress {
  return { version: 1, levels: {} };
}

/**
 * Level unlocking is strictly linear: the first level is always reachable, and
 * every other one needs its immediate predecessor passed. `order` is the
 * authoritative level sequence (see `LEVEL_ORDER`).
 */
export function isUnlocked(
  progress: Progress,
  levelId: string,
  order: readonly string[],
): boolean {
  const index = order.indexOf(levelId);
  if (index < 0) throw new Error(`unknown level: ${levelId}`);
  if (index === 0) return true;
  const previous = order[index - 1]!;
  return progress.levels[previous]?.passed === true;
}

/**
 * First reachable level that has not been passed; the last level if all are.
 *
 * Deliberately NOT "the last unlocked level": that skips work whenever the
 * player reopens an older level, because passing level 3 unlocks level 4 while
 * levels 5+ stay locked, yet the last unlocked level is 4 -- resuming there
 * would jump over level 4 only by accident and over nothing at all once the
 * player has passed levels out of order.
 */
export function resumePointOf(progress: Progress, order: readonly string[]): string {
  if (order.length === 0) throw new Error('empty level order');
  for (const id of order) {
    if (isUnlocked(progress, id, order) && progress.levels[id]?.passed !== true) return id;
  }
  return order[order.length - 1]!;
}

/**
 * The unlocked component set is *derived*, not stored: every reward from a
 * passed level, plus the starter components. Storing it as well lets the two
 * drift apart after importing an older save, which shows up as "the level
 * requires NAND but progress has no NAND".
 */
export function unlockedComponents(
  progress: Progress,
  levels: readonly LevelSpec[],
): Set<string> {
  const unlocked = new Set<string>(STARTER_COMPONENTS);
  for (const level of levels) {
    if (progress.levels[level.id]?.passed !== true) continue;
    for (const component of level.rewards?.components ?? []) unlocked.add(component);
  }
  return unlocked;
}

/**
 * Parts offered by this level that the player has actually unlocked.
 *
 * The level's own palette is the upper bound: a reward that this level does not
 * offer stays out of it, so the player can only build what the level allows.
 *
 * A level's OWN rewards are offered to build with, before the level is passed.
 * The parts a level hands out are the parts its puzzle was designed around, so
 * withholding them until the player has already solved it is backwards. Level 13
 * is the case that named the rule: its parity puzzle cannot be built without the
 * `splitter` it rewards -- every chapter-1 part has 1-bit pins, and a wire from
 * the 4-bit input copies bit 0 alone -- so a first-time palette that omitted it
 * could not build the level it was a palette for.
 *
 * The asymmetry with `allowedComponents` is deliberate and load-bearing. A
 * level's own reward is offered to *build* with, but the palette still stays
 * bounded by that level's own list, so a part the level does not offer stays out
 * even once it is unlocked: level 12 rewards `mem1` without listing it, and its
 * palette is unchanged by that. The other half -- that a level may not offer a
 * part no level at or before it hands out -- is not enforced here at all, and
 * cannot be: it is a property of the level data, and
 * `test/levels/level-buildability.test.ts` walks every shipped level for it.
 *
 * This is a NO-OP for chapter 1, verified rather than assumed: no chapter-1
 * level lists its own reward, and every chapter-1 reference solution draws only
 * on parts an earlier level rewards. `test/app/progress.test.ts` states the rule
 * for a synthetic level, and the buildability walk's `chapter 1 palettes are
 * unchanged` block pins both halves of that claim on the shipped data.
 */
export function paletteDefsFor(
  progress: Progress,
  levels: readonly LevelSpec[],
  level: LevelSpec,
): string[] {
  const unlocked = new Set([
    ...unlockedComponents(progress, levels),
    ...(level.rewards?.components ?? []),
  ]);
  return level.allowedComponents.filter((def) => unlocked.has(def));
}

/**
 * Records a pass: keeps the best score and the best star rating. Pure.
 *
 * `grade()` scores ANY valid-graph circuit, including one that fails its
 * checks, so a failed attempt is rejected before anything is written. The
 * comparison is against the grader's own `scoreOf`, not a local re-derivation:
 * one formula, one place to change it.
 */
export function applyGrade(
  progress: Progress,
  level: LevelSpec,
  result: GradeResult,
): Progress {
  if (!result.passed) return progress;

  const previous = progress.levels[level.id];
  const best = previous?.best ?? null;
  const improved = best === null || result.score < scoreOf(best);

  return {
    version: 1,
    levels: {
      ...progress.levels,
      [level.id]: {
        passed: true,
        best: improved ? { ...result.metrics } : best,
        stars: Math.max(previous?.stars ?? 0, result.stars) as 0 | 1 | 3,
      },
    },
  };
}
