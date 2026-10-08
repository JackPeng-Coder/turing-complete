import { describe, expect, it } from 'vitest';
import { emptyGraph } from '../../src/core/graph';
import { Simulation, compile } from '../../src/core/net';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import {
  bindLevelIo,
  loadProgramImage,
  runChecks,
  type LevelIo,
} from '../../src/levels/checks';
import {
  CUSTOM_BUDGET_CAP,
  customCheckIds,
  effectiveBudget,
} from '../../src/levels/custom/index';
import { DEFAULT_LOCK_BUDGET, callLock } from '../../src/levels/custom/lock';
import type { CustomCheck, LevelSpec } from '../../src/levels/spec';
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
 * TWO KINDS OF TEST, AND THEY ANSWER DIFFERENT QUESTIONS. The scripted `LevelIo`
 * states the EXCHANGE as a sequence -- read before answer, one edge per wrong
 * guess, stop on a right one, give up at the budget -- including the failure
 * shapes no reference circuit produces. The real-board block at the end states
 * what the stub cannot: the player's program reaches the circuit at all, the
 * board is reset before the first read, the write is settled before the edge that
 * samples it, and the programme the level grades is the assembler's own reading
 * of the player's text.
 *
 * THE BUDGET'S UNIT IS ONE EXCHANGE. One unit is one read of `try`, one answer on
 * `match`, one settle and one clock edge; the exchange that READS the secret
 * costs no edge, so it costs no unit. A run of `budget` units therefore reads
 * `try` `budget` times and applies `budget` edges, and the failure it reports
 * when the secret is never seen sits at tick `budget`.
 */

/**
 * The reference program for this puzzle, verbatim from
 * `.superpowers/sdd/2026-10-08-turing-complete-phase3/reference-programs.md`
 * (ch4-54): try REG5, answer `match` into REG1, and count REG5 up until the
 * answer arrives.
 */
const REFERENCE_PROGRAM = [
  'loadi|0',
  'move|s0|d5',
  'move|s5|out',
  'move|inp|d1',
  'loadi|0',
  'move|s0|d2',
  'add',
  'loadi|16',
  'jnz',
  'move|s5|d1',
  'loadi|1',
  'move|s0|d2',
  'add',
  'move|s3|d5',
  'loadi|2',
  'j',
  'loadi|16',
  'j',
].join('\n');

/** The player's buffer, as `runChecks` receives it. */
const PLAYER = { text: REFERENCE_PROGRAM };

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

/** A level whose one check is `check`, for driving the whole `runChecks` path. */
const withCheck = (check: CustomCheck, level: LevelSpec = LOCK_LEVEL): LevelSpec => ({
  ...level,
  checks: [check],
});

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
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0), PLAYER);

    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(outcome.ticksUsed).toBe(0);
    expect(script.ticks()).toBe(0);
    // The exchange is the contract: a reset for the board's own state, the load
    // of the player's program, then one read and one write.
    expect(script.log.map((c) => c.method)).toEqual([
      'reset',
      'reset',
      'readOutput',
      'writeInput',
    ]);
    expect(script.writes).toEqual([1]);
    // WHAT WAS LOADED IS THE PLAYER'S TEXT AND NOTHING ELSE -- assembled by the
    // project's own assembler, so this is also the assertion that the checker
    // reads the assembly channel and not the byte-image one.
    expect(script.images.map((image) => image.bytes.length)).toEqual([18]);
    expect(script.images[0]?.bytes.slice(0, 3)).toEqual([0x00, 0x85, 0xaf]);
  });

  it('passes when the script finds the secret by counting up one per tick', () => {
    // The reference shape of a solution: try the next byte on every tick. 42
    // therefore costs 42 ticks, and the read that matches is the 43rd.
    const script = scriptedIo({ reader: (tick) => tick });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(42), PLAYER);

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
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(200, 8), PLAYER);

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
    // ONE UNIT IS ONE EXCHANGE. Eight units are eight reads of `try` and eight
    // edges, and the read that would have been the ninth never happens.
    expect(outcome.ticksUsed).toBe(8);
    expect(script.ticks()).toBe(8);
    expect(script.log.filter((c) => c.method === 'readOutput')).toHaveLength(8);
  });

  it('runs the documented 4096-tick budget when the check declares none', () => {
    // The default is a hard ceiling like `FUZZ_ROUNDS_CAP`, so a board that
    // never matches must terminate rather than hang the editor. The count is
    // the assertion: a missing default would loop forever here.
    expect(DEFAULT_LOCK_BUDGET).toBe(4096);
    const script = scriptedIo({ outputs: new Array<number>(DEFAULT_LOCK_BUDGET + 8).fill(0) });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(1), PLAYER);

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
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(7, 4), PLAYER);

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
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0, 2), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(2);
  });

  it('refuses to run at all when the player has typed nothing', () => {
    // C1's other half. An empty buffer is not a program that happens to publish
    // zeros: nothing is loaded, nothing is compared, and the player is told the
    // buffer is empty rather than being failed for a search they never wrote.
    for (const player of [undefined, { text: '' }, { text: '   \n' }]) {
      const script = scriptedIo({ outputs: [0] });
      const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0), player);
      expect(outcome.passed).toBe(false);
      expect(outcome.failures[0]?.reason).toBe('missing-program');
      expect(outcome.failures[0]?.detail).toContain('empty');
      expect(script.ticks()).toBe(0);
      expect(script.images).toEqual([]);
    }
  });

  it('refuses a program the assembler rejects, naming the line', () => {
    const script = scriptedIo({ outputs: [0] });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0), { text: 'nonsense|1' });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('line 1');
    expect(script.ticks()).toBe(0);
  });

  it('refuses a board with nowhere to put the program', () => {
    // A circuit whose `ram_prog` is missing cannot run the player's program at
    // all, so the check reports the load rather than grading a board that is
    // reading zeros. `missing-io` is the kernel's own reason for it.
    const script = scriptedIo({ outputs: [0], programRam: false });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(0), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-io');
    expect(outcome.failures[0]?.detail).toContain('ram_prog');
    expect(script.ticks()).toBe(0);
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
    // written while the checker is reporting that its own data is wrong. The
    // refusal lands before the reset and the load for the same reason.
    expect(script.ticks()).toBe(0);
    expect(script.writes).toEqual([]);
    expect(script.resets()).toBe(0);
  });

  it('describes a secret whose own toString throws without throwing itself', () => {
    // `params` is level data, and an object in it is as untrusted as a string:
    // a throwing `toString` must become a sentence naming the field, not an
    // exception that `runChecks` reports as "the custom check threw".
    const secret = {
      toString(): string {
        throw new TypeError('secret exploded');
      },
    };
    const check = { kind: 'custom', id: 'lock', params: { secret } } as unknown as CustomCheck;
    const outcome = callLock(scriptedIo({ outputs: [0] }).io, LOCK_LEVEL, check);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('secret');
    expect(outcome.failures[0]?.detail).toContain('object');
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['a negative budget', -3],
    ['a fractional budget', 2.5],
    ['a NaN budget', Number.NaN],
  ])('refuses %s budget as an invalid outcome', (_label, budget) => {
    const outcome = callLock(scriptedIo({ outputs: [0] }).io, LOCK_LEVEL, SECRET(1, budget));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('budget');
  });

  it('clamps an over-cap budget to the ceiling instead of hanging the editor', () => {
    // The same rule `FUZZ_ROUNDS_CAP` states for `rounds`: `grade()` runs on
    // every board edit, so a level asking for a billion exchanges gets the most
    // the editor can afford. The clamp is visible in the tick count, which is
    // what the star rating is made of.
    expect(CUSTOM_BUDGET_CAP).toBe(4096);
    const script = scriptedIo({ outputs: new Array<number>(CUSTOM_BUDGET_CAP + 16).fill(1) });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(200, CUSTOM_BUDGET_CAP + 10_000), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.ticksUsed).toBe(CUSTOM_BUDGET_CAP);
    expect(script.ticks()).toBe(CUSTOM_BUDGET_CAP);
  });

  it('keeps the cap beside the rule that applies it', () => {
    // THE CONSTANT LIVES WITH THE CUSTOM-CHECK CONTRACT (`custom/index.ts`)
    // BECAUSE THAT IS WHAT IT BOUNDS: `effectiveBudget` is the only reader, and
    // a constant in `checks.ts` would make the contract's own module import a
    // value back from its caller -- a runtime cycle between the two files, for
    // one number. This assertion pins the two together where they now sit.
    expect(effectiveBudget(CUSTOM_BUDGET_CAP + 1, 1)).toBe(CUSTOM_BUDGET_CAP);
    expect(effectiveBudget(undefined, CUSTOM_BUDGET_CAP)).toBe(CUSTOM_BUDGET_CAP);
  });

  it('blames the level when its io does not name the pins this checker drives', () => {
    // I4: a checker addresses the board by pin name. A level that names them
    // differently -- or declares a pin the checker never plays with -- has to be
    // told so, or every later failure is a sentence about a puzzle that was
    // never wired up.
    const missingPin: LevelSpec = {
      ...LOCK_LEVEL,
      io: { inputs: [{ id: 'guess', width: 8 }], outputs: [{ id: 'try', width: 8 }] },
    };
    const unexpectedPin: LevelSpec = {
      ...LOCK_LEVEL,
      io: {
        inputs: [
          { id: 'match', width: 8 },
          { id: 'spare', width: 8 },
        ],
        outputs: [{ id: 'try', width: 8 }],
      },
    };
    const narrowOutput: LevelSpec = {
      ...LOCK_LEVEL,
      io: { inputs: [{ id: 'match', width: 8 }], outputs: [{ id: 'try', width: 4 }] },
    };

    const cases: ReadonlyArray<readonly [LevelSpec, string]> = [
      [missingPin, 'match'],
      [unexpectedPin, 'spare'],
      [narrowOutput, 'try'],
    ];
    for (const [level, named] of cases) {
      const script = scriptedIo({ outputs: [0] });
      const outcome = callLock(script.io, level, SECRET(0), PLAYER);
      expect(outcome.passed).toBe(false);
      expect(outcome.failures).toHaveLength(1);
      expect(outcome.failures[0]?.reason).toBe('invalid');
      expect(outcome.failures[0]?.detail).toContain(named);
      // Nothing is driven while the checker is reporting the level's own io.
      expect(script.ticks()).toBe(0);
      expect(script.resets()).toBe(0);
    }
  });

  it('never reads or settles the simulation for itself, whatever the outcome', () => {
    // The contract both closed-loop checkers keep: `io.sim` is for the kernel's
    // drivers, and a checker drives the board through the level methods so that
    // a scripted stub can stand in for a circuit. A checker that settled or read
    // slots through `sim` would pass these tests only by accident, and the stub
    // would throw on the cast it does not have.
    const script = scriptedIo({ reader: (tick) => tick });
    const outcome = callLock(script.io, LOCK_LEVEL, SECRET(3), PLAYER);
    expect(outcome.passed).toBe(true);
    // Nothing in the log is anything but the level's own methods -- `settle`
    // included, which is why it is on `LevelIo` rather than reached through
    // `io.sim`: the protocol is visible to a stub.
    expect(new Set(script.log.map((c) => c.method))).toEqual(
      new Set(['reset', 'readOutput', 'writeInput', 'settle', 'tick']),
    );
    expect(script.settles()).toBe(3);
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

/**
 * THE ACCEPTANCE FOR C1, C2 AND I1: the same level the kernel would grade, on a
 * real OVERTURE board, driven through `runChecks` exactly as `grade()` does.
 *
 * WHAT THESE ADD OVER THE SCRIPTED TESTS. The stub above proves the checker's
 * EXCHANGE; it cannot prove that a program reaches the circuit at all, that the
 * board is reset before the first read, or that the byte written is the byte the
 * next edge samples. Those are the three defects this block was written against:
 * a checker that loaded nothing graded an all-zero `ram_prog` on every board, a
 * checker that read before the first settle read a fabricated 0 (so `secret: 0`
 * passed a board with no CPU in it), and a checker that wrote and ticked handed
 * the CPU the previous input vector.
 *
 * THE BOARD IS BUILT WITH `halt: false`, AND THAT IS A FACT ABOUT THE LEVEL, NOT
 * A CONVENIENCE. The OVERTURE's halt line freezes the counter on the instruction
 * that writes `out`, and a closed-loop program writes `out` inside its loop, so
 * on the halting board the reference program stops at its first guess and never
 * searches again -- measured: `try` reads 0 forever. A chapter-4 closed-loop
 * level therefore ships `overtureBoard({ inputId, halt: false })`.
 */
describe('lock on the reference board', () => {
  const board = (): ReturnType<typeof graphFromBoard> =>
    graphFromBoard('lock', overtureBoard({ inputId: 'match', halt: false }));

  it('runs the player\'s program and passes when the search reaches the secret', () => {
    // THE C1 ACCEPTANCE. The reference program counts REG5 up, publishing each
    // candidate on `out`, and the checker answers on `match`. 42 candidates at
    // fourteen instructions each puts the answer at tick 590: the number is the
    // evidence that the program RAN -- a checker grading an all-zero image sees
    // 0 forever and reports a budget failure at tick 4096.
    const outcome = runChecks(board(), registry, withCheck(SECRET(42)), PLAYER);
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(590);
  });

  it('passes a secret of 0 on the board\'s first read, before the program has run', () => {
    // The boundary the reset decides, stated rather than assumed. `out` is 0
    // until an instruction publishes something, so a level whose secret is 0 is
    // answered by the board's own zero state: the check passes on the first read,
    // with no edge spent. That is honest -- the figure the codekeeper sees IS the
    // secret -- and it is why the fail-open case below has to be a board with no
    // `ram_prog` in it rather than a board that merely has not moved yet. Levels
    // pick a non-zero secret (the reference one is 42) for exactly this reason.
    const outcome = runChecks(board(), registry, withCheck(SECRET(0, 700)), PLAYER);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(0);
  });

  it('cannot pass a board with no CPU and no pins at all, whatever the secret', () => {
    // THE C2 ACCEPTANCE, and the fail-open this checker shipped with. An empty
    // board publishes 0 on every pin it does not have, so `secret: 0` used to be
    // found on the first read -- a PASS, at tick 0, against a circuit with no
    // `ram_prog` for the player's program and no pins for the checker to drive.
    // The load is what makes it impossible: there is nowhere to put the program,
    // and that is reported instead of graded.
    const outcome = runChecks(emptyGraph('lock'), registry, withCheck(SECRET(0)), PLAYER);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.reason).toBe('missing-io');
    expect(outcome.failures[0]?.detail).toContain('ram_prog');
    expect(outcome.ticksUsed).toBe(0);
  });

  it('fails a player who has typed nothing rather than running zeros', () => {
    // The other half of C1: the failure-free path has to be the program running,
    // so the same level with an empty buffer cannot pass however long the
    // checker waits.
    const outcome = runChecks(board(), registry, withCheck(SECRET(42)), { text: '' });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.reason).toBe('missing-program');
    expect(outcome.failures[0]?.detail).toContain('empty');
    expect(outcome.ticksUsed).toBe(0);
  });

  it('gives up at the budget on a real board when nobody finds the secret', () => {
    // A program that publishes 0 forever: with four bytes of `loadi|0`, `out`
    // never leaves zero (the machine runs off the end of the image and reads
    // zeroed RAM, which is `loadi|0` again). The failure is the checker's own
    // record, keyed by the level's pins, at the tick the budget ran out.
    const stuck = { text: 'loadi|0\nmove|s0|out' };
    const outcome = runChecks(board(), registry, withCheck(SECRET(42, 32)), stuck);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);
    const failure = outcome.failures[0]!;
    expect(failure.reason).toBe('mismatch');
    expect(failure.actual).toEqual({ try: 0 });
    expect(failure.expected).toEqual({ try: 42 });
    expect(failure.tick).toBe(32);
    expect(outcome.ticksUsed).toBe(32);
  });

  it('drives the board in the documented order: reset, load, then read-write-settle-tick', () => {
    // I1's PROTOCOL, PINNED ON A REAL CIRCUIT. The exchange is read the published
    // byte, answer it, settle so the answer reaches the circuit, then apply the
    // edge -- and the reset and the load come before the first read, because a
    // read before either of them is a fabricated zero. The wrapper records what
    // the CHECKER asked the level interface for, which is the only place the
    // order is visible.
    const calls: string[] = [];
    const graph = board();
    const net = compile(graph, registry);
    const bound = bindLevelIo(new Simulation(net, registry), net, LOCK_LEVEL);
    const io: LevelIo = {
      ...bound,
      reset: () => {
        calls.push('reset');
        bound.reset();
      },
      writeInput: (name, value) => {
        calls.push(`writeInput:${name}`);
        bound.writeInput(name, value);
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

    // Two exchanges and then the budget failure, so the log is short enough to
    // compare whole.
    const outcome = callLock(io, LOCK_LEVEL, SECRET(42, 2), PLAYER);
    expect(outcome.passed).toBe(false);

    const firstRead = calls.indexOf('readOutput:try');
    expect(firstRead).toBeGreaterThan(0);
    expect(calls.slice(0, firstRead)).toContain('reset');
    expect(calls.slice(firstRead)).toEqual([
      'readOutput:try',
      'writeInput:match',
      'settle',
      'tick',
      'readOutput:try',
      'writeInput:match',
      'settle',
      'tick',
    ]);
  });
});
