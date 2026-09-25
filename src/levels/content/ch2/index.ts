import type { LevelSpec } from '../../spec';
import { CH2_BATCH1 } from './batch1';
import { CH2_BATCH2 } from './batch2';
import { CH2_BATCH3 } from './batch3';
import { CH2_BATCH4 } from './batch4';

/**
 * Chapter 2, assembled from its batches.
 *
 * The chapter was written in four batches (levels 13-17, 18-22, 23-27, 28-38) so
 * each author owned a self-contained file; this is the one place they are joined,
 * and nothing else should import a batch directly -- except a batch's own test,
 * which grades that batch against its own file.
 *
 * The order below IS the chapter's order: `content/index.ts` appends this array
 * to chapter 1's two halves, so the four batches land in the game as levels
 * 13..38 with nothing between them. `test/levels/unlock-chain.test.ts` is what
 * holds that to a number: 26 levels, indices 13-38, contiguous and unique.
 *
 * `CH2_LEVELS` was once the join point for batch 1 alone, and
 * `test/levels/ch2-batch1.test.ts` asserted the chapter was exactly that slice.
 * Both are gone now: the chapter is all four batches, and the batch's own test
 * checks only that its slice comes first (see that file's `is the first slice of
 * the assembled chapter`).
 */
export const CH2_LEVELS: readonly LevelSpec[] = [
  ...CH2_BATCH1,
  ...CH2_BATCH2,
  ...CH2_BATCH3,
  ...CH2_BATCH4,
];
