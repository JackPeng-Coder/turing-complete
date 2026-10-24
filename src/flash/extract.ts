import type { ComponentDef } from '../core/registry';
import { portValueToNumber, type PortValue } from '../core/signal';

/**
 * Turning a component's own JavaScript behaviour into tables.
 *
 * THE POINT OF THIS FILE IS THAT IT PORTS NOTHING. Each supported part is asked
 * what it does, for every input it can be given, through the very `evaluate` and
 * `clockEdge` the in-page simulator calls. A NAND's table is therefore the same
 * four numbers the game uses, and a part whose JavaScript changes regenerates a
 * different table rather than drifting from a hand-written C++ twin.
 *
 * It is only sound because the supported set is small: a combinational part has
 * at most three input bits here (`2 ** 3 = 8` calls), and a storage part has one
 * state byte whose reachable values number two (`delay_line`, `mem1`). A wide
 * part would need `2 ** 16` calls for an adder and is refused by `build.ts`
 * before this file is reached.
 */

/** Thrown when a part does not fit the table model; `build.ts` refuses it. */
export class ExtractionError extends Error {}

/** The largest reachable-state count a storage table may have. */
export const MAX_STATES = 64;

/** What a combinational part compiles to: one truth table per output pin. */
export interface ExtractedCombination {
  readonly inputBits: number;
  /** One table per output pin, `2 ** inputBits` entries each, values 0 or 1. */
  readonly tables: readonly Uint8Array[];
}

/** What a storage part compiles to: a publish table and an edge table. */
export interface ExtractedStorage {
  readonly inputBits: number;
  /** Number of reachable states; state 0 is the all-zero state `reset` leaves. */
  readonly stateCount: number;
  /** One publish table per output pin, `stateCount` entries each. */
  readonly publish: readonly Uint8Array[];
  /** `stateCount * 2 ** inputBits` entries, each a state index. */
  readonly transitions: Uint8Array;
}

/** The values of one input pin per vector index, in the same bit order. */
function inputsFor(widths: readonly number[], vector: number): PortValue[] {
  const values: PortValue[] = [];
  let shift = 0;
  for (const width of widths) {
    const mask = 2 ** width;
    values.push(Math.floor(vector / 2 ** shift) % mask);
    shift += width;
  }
  return values;
}

/** A port value as a small non-negative integer, or a clear extraction error. */
function asSmall(value: PortValue, def: ComponentDef, pin: string): number {
  const number = portValueToNumber(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffff_ffff) {
    throw new ExtractionError(`${def.id}.${pin} produced a value a table cannot hold: ${number}`);
  }
  return number;
}

/** Every output pin's table over every input vector. */
export function extractCombination(
  def: ComponentDef,
  inputWidths: readonly number[],
  outputPins: readonly string[],
): ExtractedCombination {
  const evaluate = def.evaluate;
  if (evaluate === undefined) throw new ExtractionError(`${def.id} has no evaluate()`);
  const inputBits = inputWidths.reduce((sum, width) => sum + width, 0);
  if (inputBits > 10) throw new ExtractionError(`${def.id} has ${inputBits} input bits; the table cap is 10`);
  const vectors = 2 ** inputBits;
  const tables = outputPins.map(() => new Uint8Array(vectors));

  for (let vector = 0; vector < vectors; vector += 1) {
    const outputs: PortValue[] = [];
    evaluate(inputsFor(inputWidths, vector), outputs, undefined, { tick: 0 });
    for (let pin = 0; pin < outputPins.length; pin += 1) {
      const value = outputs[pin];
      if (value === undefined) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} published nothing`);
      }
      const bit = asSmall(value, def, outputPins[pin]!);
      if (bit !== 0 && bit !== 1) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} is not one bit (${bit})`);
      }
      tables[pin]![vector] = bit;
    }
  }
  return { inputBits, tables };
}

/**
 * A storage part as two tables: what it publishes for a held state, and where a
 * clock edge moves that state.
 *
 * The state space is whatever is REACHABLE from zero through some sequence of
 * clock edges, not all 256 byte values. For the two supported parts that is two
 * states, so a `mem1` costs 2 publish bytes and 8 transition bytes rather than
 * 256 and 1024 -- which matters on an Uno, and matters more with one memory per
 * bit of a register.
 */
export function extractStorage(
  def: ComponentDef,
  inputWidths: readonly number[],
  outputPins: readonly string[],
): ExtractedStorage {
  const evaluate = def.evaluate;
  const clockEdge = def.clockEdge;
  if (evaluate === undefined || clockEdge === undefined) {
    throw new ExtractionError(`${def.id} is sequential but has no evaluate()/clockEdge()`);
  }
  if (def.stateBytes !== 1) {
    throw new ExtractionError(`${def.id} keeps ${def.stateBytes} state bytes; the first version supports one`);
  }
  const inputBits = inputWidths.reduce((sum, width) => sum + width, 0);
  if (inputBits > 10) throw new ExtractionError(`${def.id} has ${inputBits} input bits; the table cap is 10`);
  const vectors = 2 ** inputBits;

  const states: Uint8Array[] = [new Uint8Array(def.stateBytes)];
  const indexByKey = new Map<string, number>([['0', 0]]);
  const edgeTargets: number[][] = [];

  for (let index = 0; index < states.length; index += 1) {
    const held = states[index]!;
    const targets: number[] = [];
    for (let vector = 0; vector < vectors; vector += 1) {
      const next = new Uint8Array(held);
      clockEdge(inputsFor(inputWidths, vector), [], next, { tick: 1 });
      const key = Array.from(next).join(',');
      let target = indexByKey.get(key);
      if (target === undefined) {
        if (states.length >= MAX_STATES) {
          throw new ExtractionError(`${def.id} reaches more than ${MAX_STATES} states`);
        }
        target = states.length;
        indexByKey.set(key, target);
        states.push(next);
      }
      targets.push(target);
    }
    edgeTargets.push(targets);
  }

  const publish = outputPins.map(() => new Uint8Array(states.length));
  for (let index = 0; index < states.length; index += 1) {
    const outputs: PortValue[] = [];
    evaluate([], outputs, new Uint8Array(states[index]!), { tick: 0 });
    for (let pin = 0; pin < outputPins.length; pin += 1) {
      const value = outputs[pin];
      if (value === undefined) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} published nothing`);
      }
      const bit = asSmall(value, def, outputPins[pin]!);
      if (bit !== 0 && bit !== 1) {
        throw new ExtractionError(`${def.id}.${outputPins[pin]!} is not one bit (${bit})`);
      }
      publish[pin]![index] = bit;
    }
  }

  const transitions = new Uint8Array(states.length * vectors);
  for (let index = 0; index < states.length; index += 1) {
    for (let vector = 0; vector < vectors; vector += 1) {
      transitions[index * vectors + vector] = edgeTargets[index]![vector]!;
    }
  }

  return { inputBits, stateCount: states.length, publish, transitions };
}
