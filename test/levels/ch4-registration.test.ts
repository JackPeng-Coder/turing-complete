import { describe, expect, it } from 'vitest';
import { graphFromBoard } from '../../src/levels/board';
// THE ONLY LEVEL IMPORT, and it is the point of this file: the levels come from
// `content/index.ts` -- `ALL_LEVELS`, the game's own join -- and NOT from
// `content/ch4/index.ts` and NOT from a checker module. The two closed-loop
// checkers register themselves into `levels/custom/index.ts` at module
// evaluation, so this file grades them through whatever the content path pulled
// in. If it imported `custom/lock.ts` or `custom/maze.ts` -- as the batch tests
// do, deliberately, because those grade the checkers themselves -- the assertion
// below would prove nothing about the game: a browser session imports the app's
// level list, and it is the app's import graph that has to carry the registration.
import { ALL_LEVELS } from '../../src/levels/content/index';
import { grade } from '../../src/levels/grader';
import type { LevelSpec } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { CH4_REFERENCES } from '../fixtures/ch4-references';

/**
 * The registration hand-off, held shut from the outside.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Chapter 4's levels 54 and 56 ship a
 * `custom` check (`lock`, `maze`) whose params carry the puzzle -- and neither
 * checker is imported by anything under `src/` except the content path this task
 * built. Before it, the only importers in the repository were the tests that
 * grade the checkers directly, so chapter 4 compiled, passed every batch test,
 * and would have failed in a browser with `missing-check`: the check names an id
 * and `levels/checks.ts` looks it up in a registry nothing had filled. A test
 * that imports the checker is exactly the test that cannot see this, which is
 * why this one does not.
 *
 * WHY IT ALSO PINS THE REFERENCES. "Not `missing-check`" alone would be a weak
 * claim -- a registered checker handed a broken program also fails, just with a
 * different reason. So each level is graded with the reference program
 * `test/fixtures/ch4-references.ts` files for it (never a copy here) against the
 * board the level itself ships (`graphFromBoard(level.id, level.board)`), and the
 * assertion is the whole outcome: no failures at all, and a pass. That is the
 * same claim the batch tests make, made once more through the game's own entry
 * point rather than through the chapter's batched data.
 */
const CLOSED_LOOP: ReadonlyArray<readonly [string, string]> = [
  ['ch4-54-code-breaker', 'lock'],
  ['ch4-56-the-maze', 'maze'],
];

/** One level from the game's own join, or a loud failure when it is not there. */
function shippedLevel(id: string): LevelSpec {
  const level = ALL_LEVELS.find((candidate) => candidate.id === id);
  if (!level) throw new Error(`the content path does not ship ${id}`);
  return level;
}

describe('chapter 4 registers its closed-loop checkers on the content path', () => {
  it('ships levels 54 and 56, each with the custom check id its checker owns', () => {
    for (const [id, checker] of CLOSED_LOOP) {
      const level = shippedLevel(id);
      expect(level.checks, `${id} does not ship exactly one custom check`).toHaveLength(1);
      expect(level.checks.map((check) => `${check.kind}:${'id' in check ? check.id : ''}`)).toEqual([
        `custom:${checker}`,
      ]);
    }
  });

  for (const [id, checker] of CLOSED_LOOP) {
    it(`grades ${id}'s reference through the ${checker} checker instead of missing-check`, () => {
      const level = shippedLevel(id);
      const board = level.board;
      expect(board, `${id} ships no board for the reference to run on`).toBeDefined();
      if (!board) return;
      const reference = CH4_REFERENCES[id];
      expect(reference, `${id} has no reference program`).toBeDefined();
      if (!reference) return;

      const result = grade(graphFromBoard(level.id, board), registry, level, {
        text: reference.program,
      });

      // The failure reason this file exists to catch, named first so a
      // regression reports itself as "the checker is not registered" rather than
      // as a generic red grade.
      expect(
        result.failures.map((failure) => failure.reason),
        `${id} graded through the content path: ${JSON.stringify(result.failures)}`,
      ).not.toContain('missing-check');
      expect(result.failures, `${id}: ${JSON.stringify(result.failures)}`).toEqual([]);
      expect(result.passed, id).toBe(true);
    });
  }
});
