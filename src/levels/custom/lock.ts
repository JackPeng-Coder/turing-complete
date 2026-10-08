import type { CheckFailure, CheckOutcome, CustomCheck, LevelSpec } from '../spec';
import type { LevelIo, PlayerProgram } from '../checks';
import { registerCustomCheck } from './index';

/**
 * `lock` -- 道破心机 / Code Breaker, chapter 4's first closed-loop checker.
 *
 * THE PUZZLE. The board is the player's OVERTURE CPU, and the checker plays the
 * machine that knows the code: it reads the byte the CPU proposes on `try`,
 * answers `match` with 1 or 0, and keeps going until the CPU proposes the secret
 * the level chose. Nothing about that is expressible as a step list. A `program`
 * or `script` check writes its inputs at step boundaries and reads the outputs
 * they produce, so the board would see `match` only as a constant -- one guess,
 * graded once -- while the puzzle IS the search: the program has to remember what
 * it has tried and count through 256 codes one tick at a time.
 *
 * WHY THE CHECKER TICKS THE BOARD ITSELF. `LevelIo` is the whole vocabulary this
 * uses -- `readOutput`, `writeInput`, `tick` -- and it never settles or reads
 * slots through `io.sim`: a checker that drove the board behind `bindLevelIo`'s
 * back could not be driven by a scripted stub, which is what its tests are, and
 * its verdicts would depend on the kernel's internals rather than on the level's
 * pins.
 *
 * DETERMINISM. No clock, no randomness: the secret is level data, the sequence
 * of reads is the circuit's own, and the same board always grades the same way.
 * The tick count it reports is its own high-water mark and feeds the star
 * rating, exactly as `script`'s does.
 */

/** Ticks a `lock` check runs before it gives up, when the check declares none. */
export const DEFAULT_LOCK_BUDGET = 4096;

/**
 * The outcome that fails a check whose own `params` cannot be played.
 *
 * A bad `secret` or `budget` is a defect in the LEVEL, so it is an `invalid`
 * failure with a sentence naming the field -- never a throw. `runChecks` would
 * absorb a throw into an `invalid` failure too, but it would say "the custom
 * check threw", and the player cannot act on that; naming the field and the
 * value is the whole point of validating level data at the point of use.
 *
 * The two fields are read as `unknown` off a record rather than through a typed
 * `params` interface, because level data reaches the kernel untyped: a declared
 * shape would only describe what the type SAYS is there, and every value below
 * has to be checked anyway.
 */
function invalid(detail: string): CheckOutcome {
  const failure: CheckFailure = {
    check: 'custom',
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason: 'invalid',
    detail,
  };
  return { passed: false, failures: [failure], ticksUsed: 0 };
}

/** True when `value` is a whole number in `[0, 255]`, the range an 8-bit code has. */
function isSecret(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

/** True when `value` is a positive whole number, which is what a budget must be. */
function isBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Plays one game of Code Breaker against the board `io` drives.
 *
 * The checker is the codekeeper, not the codebreaker: it answers whether the
 * byte on `try` is the secret, and the CIRCUIT's program is what has to work
 * through the codes. It therefore stops at the first match and passes, and gives
 * up at the budget with a record naming the last byte it saw -- the two ways a
 * game can end.
 *
 * `_spec` AND `_player` ARE NAMED, NOT DROPPED, and they are unused on purpose.
 * Every checker is called with all four arguments (see `CustomChecker`), so a
 * checker that ignored either would still receive it; what this one grades is the
 * byte the BOARD publishes, which needs neither the level object nor the text in
 * the player's buffer. The underscores say so where a reader would otherwise
 * look for a use.
 */
export const callLock = (
  io: LevelIo,
  _spec: LevelSpec,
  check: CustomCheck,
  _player?: PlayerProgram,
): CheckOutcome => {
  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  if (!isSecret(params.secret)) {
    return invalid(
      `lock check declares secret=${describe(params.secret)}, which is not a byte (an integer from 0 to 255)`,
    );
  }
  const budget = params.budget === undefined ? DEFAULT_LOCK_BUDGET : params.budget;
  if (!isBudget(budget)) {
    return invalid(
      `lock check declares budget=${describe(params.budget)}, which is not a positive integer`,
    );
  }
  const secret = params.secret;

  // NO RESET HERE. `runChecks` compiled this circuit for this check alone and
  // nothing has driven it yet, so the board is already at its zero state; a
  // reset in the middle of a checker's own run would be a second, invisible
  // source of state for the same check.
  let tried = 0;
  for (let tick = 0; tick <= budget; tick += 1) {
    // READ FIRST. The byte the board publishes is the guess under test, and the
    // board's answer to it is what this iteration writes back.
    tried = io.readOutput('try');
    const matched = tried === secret;
    io.writeInput('match', matched ? 1 : 0);
    if (matched) {
      // The ticks the player's machine actually spent, which is what the tick
      // metric and the star rating are made of. A first-read match costs none.
      return { passed: true, failures: [], ticksUsed: tick };
    }
    if (tick === budget) break;
    // One edge per wrong guess, and the write above comes FIRST: an edge samples
    // the pins as they stand after the last settle, so ticking before writing
    // would clock the previous answer -- and on the first iteration a `match`
    // this board has never seen.
    io.tick();
  }

  // ONE FAILURE, keyed by the level's own pins: the answer that was on `match`
  // while the last code was being tried, the byte the level wanted, and the byte
  // the board's program had reached. The detail repeats the number in words
  // because the failure table renders numbers and a player reads sentences.
  const failure: CheckFailure = {
    check: 'custom',
    inputs: { match: 0 },
    expected: { try: secret },
    actual: { try: tried },
    tick: budget,
    reason: 'mismatch',
    detail: `the budget of ${budget} tick(s) ran out with the last code tried being ${tried}, not ${secret}`,
  };
  return { passed: false, failures: [failure], ticksUsed: budget };
};

/** `params` is level data: an object or nothing, never a `TypeError`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short, safe description of an untrusted value, for a failure's `detail`. */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value === undefined) return 'undefined';
  return String(value);
}

/** Registers this checker under the id a `custom` check names. */
registerCustomCheck('lock', callLock);
