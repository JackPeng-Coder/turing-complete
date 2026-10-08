import type { CheckOutcome, CustomCheck, LevelSpec } from '../spec';
import type { LevelIo, PlayerProgram } from '../checks';

/**
 * A level-specific checker: the escape hatch for puzzles no declarative check
 * can express (spec §5.2 -- mazes, dance machines, AI duels, space invaders).
 *
 * It receives the kernel's public level interface, the level's own spec, the
 * `custom` check being run (which is where its own `params` live) and the
 * player's program when one was handed in, and returns a complete
 * `CheckOutcome`, so it decides its own ticks and its own failure records. Three
 * contracts come with that:
 *
 *  * `io`/`spec`/`check`/`player` and nothing else. No network, no real time, no
 *    DOM: a custom checker has to run offline, in the same process, while the
 *    player edits. The four arguments are the whole world a checker is allowed
 *    to read, which is what makes one reviewable in isolation.
 *  * Only `io.reset` / `io.writeInput` / `io.readOutput` / `io.tick`. Those four
 *    are the level's whole vocabulary: `io.sim` is reachable for its `tickCount`
 *    and its `loadImage`, but a checker that settles or reads slots through it
 *    is driving the board behind `bindLevelIo`'s back -- and, for the same
 *    reason, behind a test's scripted stub.
 *  * failure records must follow `CheckFailure`'s shape and key their
 *    `inputs` / `expected` / `actual` by the level's own pin ids, with finite
 *    numbers as values, because that is what the failure table renders. A record
 *    that does not -- an unknown pin id, a `NaN` or a string, a missing field --
 *    is treated as a malformed outcome and the check fails as `invalid`: the
 *    player sees a reason, never a broken panel or a silent zero.
 *
 * `runChecks` calls a checker once per check, on a `Simulation` of its own, and
 * adopts the returned outcome: `ticksUsed` is merged into the run's tick metric
 * with `Math.max`, and any failure record it returns makes the check fail even
 * if it also claimed `passed: true` (contradictions fail safe, never open).
 * Because that tick count feeds the star rating, it is part of the checker's
 * contract: it is reviewed together with the checker, like the verdicts are.
 */

export type CustomChecker = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
) => CheckOutcome;

/**
 * The live registry, keyed by the id a `CustomCheck` names.
 *
 * POPULATED BY IMPORT, not by a list here: each checker module calls
 * `registerCustomCheck` for its own id when it is first evaluated, and whatever
 * reads the registry imports the modules it needs. `levels/checks.ts` does NOT
 * import them -- it only looks ids up -- so a checker that nothing imports is
 * not silently loaded and cannot be graded; the level set that uses it names the
 * import, which is where "which checkers ship" is decided. A `Map` rather than a
 * frozen object literal because registration is what the mechanism is *for*;
 * nothing here is reachable from level data, which carries ids only.
 */
const checkers = new Map<string, CustomChecker>();

/**
 * Adds a checker to the registry.
 *
 * Validates its arguments, because registration is code: a typo here should
 * fail at the module that made it, not silently leave a level ungraded later.
 * Re-registration replaces the previous entry instead of throwing: a module
 * that registers itself is re-evaluated by Vite's HMR on every edit, and
 * throwing on the second evaluation would break the dev server rather than
 * catch anything.
 */
export function registerCustomCheck(id: string, checker: CustomChecker): void {
  if (typeof id !== 'string' || id === '') {
    throw new TypeError('registerCustomCheck: id must be a non-empty string');
  }
  if (typeof checker !== 'function') {
    throw new TypeError(`registerCustomCheck(${id}): checker must be a function`);
  }
  checkers.set(id, checker);
}

/** Removes a checker; false when the id was not registered. */
export function unregisterCustomCheck(id: string): boolean {
  return checkers.delete(id);
}

/** The checker registered under `id`, or `undefined` -- which `runChecks` fails on. */
export function getCustomCheck(id: string): CustomChecker | undefined {
  return checkers.get(id);
}

/** Every registered id, in registration order. For tests and future tooling. */
export function customCheckIds(): readonly string[] {
  return [...checkers.keys()];
}
