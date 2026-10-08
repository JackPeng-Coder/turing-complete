import { describe, expect, it } from 'vitest';
import { addInstance, emptyGraph } from '../../src/core/graph';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { createProgramRun } from '../../src/levels/run';
import type { LevelSpec } from '../../src/levels/spec';
import { registry } from '../fixtures/build';

/**
 * `createProgramRun`: one program, one board, stepped by hand.
 *
 * THE SURFACE THE IDE AND THE DEBUGGER SHARE. A `program` check drives its steps
 * itself and never stops; a player writing a program needs the opposite -- load
 * the image, clock one edge at a time, and read what the machine holds between
 * edges -- so this is the same board driven at a human's pace rather than a
 * second simulator.
 *
 * THE CIRCUIT IS REAL, WHICH IS THE POINT. `overtureBoard({ inputId: 'in' })` is
 * the chapter-4 reference CPU -- the machine the programming chapter hands the
 * player -- and the two-instruction program below is the one chapter 4's first
 * level is solved with: copy the level's input into REG1, then publish REG1 on
 * `out`. Anything the run reads therefore has to come out of the machine's own
 * state, not out of a fixture: the input byte only reaches `out` because the
 * register file wrote it on an edge, and the byte in REG1 is what makes the
 * register readout worth having.
 */

/** The level the run is opened on: the chapter-4 shape, one byte in and out. */
const RUN_LEVEL: LevelSpec = {
  id: 'test-run',
  chapter: 4,
  index: 1,
  name: { zh: '测试运行', en: 'Test Run' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['level_input', 'level_output'],
  io: {
    inputs: [{ id: 'in', width: 8 }],
    outputs: [{ id: 'out', width: 8 }],
  },
  checks: [],
};

/**
 * `move|inp|d1` / `move|s1|out`: the level's byte into REG1, REG1 onto `out`.
 *
 * The default board halts on the `out` instruction (the chapter-3 design: the
 * counter freezes so the answer stays published), so this program is two edges
 * long and then still -- which is what gives the tests below both a moving
 * counter and a halted one to look at.
 */
const ECHO = ['move|inp|d1', 'move|s1|out'].join('\n');

/** The image `ECHO` must assemble to: 10_110_001, then 10_001_111. */
const ECHO_IMAGE = [0xb1, 0x8f] as const;

/** The same program in the hand-written byte format, one line per instruction. */
const ECHO_BYTES = ['10110001', '10001111'].join('\n');

/** The reference board, ready to run programs on. */
function board(): ReturnType<typeof graphFromBoard> {
  return graphFromBoard(RUN_LEVEL.id, overtureBoard({ inputId: 'in' }));
}

describe('createProgramRun', () => {
  it('loads the image it was handed and starts at tick 0', () => {
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO, 'asm');
    expect(run.errors).toEqual([]);
    expect(run.bytes).toEqual([...ECHO_IMAGE]);
    expect(run.ticks).toBe(0);
    // The program RAM as it stands: the whole 256-byte image, so the debugger's
    // window has a tail to show.
    const ram = run.readRam();
    expect(ram).not.toBeNull();
    expect(ram).toHaveLength(256);
    expect(ram!.slice(0, 3)).toEqual([0xb1, 0x8f, 0x00]);
    // The counter starts at the first instruction, and nothing has run.
    expect(run.readPc()).toBe(0);
    expect(run.readRegisters()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(run.readOutputs()).toEqual({ out: 0 });
  });

  it('publishes the input it was given, one edge later', () => {
    // THE WHOLE CONTRACT IN ONE TEST. The byte is written while the machine is
    // looking at `move|inp|d1`, so the edge that ends that instruction is what
    // copies it into REG1; `out` then publishes REG1 for as long as the counter
    // is held on the `out` instruction. A run that ticked without settling first
    // would clock the PREVIOUS input vector and publish 0 here.
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO, 'asm');
    run.setInput('in', 0x2a);
    // Nothing is published yet: the instruction that puts the byte on `out` has
    // not been reached, and the machine does not guess.
    expect(run.readOutputs()).toEqual({ out: 0 });
    expect(run.ticks).toBe(0);

    run.step();
    expect(run.ticks).toBe(1);
    expect(run.readOutputs()).toEqual({ out: 0x2a });
    // THE STATE THE DISPLAY IS FOR: REG1 holds the byte the edge wrote, and the
    // counter has advanced to the instruction it is now looking at.
    expect(run.readRegisters()).toEqual([0, 0x2a, 0, 0, 0, 0]);
    expect(run.readPc()).toBe(1);
  });

  it('counts one edge per step, and lets the halted counter stand still', () => {
    // The halt is the chapter-3 design, not a defect: writing `out` freezes the
    // counter so the answer stays put. What must keep moving is the tick count --
    // it is the run's clock, not the program's.
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO, 'asm');
    run.setInput('in', 0x07);
    run.step();
    run.step();
    run.step();
    expect(run.ticks).toBe(3);
    expect(run.readPc()).toBe(1);
    expect(run.readOutputs()).toEqual({ out: 0x07 });
    // ...and the register file still holds exactly what the one edge wrote: a
    // halted counter executes nothing, so no later step may disturb it.
    expect(run.readRegisters()).toEqual([0, 0x07, 0, 0, 0, 0]);
  });

  it('drives the same run from a program written as bytes', () => {
    // `format` is the same choice the `program` check makes, and the two readers
    // are the kernel's: a run that only understood assembly would leave the
    // punchcard level's editor unable to run what it compiles.
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO_BYTES, 'bytes');
    expect(run.errors).toEqual([]);
    expect(run.bytes).toEqual([...ECHO_IMAGE]);
    run.setInput('in', 0x11);
    run.step();
    expect(run.readOutputs()).toEqual({ out: 0x11 });
  });

  it('refuses a bad program with a line number and steps nothing', () => {
    // A refusal is what the panel shows INSTEAD of a run: nothing is loaded, so
    // a step has to leave the clock alone rather than clock a board with no
    // program in it.
    const broken = ['# a comment', 'move|inp|d1', 'bogus'].join('\n');
    const run = createProgramRun(board(), registry, RUN_LEVEL, broken, 'asm');
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toContain('line 3');
    expect(run.bytes).toEqual([]);

    run.step();
    expect(run.ticks).toBe(0);
    run.setInput('in', 0x2a);
    run.step();
    expect(run.ticks).toBe(0);
    expect(run.readPc()).toBe(0);
  });

  it('says the PLAYER compiled nothing when their text is comment-only', () => {
    // The channel the run drives is the player's buffer, and the sentence has to
    // say so: "you have not typed anything runnable" and "this level shipped
    // nothing" are the same defect to the circuit and different problems for
    // different people.
    const run = createProgramRun(board(), registry, RUN_LEVEL, '# nothing yet\n', 'asm');
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toContain('the player compiles to zero bytes');
    expect(run.bytes).toEqual([]);
    run.step();
    expect(run.ticks).toBe(0);
  });

  it('reset puts the run back to tick 0 with the image loaded again', () => {
    // What the IDE's reset has to mean: the same program on a cleared machine,
    // not a resume. The image survives because the load happens AFTER the reset
    // -- the ordering `loadProgramImage` exists to keep.
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO, 'asm');
    run.setInput('in', 0x2a);
    run.step();
    expect(run.ticks).toBe(1);
    expect(run.readRegisters()).toEqual([0, 0x2a, 0, 0, 0, 0]);

    run.reset();
    expect(run.ticks).toBe(0);
    expect(run.readPc()).toBe(0);
    expect(run.readRegisters()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(run.readRam()!.slice(0, 2)).toEqual([0xb1, 0x8f]);
    // ...and the cleared run still works: the same input, one edge later.
    run.setInput('in', 0x05);
    run.step();
    expect(run.readOutputs()).toEqual({ out: 0x05 });
  });

  it('reports the halt line the debugger shows', () => {
    // Chapter 3's halt line freezes the counter so the answer stays published,
    // and it is the one fact the debugger cannot infer from the counter standing
    // still: a jump to its own address would look the same.
    const run = createProgramRun(board(), registry, RUN_LEVEL, ECHO, 'asm');
    // The first instruction is `move|inp|d1`, which does not write `out`, so
    // nothing is holding the counter.
    expect(run.readHalt()).toBe(false);
    run.step();
    // One edge later the machine is looking at `move|s1|out`.
    expect(run.readHalt()).toBe(true);
  });

  it('has no halt line on a board that never built one', () => {
    // `null` rather than `false`: a board without the part has not told the panel
    // the counter is free, and a panel that printed 运行 there would be inventing
    // a signal. The RAM is real, so the program still loads and steps.
    const g = emptyGraph(RUN_LEVEL.id);
    addInstance(g, 'ram_prog', 0, 0, 'RAM');
    const run = createProgramRun(g, registry, RUN_LEVEL, ECHO, 'asm');
    expect(run.errors).toEqual([]);
    expect(run.readHalt()).toBeNull();
    expect(run.readRam()).not.toBeNull();
  });

  it('reads null for the parts a board does not have, and refuses to run it', () => {
    // The debugger is mounted while the board is still being built, so "there is
    // no register file in this circuit" is an ordinary answer and not an error:
    // the three readers say `null`, and the run says why it cannot run at all
    // (there is nowhere to put the program) instead of clocking zeros.
    const run = createProgramRun(emptyGraph(RUN_LEVEL.id), registry, RUN_LEVEL, ECHO, 'asm');
    expect(run.readRegisters()).toBeNull();
    expect(run.readPc()).toBeNull();
    expect(run.readRam()).toBeNull();
    expect(run.readOutputs()).toEqual({ out: 0 });
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toContain('ram_prog');
    run.step();
    expect(run.ticks).toBe(0);
  });

  it('reports a circuit that will not compile instead of throwing', () => {
    // `createProgramRun` runs from a DOM event handler and a repeating timer, so
    // nothing it can be handed may throw: a half-built board (here a part the
    // registry does not know) becomes a sentence, and every reader stays safe.
    const g = emptyGraph(RUN_LEVEL.id);
    addInstance(g, 'no_such_part', 0, 0);
    const run = createProgramRun(g, registry, RUN_LEVEL, ECHO, 'asm');
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toContain('compile');
    expect(run.bytes).toEqual([]);
    expect(run.readRam()).toBeNull();
    expect(run.readPc()).toBeNull();
    // No circuit means no readings at all: an empty record rather than a zero per
    // pin, which would be a value nothing has driven.
    expect(run.readOutputs()).toEqual({});
    run.step();
    expect(run.ticks).toBe(0);
  });
});
