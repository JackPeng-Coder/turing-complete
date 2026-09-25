import type { LevelSpec } from '../../spec';
import { CH2_BATCH1 } from './batch1';

/**
 * Chapter 2, assembled from its batches.
 *
 * The chapter is written in four batches (levels 13-17, 18-22, 23-27, 28-38) so
 * each author owns a self-contained file; this is the one place they are joined,
 * and the next batch appends its own slice here. Nothing else should import a
 * batch directly.
 *
 * This module is the chapter's own entry point, not the game's: `content/index.ts`
 * (which `levels/index.ts` turns into `LEVELS`) is assembled by the chapter
 * assembly task, and until then chapter 2 is reachable only through this file --
 * which is exactly how `test/levels/ch2-batch1.test.ts` grades it.
 */
export const CH2_LEVELS: readonly LevelSpec[] = [...CH2_BATCH1];
