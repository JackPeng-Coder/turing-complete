import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile } from '../core/net';
import type { Registry } from '../core/registry';
import { portValueToNumber } from '../core/signal';
import { bindLevelIo, loadProgramImage, programImageOf, programTargets, type LevelIo } from './checks';
import type { LevelSpec } from './spec';

/**
 * One program on one board, stepped by hand.
 *
 * WHY THIS EXISTS, GIVEN THE CHECKERS. A `program` check drives its whole step
 * list in one call and reports a verdict; a player writing a program needs the
 * opposite: load the image, clock ONE edge, and read what the machine holds
 * between edges. The debugger and the IDE are that, and they must not re-derive
 * the parts that decide meaning -- which `ram_prog` instances hold a program, how
 * a text becomes an image, whether the circuit has to be reset before an image
 * lands. So this surface is composed out of the kernel's own pieces
 * (`loadProgramImage`, `programTargets`, `bindLevelIo`, `Simulation.readState`)
 * and adds only the thing a human has that a checker does not: time between
 * steps.
 *
 * NO DOM, NO TIME, NO RANDOMNESS. The timer that drives `step` repeatedly lives
 * in `main.ts`, where the buttons are; this module would be identical in a test
 * harness, which is what makes the two-instruction program in
 * `test/levels/run.test.ts` able to pin the real board's behaviour.
 *
 * NOTHING HERE THROWS. `createProgramRun` is called from the IDE's edit path and
 * `step` from a repeating timer, so the same rule the check pipeline follows one
 * level up applies here: a refusal is data. A parse error, a circuit that will
 * not compile, a settle that does not converge -- each becomes a sentence in
 * `errors`, and a run with errors does nothing.
 */
export interface ProgramRun {
  /**
   * What the panel shows instead of a run.
   *
   * The first entries are the text's own refusals, line-numbered, as the readers
   * word them; empty when the text is a program. A CIRCUIT-LEVEL sentence may
   * follow -- "the circuit does not compile", "there is no `ram_prog` to load
   * into", "the circuit does not settle" -- because there is no other channel a
   * panel could show it on and a control that looks live and does nothing is
   * worse than a sentence. Non-empty means nothing was loaded, so `step` is a
   * no-op that leaves `ticks` alone.
   */
  readonly errors: readonly string[];
  /** The assembled image, or `[]` when the text is not a program. */
  readonly bytes: readonly number[];
  /** Edges clocked since the last `reset`. */
  readonly ticks: number;
  /** Reset, load the image, settle: the run starts over. */
  reset(): void;
  /** Settle, apply one clock edge, settle again. */
  step(): void;
  /** Drives one level input pin; the board settles, so the next edge samples it. */
  setInput(name: string, value: number): void;
  /** Every pin of `spec.io.outputs`, as the level reads them. */
  readOutputs(): Readonly<Record<string, number>>;
  /** REG0..REG5 of the circuit's `regfile6`, or `null` when it has none. */
  readRegisters(): readonly number[] | null;
  /** The `pc8` state -- the address being executed -- or `null` with no counter. */
  readPc(): number | null;
  /**
   * The circuit's `halt` line, or `null` when this board has no `halt` part.
   *
   * THE ONE THING THE DEBUGGER CANNOT INFER. Chapter 3's machine freezes the
   * counter while `halt` is high, so a program that has finished and a program
   * that jumped to its own address both stand still -- and "the counter stopped
   * moving" would report the second as the first. This reads the machine's own
   * signal instead: `halt` is a part with an output pin, and its value is the
   * same one the counter's load logic sees.
   */
  readHalt(): boolean | null;
  /** The 256-byte program image as it stands, or `null` with no `ram_prog`. */
  readRam(): readonly number[] | null;
}

/** A circuit the run can drive: a compiled simulation with the level's pins bound. */
interface Ready {
  readonly sim: Simulation;
  readonly io: LevelIo;
}

/**
 * Builds a run of `text` on `graph` and takes it to its starting state: reset,
 * image loaded, settled, at tick 0.
 *
 * `format` is the check's own choice (`'asm'` or the hand-written image format),
 * and the text is always the PLAYER's, which is what the zero-byte sentence says
 * when it fires.
 */
export function createProgramRun(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
  text: string,
  format: 'asm' | 'bytes',
): ProgramRun {
  /** Parse refusals first, then whatever the circuit has to say; see `errors`. */
  const errors: string[] = [];
  let bytes: readonly number[] = [];
  /** True once a settle has failed: nothing is driven after that. */
  let stopped = false;
  /** The compiled circuit, or `null` when `compile` refused the graph. */
  let ready: Ready | null = null;
  /** A sentence about the CIRCUIT, held back so the text's own refusals lead. */
  let circuitIssue: string | null = null;

  const issue = (error: unknown): string => {
    if (error instanceof UnstableCircuitError) {
      return 'the circuit does not settle: there is no fixed point to step';
    }
    if (error instanceof CircuitValidationError) {
      return 'the circuit does not compile, so there is nothing to run';
    }
    if (error instanceof RangeError) {
      return `the program does not fit this circuit: ${error.message}`;
    }
    return `the circuit could not be run: ${String(error)}`;
  };

  const stop = (error: unknown): void => {
    stopped = true;
    errors.push(issue(error));
  };

  /** True when there is nothing to drive: no circuit, a refusal, or a failed settle. */
  const idle = (): boolean => ready === null || stopped || errors.length > 0;

  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    ready = { sim, io };
    // A level pin that is present at the wrong width binds nothing, so every
    // value the run would show or drive crosses that pin wrongly. The checkers
    // refuse such a circuit as `missing-io`; here it is a sentence, because a
    // board mid-edit is the ordinary state of the editor rather than a defect.
    if (io.mismatch !== undefined) circuitIssue = io.mismatch;
  } catch (error) {
    circuitIssue = issue(error);
  }

  if (ready === null) {
    // No circuit, so the text is read on its own: the panel's first job is to
    // tell the player about their program, and a typo is not the board's fault.
    errors.push(...programImageOf(text, format, 'player').errors);
  } else {
    try {
      // THE ONE WAY AN IMAGE LANDS: `loadProgramImage` resets, loads every
      // `ram_prog` and settles, in that order -- see its own comment for why the
      // reset has to come first.
      const image = loadProgramImage(ready.io, text, format, 'player');
      if (image.errors.length > 0) errors.push(...image.errors);
      else bytes = image.bytes;
    } catch (error) {
      circuitIssue ??= issue(error);
    }
  }
  if (circuitIssue !== null) errors.push(circuitIssue);

  const instanceOfDef = (def: string): string | null => {
    if (ready === null) return null;
    const ids = ready.sim.net.instanceIds();
    const defs = ready.sim.net.instanceDefs();
    for (let index = 0; index < ids.length; index += 1) {
      if (defs[index] === def) return ids[index]!;
    }
    return null;
  };

  const stateOf = (id: string | null): readonly number[] | null => {
    if (ready === null || id === null) return null;
    const state = ready.sim.readState(id);
    return state === null ? null : Array.from(state);
  };

  return {
    errors,
    bytes,
    get ticks(): number {
      return ready?.sim.tickCount ?? 0;
    },

    reset(): void {
      if (idle() || ready === null) return;
      try {
        // The same call the constructor made, so "reset" and "open" cannot drift
        // apart: reset the circuit, load the image into it, settle.
        loadProgramImage(ready.io, text, format, 'player');
      } catch (error) {
        stop(error);
      }
    },

    step(): void {
      if (idle() || ready === null) return;
      try {
        // SETTLE, EDGE, SETTLE. `tick` samples the signal TABLE, so the sweep
        // before the edge is what makes the values on screen the values the edge
        // clocks -- write an input and tick without it and the machine samples
        // the previous vector, which is a circuit the player cannot see on the
        // board. `tick` ends in a settle of its own (it publishes the new state),
        // so the trailing call is a sweep over an already-settled table; it is
        // kept because the ordering is this surface's documented contract rather
        // than an implementation detail of `tick`.
        ready.sim.settle();
        ready.sim.tick();
        ready.sim.settle();
      } catch (error) {
        stop(error);
      }
    },

    setInput(name: string, value: number): void {
      if (idle() || ready === null) return;
      try {
        ready.io.writeInput(name, value);
        // Settled here rather than left to the next `step`, so a value poked into
        // a pin shows up on everything combinational at once -- that is what a
        // debugger's write is for -- and the edge that follows still samples it,
        // because `step` settles again. `writeInput` ignores a name the level does
        // not declare, and a value that does not fit the pin.
        ready.sim.settle();
      } catch (error) {
        stop(error);
      }
    },

    readOutputs(): Readonly<Record<string, number>> {
      if (ready === null) return {};
      const outputs: Record<string, number> = {};
      for (const pin of spec.io.outputs) outputs[pin.id] = ready.io.readOutput(pin.id);
      return outputs;
    },

    readRegisters(): readonly number[] | null {
      return stateOf(instanceOfDef('regfile6'));
    },

    readPc(): number | null {
      const state = stateOf(instanceOfDef('pc8'));
      return state === null ? null : (state[0] ?? 0);
    },

    readHalt(): boolean | null {
      if (ready === null) return null;
      const id = instanceOfDef('halt');
      if (id === null) return null;
      // A pin, not state: `halt` publishes `out = in` (see `defs/cpu.ts`), so the
      // value here is the same signal the counter's load logic reads. `null` when
      // the board has no such part, because a board that never built the line has
      // not told the panel the counter is free.
      const line = ready.sim.read(ready.sim.net.outputBase(`${id}.out`), 1);
      return portValueToNumber(line) === 1;
    },

    readRam(): readonly number[] | null {
      if (ready === null) return null;
      // WHICH RAM: the same rule the checker loads by (`programTargets`), so the
      // window cannot show a different memory from the one the image went into. A
      // circuit with several program RAMs gets the first of them here; every one
      // of them holds the same image, because the load writes them all.
      const targets = programTargets(undefined, ready.sim.net);
      if ('detail' in targets) return null;
      return stateOf(targets.ids[0] ?? null);
    },
  };
}
