import type { CheckOutcome, LevelSpec } from '../spec';
import type { LevelIo } from '../checks';

/**
 * A level-specific checker: the escape hatch for puzzles no declarative check
 * can express (spec §5.2 -- mazes, dance machines, AI duels, space invaders).
 *
 * It receives the kernel's public level interface and the level's own spec, and
 * returns a complete `CheckOutcome`, so it decides its own ticks and its own
 * failure records. Two contracts come with that:
 *
 *  * `io`/`spec` and nothing else. No network, no real time, no DOM: a custom
 *    checker has to run offline, in the same process, while the player edits.
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

export type CustomChecker = (io: LevelIo, spec: LevelSpec) => CheckOutcome;

/**
 * The live registry, keyed by the id a `CustomCheck` names.
 *
 * EMPTY BY DESIGN in phase 1: chapter 2's arithmetic is checked by `fuzz`, and
 * shipping a checker nobody calls would be dead code. Chapter 3 (CPU levels)
 * registers its own by importing a module that calls `registerCustomCheck`, for
 * its side effect, before anything grades a level. A `Map` rather than a frozen
 * object literal because registration is what the mechanism is *for*; nothing
 * here is reachable from level data, which carries ids only.
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
