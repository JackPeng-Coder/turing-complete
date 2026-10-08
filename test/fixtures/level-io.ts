import type { LevelIo } from '../../src/levels/checks';
import type { Simulation } from '../../src/core/net';

/**
 * A scripted `LevelIo`, so a closed-loop checker can be driven without a
 * circuit.
 *
 * WHY THIS EXISTS. A custom checker that ticks a board itself -- the code lock,
 * the maze -- has no `steps` for the kernel to drive: it reads its output,
 * writes its input and advances the clock in a loop, and its verdict is a
 * function of what the board said at each of those moments. Proving such a
 * checker against a real circuit would prove the CIRCUIT as much as the checker,
 * and the interesting cases (a board that never finds the secret, a board with
 * no `OUT` at all) are ones no honest reference circuit produces.
 *
 * So the four methods `LevelIo` requires are scripted here, over closures rather
 * than over a circuit: each call is recorded in `log`, because a checker's
 * ORDER -- read before write, write before tick -- is half of what it has to get
 * right. The reader is a function of the tick count, which is what `readOutput`
 * would be on a board whose answer depends on its own history.
 *
 * `sim` IS A DOCUMENTED CAST. It is on `LevelIo` because the kernel's own
 * drivers settle the circuit and load program images through it, and a scripted
 * stub has neither a netlist nor state to settle. Nothing in these tests reads
 * it; a checker under test that reached for `io.sim` and settled would be driving
 * the board behind `bindLevelIo`'s back, which is exactly the contract the stub
 * is here to keep visible.
 */

/** One recorded call: the method name and the arguments it was given. */
export interface IoCall {
  readonly method: 'reset' | 'writeInput' | 'readOutput' | 'tick';
  readonly name?: string;
  readonly value?: number;
}

export interface ScriptedIo {
  readonly io: LevelIo;
  /**
   * This same stub, for a test that needs to reach it through a wrapper.
   *
   * A test that logs around the checker's own calls (to line its model up with
   * the published bytes, say) wraps `io` and forwards each method; it then needs
   * the underlying stub for `log`, `writes` and `ticks`, and reaching it through
   * the closure is what this field is for.
   */
  readonly script: ScriptedIo;
  /** Every call the checker made, in order. */
  readonly log: IoCall[];
  /** The `match` / `sensors` values the checker wrote, in write order. */
  readonly writes: number[];
  /** Clock edges applied so far. */
  readonly ticks: () => number;
  readonly resets: () => number;
  /** True when the checker asked for an output the level does not have. */
  readonly readUnknown: () => boolean;
}

export interface ScriptedIoOptions {
  /** The bytes `readOutput` answers with, one per call, in call order. */
  readonly outputs?: readonly number[];
  /**
   * The byte `readOutput` answers with, from the clock state at the time of the
   * call. Used by the maze tests, where the answer depends on how the scripted
   * robot has moved.
   */
  readonly reader?: (tick: number) => number;
  /**
   * The bytes the level actually publishes: a read of any other name is
   * reported through `readUnknown`, which is how a test proves a checker asked
   * for the pin the level declares.
   */
  readonly known?: readonly string[];
}

export function scriptedIo(options: ScriptedIoOptions = {}): ScriptedIo {
  const known = new Set(options.known ?? ['try', 'move']);
  const log: IoCall[] = [];
  const writes: number[] = [];
  let tick = 0;
  let resets = 0;
  let read = 0;
  let unknownRead = false;

  const io: LevelIo = {
    reset(): void {
      resets += 1;
      log.push({ method: 'reset' });
    },
    writeInput(name: string, value: number): void {
      log.push({ method: 'writeInput', name, value });
      writes.push(value);
    },
    readOutput(name: string): number {
      log.push({ method: 'readOutput', name });
      if (!known.has(name)) unknownRead = true;
      if (options.reader) return options.reader(tick);
      const value = options.outputs?.[read] ?? 0;
      read += 1;
      return value;
    },
    tick(): void {
      tick += 1;
      log.push({ method: 'tick' });
    },
    // The kernel's drivers need a `Simulation` here; a scripted stub has none.
    // See the module header: nothing under test may read this.
    sim: { tickCount: 0 } as unknown as Simulation,
  };

  const stub: ScriptedIo = {
    io,
    // Filled in below, once the object exists: `script` is the stub itself, so a
    // wrapper around `io` can still reach the log and the tick count.
    script: undefined as unknown as ScriptedIo,
    log,
    writes,
    ticks: () => tick,
    resets: () => resets,
    readUnknown: () => unknownRead,
  };
  (stub as { script: ScriptedIo }).script = stub;
  return stub;
}
