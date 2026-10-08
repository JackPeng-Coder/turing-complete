import type { LevelIo, PlayerProgram } from '../checks';
import type { CheckOutcome, CustomCheck, LevelSpec } from '../spec';

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
 *  * Only `io.reset` / `io.writeInput` / `io.settle` / `io.readOutput` /
 *    `io.tick`. Those five are the level's whole vocabulary: `io.sim` is
 *    reachable for its `tickCount`, and the kernel's own `loadProgramImage` reads
 *    it for the netlist, but a checker that settles or reads slots through it
 *    itself is driving the board behind `bindLevelIo`'s back -- and, for the same
 *    reason, behind a test's scripted stub. `io.settle` is on the interface
 *    rather than reached through `sim` precisely so that a checker's write ->
 *    settle -> tick protocol is visible to a stub and to a reviewer.
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

/**
 * One pin a checker drives: its id, and the narrowest width that can carry every
 * value the checker moves through it.
 *
 * The width is a MINIMUM rather than the declared one, because a wider pin is
 * always playable -- a byte moves through an 8-bit pin and through a 32-bit one
 * the same way -- while a narrower pin silently changes the puzzle: a 4-bit `try`
 * cannot publish a secret of 42, so the level would fail every program for a
 * reason nothing in the brief mentions.
 */
export interface CheckerPin {
  readonly id: string;
  readonly width: number;
}

/**
 * The level io a checker needs, pin for pin.
 *
 * EXACTLY, in both directions: a missing pin is one the checker would read as a
 * constant 0 (or write into nothing), and an unexpected pin is one the level
 * believes it is playing with and the checker never touches. Either way the
 * player sees a failure the checker produced for a puzzle it was never given, so
 * `ioIssue` blames the level data instead.
 */
export interface CheckerIo {
  readonly inputs: readonly CheckerPin[];
  readonly outputs: readonly CheckerPin[];
}

/** How a set of pins reads inside a failure's `detail`. */
function pinList(pins: readonly CheckerPin[]): string {
  if (pins.length === 0) return 'none';
  return pins.map((pin) => `"${pin.id}" (${pin.width}-bit)`).join(', ');
}

/**
 * Why a level's `io` cannot carry `io`, or `undefined` when it can.
 *
 * THE FIRST THING A CLOSED-LOOP CHECKER VALIDATES, before its own `params` and
 * before it drives anything. Such a checker addresses the board BY PIN NAME: it
 * writes `match` and reads `try`, or writes `sensors` and reads `move`. A level
 * whose `io` names those pins differently -- or declares an extra one the checker
 * never plays with -- makes every failure the checker's own sentence ("the budget
 * ran out with the last code tried being 0") about a puzzle that was never wired
 * up, and the player cannot tell that from a wrong program. Validated here, the
 * blame lands on the level data, which is where the defect is.
 *
 * `spec` is the level that was handed to the checker and `checker` its registry
 * id, so the sentence names both the pin that is wrong and the check that needs
 * it -- the two facts a level author has to have to fix the data.
 */
export function ioIssue(spec: LevelSpec, checker: string, io: CheckerIo): string | undefined {
  const sides = [
    { side: 'input', declared: spec.io.inputs, needed: io.inputs },
    { side: 'output', declared: spec.io.outputs, needed: io.outputs },
  ] as const;
  for (const { side, declared, needed } of sides) {
    for (const pin of needed) {
      const found = declared.find((candidate) => candidate.id === pin.id);
      if (found === undefined) {
        return `the ${checker} check needs a level ${side} pin named "${pin.id}" and the level declares ${pinList(declared)}`;
      }
      if (found.width < pin.width) {
        return `the ${checker} check needs the level ${side} pin "${pin.id}" to be at least ${pin.width} bits wide and the level declares ${found.width}`;
      }
    }
    for (const pin of declared) {
      if (!needed.some((candidate) => candidate.id === pin.id)) {
        return `the ${checker} check drives the level's pins itself and does not use the ${side} pin "${pin.id}"; it needs exactly ${pinList(needed)}`;
      }
    }
  }
  return undefined;
}

/**
 * The outcome that fails a check whose own data cannot be played: one `invalid`
 * record, keyed by nothing, with the sentence that names what is wrong.
 *
 * ONE SHAPE FOR BOTH CLOSED-LOOP CHECKERS, because a failure record is a thing
 * the panel renders and a reviewer reads: `inputs`/`expected`/`actual` are empty
 * because a refused check drives no pin, and the empty maps are the honest
 * statement of that -- the level's pin ids are checked by `runChecks`, so a
 * record keyed by a pin this check never touched would be a lie the kernel
 * cannot catch.
 */
export function invalidOutcome(detail: string): CheckOutcome {
  return {
    passed: false,
    failures: [
      { check: 'custom', inputs: {}, expected: {}, actual: {}, tick: 0, reason: 'invalid', detail },
    ],
    ticksUsed: 0,
  };
}

/**
 * Hard ceiling on a closed-loop `custom` check's `budget`, in its own units.
 *
 * THE SAME RULE AS `FUZZ_ROUNDS_CAP`, and for the same reason: `grade()` runs on
 * every board edit, and one budget unit is a full settle of the circuit (`lock`
 * spends one on each wrong guess, `maze` one on every move), so a level that asks
 * for 10^9 units must not be able to hang the editor. The number matches both
 * checkers' own defaults (`DEFAULT_LOCK_BUDGET`, `DEFAULT_MAZE_BUDGET`), because
 * those defaults are already the longest run the board is willing to pay for on a
 * keystroke: a check that asks for more is clamped to the cap rather than
 * refused, exactly as an over-cap `rounds` is -- the value is usable, it just
 * cannot be afforded. A budget that is not a positive integer is a different
 * thing (a defect in the level) and is refused with `invalid`, never clamped.
 *
 * IT LIVES HERE BECAUSE THIS MODULE OWNS THE CUSTOM-CHECK CONTRACT, and because
 * `effectiveBudget` -- the rule the cap exists for -- is its only reader. Kept in
 * `checks.ts`, where it was written, it made this module import a VALUE back from
 * the module that calls it (`checks.ts` imports `getCustomCheck` from here), so
 * the two files formed a runtime cycle over one number. The custom-check branch
 * of `checks.ts` still reports everything a check declares, but the ceiling on
 * what a checker may spend belongs beside the checkers' own vocabulary, next to
 * the two defaults it agrees with.
 */
export const CUSTOM_BUDGET_CAP = 4096;

/**
 * The budget a closed-loop check actually runs, or `null` when the declared one
 * is unusable.
 *
 * AN OVER-CAP BUDGET IS CLAMPED, NOT REFUSED, following `FUZZ_ROUNDS_CAP`: it is
 * a usable request for more work than `grade()` can afford on a board edit (one
 * unit is a full settle of the circuit), so the check gets the most it can have.
 * A budget that is not a positive integer is a different thing -- a defect in the
 * level, with no sensible interpretation -- and the caller refuses it as
 * `invalid` like every other bad field. `fallback` is the checker's own default,
 * which is the same ceiling, so a check that declares nothing is already at it.
 */
export function effectiveBudget(declared: unknown, fallback: number): number | null {
  if (declared === undefined) return fallback;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared <= 0) return null;
  return Math.min(declared, CUSTOM_BUDGET_CAP);
}
