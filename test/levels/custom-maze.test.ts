import { describe, expect, it } from 'vitest';
import { emptyGraph } from '../../src/core/graph';
import { Simulation, compile } from '../../src/core/net';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { bindLevelIo, runChecks, type LevelIo } from '../../src/levels/checks';
import { CUSTOM_BUDGET_CAP, customCheckIds } from '../../src/levels/custom/index';
import { callMaze } from '../../src/levels/custom/maze';
import type { CustomCheck, LevelSpec } from '../../src/levels/spec';
import { registry } from '../fixtures/build';
import { scriptedIo } from '../fixtures/level-io';

/**
 * `maze` -- 路在脚下 / The Maze: chapter 4's second closed-loop checker.
 *
 * THE PUZZLE. The board is the player's OVERTURE CPU, and a robot walks a grid
 * the level declares. The CPU sees three bits -- a wall directly ahead, one to
 * the left, one to the right, all relative to where the robot is facing -- and
 * answers with a move code. The checker applies the move, publishes the sensors
 * for the state the robot is now in, settles, advances the clock, and asks again.
 * The robot wins by standing on the goal.
 *
 * THE SENSOR BITS ARE THE LEVEL'S BRIEF: bit0 (1) a wall directly ahead, bit1
 * (2) a wall to the left, bit2 (4) a wall to the right, relative to the current
 * facing, with everything outside the grid counted as a wall. The move codes are
 * 0 stay, 1 forward, 2 turn left, 3 turn right, and anything above 3 is 0.
 *
 * HOW THE TESTS SEE THE ROBOT. The script answers each published sensor byte
 * with a move code, and the test's own model advances by that SAME code -- the
 * one the script returned, not a number read back out of the checker. The
 * assertions then compare every published byte against the byte the brief says
 * that state must publish, so a checker that published the pre-move state, or
 * that moved somewhere other than it said, fails on the byte it sent.
 *
 * THE BUDGET'S UNIT IS ONE EXCHANGE, the same unit `lock` uses: one read of
 * `move`, one applied move, one published sensor byte and one clock edge. A run
 * of `budget` units therefore reads `move` `budget` times and applies `budget`
 * edges, which is why the failure it reports when the robot never arrives sits
 * at tick `budget`.
 */

/**
 * The reference program for this puzzle, verbatim from
 * `.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`
 * (ch4-56): read the sensors into REG4, then loop -- left open, turn left;
 * otherwise ahead open, go forward; otherwise turn right.
 *
 * READ THE JUMP TARGETS: every loop-back is `loadi|1` / `j`, so the loop head is
 * address 1 and REG4 is loaded ONCE, at address 0. The program is a wall
 * follower only for a maze its first decision already solves; on any maze needing
 * a second look at the sensors it walks its stale byte into a wall (measured, and
 * pinned below). The corrected variant one screen down jumps back to 0.
 */
const REFERENCE_PROGRAM = [
  'move|inp|d4',
  'move|s4|d1',
  'loadi|2',
  'move|s0|d2',
  'and',
  'loadi|19',
  'jz',
  'move|s4|d1',
  'loadi|1',
  'move|s0|d2',
  'and',
  'loadi|23',
  'jz',
  'loadi|3',
  'move|s0|out',
  'loadi|1',
  'j',
  'loadi|1',
  'j',
  'loadi|2',
  'move|s0|out',
  'loadi|1',
  'j',
  'loadi|1',
  'move|s0|out',
  'loadi|1',
  'j',
].join('\n');

/**
 * The mirror of the reference program: right open, turn right; otherwise ahead
 * open, go forward; otherwise turn left -- and every loop-back goes to address 0,
 * so the sensors are read again on every pass. This is the program the checker's
 * brief actually asks for, and the one that solves a maze worth walking.
 */
const RIGHT_HAND_PROGRAM = [
  'move|inp|d4',
  'move|s4|d1',
  'loadi|4',
  'move|s0|d2',
  'and',
  'loadi|19',
  'jz',
  'move|s4|d1',
  'loadi|1',
  'move|s0|d2',
  'and',
  'loadi|23',
  'jz',
  'loadi|2',
  'move|s0|out',
  'loadi|0',
  'j',
  'loadi|1',
  'j',
  'loadi|3',
  'move|s0|out',
  'loadi|0',
  'j',
  'loadi|1',
  'move|s0|out',
  'loadi|0',
  'j',
].join('\n');

/** The player's buffer, as `runChecks` receives it. */
const PLAYER = { text: REFERENCE_PROGRAM };

/** The four facings, clockwise: turning right is `+1` and left is `+3`, mod 4. */
const DIRS = [
  { dx: 0, dy: -1 }, // 0 north
  { dx: 1, dy: 0 }, // 1 east
  { dx: 0, dy: 1 }, // 2 south
  { dx: -1, dy: 0 }, // 3 west
] as const;
const FACINGS = ['north', 'east', 'south', 'west'] as const;

const AHEAD_BIT = 1;
const LEFT_BIT = 2;
const RIGHT_BIT = 4;

const STAY = 0;
const FORWARD = 1;
const TURN_LEFT = 2;
const TURN_RIGHT = 3;

interface Robot {
  readonly x: number;
  readonly y: number;
  /** Index into `DIRS`. */
  readonly facing: number;
}

const MAZE = (grid: readonly string[], facing?: string, budget?: number): CustomCheck => {
  const params: Record<string, string | number | readonly string[]> = { grid };
  if (facing !== undefined) params.facing = facing;
  if (budget !== undefined) params.budget = budget;
  return { kind: 'custom', id: 'maze', params };
};

/** The level `maze` is written against: an 8-bit sensor byte in, a move code out. */
const MAZE_LEVEL: LevelSpec = {
  id: 'test-maze',
  chapter: 4,
  index: 2,
  name: { zh: '路在脚下', en: 'The Maze' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['level_input', 'level_output'],
  io: {
    inputs: [{ id: 'sensors', width: 8 }],
    outputs: [{ id: 'move', width: 8 }],
  },
  checks: [],
};

/** Is the cell a wall? Everything outside the grid is one, and so is `#`. */
function isWall(grid: readonly string[], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return true;
  const row = grid[y] ?? '';
  if (x < 0 || x >= row.length) return true;
  return row[x] === '#';
}

/**
 * The sensor byte for a robot state, written from the brief's own words.
 *
 * This is the test's INDEPENDENT reading of the level's interface, and every
 * assertion about a published byte compares the checker's value with this one. A
 * helper shared with the checker would make that comparison vacuous: the two
 * would be the same expression, and the test would pass whatever the brief said.
 */
function sensorsOf(grid: readonly string[], robot: Robot): number {
  const ahead = DIRS[robot.facing]!;
  const left = DIRS[(robot.facing + 3) % 4]!;
  const right = DIRS[(robot.facing + 1) % 4]!;
  let sensors = 0;
  if (isWall(grid, robot.x + ahead.dx, robot.y + ahead.dy)) sensors |= AHEAD_BIT;
  if (isWall(grid, robot.x + left.dx, robot.y + left.dy)) sensors |= LEFT_BIT;
  if (isWall(grid, robot.x + right.dx, robot.y + right.dy)) sensors |= RIGHT_BIT;
  return sensors;
}

/** Applies a move code to a robot state; a forward move into a wall is left alone. */
function moved(grid: readonly string[], robot: Robot, move: number): Robot {
  if (move === TURN_LEFT) return { ...robot, facing: (robot.facing + 3) % 4 };
  if (move === TURN_RIGHT) return { ...robot, facing: (robot.facing + 1) % 4 };
  if (move !== FORWARD) return robot;
  const ahead = DIRS[robot.facing]!;
  if (isWall(grid, robot.x + ahead.dx, robot.y + ahead.dy)) return robot;
  return { x: robot.x + ahead.dx, y: robot.y + ahead.dy, facing: robot.facing };
}

interface Run {
  readonly outcome: ReturnType<typeof callMaze>;
  /** The sensor byte the checker published at each tick, in tick order. */
  readonly published: readonly number[];
  /** Every byte the test's model says each of those states must publish. */
  readonly expected: readonly number[];
  /** Where the test's own model of the robot ended up. */
  readonly robot: Robot;
}

/**
 * Runs the maze with a scripted follower that answers with move codes.
 *
 * The follower is handed the TEST MODEL's own sensor byte for the state the
 * script's robot is in -- `sensorsOf(grid, robot)`, computed from the grid the
 * test itself read -- and it may also read that robot. It does NOT see the byte
 * the checker published; the passage from one to the other is what these tests
 * are checking. Each published byte is logged WITH the byte the model says the
 * state it moved into must publish, so a divergence shows up as a pair of
 * unequal arrays rather than as a verdict nobody can check -- and the follower
 * the level's reference program stands in for decides from the sensor byte
 * alone, which is why `clockFace` takes nothing else.
 *
 * The checker gets the reference program as the player's text: it loads a program
 * before it drives anything, and an empty buffer would be a `missing-program`
 * refusal rather than the geometry these tests are about.
 */
function runMaze(
  grid: readonly string[],
  start: Robot,
  follower: (sensors: number, robot: Robot) => number,
  budget = 64,
  text: string = REFERENCE_PROGRAM,
): Run {
  let robot = start;
  let chosen = STAY;
  const published: number[] = [];
  const expected: number[] = [];
  const script = scriptedIo({ known: ['sensors', 'move'] });
  const io = {
    ...script.io,
    readOutput(name: string): number {
      script.io.readOutput(name);
      // ASK, THEN MOVE. The checker reads a move code and applies it before it
      // publishes anything, so the byte it writes belongs to the state the move
      // produced -- and the answer to give it is about the state it is in NOW,
      // which the previous publish described.
      chosen = follower(sensorsOf(grid, robot), robot);
      robot = moved(grid, robot, chosen);
      return chosen;
    },
    writeInput(name: string, value: number): void {
      script.io.writeInput(name, value);
      // Published and expected are recorded TOGETHER, at the publish, so a run
      // that stops on a collision leaves no unmatched expectation behind: the
      // move that was refused was never published either.
      published.push(value);
      expected.push(sensorsOf(grid, robot));
    },
  };

  const outcome = callMaze(
    io,
    MAZE_LEVEL,
    {
      kind: 'custom',
      id: 'maze',
      params: { grid, facing: FACINGS[start.facing] as string, budget },
    },
    { text },
  );

  return { outcome, published, expected, robot };
}

/**
 * A follower that decides from the sensor byte ALONE, the way the level's
 * reference program does: turn right when the right is open, walk forward when
 * it can, turn left otherwise. It never reads the grid, so it cannot lean on
 * anything the circuit would not know.
 */
function clockFace(sensors: number): number {
  if ((sensors & RIGHT_BIT) === 0) return TURN_RIGHT;
  if ((sensors & AHEAD_BIT) === 0) return FORWARD;
  return TURN_LEFT;
}

describe('the maze checker registers itself', () => {
  it('is in the registry once its module has been imported', () => {
    expect(customCheckIds()).toContain('maze');
  });

  it('keeps the registry order the imports establish', () => {
    // `custom-lock.test.ts` proves the same thing for `lock`; the module under
    // test is the only one this file imports.
    expect(customCheckIds()).toEqual(['maze']);
  });
});

describe('maze', () => {
  it('walks a straight corridor to the goal and reports the ticks it spent', () => {
    const grid = ['#####', '#S.G#'];
    const { outcome, published, expected, robot } = runMaze(
      grid,
      { x: 1, y: 1, facing: 1 },
      () => FORWARD,
    );

    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(2);
    // Two exchanges for two moves: the byte published at tick 1 is the one that
    // described the GOAL, which is why the run ends without a third.
    expect(published).toEqual(expected);
    expect(published).toEqual([
      sensorsOf(grid, { x: 2, y: 1, facing: 1 }),
      sensorsOf(grid, { x: 3, y: 1, facing: 1 }),
    ]);
    expect(robot).toEqual({ x: 3, y: 1, facing: 1 });
  });

  it('publishes the sensors of the state the move produced, not the old one', () => {
    // The half of the contract a coordinate list cannot see: the three bits are
    // relative to the CELL the robot is standing on, so a step changes the byte
    // even though the facing did not. In this open room the robot walks north
    // through a different set of walls at every step, so a checker that published
    // the PRE-move state would send the whole sequence one position late -- its
    // first byte would be the room the robot started in, not the one it moved to.
    const grid = ['#####', '#...#', '#...#', '#S#G#'];
    const { outcome, published, expected } = runMaze(
      grid,
      { x: 1, y: 3, facing: 0 },
      () => FORWARD,
      3,
    );

    // Index for index. `expected[i]` is the byte the model's robot must publish
    // after move `i`, and the checker's byte `i` is the one it published after
    // applying that same move. Two publishes: the third move walks into the top
    // wall, and a refused move publishes nothing.
    expect(published).toEqual(expected);
    expect(published).toHaveLength(2);
    // ...and the sequence is not constant, or "the arrays agree" would say
    // nothing about which state either of them describes.
    expect(published[1]).not.toBe(published[0]);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(2);
    expect(outcome.failures[0]?.detail).toContain('wall');
  });

  it('fails when the robot drives forward into a wall, naming the cell', () => {
    // Facing north at (1,1) with a wall above: bit0 is set, so forward is a
    // wall. The record is keyed by the level's pins and the detail names the cell
    // and the facing, because "you hit a wall" without a coordinate is not
    // actionable.
    const grid = ['#####', '#S#G#'];
    const { outcome, published } = runMaze(
      grid,
      { x: 1, y: 1, facing: 0 },
      () => FORWARD,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    const failure = outcome.failures[0]!;
    expect(failure.check).toBe('custom');
    expect(failure.reason).toBe('mismatch');
    // The state the robot was in when it drove into the wall, and the move it
    // answered with: the refusal carries both.
    expect(failure.inputs).toEqual({ sensors: AHEAD_BIT | LEFT_BIT | RIGHT_BIT });
    expect(failure.actual).toEqual({ move: FORWARD });
    expect(failure.tick).toBe(0);
    expect(failure.detail).toContain('(1,1)');
    expect(failure.detail).toContain('north');
    expect(failure.detail).toContain('wall');
    expect(outcome.ticksUsed).toBe(0);
    // A refusal publishes nothing: the checker never got as far as the byte, and
    // the collision is the whole of what happened. (The model's `expected` list
    // is filled at READ time, which is why it is not the array to check here.)
    expect(published).toEqual([]);
  });

  it('fails on the budget when a turn-only script never advances', () => {
    // A robot that only turns is a legal robot: nothing about turning is an
    // error, and a checker that called it one would fail an exploring program.
    // What it is not is FINISHED, so the budget is what ends the run.
    const grid = ['#####', '#S.G#'];
    const { outcome, published, expected, robot } = runMaze(
      grid,
      { x: 1, y: 1, facing: 1 },
      () => TURN_RIGHT,
      10,
    );

    expect(published).toEqual(expected);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(10);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.reason).toBe('mismatch');
    expect(outcome.failures[0]?.detail).toContain('budget');
    expect(outcome.failures[0]?.detail).toContain('(1,1)');
    // THE LAST MOVE WAS APPLIED, and the record has to say so: the checker read
    // the code, applied it, published the sensors it produced and clocked the
    // edge before it tested for the goal, so a detail calling the move
    // "unapplied" would describe a run that never happened -- and hide the turn
    // the robot really took from the player reading it.
    expect(outcome.failures[0]?.actual).toEqual({ move: TURN_RIGHT });
    expect(outcome.failures[0]?.detail).toContain(`after applying move ${TURN_RIGHT}`);
    expect(outcome.failures[0]?.detail).not.toContain('unapplied');
    expect(published).toHaveLength(10);
    // Ten right turns is two and a half full turns: the model ends facing west,
    // on the cell it started from.
    expect(robot.x).toBe(1);
    expect(robot.y).toBe(1);
    expect(robot.facing).toBe(3);
  });

  it('solves a wall-following maze with the reference algorithm', () => {
    // A maze whose corridors are one cell wide, which is what a wall-follower
    // needs: the robot opens in the bottom corridor, and the only route to `G`
    // goes east to the right-hand wall and then north up the map. The follower
    // below reads the SENSOR BYTE and nothing else, exactly as the level's
    // reference program does, and the published bytes check it at every tick.
    const grid = ['########', '#....#G#', '#.##.#.#', '#.#..#.#', '#.#.##.#', '#S.....#', '########'];
    const { outcome, published, expected, robot } = runMaze(
      grid,
      { x: 1, y: 5, facing: 1 },
      (sensors) => clockFace(sensors),
    );

    expect(published).toEqual(expected);
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(10);
    // The test's own model finished on the goal, which is where the checker says
    // the robot is. It arrives facing north: the last move of the route is the
    // step up the right-hand corridor onto `G`.
    expect(robot.facing).toBe(0);
    expect(robot.x).toBe(6);
    expect(robot.y).toBe(1);
    expect(grid[robot.y]![robot.x]).toBe('G');
    expect(published).toHaveLength(10);
    // The opening byte is the state after the first step east: the wall of the
    // corridor above is on the LEFT and the map's edge is on the RIGHT.
    expect(published[0]).toBe(LEFT_BIT | RIGHT_BIT);
  });

  it('counts a turn or a stay on the goal as having reached it', () => {
    // The goal is a state the robot is IN, not a move it makes: a program that
    // arrives and then keeps turning has still solved the maze, and a checker
    // that required a fresh forward move onto `G` would fail such a program --
    // or, worse, walk it back off the goal.
    const grid = ['#####', '#SG.#'];
    let calls = 0;
    const { outcome, published } = runMaze(
      grid,
      { x: 1, y: 1, facing: 1 },
      () => {
        calls += 1;
        return calls === 1 ? FORWARD : TURN_RIGHT;
      },
      8,
    );

    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    // One tick spent walking onto the goal, and no second exchange: the script
    // would have kept turning had the checker kept asking.
    expect(outcome.ticksUsed).toBe(1);
    expect(published).toHaveLength(1);
  });

  it('treats a move code above the documented three as stay', () => {
    // The move codes are 0..3; anything else is not "an unknown instruction" but
    // the documented `stay`, so a program that publishes a stray value loses time
    // rather than failing the level for a reason the brief never states.
    const grid = ['#####', '#S.G#'];
    const { outcome, robot } = runMaze(grid, { x: 1, y: 1, facing: 1 }, () => 200, 3);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(3);
    expect(robot).toEqual({ x: 1, y: 1, facing: 1 });
  });

  it.each<[string, readonly string[]]>([
    // Wide enough that the S/G count is what refuses them: a ragged grid is a
    // different finding, and a fixture that was both would pass this test while
    // proving the wrong rule.
    ['no S', ['#####', '#..G#', '#####']],
    ['two S', ['#####', '#SSG#', '#####']],
    ['no G', ['#####', '#.S.#', '#####']],
    ['two G', ['#####', '#SGG#', '#####']],
    ['no S and no G', ['#####', '#...#', '#####']],
  ])('refuses a grid with %s as invalid', (_label, grid) => {
    const { io, script } = scriptedIo({ known: ['sensors', 'move'] });
    const outcome = callMaze(io, MAZE_LEVEL, MAZE(grid));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('S');
    expect(outcome.failures[0]?.detail).toContain('G');
    // A refused grid drives nothing at all.
    expect(script.ticks()).toBe(0);
    expect(script.writes).toEqual([]);
  });

  it('refuses a ragged grid as invalid', () => {
    const { io, script } = scriptedIo({ known: ['sensors', 'move'] });
    const outcome = callMaze(io, MAZE_LEVEL, MAZE(['#####', '#S.#', '#G#']));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('row');
    expect(script.ticks()).toBe(0);
  });

  it.each<[string, unknown]>([
    ['a grid that is not an array', '#####'],
    ['a grid of numbers', [1, 2, 3]],
    ['no grid at all', undefined],
    ['an empty grid', []],
  ])('refuses %s as invalid', (_label, grid) => {
    const check = { kind: 'custom', id: 'maze', params: { grid } } as unknown as CustomCheck;
    const outcome = callMaze(scriptedIo().io, MAZE_LEVEL, check);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('grid');
  });

  it.each<[string, Record<string, unknown>]>([
    ['an unknown facing', { facing: 'up' }],
    ['a facing that is not a string', { facing: 2 }],
    ['a zero budget', { budget: 0 }],
    ['a fractional budget', { budget: 1.5 }],
    ['a negative budget', { budget: -4 }],
  ])('refuses %s as invalid', (_label, extra) => {
    const grid = ['#####', '#S.G#'];
    const check = {
      kind: 'custom',
      id: 'maze',
      params: { grid, ...extra },
    } as unknown as CustomCheck;
    const outcome = callMaze(scriptedIo().io, MAZE_LEVEL, check);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
  });

  it('reads only the pins the level declares, and does not need an output pin to refuse a grid', () => {
    // `sensors` in and `move` out are the level's whole interface. A checker that
    // read some other name would get 0 forever on a real board, and the stub
    // records the read so this test can see it: `known` lists exactly the two
    // pins, so any other name is reported as unknown. The script never answers
    // forward, so the robot stays where it is and the run ends on the budget.
    const grid = ['#####', '#S.G#'];
    const script = scriptedIo({ known: ['sensors', 'move'] });
    const outcome = callMaze(script.io, MAZE_LEVEL, MAZE(grid, undefined, 4), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(4);
    expect(script.readUnknown()).toBe(false);
    expect(new Set(script.log.filter((c) => c.method === 'readOutput').map((c) => c.name))).toEqual(
      new Set(['move']),
    );
    expect(new Set(script.log.filter((c) => c.method === 'writeInput').map((c) => c.name))).toEqual(
      new Set(['sensors']),
    );
    // The protocol the log records: four exchanges, each one a read of `move`, an
    // answer on `sensors`, a settle and an edge -- with the reset and the load
    // before the first read.
    const firstRead = script.log.findIndex((call) => call.method === 'readOutput');
    expect(script.log.slice(0, firstRead).some((call) => call.method === 'reset')).toBe(true);
    expect(script.log.slice(firstRead).map((call) => call.method)).toEqual([
      'readOutput', 'writeInput', 'settle', 'tick',
      'readOutput', 'writeInput', 'settle', 'tick',
      'readOutput', 'writeInput', 'settle', 'tick',
      'readOutput', 'writeInput', 'settle', 'tick',
    ]);
    expect(script.settles()).toBe(4);
  });

  it('refuses to run at all when the player has typed nothing', () => {
    // The same rule `lock` keeps: the checker drives the player's program, so an
    // empty buffer is a refusal naming the buffer rather than a robot driven by a
    // board that is reading zeros.
    for (const text of ['', '  \n']) {
      const script = scriptedIo({ known: ['sensors', 'move'] });
      const outcome = callMaze(script.io, MAZE_LEVEL, MAZE(['#####', '#S.G#']), { text });
      expect(outcome.passed).toBe(false);
      expect(outcome.failures[0]?.reason).toBe('missing-program');
      expect(outcome.failures[0]?.detail).toContain('empty');
      expect(script.ticks()).toBe(0);
    }
  });

  it('refuses a program the assembler rejects, naming the line', () => {
    const outcome = callMaze(scriptedIo({ known: ['sensors', 'move'] }).io, MAZE_LEVEL, MAZE(['#####', '#S.G#']), {
      text: 'move|nowhere|d1',
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('line 1');
  });

  it('refuses a board with nowhere to put the program', () => {
    const script = scriptedIo({ known: ['sensors', 'move'], programRam: false });
    const outcome = callMaze(script.io, MAZE_LEVEL, MAZE(['#####', '#S.G#']), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-io');
    expect(outcome.failures[0]?.detail).toContain('ram_prog');
    expect(script.ticks()).toBe(0);
  });

  it('describes untrusted params whose own toString throws without throwing itself', () => {
    // Level data is untrusted all the way down: an object where a grid belongs
    // must become a sentence naming the field, not an exception `runChecks`
    // reports as "the custom check threw".
    const grid = {
      toString(): string {
        throw new TypeError('grid exploded');
      },
    };
    const check = { kind: 'custom', id: 'maze', params: { grid } } as unknown as CustomCheck;
    const outcome = callMaze(scriptedIo().io, MAZE_LEVEL, check);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('grid');
    expect(outcome.failures[0]?.detail).toContain('object');
  });

  it('clamps an over-cap budget to the ceiling instead of hanging the editor', () => {
    // The same ceiling `lock` applies, and the same rule `FUZZ_ROUNDS_CAP`
    // states: `grade()` runs on every board edit, so a level asking for a
    // billion moves gets the most the editor can afford.
    expect(CUSTOM_BUDGET_CAP).toBe(4096);
    const script = scriptedIo({ known: ['sensors', 'move'] });
    const outcome = callMaze(
      script.io,
      MAZE_LEVEL,
      MAZE(['#####', '#S.G#'], undefined, CUSTOM_BUDGET_CAP + 10_000),
      PLAYER,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(CUSTOM_BUDGET_CAP);
    expect(script.ticks()).toBe(CUSTOM_BUDGET_CAP);
  });

  it('blames the level when its io does not name the pins this checker drives', () => {
    // I4, for the maze: `sensors` in and `move` out are what the checker drives,
    // and a level that names them differently -- or declares a pin the checker
    // never plays with -- hears about it from the level's own failure rather than
    // from a robot that walked a board nobody wired.
    const missingPin: LevelSpec = {
      ...MAZE_LEVEL,
      io: { inputs: [{ id: 'walls', width: 8 }], outputs: [{ id: 'move', width: 8 }] },
    };
    const unexpectedPin: LevelSpec = {
      ...MAZE_LEVEL,
      io: {
        inputs: [{ id: 'sensors', width: 8 }],
        outputs: [
          { id: 'move', width: 8 },
          { id: 'spare', width: 8 },
        ],
      },
    };
    const narrowInput: LevelSpec = {
      ...MAZE_LEVEL,
      io: { inputs: [{ id: 'sensors', width: 2 }], outputs: [{ id: 'move', width: 8 }] },
    };

    const cases: ReadonlyArray<readonly [LevelSpec, string]> = [
      [missingPin, 'sensors'],
      [unexpectedPin, 'spare'],
      [narrowInput, 'sensors'],
    ];
    for (const [level, named] of cases) {
      const script = scriptedIo({ known: ['sensors', 'move'] });
      const outcome = callMaze(script.io, level, MAZE(['#####', '#S.G#']), PLAYER);
      expect(outcome.passed).toBe(false);
      expect(outcome.failures).toHaveLength(1);
      expect(outcome.failures[0]?.reason).toBe('invalid');
      expect(outcome.failures[0]?.detail).toContain(named);
      expect(script.ticks()).toBe(0);
      expect(script.resets()).toBe(0);
    }
  });

  it('starts on S facing east by default', () => {
    // The documented default, and the one the level's reference program assumes:
    // the robot opens facing east, not north. `G` sits one cell east of `S`, so a
    // single forward move solves this maze -- a checker that defaulted to north
    // would hit the wall above `S` and fail on the collision instead.
    const grid = ['####', '#SG#'];
    const { outcome, robot } = runMaze(grid, { x: 1, y: 1, facing: 1 }, () => FORWARD);
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(1);
    expect(robot).toEqual({ x: 2, y: 1, facing: 1 });
  });
});

/**
 * THE ACCEPTANCE ON A REAL BOARD: the level `runChecks` would grade, with the
 * player's program loaded into the OVERTURE's `ram_prog`, so the moves the
 * checker applies are the ones a program actually published.
 *
 * THE STUB ABOVE PROVES THE GEOMETRY; this proves the wiring. A checker that
 * loaded nothing would drive a robot with an all-zero program, and a checker that
 * did not settle would feed the CPU the previous sensor byte -- neither of which
 * a scripted `LevelIo` can show.
 *
 * `halt: false` IS A FACT ABOUT THE LEVEL. The OVERTURE's halt line freezes the
 * counter on the `move|sN|out` instruction, and both of these programs write
 * `out` inside their loop, so on the halting board the machine stops after one
 * move. Measured: the reference program never leaves its first decision.
 */
describe('maze on the reference board', () => {
  const board = (): ReturnType<typeof graphFromBoard> =>
    graphFromBoard('maze', overtureBoard({ inputId: 'sensors', halt: false }));

  /** The maze level with one check, out of the same spec the stub tests use. */
  const withGrid = (
    grid: readonly string[],
    budget?: number,
    level: LevelSpec = MAZE_LEVEL,
  ): LevelSpec => ({
    ...level,
    checks: [budget === undefined ? MAZE(grid) : MAZE(grid, undefined, budget)],
  });

  /** A one-cell-wide corridor with the goal two cells east of the start. */
  const CORRIDOR = ['#####', '#S.G#'];
  /** The corridor with a wall where the second forward step would land. */
  const DEAD_END = ['######', '#S.#G#'];
  /** The start's left is open, so the reference rule turns left forever. */
  const TURN_ONLY = ['#####', '#.G.#', '#S..#', '#####'];

  it('walks the reference program to the goal and reports the ticks it spent', () => {
    // THE C1 ACCEPTANCE FOR THE MAZE. The program reads the sensors at address 0,
    // decides forward and publishes `move = 1`, then jumps back to 1 with the
    // sensor byte it already has; the corridor's second decision is the same one,
    // so it reaches `G`. 31 ticks is the measured cost -- 27 instructions of
    // loop, two moves -- and proves the program RAN: an all-zero image would
    // publish move 0 and exhaust the budget instead.
    const outcome = runChecks(board(), registry, withGrid(CORRIDOR), {
      text: REFERENCE_PROGRAM,
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(31);
  });

  it('fails a player who has typed nothing rather than driving zeros', () => {
    const outcome = runChecks(board(), registry, withGrid(CORRIDOR), { text: '' });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.reason).toBe('missing-program');
    expect(outcome.ticksUsed).toBe(0);
  });

  it('cannot pass a board with no CPU and no pins at all', () => {
    // The maze's half of the C2 fail-open: an empty board has no `ram_prog` for
    // the player's program, and that is reported instead of a robot driven by a
    // zeroed image -- which would walk forward on every tick and reach a goal
    // placed to the east.
    const outcome = runChecks(emptyGraph('maze'), registry, withGrid(['#####', '#SG.#']), {
      text: RIGHT_HAND_PROGRAM,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-io');
    expect(outcome.failures[0]?.detail).toContain('ram_prog');
    expect(outcome.ticksUsed).toBe(0);
  });

  it('fails the run when the program drives into a wall, naming the cell', () => {
    // The stale-sensor program decides "ahead is open" once and keeps going, so
    // the wall two cells along is a collision rather than a wrong turn. The
    // failure names the cell and the facing, which is what a player needs to find
    // the line of their program that walked into it.
    const outcome = runChecks(board(), registry, withGrid(DEAD_END), {
      text: REFERENCE_PROGRAM,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    expect(failure.detail).toContain('wall');
    expect(failure.detail).toContain('(2,1)');
    expect(failure.detail).toContain('east');
    expect(failure.actual).toEqual({ move: FORWARD });
  });

  it('gives up at the budget on a real board when the program only turns', () => {
    // The start's left is open, so the reference rule answers `move = 2` on every
    // pass: a legal robot that never arrives. The record carries the sensors the
    // circuit was reading, the move it answered with and the cell it gave up in,
    // and its detail says the last move WAS applied -- which it was, before the
    // goal test. The code on that last tick is 0, and 0 is the documented `stay`:
    // the CPU publishes a move only while the instruction that writes `out` is
    // decoded, and every other tick of its 27-instruction loop reads as stay.
    const outcome = runChecks(board(), registry, withGrid(TURN_ONLY, 64), {
      text: REFERENCE_PROGRAM,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(64);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    expect(failure.actual).toEqual({ move: STAY });
    expect(failure.detail).toContain('budget');
    expect(failure.detail).toContain('(1,2)');
    expect(failure.detail).toContain(`after applying move ${STAY}`);
  });

  it('walks a wall-following program through a maze worth walking', () => {
    // A maze whose corridors are one cell wide, and the mirrored program that
    // reads the sensors on EVERY pass (its loop-backs go to address 0). This is
    // the route the stub test's independent model takes, driven here by a real
    // CPU: east to the right-hand wall, then north to the goal. 168 ticks is the
    // measured cost of the ten moves -- the program's own loop is 27
    // instructions, and the branch that turns reaches its `out` sooner.
    const grid = ['########', '#....#G#', '#.##.#.#', '#.#..#.#', '#.#.##.#', '#S.....#', '########'];
    const outcome = runChecks(board(), registry, withGrid(grid), {
      text: RIGHT_HAND_PROGRAM,
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(168);
  });

  it('drives the board in the documented order: reset, load, then read-write-settle-tick', () => {
    // I1's protocol for the maze, on the real circuit. The order matters twice
    // over here: the sensor byte written at tick N is what the CPU samples at the
    // next edge, and the move the CPU answers with is what the checker applies
    // before it publishes again.
    const calls: string[] = [];
    const net = compile(board(), registry);
    const bound = bindLevelIo(new Simulation(net, registry), net, MAZE_LEVEL);
    const io: LevelIo = {
      ...bound,
      reset: () => {
        calls.push('reset');
        bound.reset();
      },
      writeInput: (name) => {
        calls.push(`writeInput:${name}`);
        bound.writeInput(name, 0);
      },
      settle: () => {
        calls.push('settle');
        bound.settle();
      },
      readOutput: (name) => {
        calls.push(`readOutput:${name}`);
        return bound.readOutput(name);
      },
      tick: () => {
        calls.push('tick');
        bound.tick();
      },
    };

    const outcome = callMaze(io, MAZE_LEVEL, MAZE(CORRIDOR, undefined, 2), PLAYER);
    expect(outcome.passed).toBe(false);

    const firstRead = calls.indexOf('readOutput:move');
    expect(firstRead).toBeGreaterThan(0);
    expect(calls.slice(0, firstRead)).toContain('reset');
    expect(calls.slice(firstRead)).toEqual([
      'readOutput:move',
      'writeInput:sensors',
      'settle',
      'tick',
      'readOutput:move',
      'writeInput:sensors',
      'settle',
      'tick',
    ]);
  });
});
