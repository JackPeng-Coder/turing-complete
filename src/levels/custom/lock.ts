import {
  effectiveBudget,
  invalidOutcome,
  ioIssue,
  registerCustomCheck,
  type CheckerIo,
} from './index';
import {
  describeValue,
  loadProgramImage,
  playerProgramText,
  type LevelIo,
  type PlayerProgram,
} from '../checks';
import type { CheckFailure, CheckOutcome, CustomCheck, LevelSpec } from '../spec';

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
 * uses -- `reset`, `readOutput`, `writeInput`, `settle`, `tick` -- and it never
 * settles or reads slots through `io.sim`: a checker that drove the board behind
 * `bindLevelIo`'s back could not be driven by a scripted stub, which is what its
 * tests are, and its verdicts would depend on the kernel's internals rather than
 * on the level's pins. Loading the program is the one piece of kernel machinery
 * it does use, and it uses it through `loadProgramImage` -- the same helper the
 * `program` branch loads with, so the parse, the target lookup and the
 * reset-then-load ordering exist once.
 *
 * THE PROGRAM IS THE PLAYER'S, AND IT HAS TO ARRIVE. A `custom` check runs on a
 * `Simulation` of its own, so nothing else in the run can have loaded an image:
 * the checker loads `playerProgramText(player)` itself, before its first read,
 * and an empty buffer or a parser refusal is reported as `missing-program` or
 * `invalid` -- never graded as a board that is quietly reading zeros. A board
 * with no `ram_prog` in it is `missing-io` for the same reason.
 *
 * ONE BUDGET UNIT IS ONE EXCHANGE: read the byte on `try`, answer it on `match`,
 * settle so the answer reaches the circuit, apply one edge. The exchange that
 * READS the secret passes and costs no edge, so `lock`'s unit is a tick of the
 * player's program, exactly like `maze`'s unit is one move -- and a run of
 * `budget` units reads `try` `budget` times and applies `budget` edges.
 *
 * WHAT THE ANSWER MEANS ON THIS BOARD, MEASURED. The checker answers the byte it
 * read in the SAME exchange, so the CPU samples, at each edge, the comparison of
 * whatever `try` holds during that edge's instruction. On the OVERTURE board a
 * program publishes `try` with `move|sN|out` and reads `match` with
 * `move|inp|dN` -- two different instructions -- so on the tick the read
 * instruction is decoded `out` has fallen back to 0 and the CPU samples
 * `match == 0`. The reference search still passes (this checker passes on the
 * tick it READS the secret, and a counting program publishes every candidate),
 * and the reference program's own "found" branch is simply never taken: measured
 * on the reference board, the register file's data input at that instruction is 0
 * in every exchange. A level that wants its CPU to ACT on `match` needs a
 * codekeeper with one tick of latency -- the answer to the PREVIOUS tick's byte --
 * which is a different contract from this one and is not something this checker
 * changes on its own say-so.
 *
 * DETERMINISM. No clock, no randomness: the secret is level data, the sequence
 * of reads is the circuit's own, and the same board always grades the same way.
 * The tick count it reports is its own high-water mark and feeds the star
 * rating, exactly as `script`'s does.
 */

/** Ticks a `lock` check runs before it gives up, when the check declares none. */
export const DEFAULT_LOCK_BUDGET = 4096;

/**
 * THE PINS THIS CHECKER DRIVES, and the narrowest widths that can carry what it
 * moves: a byte on `try`, one bit of answer on `match`.
 *
 * Validated before anything else, because the checker addresses the board by
 * name -- see `ioIssue`. A level that declares other pins has to hear about it
 * from the level data's own failure, not from a search that ran against a board
 * the checker never reached.
 */
const LOCK_PINS: CheckerIo = {
  inputs: [{ id: 'match', width: 1 }],
  outputs: [{ id: 'try', width: 8 }],
};

/**
 * The failure a program that will not load produces: keyed by nothing, because
 * no pin was ever driven, and carrying the loader's own sentence.
 *
 * `emptyProgram` is the one case that is not a refusal: a text both readers
 * accept as zero bytes. It gets the same reason and wording the `program` branch
 * gives the player's buffer, because to the circuit "you have not typed a
 * program" and "you typed a comment" are the same nothing.
 */
function programFailure(error: string, reason: NonNullable<CheckFailure['reason']>): CheckOutcome {
  const failure: CheckFailure = {
    check: 'custom',
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason,
    detail: error,
  };
  return { passed: false, failures: [failure], ticksUsed: 0 };
}

/** True when `value` is a whole number in `[0, 255]`, the range an 8-bit code has. */
function isSecret(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
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
 * `spec` IS READ, AND FOR THE PINS: a level whose `io` does not declare `match`
 * and `try` cannot be played at all, and that is the level's defect rather than
 * the player's.
 */
export const callLock = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
): CheckOutcome => {
  const pins = ioIssue(spec, 'lock', LOCK_PINS);
  if (pins !== undefined) return invalidOutcome(pins);

  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  if (!isSecret(params.secret)) {
    return invalidOutcome(
      `lock check declares secret=${describeValue(params.secret)}, which is not a byte (an integer from 0 to 255)`,
    );
  }
  const budget = effectiveBudget(params.budget, DEFAULT_LOCK_BUDGET);
  if (budget === null) {
    return invalidOutcome(
      `lock check declares budget=${describeValue(params.budget)}, which is not a positive integer`,
    );
  }
  const secret = params.secret;

  // RESET FIRST, THEN LOAD THE PLAYER'S PROGRAM. The reset is this checker's own
  // -- `runChecks` compiled the circuit for this check alone but did not settle
  // it, and a read before the first settle would report a fabricated zero for a
  // pin whose value only appears once the circuit has been evaluated. The load
  // resets again on its own way in (a load must land after a reset, see
  // `loadProgramImage`), which is harmless and is not something this checker
  // relies on: the reset above is what makes its first read honest.
  //
  // `'player'` IS THE CHANNEL, and it is named rather than defaulted: the text is
  // the player's buffer, so a refusal that mentions it has to say whose it is.
  io.reset();
  const image = loadProgramImage(io, playerProgramText(player), 'asm', 'player');
  if (image.errors.length > 0) {
    if (image.emptyProgram) {
      return programFailure(
        "the player's program buffer is empty: there is nothing to load, so no instruction would ever execute",
        'missing-program',
      );
    }
    return programFailure(image.errors[0]!, image.reason);
  }

  let tried = 0;
  for (let tick = 0; tick < budget; tick += 1) {
    // READ FIRST. The byte the board publishes is the guess under test, and the
    // board's answer to it is what this iteration writes back.
    tried = io.readOutput('try');
    const matched = tried === secret;
    io.writeInput('match', matched ? 1 : 0);
    if (matched) {
      // The edges the player's machine actually spent, which is what the tick
      // metric and the star rating are made of. A first-read match costs none,
      // so the read that finds the secret is not charged to the program.
      return { passed: true, failures: [], ticksUsed: tick };
    }
    // WRITE, SETTLE, THEN TICK, in that order, and the settle is not optional:
    // an edge samples the storage elements' inputs out of the signal table, and
    // the byte written above only arrives there through the combinational parts
    // between the level's pin and the CPU's register file -- `srcData` -> `d1` ->
    // `data` on the OVERTURE board. Tick without settling and the machine
    // samples the PREVIOUS answer, which is a circuit nobody built and a puzzle
    // with no solution.
    io.settle();
    io.tick();
  }

  // ONE FAILURE, keyed by the level's own pins: the answer that was on `match`
  // while the last code was being tried, and the byte the board's program had
  // reached. THE SECRET IS NOT IN IT. The failure record is what the panel
  // renders, and `truthTable.ts` draws any record with a non-empty vector as a
  // matrix column -- so an `expected` byte would print the answer on the
  // player's first failing run and collapse the closed-loop search this level
  // exists to be. The detail repeats the byte the program reached in words
  // because the failure table renders numbers and a player reads sentences.
  const failure: CheckFailure = {
    check: 'custom',
    inputs: { match: 0 },
    expected: {},
    actual: { try: tried },
    tick: budget,
    reason: 'mismatch',
    detail: `the budget of ${budget} tick(s) ran out with the last code tried being ${tried}`,
  };
  return { passed: false, failures: [failure], ticksUsed: budget };
};

/** `params` is level data: an object or nothing, never a `TypeError`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Registers this checker under the id a `custom` check names. */
registerCustomCheck('lock', callLock);
