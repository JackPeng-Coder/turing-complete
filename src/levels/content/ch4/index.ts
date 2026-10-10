import type { LevelSpec } from '../../spec';
import { CH4_BATCH1 } from './batch1';
import { CH4_BATCH2 } from './batch2';
// THE REGISTRATION IMPORTS, and they are side effects on purpose. The two
// closed-loop checkers levels 54 and 56 name (`custom: lock`, `custom: maze`) are
// populated into `levels/custom/index.ts`'s registry BY MODULE EVALUATION -- each
// calls `registerCustomCheck` for its own id at the top level -- and nothing else
// in `src/` imports them: `levels/checks.ts` imports only the registry (it looks
// ids up, it does not know the checkers) and `custom/index.ts` deliberately
// imports none of its own checkers. Before this file existed, the only importers
// of `custom/lock.ts` / `custom/maze.ts` in the whole repository were the tests
// that grade those levels, so a player opening level 54 in a browser got
// `missing-check` -- the level's check named a checker no module had registered.
//
// WHY HERE AND NOT IN `custom/index.ts`. Making `custom/index.ts` import its own
// two checkers is the other legal spelling, and it is the one this project
// refused: the import would be a genuine runtime cycle (lock imports
// `registerCustomCheck` from `custom/index.ts`), so the checker's top-level
// `registerCustomCheck('lock', ...)` call would run while `custom/index.ts` was
// still being evaluated -- before its `const checkers = new Map()` line -- and a
// `Map.set` on a module-local `const` that has not been initialised is a TDZ
// `ReferenceError` at import time, in every entry point, for every level. Placed
// on the CONTENT path instead, the edges only run one way (`content/ch4/index.ts`
// -> `custom/lock.ts` -> `custom/index.ts`, which imports nothing at runtime but
// types), so the registry is fully constructed before a checker registers itself
// into it. The set of checkers that ship is still decided by the level set that
// names them, exactly as `custom/index.ts` documents; this is that naming, and
// `test/levels/ch4-registration.test.ts` is what holds it (a test that imports
// NO checker, only this content path, and grades 54 and 56 through it).
import '../../custom/lock';
import '../../custom/maze';

/**
 * Chapter 4, assembled from its two batches.
 *
 * The chapter was written in two batches (levels 50-52, 53-56) so each author
 * owned a self-contained file; this is the one place they are joined, and nothing
 * else should import a batch directly -- except a batch's own test, which grades
 * that batch against its own file.
 *
 * The order below IS the chapter's order: `content/index.ts` appends this array
 * to chapters 1-3, so the two batches land in the game as levels 50..56 with
 * nothing between them. `test/levels/campaign-shape.test.ts` holds the whole set
 * to the campaign table (56 levels, chapters of 13/26/10/7) and
 * `test/levels/level-buildability.test.ts` holds this export to the game's order
 * -- the same pair of checks that caught chapter 3 being written, tested and
 * appended nowhere, which is why a chapter is not finished until
 * `content/index.ts` names it.
 *
 * THE CHAPTER'S DATA IS TWO SHAPES IN FOUR FILES, and the split is by author.
 * Levels 50-55 are the straight-line programming levels (a `program` check that
 * reads the PLAYER's buffer -- `from: 'player'`, no `source` in the level data --
 * on two walks each), and 54/56 are the closed-loop `custom` levels whose data
 * (a secret byte, a maze grid) lives in `params`, in the level. The reference
 * PROGRAMS are not here at all: they belong to `test/fixtures/ch4-references.ts`,
 * one `{ program, format }` per level, because a level that shipped its own
 * reference text would let an empty player buffer be graded against it.
 *
 * THE BOARD IS THE LEVEL'S OWN, CHAPTER 3'S MACHINE (`boards/overture.ts`), and
 * that is a shared circuit rather than a copy: the builder is the same one
 * `test/fixtures/ch3-references.ts` grades the built machine against, so the CPU
 * the player programs in chapter 4 is the CPU the player built in chapter 3.
 */
export const CH4_LEVELS: readonly LevelSpec[] = [...CH4_BATCH1, ...CH4_BATCH2];
