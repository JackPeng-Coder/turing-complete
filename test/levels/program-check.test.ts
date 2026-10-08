import { describe, expect, it } from 'vitest';
import { OVERTURE_ISA, assemble, parseImage } from '../../src/asm/index';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { Simulation, compile, type Netlist } from '../../src/core/net';
import { createRegistry } from '../../src/core/registry';
import { runChecks } from '../../src/levels/checks';
import {
  FAILURE_REASONS,
  type LevelCheck,
  type LevelSpec,
  type ProgramCheck,
  type ProgramStep,
} from '../../src/levels/spec';

/**
 * The `program` check kind and `Simulation.loadImage`, end to end.
 *
 * The ordering this file exists to pin: `runChecks` compiles a circuit once,
 * before any check branch runs, and every drive path calls `io.reset()` first --
 * and `reset()` fills every state byte with zero. A program image therefore
 * cannot be planted at compile time. It is loaded after that reset by
 * `Simulation.loadImage`, and only then driven. The `loadImage` block below
 * proves both halves: the image survives every tick of a run, and does NOT
 * survive a reset.
 *
 * The counterexample circuits matter as much as the reference one. A check that
 * passes a right circuit is only half evidence; a check that also passes a
 * plausible wrong one is comparing nothing. `IMAGE` is pinned against the
 * assembler so the reference cannot quietly pass against a different encoding.
 */

const registry = createRegistry(BASE_DEFS);

/** Reads the byte `key` ("<instId>.<pinId>") publishes, without a level binding. */
function readByte(sim: Simulation, net: Netlist, key: string): number {
  const value = sim.read(net.outputBase(key), 8);
  return typeof value === 'number'
    ? value
    : Array.from(value).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
}

/**
 * A `ram_prog` addressed by an 8-bit level input and published on `out`.
 *
 * The smallest circuit that can show an image arriving: the address comes from
 * outside, so a test reads any byte of the image without a clock, and the byte
 * is read through the instance's own output pin -- which is what "the image
 * reached the circuit" has to mean.
 */
function ramFixture(): { sim: Simulation; net: Netlist } {
  const g = emptyGraph();
  const addr = addInstance(g, 'level_input', 0, 0, 'IN_addr');
  addr.params.width = 8;
  const ram = addInstance(g, 'ram_prog', 120, 0, 'RAM');
  const out = addInstance(g, 'level_output', 240, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: addr.id, port: 'out' }, { inst: ram.id, port: 'addr' });
  connect(g, { inst: ram.id, port: 'out' }, { inst: out.id, port: 'in' });
  const net = compile(g, registry);
  return { sim: new Simulation(net, registry), net };
}

/** Drives an address into the fixture and reads the byte `RAM` publishes for it. */
function byteAt(sim: Simulation, net: Netlist, address: number): number {
  sim.write(net.outputBase('IN_addr.out'), 8, address);
  sim.settle();
  return readByte(sim, net, 'RAM.out');
}

describe('Simulation.loadImage', () => {
  it('round-trips an image through the ram_prog output pin', () => {
    const { sim, net } = ramFixture();
    sim.reset();
    sim.loadImage('RAM', [0x11, 0x22, 0x33]);
    sim.settle();
    expect(byteAt(sim, net, 0)).toBe(0x11);
    expect(byteAt(sim, net, 1)).toBe(0x22);
    expect(byteAt(sim, net, 2)).toBe(0x33);
    // Past the image the RAM holds the zero `reset()` gave it, so a short image
    // never leaves the tail of a longer one behind.
    expect(byteAt(sim, net, 3)).toBe(0);
    expect(byteAt(sim, net, 255)).toBe(0);
  });

  it('accepts a Uint8Array as well as a number array', () => {
    const { sim, net } = ramFixture();
    sim.reset();
    sim.loadImage('RAM', new Uint8Array([0xde, 0xad]));
    sim.settle();
    expect(byteAt(sim, net, 0)).toBe(0xde);
    expect(byteAt(sim, net, 1)).toBe(0xad);
  });

  it('zeroes the tail, so a shorter second image leaves nothing behind', () => {
    // Without the zeroing, byte 1 would still hold 0x22 after the second load:
    // the new image would be a partial overwrite, which is the one thing an
    // "image" must not be.
    const { sim, net } = ramFixture();
    sim.reset();
    sim.loadImage('RAM', [0x11, 0x22, 0x33, 0x44]);
    sim.settle();
    sim.loadImage('RAM', [0x99]);
    sim.settle();
    expect(byteAt(sim, net, 0)).toBe(0x99);
    expect(byteAt(sim, net, 1)).toBe(0);
    expect(byteAt(sim, net, 3)).toBe(0);
  });

  it('survives ticking, and reset() clears it', () => {
    // Both halves of the ordering requirement the `program` checker exists
    // around. Ticking must not erase the image, or a check could not drive a
    // multi-tick program; `reset()` must erase it, which is why the checker
    // loads AFTER its reset and never before.
    const { sim, net } = ramFixture();
    sim.reset();
    sim.loadImage('RAM', [0xab]);
    sim.settle();
    sim.tick();
    sim.tick();
    expect(byteAt(sim, net, 0)).toBe(0xab);
    sim.reset();
    sim.settle();
    expect(byteAt(sim, net, 0), 'reset() clears state, so an image must be loaded after it').toBe(0);
    sim.loadImage('RAM', [0xab]);
    sim.settle();
    expect(byteAt(sim, net, 0)).toBe(0xab);
  });

  it('throws RangeError for an id the netlist does not have', () => {
    const { sim } = ramFixture();
    sim.reset();
    expect(() => sim.loadImage('NO_SUCH_RAM', [1])).toThrow(RangeError);
    // The message names the id, because the failure a caller reports carries it.
    expect(() => sim.loadImage('NO_SUCH_RAM', [1])).toThrow(/NO_SUCH_RAM/);
  });

  it('throws RangeError for an image longer than the instance state', () => {
    const { sim } = ramFixture();
    sim.reset();
    // 257 bytes against ram_prog's 256: one too many, refused rather than
    // truncated -- a truncated program would execute something the level never
    // wrote while reporting success.
    expect(() => sim.loadImage('RAM', new Uint8Array(257))).toThrow(RangeError);
    expect(() => sim.loadImage('RAM', new Array<number>(257).fill(0))).toThrow(RangeError);
  });

  it('leaves the state untouched when it refuses an oversized image', () => {
    // The size is checked before the state is cleared: a refused load must not
    // half-apply, or a check that failed on capacity would have destroyed the
    // image it was loading.
    const { sim, net } = ramFixture();
    sim.reset();
    sim.loadImage('RAM', [0x11, 0x22]);
    sim.settle();
    expect(() => sim.loadImage('RAM', new Uint8Array(300))).toThrow(RangeError);
    sim.settle();
    expect(byteAt(sim, net, 0)).toBe(0x11);
    expect(byteAt(sim, net, 1)).toBe(0x22);
  });
});

/**
 * The program every `program` check below runs.
 *
 * Hand-computed from the OVERTURE table in the phase-2 plan (decision 5):
 * `loadi` is `00_iiiiii`, `add` is `01_000_000`, and `move|sX|dY` is
 * `10_XXX_YYY` with 6 = `inp` and 7 = `out`. Every byte is different on purpose:
 * a circuit that always reads byte 0 must not be able to pass the reference
 * check.
 */
const SOURCE = [
  '# fetch-and-add, one distinct byte per instruction',
  'loadi|5',
  'move|s0|d1',
  'loadi|9',
  'move|s0|d2',
  'add',
  'move|s2|out',
].join('\n');

/** The image `SOURCE` must assemble to: `loadi|5`, `move|s0|d1`, ... in order. */
const IMAGE = [0x05, 0x81, 0x09, 0x82, 0x40, 0x97] as const;

/**
 * Six steps, one per instruction, then a reload.
 *
 * Driving the level's `load` pin high sends the program counter back to address
 * 0 (its `in` pin is unwired, so it loads zero), which is why the last two steps
 * read the first two bytes again. The input pin is not decoration: the
 * counterexample that forgets to wire it diverges exactly at that reload.
 */
const STEPS: readonly ProgramStep[] = [
  { tick: 0, inputs: { load: 0 }, expect: { out: IMAGE[0] } },
  { tick: 1, inputs: { load: 0 }, expect: { out: IMAGE[1] } },
  { tick: 2, inputs: { load: 0 }, expect: { out: IMAGE[2] } },
  { tick: 3, inputs: { load: 0 }, expect: { out: IMAGE[3] } },
  { tick: 4, inputs: { load: 1 }, expect: { out: IMAGE[0] } },
  { tick: 5, inputs: { load: 0 }, expect: { out: IMAGE[1] } },
];

/** The level every check below is graded against: one 1-bit input, one 8-bit output. */
function programSpec(checks: readonly LevelCheck[]): LevelSpec {
  return {
    id: 'test-program',
    chapter: 3,
    index: 43,
    name: { zh: '测试程序', en: 'Test Program' },
    brief: { zh: '', en: '' },
    hint: { zh: '', en: '' },
    allowedComponents: ['level_input', 'level_output', 'pc8', 'ram_prog'],
    io: {
      inputs: [{ id: 'load', width: 1 }],
      outputs: [{ id: 'out', width: 8 }],
    },
    checks,
  };
}

/** The check under test, with anything a test wants to vary. */
function programCheck(overrides: Partial<ProgramCheck> = {}): LevelCheck {
  return { kind: 'program', source: SOURCE, steps: STEPS, ...overrides };
}

/**
 * The reference solution: a program counter addressing the program RAM, whose
 * byte is the level output.
 *
 * `pc8` advances on every clock edge and the level's `load` pin sends it back to
 * address 0, so the circuit genuinely walks the image. This is the fetch half of
 * an OVERTURE with no instruction semantics of its own, which is the point: the
 * check verifies that the assembled image reached the RAM and is read in order,
 * not that the circuit understands the instructions.
 */
function fetcher(): Graph {
  const g = emptyGraph();
  const load = addInstance(g, 'level_input', 0, 0, 'IN_load');
  const pc = addInstance(g, 'pc8', 60, 0, 'PC');
  const ram = addInstance(g, 'ram_prog', 140, 0, 'RAM');
  const out = addInstance(g, 'level_output', 220, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: load.id, port: 'out' }, { inst: pc.id, port: 'load' });
  connect(g, { inst: pc.id, port: 'out' }, { inst: ram.id, port: 'addr' });
  connect(g, { inst: ram.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

/**
 * Counterexample 1: the counter is wired to the output instead of the RAM's
 * byte.
 *
 * A plausible mis-wiring -- both pins are 8-bit and sit next to each other --
 * that loads the image and never reads it, so the output is the address
 * sequence 0, 1, 2, ... The check must fail on it.
 */
function ignoresImage(): Graph {
  const g = emptyGraph();
  const load = addInstance(g, 'level_input', 0, 0, 'IN_load');
  const pc = addInstance(g, 'pc8', 60, 0, 'PC');
  addInstance(g, 'ram_prog', 140, 0, 'RAM');
  const out = addInstance(g, 'level_output', 220, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: load.id, port: 'out' }, { inst: pc.id, port: 'load' });
  connect(g, { inst: pc.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

/**
 * Counterexample 2: the reference solution with the level's `load` pin left
 * unwired.
 *
 * `pc8.load` reads 0 on every edge, so the counter never returns to address 0
 * and the reload step reads on through the image instead of restarting it -- the
 * classic "I wired the circuit but not the level input" bug. The check must fail
 * on it, at the reload step.
 */
function ignoresInput(): Graph {
  const g = emptyGraph();
  addInstance(g, 'level_input', 0, 0, 'IN_load');
  const pc = addInstance(g, 'pc8', 60, 0, 'PC');
  const ram = addInstance(g, 'ram_prog', 140, 0, 'RAM');
  const out = addInstance(g, 'level_output', 220, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: pc.id, port: 'out' }, { inst: ram.id, port: 'addr' });
  connect(g, { inst: ram.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

/**
 * Two program RAMs, only the second of which is read.
 *
 * A check that names no `ram` must load EVERY `ram_prog` instance: a loader that
 * took only the first would leave `RAM_B` at zero and fail here. The named
 * checks then prove the name selects, in both directions.
 */
function twoRams(): Graph {
  const g = emptyGraph();
  const load = addInstance(g, 'level_input', 0, 0, 'IN_load');
  const pc = addInstance(g, 'pc8', 60, 0, 'PC');
  addInstance(g, 'ram_prog', 140, 0, 'RAM_A');
  const ramB = addInstance(g, 'ram_prog', 140, 80, 'RAM_B');
  const out = addInstance(g, 'level_output', 220, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: load.id, port: 'out' }, { inst: pc.id, port: 'load' });
  connect(g, { inst: pc.id, port: 'out' }, { inst: ramB.id, port: 'addr' });
  connect(g, { inst: ramB.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

/** A circuit with level I/O but no program RAM for the check to load into. */
function noRam(): Graph {
  const g = emptyGraph();
  const load = addInstance(g, 'level_input', 0, 0, 'IN_load');
  const out = addInstance(g, 'level_output', 120, 0, 'OUT');
  out.params.width = 8;
  connect(g, { inst: load.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('runChecks / program', () => {
  it('assembles SOURCE to the image the ISA table says', () => {
    // The cross-check between this check kind and Task 3's assembler. If either
    // the encoding or the byte order drifted, the reference test below would
    // still pass against a consistently-wrong assembler, so the image is pinned
    // here, and its bytes are asserted distinct: an all-equal image could not
    // tell "reads byte 0" from "reads in order".
    expect(assemble(SOURCE, OVERTURE_ISA).bytes).toEqual([...IMAGE]);
    expect(new Set(IMAGE).size).toBe(IMAGE.length);
  });

  it('passes on a circuit that fetches the image from the program RAM', () => {
    const outcome = runChecks(fetcher(), registry, programSpec([programCheck()]));
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    // Same tick accounting as `script`: the last step's tick is the high-water
    // mark the run reports, and it feeds the star rating.
    expect(outcome.ticksUsed).toBe(5);
  });

  it('fails on a circuit that loads the image and never reads it', () => {
    const outcome = runChecks(ignoresImage(), registry, programSpec([programCheck()]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toContain('mismatch');
    // The record carries the numbers, in the same shape `script` records them.
    const first = outcome.failures[0];
    expect(first?.check).toBe('program');
    expect(first?.tick).toBe(0);
    expect(first?.inputs).toEqual({ load: 0 });
    expect(first?.expected).toEqual({ out: IMAGE[0] });
    expect(first?.actual).toEqual({ out: 0 });
  });

  it('fails on a circuit that ignores the level input pin', () => {
    // The divergence is at the reload step: driving `load` high is what sends
    // the counter back to address 0, and a circuit that dropped that wire reads
    // byte 4 where the check expects byte 0.
    const outcome = runChecks(ignoresInput(), registry, programSpec([programCheck()]));
    expect(outcome.passed).toBe(false);
    const mismatch = outcome.failures.find((f) => f.reason === 'mismatch');
    expect(mismatch?.tick).toBe(4);
    expect(mismatch?.expected).toEqual({ out: IMAGE[0] });
    expect(mismatch?.actual).toEqual({ out: IMAGE[4] });
    // Failing early does not stop the tick count; it is a metric, not a verdict.
    expect(outcome.ticksUsed).toBe(5);
  });

  it('loads every ram_prog instance when the check names none', () => {
    // RAM_A comes first in the document and is unread; only a loader that fills
    // every program RAM can pass this circuit.
    expect(runChecks(twoRams(), registry, programSpec([programCheck()])).passed).toBe(true);
  });

  it('loads only the instance the check names', () => {
    const named = runChecks(twoRams(), registry, programSpec([programCheck({ ram: 'RAM_B' })]));
    expect(named.passed).toBe(true);
    // Naming the other one must NOT also load the read one: the name selects,
    // and a check that quietly loaded everything would pass this too.
    const wrong = runChecks(twoRams(), registry, programSpec([programCheck({ ram: 'RAM_A' })]));
    expect(wrong.passed).toBe(false);
    expect(wrong.failures.map((f) => f.reason)).toContain('mismatch');
  });

  it('reports a circuit with no ram_prog instance as missing-io', () => {
    const outcome = runChecks(noRam(), registry, programSpec([programCheck()]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-io');
    expect(outcome.failures[0]?.detail).toContain('ram_prog');
  });

  it('turns an unknown ram id into an invalid failure instead of throwing', () => {
    // `Simulation.loadImage` raises `RangeError` for an id the netlist does not
    // have, and `runChecks` absorbs `RangeError` as `invalid`. A bare `Error`
    // would escape the check loop into `grade()`, which runs on every board edit.
    const spec = programSpec([programCheck({ ram: 'NO_SUCH_RAM' })]);
    expect(() => runChecks(fetcher(), registry, spec)).not.toThrow();
    const outcome = runChecks(fetcher(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
  });

  it('turns an image too long for ram_prog into an invalid failure', () => {
    // 300 instructions, 300 bytes, against 256 bytes of `ram_prog` state. The
    // assembler deliberately does not enforce the capacity, so the loader is
    // what refuses it -- as a failed check, not a throw.
    const oversized = Array.from({ length: 300 }, (_, i) => `loadi|${i % 64}`).join('\n');
    const spec = programSpec([{ kind: 'program', source: oversized, steps: STEPS }]);
    expect(() => runChecks(fetcher(), registry, spec)).not.toThrow();
    const outcome = runChecks(fetcher(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
  });

  it('refuses a program check with an empty steps array', () => {
    // The `missing-rows` lesson one kind over: no steps means nothing executed
    // and nothing compared, so this is a defect in the level, not a pass.
    const outcome = runChecks(fetcher(), registry, programSpec([programCheck({ steps: [] })]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
    // The reason is in the runtime array `levels/checks.ts` validates custom
    // failure records against, so the two declarations cannot drift.
    expect(FAILURE_REASONS).toContain('missing-program');
  });

  it('refuses a program check in which no step asserts anything', () => {
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([
        programCheck({
          steps: [{ tick: 0 }, { tick: 1, inputs: { load: 1 } }, { tick: 2, expect: {} }],
        }),
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
  });

  it('refuses a source that assembles to zero bytes', () => {
    // The assembler accepts a comment-only file as a legal zero-byte program;
    // loading it would execute nothing, which is the same vacuity as no steps.
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([programCheck({ source: '# no instructions here\n' })]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-program');
    expect(outcome.failures[0]?.detail).toContain('zero bytes');
  });

  it('reports an assembly error as invalid, naming the line', () => {
    const broken = ['# line 1 is a comment', 'loadi|5', 'bogus'].join('\n');
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([programCheck({ source: broken })]),
    );
    expect(outcome.passed).toBe(false);
    const first = outcome.failures[0];
    expect(first?.reason).toBe('invalid');
    // The line number has to be the error's own, not a constant: the next test
    // puts the same kind of error on a different line.
    expect(first?.detail).toContain('line 3');
  });

  it('reports an out-of-range field at its own line', () => {
    const broken = ['loadi|1', 'loadi|99'].join('\n');
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([programCheck({ source: broken })]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('line 2');
  });

  it('does not drive the steps after the assembler refused the source', () => {
    // A refused program must stop the check, not run the steps against a
    // half-written RAM: an invalid failure AND a pile of mismatches would tell
    // the player their circuit is wrong when their program is.
    const broken = ['loadi|5', 'bogus'].join('\n');
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([programCheck({ source: broken })]),
    );
    expect(outcome.failures.map((f) => f.reason)).toEqual(['invalid']);
  });
});

/**
 * The second channel: the program text arrives from the PLAYER, not from level
 * data.
 *
 * WHY BOTH CHANNELS EXIST. Chapters 1-3 grade a circuit against a program the
 * LEVEL wrote -- the player builds the machine, and the level's own image is what
 * proves it runs. Chapter 4 turns that around: the machine is given, and the
 * player writes the program. The check kind does not change, because everything
 * after the image is loaded is identical -- the same RAM, the same steps, the
 * same driver -- so a second kind would be a second set of tick semantics to keep
 * in agreement. Only the SOURCE of the text and the FORMAT it is written in are
 * new, and `from`/`format` are those two choices.
 *
 * WHAT MUST NOT CHANGE. An empty program is still a hard `missing-program`
 * whichever channel it came from: a check that loads nothing executes nothing
 * and compares nothing, which would pass every circuit ever built -- the
 * `missing-rows` lesson. A text that will not parse is still `invalid`, with the
 * line in the detail. And a check with no `from` still reads its own `source`
 * even when a player program is handed in beside it, which is what keeps every
 * shipped level exactly as it was.
 */
describe('runChecks / program from the player', () => {
  /** The same program, spelled as bytes: one line per instruction of `IMAGE`. */
  const BYTES = [
    '00000101',
    '10000001',
    '00001001',
    '10000010',
    '01000000',
    '10010111',
  ].join('\n');

  /** The check a chapter-4 level ships: no `source` of its own, the text is the player's. */
  function playerCheck(overrides: Partial<ProgramCheck> = {}): LevelCheck {
    return { kind: 'program', from: 'player', steps: STEPS, ...overrides };
  }

  /**
   * A check whose text is read as hand-written bytes rather than as assembly.
   *
   * No `source` by default, so the same helper builds the level-authored image
   * and the player-authored one -- the two differ only in which of those two the
   * test supplies.
   */
  function bytesCheck(overrides: Partial<ProgramCheck> = {}): LevelCheck {
    return { kind: 'program', format: 'bytes', steps: STEPS, ...overrides };
  }

  it('spells the fixture program the same way the assembler does', () => {
    // The bytes above are the SOURCE program in the machine-code format, and this
    // is that claim rather than an assumption: if the two spellings disagreed,
    // every test below would be grading a different program from the one the rest
    // of this file pins. It is also the cross-check between `asm/image.ts` and
    // `asm/isa.ts` -- two readers of one encoding, neither of which is allowed to
    // drift.
    expect(parseImage(BYTES).errors).toEqual([]);
    expect(parseImage(BYTES).bytes).toEqual([...IMAGE]);
  });

  it('runs the program the player handed in', () => {
    const outcome = runChecks(fetcher(), registry, programSpec([playerCheck()]), {
      text: SOURCE,
    });
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    // The same tick accounting as the level-authored channel: the program does
    // not change what a step means, only where the bytes came from.
    expect(outcome.ticksUsed).toBe(5);
  });

  it('refuses a player check when no program was handed in at all', () => {
    // The board-edit path calls `runChecks` with no fourth argument, and every
    // chapter-4 level's check is a player check: "the player has not typed
    // anything yet" must be a failure of the check, not a crash and not a pass.
    const outcome = runChecks(fetcher(), registry, programSpec([playerCheck()]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
    expect(outcome.failures[0]?.detail).toContain('empty');
  });

  it('refuses an empty or whitespace-only player buffer', () => {
    // Whitespace is nothing to run, exactly as it is for the assembler. The
    // detail says which buffer was empty, because "the level ships no source" and
    // "you have not typed anything" are different problems for different people.
    for (const text of ['', '   ', '\n\t\n', '  \n  ']) {
      const outcome = runChecks(fetcher(), registry, programSpec([playerCheck()]), { text });
      expect(outcome.passed, JSON.stringify(text)).toBe(false);
      expect(outcome.failures.map((f) => f.reason), JSON.stringify(text)).toEqual([
        'missing-program',
      ]);
      expect(outcome.failures[0]?.detail).toContain('player');
    }
  });

  it('reports an assembly error in the player text as invalid, naming the line', () => {
    const broken = ['# a comment', 'loadi|5', 'bogus'].join('\n');
    const outcome = runChecks(fetcher(), registry, programSpec([playerCheck()]), {
      text: broken,
    });
    expect(outcome.passed).toBe(false);
    const first = outcome.failures[0];
    expect(first?.reason).toBe('invalid');
    // The wording is the level channel's own, because the assembler is the same
    // assembler: the line is the player's line either way.
    expect(first?.detail).toContain('program assembly failed at line 3');
  });

  it('ignores the level text when the check asks for the player buffer', () => {
    // `from` chooses the CHANNEL, it does not merely permit one. A check that
    // named a `source` and still ran whatever the player had typed would grade a
    // different program depending on state the level never declared -- and here
    // the level's text would pass, so an implementation that fell back to it
    // whenever the buffer was empty would report a pass for an empty buffer.
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([playerCheck({ source: SOURCE })]),
      { text: '' },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
  });

  it('keeps reading the level text when a player program is handed in beside it', () => {
    // The regression that matters for every shipped level: 49 of them declare a
    // `source` and no `from`, and the app now passes the player's buffer to
    // `grade()` on every level. A channel that leaked would grade chapter 3
    // against a program the player had typed for a chapter-4 level.
    const outcome = runChecks(fetcher(), registry, programSpec([programCheck()]), {
      text: 'bogus',
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it('still refuses a level text that is not a string', () => {
    // Untrusted level data reaches the assembler directly, so the type is checked
    // before it is handed over -- and it stays `invalid` on the level channel
    // rather than becoming an empty player buffer, which would report the wrong
    // defect to the level author.
    const notText = { kind: 'program', source: 42, steps: STEPS } as unknown as LevelCheck;
    const outcome = runChecks(fetcher(), registry, programSpec([notText]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('source');
  });

  it('reads a level-authored image written as bytes', () => {
    const outcome = runChecks(fetcher(), registry, programSpec([bytesCheck({ source: BYTES })]));
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(5);
  });

  it('reads a player-authored image written as bytes', () => {
    const outcome = runChecks(fetcher(), registry, programSpec([bytesCheck({ from: 'player' })]), {
      text: BYTES,
    });
    expect(outcome.passed).toBe(true);
  });

  it('reports a bad image line as invalid, naming the line and the field', () => {
    // The image failure is worded in parallel with the assembler's, so a player
    // who moves between the two formats reads the same sentence shape. The line
    // is the image's own: the second line here, not a constant.
    const broken = ['00000101', '100000011'].join('\n');
    const outcome = runChecks(fetcher(), registry, programSpec([bytesCheck({ source: broken })]));
    expect(outcome.passed).toBe(false);
    const first = outcome.failures[0];
    expect(first?.reason).toBe('invalid');
    expect(first?.detail).toContain('program image failed at line 2');
  });

  it('refuses an image that parses to zero bytes', () => {
    // A comment-only image is legal to the parser -- zero bytes, zero errors --
    // and vacuous to the checker, which is the same hazard as an empty table.
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([bytesCheck({ source: '# nothing yet\n' })]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-program');
    expect(outcome.failures[0]?.detail).toContain('zero bytes');
  });

  it('refuses an empty player image before it reaches the parser', () => {
    const outcome = runChecks(
      fetcher(),
      registry,
      programSpec([bytesCheck({ from: 'player' })]),
      { text: '' },
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.reason)).toEqual(['missing-program']);
    expect(outcome.failures[0]?.detail).toContain('player');
  });
});
