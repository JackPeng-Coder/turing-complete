import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';
import { CH1_PART2 } from './ch1/part2';
import { CH2_LEVELS } from './ch2/index';

/**
 * Every level the game ships, in play order: chapter 1 (levels 1-12), then
 * chapter 2 (levels 13-38).
 *
 * This is the ONLY join between chapters. `levels/index.ts` turns it into
 * `LEVELS` / `LEVEL_ORDER` -- which is what the app walks, what `isUnlocked`
 * gates on, and what the whole-set tests in `test/levels/` walk -- so a chapter
 * that is written but not appended here is invisible to the game however
 * complete it is. That was chapter 2's state until this assembly: 22 of its 26
 * levels existed and no player could reach them.
 *
 * The chapters are appended in index order and nothing sorts or filters them
 * afterwards: level `n + 1` is `LEVEL_ORDER[n + 1]`, which is the invariant
 * `isUnlocked` (the immediate predecessor) is written against.
 */
export const ALL_LEVELS: readonly LevelSpec[] = [...CH1_PART1, ...CH1_PART2, ...CH2_LEVELS];
