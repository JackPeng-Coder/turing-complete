import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile, type Netlist } from '../core/net';
import type { Registry } from '../core/registry';
import { formatPort, type PortValue } from '../core/signal';
import type {
  CheckFailure,
  CheckOutcome,
  ConstraintRule,
  LevelCheck,
  LevelSpec,
} from './spec';

export interface LevelIo {
  reset(): void;
  writeInput(name: string, value: number): void;
  readOutput(name: string): number;
  tick(): void;
  readonly sim: Simulation;
}

/**
 * Binds a compiled circuit to a level's named pins.
 *
 * Convention: a `level_input` instance whose id is `IN_<pinId>` supplies that
 * level input; a `level_output` instance whose id is `OUT` (single output) or
 * `OUT_<pinId>` (multi-output) mirrors that level output.
 *
 * Widths come from the level spec, so multi-bit level pins work without any
 * special-casing in the caller.
 */
export function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();

  for (const pin of spec.io.inputs) {
    try {
      inputSlots.set(pin.id, { base: net.outputBase(`IN_${pin.id}.out`), width: pin.width });
    } catch {
      /* pin not present in this circuit: it will read as 0 */
    }
  }

  const outputPins = spec.io.outputs;
  for (const pin of outputPins) {
    const keys = outputPins.length === 1 ? ['OUT.in'] : [`OUT_${pin.id}.in`, 'OUT.in'];
    for (const key of keys) {
      try {
        outputSlots.set(pin.id, { base: net.inputBase(key), width: pin.width });
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }

  const toNumber = (v: PortValue): number => {
    if (typeof v === 'number') return v;
    return Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
  };

  return {
    sim,
    reset: () => sim.reset(),
    tick: () => {
      sim.tick();
    },
    writeInput(name: string, value: number): void {
      const slot = inputSlots.get(name);
      if (!slot) return;
      sim.write(slot.base, slot.width, value);
    },
    readOutput(name: string): number {
      const slot = outputSlots.get(name);
      if (!slot) return 0;
      return toNumber(sim.read(slot.base, slot.width));
    },
  };
}

function enumerateInputs(spec: LevelSpec): Array<Record<string, number>> {
  const bits = spec.io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  const total = 2 ** bits;
  for (let n = 0; n < total; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of spec.io.inputs) {
      const mask = (1 << pin.width) - 1;
      row[pin.id] = (n >>> offset) & mask;
      offset += pin.width;
    }
    combos.push(row);
  }
  return combos;
}

/**
 * Builds the full truth table of a purely combinational level by enumerating
 * every input combination and slicing `expected` into the output pins.
 * The bit layout of `expected` must match the order of `alwaysOn.outputs`.
 */
export function generateRows(
  alwaysOn: LevelSpec,
  expected: (inputs: Record<string, number>) => number,
): Array<{ inputs: Record<string, number>; outputs: Record<string, number> }> {
  return enumerateInputs(alwaysOn).map((inputs) => {
    const value = expected(inputs) >>> 0;
    const outputs: Record<string, number> = {};
    let offset = 0;
    for (const pin of alwaysOn.io.outputs) {
      const mask = (1 << pin.width) - 1;
      outputs[pin.id] = (value >>> offset) & mask;
      offset += pin.width;
    }
    return { inputs, outputs };
  });
}

/** Declared width of a level output pin; an unknown pin is treated as 1 bit. */
function outputWidth(spec: LevelSpec, id: string): number {
  return spec.io.outputs.find((pin) => pin.id === id)?.width ?? 1;
}

/**
 * Expected value of `rule.output` for one input vector.
 *
 * `sum-equals` reduces the sum modulo the output pin's width, because the raw
 * sum is not representable there. A 1-bit `out` pin IS a half-adder sum, and
 * comparing the raw sum would make the `(1, 1)` row unsatisfiable for every
 * circuit -- including a correct XOR. Reducing modulo `2 ** width` keeps the
 * rule meaningful for a wide pin too: it compares the low `width` bits.
 */
function evaluateRule(
  rule: ConstraintRule,
  inputs: Record<string, number>,
  width: number,
): number {
  if (rule.kind === 'sum-equals') {
    let sum = 0;
    for (const id of rule.inputs) sum += inputs[id] ?? 0;
    return sum % 2 ** width;
  }
  let count = 0;
  for (const id of rule.inputs) count += inputs[id] ?? 0;
  return count >= rule.count ? 1 : 0;
}

export function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome {
  const failures: CheckFailure[] = [];
  let ticksUsed = 0;

  for (const check of spec.checks) {
    // One compilation and one Simulation per check, reused for every row.
    // Compiling per row would re-run validateGraph and reallocate the signal
    // table hundreds of times for a single level.
    const created = createSim(graph, registry, spec);
    if ('error' in created) {
      failures.push(failure(check, {}, {}, {}, 0, created.error));
      continue;
    }
    const io = created.io;

    try {
      if (check.kind === 'truth-table') {
        if (!check.rows || check.rows.length === 0) {
          // A truth-table check with nothing to compare against would pass
          // every circuit ever built. Refuse it loudly instead.
          failures.push(
            failure(
              check,
              {},
              { rows: 1 },
              { rows: 0 },
              0,
              'missing-rows',
            ),
          );
          continue;
        }
        for (const row of check.rows) {
          if (Object.keys(row.outputs).length === 0) {
            // The same hazard as an empty `rows` array, one level down: a row
            // that declares no expected output compares nothing, so a correct
            // circuit and a pile of NANDs would both "pass" it.
            failures.push(
              failure(check, row.inputs, { outputs: 1 }, { outputs: 0 }, 0, 'missing-rows'),
            );
            continue;
          }
          const attempt = runRow(io, spec, row.inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(row.outputs, attempt.outputs)) {
            failures.push(failure(check, row.inputs, row.outputs, attempt.outputs, 0, 'mismatch'));
          }
        }
        continue;
      }

      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          const want = evaluateRule(check.rule, inputs, outputWidth(spec, check.rule.output));
          const got = attempt.outputs[check.rule.output] ?? 0;
          if (want !== got) {
            failures.push(
              failure(check, inputs, { [check.rule.output]: want }, attempt.outputs, 0, 'mismatch'),
            );
          }
        }
        continue;
      }

      // script: walk the steps in tick order, driving inputs along the way
      io.reset();
      ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
      const steps = [...check.steps].sort((a, b) => a.tick - b.tick);
      for (const step of steps) {
        for (const pin of spec.io.inputs) {
          io.writeInput(pin.id, step.inputs?.[pin.id] ?? 0);
        }
        io.sim.settle();
        while (io.sim.tickCount < step.tick) io.tick();
        ticksUsed = Math.max(ticksUsed, io.sim.tickCount);
        if (step.expect) {
          const actual: Record<string, number> = {};
          for (const pin of spec.io.outputs) actual[pin.id] = io.readOutput(pin.id);
          if (compare(step.expect, actual)) {
            failures.push(
              failure(check, step.inputs ?? {}, step.expect, actual, step.tick, 'mismatch'),
            );
          }
        }
      }
    } catch (e) {
      if (e instanceof UnstableCircuitError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'unstable'));
      } else if (e instanceof CircuitValidationError) {
        failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'invalid'));
      } else {
        throw e;
      }
    }
  }

  return { passed: failures.length === 0, failures, ticksUsed };
}

/** Drives one input vector into a fresh reset of an already-compiled circuit. */
function runRow(
  io: LevelIo,
  spec: LevelSpec,
  inputs: Readonly<Record<string, number>>,
  ticks: number,
): AttemptOk {
  io.reset();
  for (const pin of spec.io.inputs) io.writeInput(pin.id, inputs[pin.id] ?? 0);
  io.sim.settle();
  for (let i = 0; i < ticks; i += 1) io.tick();
  const outputs: Record<string, number> = {};
  for (const pin of spec.io.outputs) outputs[pin.id] = io.readOutput(pin.id);
  return { outputs, ticksUsed: io.sim.tickCount };
}

/** True when `actual` differs from `expected` on any key that `expected` declares. */
function compare(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  for (const [key, want] of Object.entries(expected)) {
    if ((actual[key] ?? 0) !== want) return true;
  }
  return false;
}

/**
 * Builds one failure record.
 *
 * `reason` is `NonNullable<...>` rather than `CheckFailure['reason']`: the field
 * is optional, so the indexed type includes `undefined`, and
 * `exactOptionalPropertyTypes` rejects assigning a possibly-`undefined` value to
 * an optional property. Every failure this module builds names a reason anyway.
 */
function failure(
  check: LevelCheck,
  inputs: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  tick: number,
  reason: NonNullable<CheckFailure['reason']>,
): CheckFailure {
  return { check: check.kind, inputs, expected, actual, tick, reason };
}

interface AttemptFail {
  error: 'unstable' | 'invalid' | 'missing-io';
}

interface AttemptOk {
  outputs: Record<string, number>;
  ticksUsed: number;
}

function createSim(
  graph: Graph,
  registry: Registry,
  spec: LevelSpec,
): { io: LevelIo } | AttemptFail {
  try {
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const io = bindLevelIo(sim, net, spec);
    return { io };
  } catch (e) {
    if (e instanceof UnstableCircuitError) return { error: 'unstable' };
    if (e instanceof CircuitValidationError) return { error: 'invalid' };
    throw e;
  }
}

export function countTicksUsed(graph: Graph, registry: Registry, spec: LevelSpec): number {
  return runChecks(graph, registry, spec).ticksUsed;
}

export { formatPort };
