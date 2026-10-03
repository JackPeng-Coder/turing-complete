import type { LevelSpec } from '../../spec';
import { CH3_BATCH1 } from './batch1';
import { CH3_BATCH2 } from './batch2';
import { CH3_BATCH3 } from './batch3';

/**
 * Chapter 3, assembled from its batches.
 *
 * The chapter was written in three batches (levels 39-41, 42-44, 45-47) so each
 * author owned a self-contained file; this is the one place they are joined, and
 * nothing else should import a batch directly -- except a batch's own test, which
 * grades that batch against its own file.
 *
 * The order below IS the chapter's order: `content/index.ts` appends this array
 * to chapters 1 and 2, so the three batches land in the game as levels 39..47
 * with nothing between them. `test/levels/unlock-chain.test.ts` is what holds
 * that to a number: 9 levels, indices 39-47, contiguous and unique.
 *
 * THIS JOIN WAS THE LAST THING MISSING, AND ITS ABSENCE WAS INVISIBLE. All three
 * batches existed, compiled and passed their own tests while no player could
 * reach any of them: `content/index.ts` is the only join between chapters, and
 * until it named this array every level here was written but unreachable -- the
 * same failure chapter 2 had before its own assembly, recorded there. The batch
 * tests cannot catch it, because a batch test imports its batch by path and
 * therefore passes whether or not the chapter is ever appended; only
 * `unlock-chain.test.ts` (which walks `ALL_LEVELS`) can, which is why it asserts
 * the chapter boundary by index rather than merely the level count.
 *
 * THE PROGRAM CONSTANTS ARE NOT RE-EXPORTED. `batch2.ts` and `batch3.ts` each
 * export the assembler source their `program` check runs (`PROGRAM_43`,
 * `PROGRAM_45`-`PROGRAM_47`) so those bytes are readable from outside the
 * module. No test reads them today, which is a gap rather than a design:
 * asserting them is why they are exported, and it is the obvious next thing to
 * write. They stay next to the levels that use them: a chapter index is a
 * placement list, and re-exporting them here would invite a second import path
 * to the same string, which is how one of them ends up edited in only one
 * place.
 */
export const CH3_LEVELS: readonly LevelSpec[] = [
  ...CH3_BATCH1,
  ...CH3_BATCH2,
  ...CH3_BATCH3,
];
