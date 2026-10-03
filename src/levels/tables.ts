import { maskInto } from '../core/signal';
import type { PinSpec, TruthRow, TruthTableCheck } from './spec';

export interface LevelIo {
  readonly inputs: readonly PinSpec[];
  readonly outputs: readonly PinSpec[];
}

function enumerateInputs(io: LevelIo): Array<Record<string, number>> {
  const bits = io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  for (let n = 0; n < 2 ** bits; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of io.inputs) {
      row[pin.id] = maskInto(n >>> offset, pin.width);
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds a complete truth table from one function per output pin.
 * Throws if a declared output pin has no function, so a typo cannot silently
 * produce a table that never checks that pin.
 */
export function truthTable(
  io: LevelIo,
  expected: Readonly<Record<string, (inputs: Record<string, number>) => number>>,
): TruthTableCheck {
  for (const pin of io.outputs) {
    if (typeof expected[pin.id] !== 'function') {
      throw new Error(`truthTable: no expectation given for output pin "${pin.id}"`);
    }
  }
  for (const key of Object.keys(expected)) {
    if (!io.outputs.some((pin) => pin.id === key)) {
      throw new Error(`truthTable: "${key}" is not an output pin of this level`);
    }
  }
  const rows: TruthRow[] = enumerateInputs(io).map((inputs) => {
    const outputs: Record<string, number> = {};
    for (const pin of io.outputs) {
      outputs[pin.id] = maskInto(expected[pin.id]!(inputs), pin.width);
    }
    return { inputs, outputs };
  });
  return { kind: 'truth-table', rows };
}
