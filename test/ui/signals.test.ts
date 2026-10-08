import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';
import { getLevel } from '../../src/levels/index';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { createProgramRun } from '../../src/levels/run';
import type { LevelSpec } from '../../src/levels/spec';
import { createDisplay } from '../../src/ui/board/signals';

const registry = createRegistry(BASE_DEFS);

/**
 * The chapter-4 machine the board is painted from when the level grades a
 * program the player wrote: one byte in, one byte out, on the reference CPU.
 */
const PROGRAM_LEVEL: LevelSpec = {
  id: 'test-display-machine',
  chapter: 4,
  index: 1,
  name: { zh: '测试显示', en: 'Test Display' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['level_input', 'level_output'],
  io: {
    inputs: [{ id: 'in', width: 8 }],
    outputs: [{ id: 'out', width: 8 }],
  },
  checks: [],
};

/** `move|inp|d1` / `move|s1|out`: the level's byte into REG1, REG1 onto `out`. */
const ECHO = ['move|inp|d1', 'move|s1|out'].join('\n');

/** The reference board, with `PROGRAM_LEVEL`'s pins wired to it. */
function programBoard() {
  return graphFromBoard(PROGRAM_LEVEL.id, overtureBoard({ inputId: 'in' }));
}

/**
 * The live display is what makes the board a readout instead of a drawing: the
 * wires light up from it and the readout panel's numbers come from it.
 *
 * It is NOT the grader, and these tests pin that separation. `levels/grader.ts`
 * compiles its own simulation and drives its own vectors; this one only has to
 * agree with the circuit about what a pin is carrying.
 */
describe('the board display', () => {
  /** `IN_a`, `IN_b` -> NAND -> `OUT`, which is a NAND and not the level's AND. */
  function nandBoard() {
    const level = getLevel('ch1-04-and-gate');
    const g = emptyGraph(level.id);
    const a = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const b = addInstance(g, 'level_input', 0, 80, 'IN_b');
    const gate = addInstance(g, 'nand', 200, 0);
    const out = addInstance(g, 'level_output', 400, 0, 'OUT');
    connect(g, { inst: a.id, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(g, { inst: b.id, port: 'out' }, { inst: gate.id, port: 'b' });
    connect(g, { inst: gate.id, port: 'out' }, { inst: out.id, port: 'in' });
    return { level, g, gate, out };
  }

  it('drives the level inputs and reads the level outputs back', () => {
    const { level, g } = nandBoard();
    const display = createDisplay(g, registry, level, { a: 1, b: 0 });
    expect(display).not.toBeNull();
    expect(display!.read().stable).toBe(true);
    expect(display!.read().levelOutputs.get('out')).toBe(1);

    display!.drive({ a: 1, b: 1 });
    expect(display!.read().levelOutputs.get('out')).toBe(0);
  });

  it('reports every compiled output pin by instance and port', () => {
    const { level, g, gate } = nandBoard();
    const display = createDisplay(g, registry, level, { a: 0, b: 1 });
    // The board paints a wire from the driver's own pin, so the snapshot has to
    // name that pin and not only the level's outputs.
    expect(display!.read().outputs.get(`${gate.id}.out`)).toBe(1);
  });

  it('drives a pin the vector does not name as 0, rather than remembering it', () => {
    // `IN_b` is left out of the second vector. An input that kept its last value
    // would leave the board showing a circuit nobody is driving.
    const { level, g } = nandBoard();
    const display = createDisplay(g, registry, level, { a: 1, b: 1 });
    expect(display!.read().levelOutputs.get('out')).toBe(0);
    display!.drive({ a: 1 });
    expect(display!.read().levelOutputs.get('out')).toBe(1);
  });

  it('clears storage on reset and re-drives the original vector', () => {
    const { level, g } = nandBoard();
    const display = createDisplay(g, registry, level, { a: 1, b: 1 });
    display!.tick();
    display!.reset();
    expect(display!.read().levelOutputs.get('out')).toBe(0);
    expect(display!.read().tick).toBe(0);
  });

  /**
   * A ring of two inverters is a combinational cycle, which `compile` refuses
   * outright -- `validateGraph` reports it as an error. So the display is null,
   * not a half-finished sweep: the board goes dark rather than showing a value
   * for a circuit that has none.
   *
   * `read`'s own `stable` flag is still there, and still consulted, because a
   * feedback loop THROUGH storage passes validation and can genuinely fail to
   * settle. This test pins the reachable half of that contract.
   */
  it('is null for a graph the compiler refuses, instead of throwing', () => {
    // The board doubles as the editor, so the states a player passes through are
    // usually not runnable. A throw here would take the whole app down mid-edit.
    const level = getLevel('ch1-04-and-gate');
    const g = emptyGraph(level.id);
    const one = addInstance(g, 'not', 0, 0);
    const two = addInstance(g, 'not', 200, 0);
    connect(g, { inst: one.id, port: 'out' }, { inst: two.id, port: 'in' });
    connect(g, { inst: two.id, port: 'out' }, { inst: one.id, port: 'in' });
    expect(createDisplay(g, registry, level, {})).toBeNull();
  });

  it('runs a half-built board, which is the state a player is in most of the time', () => {
    const level = getLevel('ch1-04-and-gate');
    const g = emptyGraph(level.id);
    addInstance(g, 'nand', 0, 0);
    expect(createDisplay(g, registry, level, {})).not.toBeNull();
  });

  /**
   * THE DISPLAY AND THE RUN ARE ONE MACHINE.
   *
   * A program level hands the board the run's own compiled circuit, because the
   * two must not be able to disagree: the board's clock card, the io panel's `out`
   * row and the debugger's counter are all readouts of the machine a step
   * advanced, and a display that compiled its own would paint a zero program --
   * 256 zeros in `ram_prog` -- under a debugger counting the player's.
   */
  it('paints the machine a program run is driving when it is handed one', () => {
    const run = createProgramRun(programBoard(), registry, PROGRAM_LEVEL, ECHO, 'asm');
    expect(run.errors).toEqual([]);
    const machine = run.machine;
    expect(machine).not.toBeNull();

    const display = createDisplay(programBoard(), registry, PROGRAM_LEVEL, {}, machine);
    expect(display).not.toBeNull();
    // The machine's own storage, not a copy: the image the run loaded into
    // `ram_prog` is what the board is painted from.
    expect(display!.io.sim).toBe(machine!.sim);

    // FIVE STEPS, THE NUMBER THE REVIEW COUNTED. `main.ts` drives its clock
    // through the display, so the display is what advances the machine here.
    const INPUT = 0x2a;
    run.setInput('in', INPUT);
    for (let i = 0; i < 5; i += 1) display!.tick();

    // The clock card's reading and the debugger's tick are the same simulation's
    // counter: before this fix the run said 5 while the display said 0.
    expect(display!.read().tick).toBe(5);
    expect(run.ticks).toBe(5);
    // ...and the level's `out` row carries what the player's program drove. The
    // zero program could never produce this byte.
    expect(display!.read().levelOutputs.get('out')).toBe(INPUT);
    expect(run.readOutputs()).toEqual({ out: INPUT });
  });

  it('compiles its own circuit when no machine is handed to it, as before', () => {
    // THE CHANGED SIGNATURE'S OTHER HALF, and the reason chapters 1 to 3 are
    // untouched: with no machine the display does exactly what it always did --
    // compiles the graph and owns the storage. Two separate simulations of one
    // graph are what those levels have always had, since nothing there is loaded
    // with a program and there is no second reader to disagree with.
    const run = createProgramRun(programBoard(), registry, PROGRAM_LEVEL, ECHO, 'asm');
    // The run IS driving a machine here -- the display was simply not given it.
    const own = createDisplay(programBoard(), registry, PROGRAM_LEVEL, {}, null);
    expect(own).not.toBeNull();
    expect(run.machine).not.toBeNull();
    expect(own!.io.sim).not.toBe(run.machine!.sim);

    // ...so the two really are independent machines: the display's own never had
    // the program, and stepping one leaves the other's clock where it was.
    own!.tick();
    expect(own!.read().tick).toBe(1);
    expect(run.ticks).toBe(0);
    expect(own!.read().levelOutputs.get('out')).toBe(0);
  });
});
