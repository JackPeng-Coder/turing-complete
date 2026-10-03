import type { LevelSpec } from '../spec';
import { CH1_PART1 } from './ch1/part1';
import { CH1_PART2 } from './ch1/part2';
import { CH2_LEVELS } from './ch2/index';
import { CH3_LEVELS } from './ch3/index';

/**
 * Every level the game ships, in play order: chapter 1 (levels 1-13), chapter 2
 * (14-39), chapter 3 (40-49).
 *
 * This is the ONLY join between chapters. `levels/index.ts` turns it into
 * `LEVELS` / `LEVEL_ORDER` -- which is what the app walks, what `isUnlocked`
 * gates on, and what the whole-set tests in `test/levels/` walk -- so a chapter
 * that is written but not appended here is invisible to the game however
 * complete it is. That was chapter 2's state until its assembly: 22 of its 26
 * levels existed and no player could reach them. Chapter 3 then repeated the
 * mistake exactly -- all nine levels written, all three batch tests green, and
 * not one of them reachable -- which is the second data point behind the rule
 * that a chapter is not finished until this file names it.
 *
 * FILE MEMBERSHIP NO LONGER IMPLIES ORDER, so this sorts by `index`. A level's
 * index is its global position and `src/levels/campaign.ts` is the table that
 * fixes it; the 2.x realignment moved levels BETWEEN batch files (chapter 2's
 * `circular-dependency` and `delayed-lines` are now the chapter's 4th and 7th
 * levels and still live in `ch2/batch4.ts` beside their old neighbours), so the
 * spread of the files is a record of which task wrote what, not a running
 * order. Sorting here makes level `n + 1` the `LEVEL_ORDER[n + 1]` by
 * construction, which is the invariant `isUnlocked` -- the immediate predecessor
 * -- is written against, and `test/levels/campaign-shape.test.ts` holds the
 * result to the table.
 */
export const ALL_LEVELS: readonly LevelSpec[] = [
  ...CH1_PART1,
  ...CH1_PART2,
  ...CH2_LEVELS,
  ...CH3_LEVELS,
].sort((a, b) => a.index - b.index);
