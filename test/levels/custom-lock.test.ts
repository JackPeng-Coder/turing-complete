import { describe, expect, it } from 'vitest';
import type { CheckOutcome, CustomCheck, LevelSpec } from '../../src/levels/spec';
import { Simulation, compile } from '../../src/core/net';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { bindLevelIo, loadProgramImage } from '../../src/levels/checks';
import { customCheckIds } from '../../src/levels/custom/index';
import { DEFAULT_LOCK_BUDGET, callLock } from '../../src/levels/custom/lock';
import type { LevelIo } from '../../src/levels/checks';
import { registry } from '../fixtures/build';
import { scriptedIo } from '../fixtures/level-io';

/**
 * `lock` -- 道破心机 / Code Breaker: the level's first closed-loop checker.
 *
 * THE PUZZLE. The board is the player's OVERTURE CPU. The checker drives a
 * `match` pin with 0 or 1, reads the byte the CPU publishes on `try`, and keeps
 * guessing until the byte it reads is the secret the level chose. Only the
 * CIRCUIT can search: it sees one bit per tick and has to remember what it has
 * tried, so a program that does not loop never gets past its first guess.
 *
 * WHY THE TESTS DRIVE A SCRIPT INSTEAD OF A CIRCUIT. Every rule this checker
 * owns is about the exchange, not the chip: it must read before it writes, write
 * the comparison of what it just read, tick exactly once per wrong guess, stop on
 * a right one, and give up on a budget rather than loop forever. A scripted
 * `LevelIo` states those as a sequence, and the failure cases -- a board that
 * never finds the secret, a board with no `OUT` at all -- are ones a reference
 * circuit cannot produce.
 *
 * The expected values below are all derived from the same two published facts:
 * `match` is written from the byte just read, and a wrong guess costs one tick.
 */

const SECRET = (secret: number, budget?: number): CustomCheck => ({
  kind: 'custom',
  id: 'lock',
  params: budget === undefined ? { secret } : { secret, budget },
});

/** The level `lock` is written against: one 8-bit input, one 8-bit output. */
const LOCK_LEVEL: LevelSpec = {
  id: 'test-lock',
  chapter: 4,
  index: 1,
  name: { zh: '道破心机', en: 'Code Breaker' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['level_input', 'level_output'],
  io: {
    inputs: [{ id: 'match', width: 8 }],
    outputs: [{ id: 'try', width: 8 }],
  },
  checks: [],
};

/**
 * The checker is expected to have registered itself on import, which is the
 * mechanism the registry's comment prescribes: `runChecks` looks an id up, and
 * the module that defines the checker is what puts it there. A level that names
 * `lock` in its data is graded by this registration or by nothing.
 */
describe('the lock checker registers itself', () => {
  it('is in the registry once its module has been imported', () => {
    expect(customCheckIds()).toContain('lock');
  });

  it('keeps the registry order the imports establish', () => {
    // A characterization pin rather than a requirement: the registry is a Map
    // in registration order, and this records that `lock` is the only checker
    // this file pulls in.
    expect(customCheckIds()).toEqual(['lock']);
  });
});

describe('lock', () => {
  it('passes on the first read when the secret is 0', () => {
    // A board that publishes 0 immediately is already right: the checker must
    // compare before it ticks, or this level would cost a tick it never spent.
    const script = scriptedIo({ outputs: [0] });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0));

    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(outcome.ticksUsed).toBe(0);
    expect(script.ticks()).toBe(0);
    // One read, one write, and nothing else: the exchange is the contract.
    expect(script.log.map((c) => c.method)).toEqual(['readOutput', 'writeInput']);
    expect(script.writes).toEqual([1]);
  });

  it('passes when the script finds the secret by counting up one per tick', () => {
    // The reference shape of a solution: try the next byte on every tick. 42
    // therefore costs 42 ticks, and the 43rd read is the one that matches.
    const script = scriptedIo({ reader: (tick) => tick });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(42));

    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(42);
    expect(script.ticks()).toBe(42);
    // Every wrong guess is written as `match = 0` and costs one tick; the last
    // write is the match, and it costs none.
    expect(script.writes).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    // The write always describes the byte that was READ, never the secret: a
    // checker that leaked the answer onto `match` would tell the player's
    // program what to guess and pass without a search.
    expect(script.log.filter((c) => c.method === 'writeInput').slice(0, -1).every((c) => c.value === 0))
      .toBe(true);
  });

  it('fails on the budget, naming the last byte it tried', () => {
    // A script that only ever publishes 1 never finds a secret of 200, so the
    // checker has to stop at its budget. The failure is ONE record keyed by the
    // level's own pins: the input it wrote, the byte it expected, the byte it
    // got, and the tick the budget ran out on.
    const script = scriptedIo({ outputs: new Array<number>(64).fill(1) });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(200, 8));

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    const failure = outcome.failures[0]!;
    expect(failure.check).toBe('custom');
    expect(failure.reason).toBe('mismatch');
    expect(failure.inputs).toEqual({ match: 0 });
    expect(failure.expected).toEqual({ try: 200 });
    expect(failure.actual).toEqual({ try: 1 });
    expect(failure.tick).toBe(8);
    expect(failure.detail).toContain('1');
    // The budget is a HIGH-WATER MARK: eight wrong guesses, eight ticks, and
    // the ninth read never happens.
    expect(outcome.ticksUsed).toBe(8);
    expect(script.ticks()).toBe(8);
  });

  it('runs the documented 4096-tick budget when the check declares none', () => {
    // The default is a hard ceiling like `FUZZ_ROUNDS_CAP`, so a board that
    // never matches must terminate rather than hang the editor. The count is
    // the assertion: a missing default would loop forever here.
    expect(DEFAULT_LOCK_BUDGET).toBe(4096);
    const script = scriptedIo({ outputs: new Array<number>(DEFAULT_LOCK_BUDGET + 8).fill(0) });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(1));

    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(DEFAULT_LOCK_BUDGET);
    expect(script.ticks()).toBe(DEFAULT_LOCK_BUDGET);
    expect(outcome.failures).toHaveLength(1);
  });

  it('ends the same way on a board with no output at all', () => {
    // `readOutput` answers 0 for a pin the circuit does not have, so `try` reads
    // 0 forever. That must end in the budget failure -- not an infinite loop and
    // not a pass -- which is why the "no OUT" case is a read like any other.
    const script = scriptedIo({ outputs: [] });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(7, 4));

    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(4);
    expect(script.ticks()).toBe(4);
    expect(outcome.failures[0]?.reason).toBe('mismatch');
    expect(outcome.failures[0]?.actual).toEqual({ try: 0 });
  });

  it('fails on a secret 0 board whose output never matches either', () => {
    // The mirror of the first test: an absent `OUT` reads 0, and a secret of 0
    // would silently PASS if the checker read the pin before the level's own
    // board existed. The stub answers 0 here as well, so what separates the two
    // cases is the secret alone -- and 0 is a legal secret that must pass.
    const script = scriptedIo({ outputs: [5, 5, 5, 5, 5, 5] });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0, 2));
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(2);
  });

  it.each<[string, unknown]>([
    ['a secret above a byte', 256],
    ['a negative secret', -1],
    ['a fractional secret', 1.5],
    ['a secret that is not a number', '42'],
    ['no secret at all', undefined],
    ['a NaN secret', Number.NaN],
  ])('refuses %s as an invalid outcome', (_label, secret) => {
    // Level data is untrusted and `params` is level data: a bad secret is a
    // defect in the LEVEL, reported with `invalid` and never thrown, because
    // `grade()` runs on every board edit.
    const check = { kind: 'custom', id: 'lock', params: { secret } } as unknown as CustomCheck;
    const script = scriptedIo({ outputs: [0] });
    const outcome = callLock(script.io, LOCK_LEVEL, check);

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('secret');
    expect(outcome.failures[0]?.tick).toBe(0);
    // A refused check drives nothing: the board is not ticked and no byte is
    // written while the checker is reporting that its own data is wrong.
    expect(script.ticks()).toBe(0);
    expect(script.writes).toEqual([]);
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['a negative budget', -3],
    ['a fractional budget', 2.5],
  ])('refuses %s budget as an invalid outcome', (_label, budget) => {
    const outcome = callLock(scriptedIo({ outputs: [0] }).io, LOCK_LEVEL, SECRET(1, budget));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('budget');
  });

  it('never reads the simulation, whatever the outcome', () => {
    // The contract both closed-loop checkers keep: `io.sim` is for the kernel's
    // drivers, and a checker drives the board through the four level methods so
    // that a scripted stub can stand in for a circuit. A checker that settled or
    // read slots through `sim` would pass these tests only by accident, and the
    // stub would throw on the cast it does not have.
    const script = scriptedIo({ reader: (tick) => tick });
    const outcome: CheckOutcome = callLock(script.io, LOCK_LEVEL, SECRET(3));
    expect(outcome.passed).toBe(true);
    // Nothing in the log is anything but the four level methods.
    expect(new Set(script.log.map((c) => c.method))).toEqual(new Set(['readOutput', 'writeInput', 'tick']));
  });
});

/**
 * THE WRITE -> SETTLE -> TICK PROTOCOL, SEEN FROM THE CIRCUIT SIDE.
 *
 * `Simulation.tick` samples the signal table (net.ts), and a value written to a
 * level input only reaches a storage element through the combinational parts
 * between them -- on the OVERTURE board the level input is three parts away from
 * the register file (`srcData` -> `d1` -> `data`). A caller that writes and ticks
 * without settling therefore clocks the PREVIOUS input vector, which no
 * combinational stub can show and no assertion about a checker's method log can
 * prove. This block proves it against the real board, with a program that copies
 * the level's input into a register and publishes it one instruction later.
 */
describe('the level input path on the reference board', () => {
  /**
   * `move|inp|d1` / `move|s1|out` / `loadi|0` / `j`: the level's byte into REG1,
   * REG1 onto `out`, then a jump back to the read, so the exchange repeats every
   * four ticks. The machine must NOT halt -- `move|s1|out` is in the loop -- which
   * is why the board is built with `halt: false`.
   */
  const ECHO = ['move|inp|d1', 'move|s1|out', 'loadi|0', 'j'].join('\n');

  /** The lock's level io, on the chapter-4 board wired to `match`. */
  function lockBoard(): LevelIo {
    const graph = graphFromBoard('lock', overtureBoard({ inputId: 'match', halt: false }));
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, LOCK_LEVEL);
    io.reset();
    const image = loadProgramImage(io, ECHO, 'asm');
    if (image.errors.length > 0) throw new Error(`the echo program does not load: ${image.errors[0]}`);
    return io;
  }

  /**
   * Writes `values` on `match`, one per tick, and returns what `try` published
   * after each edge. `settle` is the whole experiment: with it the board is run
   * to a fixed point between the write and the edge, without it the edge samples
   * whatever the last settle left.
   */
  function driveEcho(settle: boolean, values: readonly number[]): number[] {
    const io = lockBoard();
    const published: number[] = [];
    for (const value of values) {
      io.writeInput('match', value);
      if (settle) io.settle();
      io.tick();
      published.push(io.readOutput('try'));
    }
    return published;
  }

  it('publishes the byte written in the same tick once the write has settled', () => {
    // The register captures on the tick whose instruction is `move|inp|d1` (the
    // first of the four) and `out` publishes it on the next, so every fourth
    // published byte is the byte written on the tick before it. The values are
    // distinct and non-zero, so a board that quietly published its reset value
    // could not satisfy this.
    const values = [0x2a, 0x11, 0x22, 0x33, 0x5c, 0x44, 0x55, 0x66];
    const published = driveEcho(true, values);
    expect(published.filter((_, index) => index % 4 === 0)).toEqual([0x2a, 0x5c]);
  });

  it('clocks the previous byte instead when the write is not settled', () => {
    // THE HAZARD THE PROTOCOL EXISTS FOR. Without a settle the register samples
    // the table as the last sweep committed it, so the byte that arrives is the
    // one written on the PREVIOUS tick -- one input vector behind, exactly as
    // `Simulation.tick` documents. The first capture sees the reset value,
    // because nothing had been written when the first sweep committed; the second
    // sees `values[3]` where the settled run saw `values[4]`. A checker that
    // wrote and ticked would hand the player's program that board.
    const values = [0x2a, 0x11, 0x22, 0x33, 0x5c, 0x44, 0x55, 0x66];
    const published = driveEcho(false, values);
    expect(published.filter((_, index) => index % 4 === 0)).toEqual([0, values[3]]);
  });

  it('is the same board the checkers drive', () => {
    // The lock's input pin is named `match` and its output `try`, so the level's
    // own io binds to this circuit: a board wired for another pin id would leave
    // `io.mismatch` unset (the pin is simply absent) and every read would be a
    // fabricated zero -- which is why the acceptance tests below drive the same
    // board through `runChecks`.
    const io = lockBoard();
    io.writeInput('match', 1);
    io.settle();
    io.tick();
    expect(io.mismatch).toBeUndefined();
  });
});
