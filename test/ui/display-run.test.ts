// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { graphFromBoard } from '../../src/levels/board';
import { overtureBoard } from '../../src/levels/boards/overture';
import { createProgramRun } from '../../src/levels/run';
import type { LevelSpec } from '../../src/levels/spec';
import { createDisplay, resetBoard } from '../../src/ui/board/signals';
import { mountDebug } from '../../src/ui/debug';

const registry = createRegistry(BASE_DEFS);

/**
 * ONE MACHINE BEHIND EVERY READOUT: the board's clock card, its `out` row and the
 * debugger's counter.
 *
 * THE INTEGRATION `main.ts` PERFORMS, at the seam it performs it. A program level
 * builds the run first and hands the run's machine to `createDisplay`, so the
 * simulation the board paints is the one the program is loaded in; the io panel's
 * clock is read from the display's snapshot and the debugger's from the run. This
 * is the wiring the board screen cannot be mounted for in a test -- `main.ts` is
 * the whole application, reading a real save and a real canvas -- so what is
 * pinned here is the composition itself: the display drives the run's machine, and
 * both readouts are answers about that one machine.
 */

/** A chapter-4 level: one byte in, one byte out, on the reference CPU. */
const PROGRAM_LEVEL: LevelSpec = {
  id: 'test-display-run',
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

/** `move|inp|d1` / `move|s1|out`: the level's byte into REG1, REG1 onto `out`. */
const ECHO = ['move|inp|d1', 'move|s1|out'].join('\n');

/** The byte the level's input is driven with for the whole test. */
const INPUT = 0x2a;

describe('the board, the run and the debugger as main.ts wires them', () => {
  it('agrees about the clock and the output after five steps', () => {
    // The board: the same reference circuit, and the run's machine handed to it.
    const graph = graphFromBoard(PROGRAM_LEVEL.id, overtureBoard({ inputId: 'in' }));
    const run = createProgramRun(graph, registry, PROGRAM_LEVEL, ECHO, 'asm');
    expect(run.errors).toEqual([]);
    const display = createDisplay(graph, registry, PROGRAM_LEVEL, {}, run.machine);
    expect(display).not.toBeNull();

    // The debugger, wired exactly as `main.ts` wires it: every answer is the run's.
    const root = document.createElement('div');
    document.body.append(root);
    const debug = mountDebug(root, {
      registers: () => run.readRegisters(),
      pc: () => run.readPc(),
      ram: () => run.readRam(),
      halt: () => run.readHalt(),
      ticks: () => run.ticks,
    });

    // The player's byte reaches the machine before the first edge, through the
    // same call `main.ts` makes when the readout panel is clicked.
    run.setInput('in', INPUT);

    const STEPS = 5;
    for (let i = 0; i < STEPS; i += 1) {
      display!.tick();
      // What `main.ts` does after a 单步: it re-renders both panels, which is how
      // the debugger comes to report the edge the board just clocked.
      debug.render();
    }

    // THE CLOCK CARD AND THE DEBUGGER, after five clicks of 单步: one number, not
    // two. Before this wiring the debugger said 5 while the card said 0, because
    // the card was reading a second simulation that had never been stepped.
    const ioClock = display!.read().tick;
    const debuggerTicks = root.querySelector('.debug-ticks')?.textContent ?? '';
    expect(ioClock).toBe(STEPS);
    expect(run.ticks).toBe(STEPS);
    expect(debuggerTicks).toContain(String(STEPS));

    // THE LEVEL'S `out` ROW carries what the player's program drove. The zero
    // program cannot produce this byte: with no image loaded, `move|inp|d1` never
    // executes and the publish line reads a register that was never written.
    const snapshot = display!.read();
    expect(snapshot.stable).toBe(true);
    expect(snapshot.levelOutputs.get('out')).toBe(INPUT);
    expect(run.readOutputs()).toEqual({ out: INPUT });

    // ...and the byte is visible in the machine's own state, which is the reading
    // the panel exists for.
    expect(run.readRegisters()).toEqual([0, INPUT, 0, 0, 0, 0]);
    expect(root.querySelector('.debug-reg:nth-child(2)')?.textContent).toContain('0x2A');
  });

  /**
   * THE BOARD'S 停止并复位 MUST NOT EAT THE PROGRAM. `main.ts`'s `onStop` calls
   * `resetBoard(display, run)` -- the same call, on the same pair, this test
   * makes -- and the bug this pins is what happened when that path was a bare
   * `display.reset()`: the display paints the run's own `Simulation`, so clearing
   * the display's storage cleared `ram_prog` too, and the editor went on showing
   * "5 字节" over 256 zeros. The debugger then read zeros and the counter walked a
   * zero program, because nothing reloads the image until the text changes.
   *
   * THE RESET STILL HAS TO RESET, so this is not satisfied by a board that never
   * cleared: the tick goes back to 0 and the register file is empty after it.
   */
  it('keeps the program loaded, and still runnable, when the board is reset', () => {
    const graph = graphFromBoard(PROGRAM_LEVEL.id, overtureBoard({ inputId: 'in' }));
    const run = createProgramRun(graph, registry, PROGRAM_LEVEL, ECHO, 'asm');
    expect(run.errors).toEqual([]);
    const display = createDisplay(graph, registry, PROGRAM_LEVEL, {}, run.machine);
    expect(display).not.toBeNull();

    // The machine has run: state the reset has to clear, and a program in RAM.
    run.setInput('in', INPUT);
    display!.tick();
    display!.tick();
    expect(display!.read().tick).toBe(2);
    expect(run.readRegisters()).toEqual([0, INPUT, 0, 0, 0, 0]);
    expect(run.readRam()!.slice(0, 2)).toEqual([0xb1, 0x8f]);

    resetBoard(display, run);
    // `main.ts` re-drives the readout panel's vector onto the run after the
    // reset, because a cleared simulation has no inputs in it.
    run.setInput('in', INPUT);

    // THE CLOCK AND THE REGISTERS CLEARED, THE IMAGE DID NOT: the same bytes the
    // editor's text compiles to, and the counter back at the first instruction.
    expect(display!.read().tick).toBe(0);
    expect(run.ticks).toBe(0);
    expect(run.readPc()).toBe(0);
    expect(run.readRegisters()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(run.readRam()!.slice(0, 2)).toEqual([0xb1, 0x8f]);

    // ...AND IT STILL RUNS. A zeroed `ram_prog` cannot reach this byte: with the
    // image erased every instruction is `loadi|0`, so `out` stays 0.
    display!.tick();
    display!.tick();
    expect(display!.read().levelOutputs.get('out')).toBe(INPUT);
    expect(run.readOutputs()).toEqual({ out: INPUT });
  });
});
