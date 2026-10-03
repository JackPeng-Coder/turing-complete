/**
 * The board's live values: what every pin is carrying right now.
 *
 * The editor used to paint the circuit without ever running it -- every wire in
 * the same grey, every pin the same dot -- so a player could only find out
 * whether a circuit worked by pressing "run" and reading a table of numbers. The
 * original is the opposite: the board IS the readout, orange where a bit is 1,
 * teal where a byte is flowing, and a click on an input bit drives it.
 *
 * This module is the whole of that, kept apart from `render.ts` so the painter
 * stays a pure function of the store and a snapshot it is handed. Nothing here
 * grades anything: `levels/grader.ts` compiles its own simulation and is the only
 * thing that decides whether a level is passed. A display simulation that
 * disagreed with it would paint a circuit that looks right and fails, which is
 * exactly why both go through `compile` and `bindLevelIo`.
 *
 * A circuit that never settles, or a graph `compile` refuses, yields `null`
 * rather than an exception: the board is also the editor, and the state a player
 * types through on the way to a working circuit is usually not runnable.
 */
import { Simulation, compile, type Netlist } from '../../core/net';
import { bindLevelIo, type LevelIo } from '../../levels/checks';
import type { LevelSpec } from '../../levels/spec';
import type { Graph } from '../../core/graph';
import type { Registry } from '../../core/registry';
import type { PortValue } from '../../core/signal';

/** Every value the board and the readout panels need, read in one pass. */
export interface SignalSnapshot {
  /** Value at a compiled output pin, keyed `${instanceId}.${portId}`. */
  readonly outputs: ReadonlyMap<string, number>;
  /** Value at a level output pin, keyed by the level's own pin id. */
  readonly levelOutputs: ReadonlyMap<string, number>;
  /** False when the circuit never reached a fixed point: no value is trustworthy. */
  readonly stable: boolean;
  /** Clock edges applied since the last reset. */
  readonly tick: number;
}

const UNSTABLE: SignalSnapshot = {
  outputs: new Map(),
  levelOutputs: new Map(),
  stable: false,
  tick: 0,
};

/** A running display of one circuit, with its own clock. */
export interface DisplaySimulation {
  /** The values as of the last `settle`: cheap, and safe to call every frame. */
  read(): SignalSnapshot;
  /** Applies one clock edge and settles. */
  tick(): void;
  /** Drives a new input vector and settles. */
  drive(vector: Readonly<Record<string, number>>): void;
  /** Clears every storage element, re-drives the vector and settles. */
  reset(): void;
  readonly io: LevelIo;
}

/** One compiled output pin of one instance, cached so `read` walks no maps. */
interface OutputRegion {
  readonly key: string;
  readonly base: number;
  readonly width: number;
}

/**
 * Compiles `graph` and returns a live view of it, or `null` if it cannot run.
 *
 * The returned object owns a `Simulation` and therefore storage state: callers
 * keep one per board and call `drive` on every edit. `vector` is the starting
 * input vector, and every pin it does not name is driven as 0 -- an input does
 * not remember what it was last driven with, which is the same rule the level
 * checks follow.
 */
export function createDisplay(
  graph: Graph,
  registry: Registry,
  level: LevelSpec,
  vector: Readonly<Record<string, number>>,
): DisplaySimulation | null {
  const regions: OutputRegion[] = [];
  // Compiled in one block so that a refusal anywhere -- an unallocated pin, a
  // graph `compile` will not accept -- leaves through the same door.
  const ready = ((): { sim: Simulation; io: LevelIo } | null => {
    try {
      const net = compile(graph, registry);
      const sim = new Simulation(net, registry);
      const io = bindLevelIo(sim, net, level);
      for (const inst of graph.instances) {
        if (!registry.has(inst.def)) continue;
        for (const pin of registry.get(inst.def).outputs) {
          const key = `${inst.id}.${pin.id}`;
          try {
            regions.push({ key, base: net.outputBase(key), width: net.outputWidth(key) });
          } catch {
            // A pin `compile` did not allocate: it carries nothing to show.
          }
        }
      }
      return { sim, io };
    } catch {
      return null;
    }
  })();
  if (!ready) return null;
  const { sim, io } = ready;

  const driveVector = (values: Readonly<Record<string, number>>): void => {
    for (const pin of level.io.inputs) {
      io.writeInput(pin.id, within(values[pin.id] ?? 0, pin.width));
    }
  };

  /**
   * The last settle's verdict. `reset` settles internally without reporting, so
   * every path that changes the circuit settles once more through here -- a
   * second sweep over an already-settled table returns immediately.
   */
  let stable = true;
  const settleNow = (): void => {
    stable = sim.settle().stable;
  };

  const display: DisplaySimulation = {
    io,
    read(): SignalSnapshot {
      const tick = sim.tickCount;
      // An unsettled circuit has no value worth painting: showing the last sweep
      // of a loop would be showing a number that is about to be different.
      if (!stable) return { ...UNSTABLE, tick };
      const outputs = new Map<string, number>();
      for (const region of regions) {
        outputs.set(region.key, toNumber(sim.read(region.base, region.width)));
      }
      const levelOutputs = new Map<string, number>();
      for (const pin of level.io.outputs) levelOutputs.set(pin.id, io.readOutput(pin.id));
      return { outputs, levelOutputs, stable: true, tick };
    },
    tick(): void {
      // `tick` samples storage from the signal table, so the table has to hold a
      // settled sweep before the edge -- which it does, because every path into
      // here (`reset`, `drive`, the previous `tick`) ends in a settle.
      sim.tick();
      settleNow();
    },
    drive(values: Readonly<Record<string, number>>): void {
      driveVector(values);
      settleNow();
    },
    reset(): void {
      // `reset` clears the inputs along with the storage, so the vector has to be
      // driven again afterwards, not before.
      sim.reset();
      driveVector(vector);
      settleNow();
    },
  };

  display.reset();
  return display;
}

/** A value reduced into a pin's width, so a stale vector cannot be rejected. */
function within(value: number, width: number): number {
  if (width >= 31) return value % 2 ** width;
  return value & ((1 << width) - 1);
}

/** `PortValue` as one number, the way `levels/checks.ts` reads a wide pin back. */
function toNumber(value: PortValue): number {
  if (typeof value === 'number') return value;
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total += value[i]! * 2 ** (8 * i);
  return total;
}

/** The snapshot before anything has run, for callers with no display at all. */
export function emptySignals(): SignalSnapshot {
  return UNSTABLE;
}
