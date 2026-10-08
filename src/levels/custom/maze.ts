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
 * `maze` -- 路在脚下 / The Maze, chapter 4's closed-loop navigation checker.
 *
 * THE PUZZLE. The board is the player's OVERTURE CPU, and a robot walks a grid
 * the level declares. The CPU sees three bits -- a wall directly ahead, one to
 * the left, one to the right, all relative to where the robot is facing -- and
 * answers with a move code. The checker applies the move, publishes the sensors
 * for the state the robot is now in, settles, advances the clock, and asks again.
 * The robot wins by standing on the goal.
 *
 * WHY THE CHECKER TICKS THE BOARD ITSELF. The sensors are a function of the
 * robot's own history: a step list cannot say "the byte you see now depends on
 * the moves you have made", which is the whole puzzle. `LevelIo` is the whole
 * vocabulary used here -- `reset`, `readOutput`, `writeInput`, `settle`, `tick`
 * -- and `io.sim` is never touched, so a scripted stub can drive the checker in a
 * test and the verdict never depends on the kernel's internals. The player's
 * program is loaded through `loadProgramImage`, the same helper the `program`
 * branch loads with, so the parse, the target lookup and the reset-then-load
 * ordering exist once.
 *
 * DETERMINISM. No clock, no randomness, no hidden state: the grid, the start and
 * the facing all come from level data, and the move sequence comes from the
 * circuit. The same board always grades the same way.
 *
 * THE SENSOR BITS ARE THE LEVEL'S BRIEF. bit0 = a wall directly ahead, bit1 = a
 * wall to the left, bit2 = a wall to the right, relative to the current facing,
 * with everything outside the grid counted as a wall. The move codes are 0 stay,
 * 1 forward, 2 turn left, 3 turn right, and a code above 3 is treated as 0 --
 * stated here as well as in the brief because this file is what the checker
 * actually implements, and a brief that drifted from it would teach a program
 * that cannot pass.
 *
 * ONE BUDGET UNIT IS ONE EXCHANGE, the same unit `lock` uses: read the move code
 * the circuit publishes, apply it, publish the sensors of the state it produced,
 * settle, apply one edge. A run of `budget` units therefore reads `move` `budget`
 * times and applies `budget` edges, and the arrival it reports after the last
 * edge is charged the edge that reached it.
 */

/** Ticks a `maze` check runs before it gives up, when the check declares none. */
export const DEFAULT_MAZE_BUDGET = 4096;

/**
 * THE PINS THIS CHECKER DRIVES, and the narrowest widths that can carry what it
 * moves: three sensor bits in, a two-bit move code out.
 *
 * Validated before anything else, because the checker addresses the board by
 * name -- see `ioIssue`. A level whose `io` names them differently has to hear
 * about it from the level's own failure, not from a robot that walked a board the
 * checker never reached.
 */
const MAZE_PINS: CheckerIo = {
  inputs: [{ id: 'sensors', width: 3 }],
  outputs: [{ id: 'move', width: 2 }],
};

/** The four facings, clockwise: turning right is `+1` and left is `+3`, mod 4. */
const FACINGS = ['north', 'east', 'south', 'west'] as const;
type Facing = (typeof FACINGS)[number];
const STEPS: Readonly<Record<Facing, { readonly dx: number; readonly dy: number }>> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

/** Move codes the circuit may publish. Anything above `TURN_RIGHT` means stay. */
const STAY = 0;
const FORWARD = 1;
const TURN_LEFT = 2;
const TURN_RIGHT = 3;

/** The three sensor bits, named so the masks below read as the brief's words. */
const AHEAD_BIT = 1;
const LEFT_BIT = 2;
const RIGHT_BIT = 4;

/** The grid the checker walks, as rows of characters. */
interface MazeGrid {
  readonly rows: readonly string[];
  readonly start: { readonly x: number; readonly y: number };
}

/**
 * The failure a program that will not load produces: keyed by nothing, because
 * no pin was ever driven, and carrying the loader's own sentence.
 *
 * `emptyProgram` is the one case that is not a refusal at all -- a text both
 * readers accept as zero bytes -- and it gets the wording the `program` branch
 * gives the player's buffer, because to the circuit "nothing typed" and "a
 * comment" are the same nothing.
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

/**
 * Reads a grid, or `null` when it is not one.
 *
 * THE RULES a grid must satisfy before a robot can walk it: every row is a
 * string, all rows are the same length (a ragged grid has no columns, so "one
 * cell to the east" would mean different things on different rows), the grid is
 * not empty, and there is exactly one start and one goal. One `S` and one `G`
 * rather than "the first of each": a grid with two starts has two answers to
 * "where is the robot", and a checker that picked one would grade a puzzle the
 * level never described.
 */
function parseGrid(value: unknown): MazeGrid | null {
  const rows = Array.isArray(value) ? value : null;
  if (rows === null || rows.length === 0 || !rows.every((row) => typeof row === 'string')) {
    return null;
  }
  const width = (rows[0] as string).length;
  if (width === 0 || !rows.every((row) => (row as string).length === width)) return null;
  const lines = rows as readonly string[];

  let start: { x: number; y: number } | null = null;
  let starts = 0;
  let goals = 0;
  for (let y = 0; y < lines.length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = lines[y]![x];
      if (cell === 'S') {
        starts += 1;
        start = { x, y };
      } else if (cell === 'G') {
        goals += 1;
      }
    }
  }
  if (starts !== 1 || goals !== 1 || start === null) return null;
  return { rows: lines, start };
}

/** Why `value` is not a walkable grid, for the failure that refuses it. */
function gridIssue(value: unknown): string {
  if (!Array.isArray(value)) return `maze check declares grid=${describeValue(value)}, expected an array of row strings`;
  if (value.length === 0) return 'maze check declares an empty grid: there is no S to start on';
  if (!value.every((row) => typeof row === 'string')) {
    return 'maze check declares a grid with a row that is not a string';
  }
  const rows = value as readonly string[];
  const width = rows[0]!.length;
  if (width === 0) return 'maze check declares a grid whose first row is empty';
  const ragged = rows.findIndex((row) => row.length !== width);
  if (ragged >= 0) {
    return `maze check declares a ragged grid: row ${ragged} is ${rows[ragged]!.length} wide where row 0 is ${width}`;
  }
  const count = (cell: string): number =>
    rows.reduce((total, row) => total + [...row].filter((c) => c === cell).length, 0);
  const starts = count('S');
  const goals = count('G');
  if (starts !== 1 || goals !== 1) {
    return `maze check declares a grid with ${starts} S and ${goals} G; it must have exactly one of each`;
  }
  return 'maze check declares a grid the checker cannot read';
}

/** The character at a cell; outside the grid is a wall, so callers need no bounds test. */
function cellAt(grid: MazeGrid, x: number, y: number): string {
  if (y < 0 || y >= grid.rows.length) return '#';
  const row = grid.rows[y]!;
  if (x < 0 || x >= row.length) return '#';
  return row[x] ?? '#';
}

/** True when the robot cannot enter a cell: `#`, or anything outside the grid. */
function isWall(grid: MazeGrid, x: number, y: number): boolean {
  return cellAt(grid, x, y) === '#';
}

/**
 * The sensor byte for a robot state: bit0 ahead, bit1 left, bit2 right.
 *
 * RELATIVE TO THE FACING, which is the whole reason the bits are computed here
 * rather than stored per cell: "a wall to the left" means a different cell after
 * every turn, and a checker that published absolute walls would make the puzzle
 * a map-reading exercise instead of a program.
 */
function sensorsFor(grid: MazeGrid, x: number, y: number, facing: Facing): number {
  const index = FACINGS.indexOf(facing);
  const ahead = STEPS[FACINGS[index]!]!;
  const left = STEPS[FACINGS[(index + 3) % 4]!]!;
  const right = STEPS[FACINGS[(index + 1) % 4]!]!;
  let sensors = 0;
  if (isWall(grid, x + ahead.dx, y + ahead.dy)) sensors |= AHEAD_BIT;
  if (isWall(grid, x + left.dx, y + left.dy)) sensors |= LEFT_BIT;
  if (isWall(grid, x + right.dx, y + right.dy)) sensors |= RIGHT_BIT;
  return sensors;
}

/**
 * Walks the maze `check.params` describes against the board `io` drives.
 *
 * ONE TICK, ONE MOVE, in that order: read the code the circuit publishes, apply
 * it, publish the sensors of the state the move produced, settle so the byte
 * reaches the circuit, then advance the clock. The sensor byte the circuit reads
 * at tick N therefore describes where the robot IS after N moves, and a program
 * that plans from it is answering a question about the present rather than about
 * one move ago.
 *
 * THE RUN ENDS ONE OF THREE WAYS. The robot stands on `G` -- pass, with the ticks
 * it actually spent. It drives forward into a wall -- an immediate `mismatch`
 * naming the cell and the facing, because a robot that walks through walls is
 * not solving a maze and continuing would report a success the grid never
 * allowed. Or the budget runs out -- the other `mismatch`, naming the cell it
 * gave up in and the move it last applied, which is the only thing that ends a
 * robot that never arrives.
 *
 * `spec` IS READ, FOR THE PINS, and `player` for the program: a level whose `io`
 * does not declare `sensors` and `move` cannot be played at all, and the robot's
 * moves have to come from the text the player wrote -- an empty buffer is a
 * refusal, never a board that quietly reads zeros.
 */
export const callMaze = (
  io: LevelIo,
  spec: LevelSpec,
  check: CustomCheck,
  player?: PlayerProgram,
): CheckOutcome => {
  const pins = ioIssue(spec, 'maze', MAZE_PINS);
  if (pins !== undefined) return invalidOutcome(pins);

  const params: Record<string, unknown> = isRecord(check.params) ? check.params : {};
  const grid = parseGrid(params.grid);
  if (grid === null) return invalidOutcome(gridIssue(params.grid));

  const facing = params.facing === undefined ? 'east' : params.facing;
  if (typeof facing !== 'string' || !FACINGS.includes(facing as Facing)) {
    return invalidOutcome(
      `maze check declares facing=${describeValue(params.facing)}, expected one of ${FACINGS.join(', ')}`,
    );
  }
  const budget = effectiveBudget(params.budget, DEFAULT_MAZE_BUDGET);
  if (budget === null) {
    return invalidOutcome(
      `maze check declares budget=${describeValue(params.budget)}, which is not a positive integer`,
    );
  }

  // RESET FIRST, THEN LOAD THE PLAYER'S PROGRAM, for the reasons `lock` states:
  // `runChecks` compiled this circuit for this check alone but never settled it,
  // so a read before the reset is a fabricated zero, and the program the moves
  // come from has to be in the circuit before the first of them is read. The
  // helper resets again on its own way in, which is harmless and is not something
  // this checker relies on.
  //
  // `'player'` IS THE CHANNEL, named for the same reason: a comment-only buffer
  // has to be reported as the PLAYER having compiled nothing, not as a level that
  // shipped nothing.
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

  let x = grid.start.x;
  let y = grid.start.y;
  let heading = facing as Facing;
  // The move just read and applied, kept across the loop so the failure records
  // can name it: the circuit's own code is the `actual` of a failure.
  let pending = STAY;

  // THE GOAL IS TESTED AFTER EVERY MOVE, NOT BEFORE THE FIRST ONE. `parseGrid`
  // guarantees `G` is a different cell from the `S` the robot starts on, so a
  // test before the loop could never be true -- and the test after each move is
  // what makes "the goal is reached, not a move" true for a program whose last
  // action is a turn or a stay: it passes on the state that move produced,
  // whether or not that move went anywhere.
  for (let tick = 0; tick < budget; tick += 1) {
    pending = io.readOutput('move');
    // A code above the documented three is the documented STAY. It is not a
    // failure: the brief says what an out-of-range code means, and a level that
    // failed one would be failing a program for a reason nothing stated.
    const move = pending === FORWARD || pending === TURN_LEFT || pending === TURN_RIGHT ? pending : STAY;
    if (move === FORWARD) {
      const step = STEPS[heading];
      const nextX = x + step.dx;
      const nextY = y + step.dy;
      if (isWall(grid, nextX, nextY)) {
        return {
          passed: false,
          failures: [
            driveFailure(sensorsFor(grid, x, y, heading), move, tick, x, y, heading, 'wall'),
          ],
          ticksUsed: tick,
        };
      }
      x = nextX;
      y = nextY;
    } else if (move === TURN_LEFT || move === TURN_RIGHT) {
      const index = FACINGS.indexOf(heading);
      heading = FACINGS[(index + (move === TURN_RIGHT ? 1 : 3)) % 4]!;
    }

    // The sensors describe the state the move produced, and they are published
    // and SETTLED before the edge for the reason `lock`'s answer is: an edge
    // samples the storage elements' inputs out of the signal table, and this byte
    // only arrives there through the combinational parts between the level's pin
    // and the CPU's register file. Tick without settling and the machine steers
    // by the sensors of the position it was in one move ago.
    io.writeInput('sensors', sensorsFor(grid, x, y, heading));
    io.settle();
    io.tick();

    // The arrival, and the stay: both are states the robot is IN after the edge,
    // so both pass here -- the turn that lands on nothing (or on the goal) is
    // inspected before the circuit is asked for another move.
    if (cellAt(grid, x, y) === 'G') {
      return { passed: true, failures: [], ticksUsed: tick + 1 };
    }
  }

  // The budget ran out with the robot still walking. One record, keyed by the
  // level's own pins: the sensors the circuit last saw, the move it answered
  // with, and a detail naming the cell and the facing it gave up in. The goal was
  // tested after the last move, so reaching this line means the robot is
  // genuinely still in the maze.
  return {
    passed: false,
    failures: [
      driveFailure(sensorsFor(grid, x, y, heading), pending, budget, x, y, heading, 'budget'),
    ],
    ticksUsed: budget,
  };
};

/**
 * The one failure shape both ways of losing a maze produce.
 *
 * `sensors` is the byte the circuit was reading, `move` the code it answered
 * with, and the detail names the cell, the facing and what went wrong -- the
 * three things a player needs to find the line of their program that walked into
 * a wall, none of which fits in the numeric record.
 */
function driveFailure(
  sensors: number,
  move: number,
  tick: number,
  x: number,
  y: number,
  facing: Facing,
  why: 'wall' | 'budget',
): CheckFailure {
  const at = `(${x},${y}) facing ${facing}`;
  return {
    check: 'custom',
    inputs: { sensors },
    expected: {},
    actual: { move },
    tick,
    reason: 'mismatch',
    detail:
      why === 'wall'
        ? `the robot drove forward into a wall at ${at}`
        : // THE LAST MOVE WAS APPLIED, and the sentence says so. It was read,
          // applied, published and clocked before the goal was tested -- that is
          // the loop -- so calling it "unapplied" would describe a run that never
          // happened and hide the turn the robot really made from the player
          // reading the failure. What ended the run is the budget, not the move.
          `the budget of ${tick} tick(s) ran out with the robot still at ${at} after applying move ${move}`,
  };
}

/** `params` is level data: an object or nothing, never a `TypeError`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Registers this checker under the id a `custom` check names. */
registerCustomCheck('maze', callMaze);
