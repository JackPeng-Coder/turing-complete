import { assemble, OVERTURE_ISA } from '../asm/index';
import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import { Simulation, compile, type Netlist } from '../core/net';
import type { Registry } from '../core/registry';
import { assertWidth, formatPort, maskInto, portValueToNumber } from '../core/signal';
import { getCustomCheck } from './custom/index';
import { FAILURE_REASONS } from './spec';
import type {
  CheckFailure,
  CheckOutcome,
  ConstraintRule,
  FailureReason,
  FuzzCheck,
  FuzzSample,
  FuzzVector,
  LevelCheck,
  LevelSpec,
  ProgramCheck,
  ProgramStep,
  ScriptStep,
} from './spec';

export interface LevelIo {
  reset(): void;
  writeInput(name: string, value: number): void;
  readOutput(name: string): number;
  tick(): void;
  readonly sim: Simulation;
  /**
   * A level pin whose compiled width disagrees with `spec.io`, if any.
   *
   * Set only when such a pin is *present* in the circuit: nothing can be written
   * to it or read from it without crossing a pin boundary, so `createSim` treats
   * the circuit as unbound. Absent pins are not reported here -- an incomplete
   * board still grades, with those pins reading 0 as they always have.
   */
  readonly mismatch?: string;
}

/**
 * How many random vectors a `fuzz` check runs when it does not state `rounds`.
 *
 * 64 is enough to catch a wrong 8-bit operator almost immediately -- a circuit
 * that disagrees on any single bit pattern disagrees on roughly half of the
 * vectors -- while keeping a board edit cheap.
 */
export const DEFAULT_FUZZ_ROUNDS = 64;

/**
 * Hard ceiling on a `fuzz` check's `rounds`.
 *
 * `grade()` runs on every board edit, so a level that asks for 10^9 rounds must
 * not be able to hang the editor: `rounds` is clamped here, and the levels that
 * want exhaustive coverage use `truth-table`/`constraint` instead. (A `rounds`
 * that is not a positive integer is not clamped but refused -- see `fuzzIssue`.)
 */
export const FUZZ_ROUNDS_CAP = 4096;

/**
 * True when `value` is representable on a `width`-bit pin.
 *
 * Delegates to the kernel's own `assertWidth` instead of duplicating its bounds,
 * so "what the level layer will write" and "what the signal table accepts" can
 * never drift apart: every value this rejects is one that would have thrown.
 */
function fitsPort(value: number, width: number): boolean {
  try {
    assertWidth(value, width);
    return true;
  } catch {
    // `assertWidth` throws RangeError and nothing else; a value that does not
    // fit is data, not a bug.
    return false;
  }
}

/**
 * Binds a compiled circuit to a level's named pins.
 *
 * Convention: a `level_input` instance whose id is `IN_<pinId>` supplies that
 * level input; a `level_output` instance whose id is `OUT` (single output) or
 * `OUT_<pinId>` (multi-output) mirrors that level output.
 *
 * Every base and width comes from the COMPILED pin (`net.outputWidth` /
 * `net.inputWidth`), which is the instance's `params.width` when it sets one and
 * the def's declared width otherwise. The def alone is never enough: both
 * `level_input` and `level_output` declare 1-bit pins, so a level's 8-bit pin
 * exists in the table only because the instance carrying it says so.
 *
 * A pin that is present but compiled at a width other than `spec.io`'s is
 * reported in `mismatch` and binds nothing. Writing it at the spec width would
 * run across the neighbouring slots and writing it at the compiled width would
 * silently drop the high bits; neither is the value the level asked for, so the
 * check fails loudly instead (`runChecks` maps this to `missing-io`). A pin whose
 * instance is absent is NOT a mismatch: it keeps its Phase-0 behaviour of
 * reading 0 and swallowing writes, so a half-built board still grades.
 */
export function bindLevelIo(sim: Simulation, net: Netlist, spec: LevelSpec): LevelIo {
  const inputSlots = new Map<string, { base: number; width: number }>();
  const outputSlots = new Map<string, { base: number; width: number }>();
  const mismatches: string[] = [];

  const noteMismatch = (key: string, compiled: number, declared: number): void => {
    mismatches.push(`${key} is ${compiled}-bit in the circuit but the level declares ${declared}`);
  };

  for (const pin of spec.io.inputs) {
    const key = `IN_${pin.id}.out`;
    try {
      const width = net.outputWidth(key);
      if (width !== pin.width) {
        noteMismatch(key, width, pin.width);
        continue;
      }
      inputSlots.set(pin.id, { base: net.outputBase(key), width });
    } catch {
      /* pin not present in this circuit: it will read as 0 */
    }
  }

  const outputPins = spec.io.outputs;
  for (const pin of outputPins) {
    const keys = outputPins.length === 1 ? ['OUT.in'] : [`OUT_${pin.id}.in`, 'OUT.in'];
    for (const key of keys) {
      try {
        const width = net.inputWidth(key);
        if (width !== pin.width) {
          // Present but mis-sized: that is the disagreement to report, not a
          // reason to go looking for another naming convention.
          noteMismatch(key, width, pin.width);
          break;
        }
        outputSlots.set(pin.id, { base: net.inputBase(key), width });
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }

  const io: LevelIo = {
    sim,
    reset: () => sim.reset(),
    tick: () => {
      sim.tick();
    },
    writeInput(name: string, value: number): void {
      const slot = inputSlots.get(name);
      if (!slot) return;
      if (!fitsPort(value, slot.width)) {
        // Authored level data is untrusted input: a row may name a value the pin
        // cannot hold (`{ a: 2 }` or `{ a: 0.5 }` on a 1-bit pin). Reject the
        // write -- deterministically, leaving the pin at the zero default that
        // `reset()` established, exactly like a pin the circuit does not contain
        // -- rather than let `Simulation.write` raise a RangeError out of
        // `runChecks` and `grade()` on every board edit.
        return;
      }
      sim.write(slot.base, slot.width, value);
    },
    readOutput(name: string): number {
      const slot = outputSlots.get(name);
      if (!slot) return 0;
      return portValueToNumber(sim.read(slot.base, slot.width));
    },
  };

  // `exactOptionalPropertyTypes` rejects handing an explicit `undefined` to an
  // optional property, so the field is only present when there is something to
  // report.
  return mismatches.length === 0 ? io : { ...io, mismatch: mismatches.join('; ') };
}

function enumerateInputs(spec: LevelSpec): Array<Record<string, number>> {
  const bits = spec.io.inputs.reduce((acc, p) => acc + p.width, 0);
  const combos: Array<Record<string, number>> = [];
  const total = 2 ** bits;
  for (let n = 0; n < total; n += 1) {
    const row: Record<string, number> = {};
    let offset = 0;
    for (const pin of spec.io.inputs) {
      row[pin.id] = maskInto(n >>> offset, pin.width);
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
      outputs[pin.id] = maskInto(value >>> offset, pin.width);
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

// ---------------------------------------------------------------------------
// fuzz
// ---------------------------------------------------------------------------

/**
 * True when `value` is a whole number that fits a `width`-bit pin.
 *
 * Shares `fitsPort` with `writeInput`, so "a value a fuzz function may expect"
 * and "a value the signal table accepts" cannot drift apart.
 */
function fitsPin(value: unknown, width: number): value is number {
  return typeof value === 'number' && fitsPort(value, width);
}

/** A safe, short description of an untrusted value, for a failure's `detail`. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object' || typeof value === 'symbol') {
    // An object's own `toString` is untrusted too: a throwing one must not
    // escape the failure that is trying to describe it.
    try {
      return String(value);
    } catch {
      return `a ${typeof value}`;
    }
  }
  return String(value);
}

/** `name: message` of a thrown `Error`, or a description of anything else. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : describeValue(error);
}

/** Only the numeric entries of an authored vector, for a numeric failure record. */
function numericOnly(vector: Readonly<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(vector)) {
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

/** The sentence a failure carries when an authored value cannot fit its pin. */
function unfitDetail(subject: string, id: string, value: unknown, width: number): string {
  return `${subject} "${id}" is ${describeValue(value)}, which does not fit a ${width}-bit pin`;
}

/**
 * The check's deterministic PRNG: xorshift32, seeded from the check data and
 * from nothing else.
 *
 * Written here rather than taken from a library (the project has no runtime
 * dependencies) and rather than `Math.random` (a level has to grade the same
 * way on every board edit, and the same seed has to produce the same vectors in
 * every run). xorshift32 has a single fixed point at 0, so an all-zero seed is
 * remapped to the golden-ratio odd constant: a `seed: 0` level would otherwise
 * drive one vector `rounds` times without ever saying so.
 */
function createFuzzRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e37_79b9;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
}

/** One validated input pin binding: the drawn sample in, the value to drive out. */
interface FuzzInputPin {
  readonly id: string;
  readonly width: number;
  readonly fn: (sample: FuzzSample) => number;
}

/** One validated output pin binding: the driven vector in, the expected value out. */
interface FuzzOutputPin {
  readonly id: string;
  readonly width: number;
  readonly fn: (inputs: FuzzVector) => number;
}

/**
 * A fuzz check that can be run: the resolved round count and the level's pins
 * bound to validated functions.
 *
 * `inputs` / `outputs` are in the level's pin order (never `Object.keys` order),
 * which is what makes the vector sequence reproducible.
 */
interface FuzzRun {
  readonly rounds: number;
  readonly inputs: readonly FuzzInputPin[];
  readonly outputs: readonly FuzzOutputPin[];
}

/** Why a fuzz check cannot run as written, in the shape a failure record needs. */
interface FuzzIssue {
  readonly reason: 'missing-vectors' | 'invalid';
  readonly expected: Readonly<Record<string, number>>;
  readonly actual: Readonly<Record<string, number>>;
  readonly detail: string;
}

type FuzzPlan = ({ readonly kind: 'plan' } & FuzzRun) | ({ readonly kind: 'issue' } & FuzzIssue);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a fuzz check against the level it belongs to.
 *
 * Vacuity is reported first, and deliberately: a check that would compare
 * nothing is the defect this kind exists next to (`rounds: 0`, no input pins, no
 * expectations -- the `missing-rows` lesson), so it is named as such even when
 * the same check is also misspelled. Everything after that is a plain authoring
 * error and comes back as `invalid`: a pin without a function, a function for a
 * pin the level does not have, a non-integer seed.
 */
function planFuzz(check: FuzzCheck, spec: LevelSpec): FuzzPlan {
  const rounds = check.rounds ?? DEFAULT_FUZZ_ROUNDS;
  // A check that runs no rounds compares nothing -- the `missing-rows` lesson --
  // so the round count is the first thing validated, before any pin is bound.
  if (!Number.isInteger(rounds) || rounds <= 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { rounds: 1 },
      actual: { rounds },
      detail: `fuzz check declares rounds=${describeValue(check.rounds)}; it must be a positive integer`,
    };
  }
  if (spec.io.inputs.length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { inputs: 1 },
      actual: { inputs: 0 },
      detail:
        'fuzz check on a level with no input pins: every round would drive the same empty vector',
    };
  }
  if (spec.io.outputs.length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { outputs: 1 },
      actual: { outputs: 0 },
      detail: 'fuzz check on a level with no output pins: there is nothing to compare against',
    };
  }

  // Level data is untrusted however it is typed: `inputs` and `outputs` may be
  // absent, or hold something that is not a function at all.
  const inputs: Record<string, unknown> = isRecord(check.inputs) ? check.inputs : {};
  const outputs: Record<string, unknown> = isRecord(check.outputs) ? check.outputs : {};
  if (Object.keys(inputs).length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { inputs: 1 },
      actual: { inputs: 0 },
      detail: 'fuzz check declares no input functions: every round would drive the same vector',
    };
  }
  if (Object.keys(outputs).length === 0) {
    return {
      kind: 'issue',
      reason: 'missing-vectors',
      expected: { outputs: 1 },
      actual: { outputs: 0 },
      detail: 'fuzz check declares no output expectations: every circuit would pass it',
    };
  }
  if (!Number.isInteger(check.seed)) {
    return {
      kind: 'issue',
      reason: 'invalid',
      expected: { seed: 1 },
      actual: { seed: check.seed },
      detail: `fuzz check declares seed=${describeValue(check.seed)}, but it must be an integer`,
    };
  }

  const boundInputs: FuzzInputPin[] = [];
  const boundOutputs: FuzzOutputPin[] = [];
  for (const pin of spec.io.inputs) {
    const fn = inputs[pin.id];
    if (typeof fn !== 'function') {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [pin.id]: 1 },
        actual: { [pin.id]: 0 },
        detail: `fuzz check declares no input function for pin "${pin.id}"`,
      };
    }
    boundInputs.push({ id: pin.id, width: pin.width, fn: fn as FuzzInputPin['fn'] });
  }
  for (const pin of spec.io.outputs) {
    const fn = outputs[pin.id];
    if (typeof fn !== 'function') {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [pin.id]: 1 },
        actual: { [pin.id]: 0 },
        detail: `fuzz check declares no output expectation for pin "${pin.id}"`,
      };
    }
    boundOutputs.push({ id: pin.id, width: pin.width, fn: fn as FuzzOutputPin['fn'] });
  }
  for (const key of Object.keys(inputs)) {
    if (!spec.io.inputs.some((pin) => pin.id === key)) {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [key]: 0 },
        actual: { [key]: 1 },
        detail: `fuzz check declares an input function for "${key}", which is not an input pin`,
      };
    }
  }
  for (const key of Object.keys(outputs)) {
    if (!spec.io.outputs.some((pin) => pin.id === key)) {
      return {
        kind: 'issue',
        reason: 'invalid',
        expected: { [key]: 0 },
        actual: { [key]: 1 },
        detail: `fuzz check declares an output expectation for "${key}", which is not an output pin`,
      };
    }
  }
  return {
    kind: 'plan',
    rounds: Math.min(rounds, FUZZ_ROUNDS_CAP),
    inputs: boundInputs,
    outputs: boundOutputs,
  };
}

/**
 * The vectors a validated fuzz check drives, one per round.
 *
 * A generator so the caller can stop at the first failing round without paying
 * for the rest of the sequence -- a wrong circuit usually disagrees on round 0,
 * and the cap allows thousands of rounds.
 *
 * Each pin's draw is already inside that pin's width, so the natural input
 * function (`(sample) => sample.a`) always produces a value the pin can hold.
 * A pin wider than 32 bits can only use 32 bits of the stream; nothing this
 * phase builds is wider than eight.
 */
function* fuzzVectors(seed: number, plan: FuzzRun): Generator<FuzzVector> {
  const random = createFuzzRandom(seed);
  for (let round = 0; round < plan.rounds; round += 1) {
    const sample: Record<string, number> = {};
    for (const pin of plan.inputs) sample[pin.id] = random() % 2 ** pin.width;
    const vector: Record<string, number> = {};
    for (const pin of plan.inputs) vector[pin.id] = pin.fn(sample);
    yield vector;
  }
}

// ---------------------------------------------------------------------------
// custom
// ---------------------------------------------------------------------------

/**
 * Why one adopted failure record cannot be shown as-is, or `undefined`.
 *
 * `spec` is what makes the pin names checkable: these three maps are rendered
 * pin by pin, so a key that is not one of the level's pins would put a stray
 * row of zeros beside the real ones, and a value that is not a finite number
 * would render as whatever the panel's string conversion makes of it. Both are
 * refused here, for the same reason `fuzz` refuses a value that does not fit its
 * pin -- a checker must not be able to ship a silently wrong row.
 */
function failureIssue(item: unknown, spec: LevelSpec): string | undefined {
  if (!isRecord(item)) return `is ${describeValue(item)}, expected an object`;
  if (typeof item.check !== 'string') {
    return `has check=${describeValue(item.check)}, expected a check kind`;
  }
  const pinIds = new Set<string>();
  for (const pin of spec.io.inputs) pinIds.add(pin.id);
  for (const pin of spec.io.outputs) pinIds.add(pin.id);
  for (const field of ['inputs', 'expected', 'actual'] as const) {
    const map = item[field];
    if (!isRecord(map)) {
      return `has ${field}=${describeValue(map)}, expected an object of pin values`;
    }
    for (const [pin, value] of Object.entries(map)) {
      if (!pinIds.has(pin)) {
        return `has ${field} key "${pin}", which is not a pin of this level`;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `has ${field}."${pin}"=${describeValue(value)}, expected a finite number`;
      }
    }
  }
  if (typeof item.tick !== 'number' || !Number.isFinite(item.tick)) {
    return `has tick=${describeValue(item.tick)}, expected a number`;
  }
  if (item.reason !== undefined && !FAILURE_REASONS.includes(item.reason as FailureReason)) {
    return `has reason=${describeValue(item.reason)}, which is not a known failure reason`;
  }
  return undefined;
}

/**
 * Why a custom checker's return value cannot be adopted, or `undefined` when it
 * can.
 *
 * The shape is checked here rather than trusted, because the records go straight
 * into the failure panel: a checker that returns `{ failures: 'none' }` or a
 * bare `null` must fail its check with a reason, not break the board on the next
 * keystroke. Each record is checked against the level as well as for its own
 * shape -- see `failureIssue`.
 */
function outcomeIssue(outcome: unknown, spec: LevelSpec): string | undefined {
  if (!isRecord(outcome)) {
    return `it returned ${describeValue(outcome)} instead of a CheckOutcome`;
  }
  if (typeof outcome.passed !== 'boolean') {
    return `"passed" is ${describeValue(outcome.passed)}, expected a boolean`;
  }
  if (!Array.isArray(outcome.failures)) {
    return `"failures" is ${describeValue(outcome.failures)}, expected an array`;
  }
  if (!Number.isInteger(outcome.ticksUsed) || (outcome.ticksUsed as number) < 0) {
    return `"ticksUsed" is ${describeValue(outcome.ticksUsed)}, expected a non-negative integer`;
  }
  for (const [index, item] of outcome.failures.entries()) {
    const issue = failureIssue(item, spec);
    if (issue !== undefined) return `failure record ${index} ${issue}`;
  }
  return undefined;
}

export function runChecks(graph: Graph, registry: Registry, spec: LevelSpec): CheckOutcome {
  const failures: CheckFailure[] = [];
  let ticksUsed = 0;

  for (const entry of spec.checks) {
    // Element-level guard, before anything reads `check.kind`: level data
    // reaches the kernel untyped, and an entry that is `null` used to throw a
    // `TypeError` out of `runChecks` -- including from the `'error' in created`
    // push just below, which reads `kind` and sits outside the `try`.
    if (!isRecord(entry) || typeof entry.kind !== 'string') {
      failures.push(unreadableCheckFailure(entry));
      continue;
    }
    const check: LevelCheck = entry;
    // One compilation and one Simulation per check, reused for every row.
    // Compiling per row would re-run validateGraph and reallocate the signal
    // table hundreds of times for a single level.
    const created = createSim(graph, registry, spec);
    if ('error' in created) {
      failures.push(failure(check, {}, {}, {}, 0, created.error));
      continue;
    }
    const io = created.io;
    // The fuzz round in flight, so the `catch` below can still name the round
    // when the kernel (not the authored data) is what failed. `null` for every
    // other kind of check.
    let activeRound: number | null = null;

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

      if (check.kind === 'fuzz') {
        const plan = planFuzz(check, spec);
        if (plan.kind === 'issue') {
          failures.push(
            failure(check, {}, plan.expected, plan.actual, 0, plan.reason, null, plan.detail),
          );
          continue;
        }

        const vectors = fuzzVectors(check.seed, plan);
        for (let round = 0; ; round += 1) {
          activeRound = round;
          let step: IteratorResult<FuzzVector>;
          try {
            step = vectors.next();
          } catch (e) {
            // Authored code, not kernel code: a throwing input function is a
            // level-data defect, and it must not escape into the board-edit
            // path (see the `RangeError` note in the `catch` below).
            failures.push(
              failure(
                check,
                {},
                {},
                {},
                0,
                'invalid',
                round,
                `fuzz input function threw in round ${round}: ${describeError(e)}`,
              ),
            );
            break;
          }
          if (step.done) break;
          const raw: Readonly<Record<string, unknown>> = step.value;
          const unpinnable = plan.inputs.find((pin) => !fitsPin(raw[pin.id], pin.width));
          if (unpinnable !== undefined) {
            // Writing it would be refused by `writeInput` and leave the pin at
            // zero, comparing the circuit against a vector it never saw. Say
            // which pin and which value instead.
            failures.push(
              failure(
                check,
                numericOnly(raw),
                {},
                {},
                0,
                'invalid',
                round,
                unfitDetail(
                  'the value of fuzz input pin',
                  unpinnable.id,
                  raw[unpinnable.id],
                  unpinnable.width,
                ),
              ),
            );
            break;
          }
          const inputs: FuzzVector = step.value;

          const expected: Record<string, number> = {};
          let badExpectation: { id: string; width: number; value: unknown } | undefined;
          try {
            for (const pin of plan.outputs) {
              const value: unknown = pin.fn(inputs);
              if (!fitsPin(value, pin.width)) {
                badExpectation = { id: pin.id, width: pin.width, value };
                break;
              }
              expected[pin.id] = value;
            }
          } catch (e) {
            failures.push(
              failure(
                check,
                inputs,
                {},
                {},
                0,
                'invalid',
                round,
                `fuzz output function threw in round ${round}: ${describeError(e)}`,
              ),
            );
            break;
          }
          if (badExpectation !== undefined) {
            // Never masked to the pin width: masking `a + b` on an 8-bit pin
            // would turn the authored mistake into a comparison that silently
            // means something else. The expectation is reported unusable, with
            // the pin and the value, instead.
            failures.push(
              failure(
                check,
                inputs,
                typeof badExpectation.value === 'number'
                  ? { [badExpectation.id]: badExpectation.value }
                  : {},
                {},
                0,
                'invalid',
                round,
                unfitDetail(
                  'the fuzz expectation for pin',
                  badExpectation.id,
                  badExpectation.value,
                  badExpectation.width,
                ),
              ),
            );
            break;
          }

          const attempt = runRow(io, spec, inputs, 0);
          ticksUsed = Math.max(ticksUsed, attempt.ticksUsed);
          if (compare(expected, attempt.outputs)) {
            // The first failing round is enough: no later round can change the
            // verdict, and a wrong circuit usually disagrees on round 0 while
            // the cap allows thousands. The record still names the round, the
            // vector, the expectation and what the circuit actually drove.
            failures.push(
              failure(
                check,
                inputs,
                expected,
                attempt.outputs,
                0,
                'mismatch',
                round,
                `round ${round} of ${plan.rounds} (seed ${check.seed})`,
              ),
            );
            break;
          }
        }
        continue;
      }

      if (check.kind === 'custom') {
        if (typeof check.id !== 'string' || check.id === '') {
          // Ruling: the kernel takes an id and looks it up in the registry. A
          // function carried in level data is neither serialisable nor
          // reviewable, so it is refused -- not called.
          const detail =
            typeof check.id === 'function'
              ? 'custom check inlined a function in level data; name a registered id instead'
              : `custom check id=${describeValue(check.id)}: expected a non-empty string`;
          failures.push(failure(check, {}, {}, {}, 0, 'missing-check', null, detail));
          continue;
        }

        const checker = getCustomCheck(check.id);
        if (typeof checker !== 'function') {
          failures.push(
            failure(
              check,
              {},
              { [check.id]: 1 },
              { [check.id]: 0 },
              0,
              'missing-check',
              null,
              `no custom check is registered under id "${check.id}"`,
            ),
          );
          continue;
        }

        let outcome: unknown;
        let issue: string | undefined;
        try {
          outcome = checker(io, spec);
          // Read inside the same `try` as the call: an outcome whose `passed`,
          // `failures` or `ticksUsed` accessor throws is a hostile return value,
          // not kernel code, and the outer `catch` rethrows everything that is
          // not a kernel error. Here it is a malformed outcome with an
          // explanation, which is what it is.
          issue = outcomeIssue(outcome, spec);
        } catch (e) {
          // A registered checker is code, and code has bugs. Every throw is
          // absorbed here -- `grade()` runs on every board edit, and Phase 0
          // had a `RangeError` escape this loop and fire on each one. Unlike
          // the outer `catch`, nothing is rethrown: a checker's crash is the
          // level's failure, not the kernel's.
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              io.sim.tickCount,
              e instanceof UnstableCircuitError ? 'unstable' : 'invalid',
              null,
              `custom check "${check.id}" threw ${describeError(e)}`,
            ),
          );
          continue;
        }

        if (issue !== undefined) {
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              io.sim.tickCount,
              'invalid',
              null,
              `custom check "${check.id}" returned a malformed outcome: ${issue}`,
            ),
          );
          continue;
        }

        const result = outcome as CheckOutcome;
        // The checker owns its ticks (it is the only thing that knows how far it
        // drove the circuit); they join the run's tick metric like every other
        // check's.
        ticksUsed = Math.max(ticksUsed, result.ticksUsed);
        if (!result.passed || result.failures.length > 0) {
          if (result.failures.length > 0) {
            // Adopted verbatim: these records are the checker's own report. A
            // loop rather than `push(...)`, because a checker may return more
            // records than the argument limit a spread tolerates.
            for (const record of result.failures) failures.push(record);
            if (result.passed) {
              // A contradiction fails safe: the records are kept, and a second
              // record says why the check failed despite `passed: true`.
              const count = result.failures.length;
              const detail = `custom check "${check.id}" reported passed=true despite ${count} failure(s)`;
              failures.push(failure(check, {}, {}, {}, io.sim.tickCount, 'invalid', null, detail));
            }
          } else {
            // Failing without a record leaves the player nothing to look at,
            // so the run states one on the checker's behalf.
            failures.push(
              failure(
                check,
                {},
                {},
                {},
                io.sim.tickCount,
                'invalid',
                null,
                `custom check "${check.id}" reported passed=false without a failure record`,
              ),
            );
          }
        }
        continue;
      }

      if (check.kind === 'script') {
        // script: walk the steps in tick order, driving inputs along the way
        io.reset();
        ticksUsed = Math.max(ticksUsed, driveSteps(io, spec, check, check.steps, failures));
        continue;
      }

      if (check.kind === 'program') {
        // program: assemble the authored source, put the bytes into the
        // circuit's program RAM, then drive the steps through the SAME driver
        // `script` uses (`driveSteps`: `io.writeInput`, `io.sim.settle`,
        // `io.tick`, `io.readOutput`, `compare`, `failure`). Only what happens
        // before the first step differs between the two kinds.
        //
        // Vacuity comes first, as it does for every kind: a check that executes
        // nothing, or executes something and compares nothing, would pass every
        // circuit ever built -- the `missing-rows` lesson.
        const steps: readonly ProgramStep[] = Array.isArray(check.steps) ? check.steps : [];
        const asserting = steps.filter(stepAsserts).length;
        if (steps.length === 0) {
          failures.push(
            failure(
              check,
              {},
              { steps: 1 },
              { steps: 0 },
              0,
              'missing-program',
              null,
              'program check declares no steps: nothing would be executed and nothing compared',
            ),
          );
          continue;
        }
        if (asserting === 0) {
          failures.push(
            failure(
              check,
              {},
              { expects: 1 },
              { expects: 0 },
              0,
              'missing-program',
              null,
              `program check has ${steps.length} step(s) and not one declares an expectation: every circuit would pass it`,
            ),
          );
          continue;
        }

        if (typeof check.source !== 'string') {
          // Level data reaches the kernel untyped, and the assembler is handed
          // this value directly: refusing it here keeps a `TypeError` out of the
          // board-edit path rather than out of the kernel's own `catch`.
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              0,
              'invalid',
              null,
              `program check declares source=${describeValue(check.source)}; expected assembly text`,
            ),
          );
          continue;
        }

        // The image is loaded after the reset, and that ordering is the whole
        // point: `reset()` clears every storage byte, and `runChecks` compiled
        // this circuit before any branch ran, so an image written earlier would
        // be gone before the first step read it.
        io.reset();
        const assembled = assemble(check.source, OVERTURE_ISA);
        if (assembled.errors.length > 0) {
          // The assembler never throws; it reports. The first error is the one
          // to show, with its line, exactly as it located it.
          const first = assembled.errors[0]!;
          failures.push(
            failure(
              check,
              {},
              {},
              {},
              0,
              'invalid',
              null,
              `program assembly failed at line ${first.line}: ${first.reason}`,
            ),
          );
          continue;
        }
        if (assembled.bytes.length === 0) {
          // An empty or comment-only source is a legal zero-byte program to the
          // assembler; loading it would exercise no instruction at all, which is
          // the same hazard as an empty `steps` array.
          failures.push(
            failure(
              check,
              {},
              { bytes: 1 },
              { bytes: 0 },
              0,
              'missing-program',
              null,
              'the program source assembles to zero bytes: no instruction would ever execute',
            ),
          );
          continue;
        }

        const targets = programTargets(check, graph);
        if ('detail' in targets) {
          failures.push(failure(check, {}, {}, {}, 0, 'missing-io', null, targets.detail));
          continue;
        }

        // An image longer than the instance's state, or a `ram` id this netlist
        // does not have, is `Simulation.loadImage`'s `RangeError` -- absorbed by
        // the `catch` below as an `invalid` failure, never thrown out of
        // `runChecks`. The assembler deliberately does not enforce `ram_prog`'s
        // capacity, so a 257-byte program reaches the kernel and is refused
        // there.
        for (const id of targets.ids) io.sim.loadImage(id, assembled.bytes);
        io.sim.settle();
        ticksUsed = Math.max(ticksUsed, driveSteps(io, spec, check, steps, failures));
        continue;
      }

      // Every kind `LevelCheck` declares is handled above; this is the guard for
      // level data that names something else (a stale save, a typo, a check from
      // a newer kernel). It fails loudly instead of falling through, which is
      // exactly how a `fuzz` or `custom` check used to reach `check.steps` and
      // throw a `TypeError` out of `runChecks` on every board edit.
      const unknown = check as { readonly kind?: unknown };
      failures.push(
        failure(
          check,
          {},
          {},
          {},
          0,
          'invalid',
          null,
          `unknown check kind ${describeValue(unknown.kind)}; this kernel cannot run it`,
        ),
      );
    } catch (e) {
      if (e instanceof UnstableCircuitError) {
        failures.push(
          failure(
            check,
            {},
            {},
            {},
            io.sim.tickCount,
            'unstable',
            activeRound,
            activeRound === null ? null : `fuzz round ${activeRound} did not settle`,
          ),
        );
      } else if (e instanceof CircuitValidationError || e instanceof RangeError) {
        // `RangeError` is the kernel's "this value does not fit this port"
        // signal (`assertWidth`), and level data is hand-authored: absorb it as
        // a failed check so nothing thrown from inside a check can escape
        // `runChecks` into the board-edit path. `'invalid'` already means "this
        // circuit/spec cannot be evaluated as declared".
        failures.push(
          failure(
            check,
            {},
            {},
            {},
            io.sim.tickCount,
            'invalid',
            activeRound,
            activeRound === null ? null : `fuzz round ${activeRound}`,
          ),
        );
      } else {
        throw e;
      }
    }
  }

  return { passed: failures.length === 0, failures, ticksUsed };
}

/**
 * True when a step carries at least one expectation.
 *
 * `expect: {}` compares nothing, so it is not an assertion: a `program` check
 * whose every step looks like that would pass every circuit ever built, and it
 * counts here exactly like a step with no `expect` at all. Read defensively,
 * because level data reaches the kernel untyped and a `null` step must not throw.
 */
function stepAsserts(step: unknown): boolean {
  return isRecord(step) && isRecord(step.expect) && Object.keys(step.expect).length > 0;
}

/**
 * The `ram_prog` instances a `program` check must load its image into, or the
 * sentence explaining why there is nothing to load it into.
 *
 * An absent (or empty) `ram` loads EVERY `ram_prog` instance in the circuit: a
 * level with one program RAM need not name it, and a level with several gets all
 * of them, which keeps the check independent of the order instances sit in the
 * document. A named `ram` is used verbatim -- an id the netlist does not have is
 * `Simulation.loadImage`'s `RangeError`, which `runChecks` reports as `invalid`,
 * so the check does not second-guess the name here.
 *
 * The list is read from the DOCUMENT (`graph.instances`), because that is where
 * an instance's def id is readable by name; `Simulation.loadImage` resolves each
 * id through `CompiledInstance.key`, which `compile` sets from the same document
 * id. Returning an empty list is not an option: a check that has nowhere to put
 * its program is a `missing-io` failure, not a check that quietly runs nothing.
 */
function programTargets(
  check: ProgramCheck,
  graph: Graph,
): { readonly ids: readonly string[] } | { readonly detail: string } {
  const named = typeof check.ram === 'string' && check.ram !== '' ? check.ram : undefined;
  if (named !== undefined) return { ids: [named] };
  const ids = graph.instances
    .filter((inst) => inst.def === 'ram_prog')
    .map((inst) => inst.id);
  if (ids.length === 0) {
    return {
      detail:
        'program check names no "ram" and the circuit has no ram_prog instance to load the program into',
    };
  }
  return { ids };
}

/**
 * Drives a tick-ordered step list against an already-reset circuit, appending
 * one `mismatch` failure per step whose expectations the circuit does not meet,
 * and returns the tick high-water mark.
 *
 * Shared by `script` and `program` on purpose. The two kinds differ only in what
 * happens before the first step -- a `program` check assembles its source and
 * loads the bytes into the circuit's program RAM, a `script` check does not --
 * and every step after that means the same thing to both: write the step's
 * inputs, settle, tick up to the step's tick, then compare each declared output
 * with `compare` and record a `failure` when one differs. A second driver for
 * `program` would be a second set of tick semantics to keep in agreement.
 *
 * The caller resets first. `settle` and `tick` never clear state, so a program
 * image loaded between the reset and this call survives every step.
 */
function driveSteps(
  io: LevelIo,
  spec: LevelSpec,
  check: LevelCheck,
  steps: readonly (ScriptStep | ProgramStep)[],
  failures: CheckFailure[],
): number {
  let ticksUsed = io.sim.tickCount;
  const ordered = [...steps].sort((a, b) => a.tick - b.tick);
  for (const step of ordered) {
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
        failures.push(failure(check, step.inputs ?? {}, step.expect, actual, step.tick, 'mismatch'));
      }
    }
  }
  return ticksUsed;
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
 * The failure for a `spec.checks` element that is not a check at all.
 *
 * `failure()` cannot build this one: it reads `check.kind`, and the point of the
 * record is that there is no readable kind. The record's `check` field is typed
 * as the union of the kinds this kernel knows, so it states `'(none)'` here --
 * the one place where level data is known to have named nothing the kernel can
 * run.
 */
function unreadableCheckFailure(entry: unknown): CheckFailure {
  const detail = isRecord(entry)
    ? `check entry has kind=${describeValue(entry.kind)}, expected a string kind`
    : `check entry is ${describeValue(entry)}, expected an object with a kind`;
  return {
    check: '(none)' as CheckFailure['check'],
    inputs: {},
    expected: {},
    actual: {},
    tick: 0,
    reason: 'invalid',
    detail,
  };
}

/**
 * Builds one failure record.
 *
 * `reason` is `NonNullable<...>` rather than `CheckFailure['reason']`: the field
 * is optional, so the indexed type includes `undefined`, and
 * `exactOptionalPropertyTypes` rejects assigning a possibly-`undefined` value to
 * an optional property. Every failure this module builds names a reason anyway.
 *
 * `round` and `detail` are likewise "absent when there is nothing to say": only
 * `fuzz` has rounds, and only the failures whose specifics do not fit a numeric
 * record carry a sentence.
 */
function failure(
  check: LevelCheck,
  inputs: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  tick: number,
  reason: NonNullable<CheckFailure['reason']>,
  round: number | null = null,
  detail: string | null = null,
): CheckFailure {
  // `round` and `detail` are only attached when they exist: `exactOptional
  // PropertyTypes` rejects handing an explicit `undefined` to an optional
  // property, and a caller here has nothing to say with a null either.
  return {
    check: check.kind,
    inputs,
    expected,
    actual,
    tick,
    reason,
    ...(round === null ? {} : { round }),
    ...(detail === null ? {} : { detail }),
  };
}

/**
 * Why a check had no evaluable circuit: the settle loop ran away (`unstable`),
 * `compile` refused the graph (`invalid`), or the graph's level I/O does not
 * match the level's declared pins (`missing-io`, see `bindLevelIo`). Each maps
 * onto the `CheckFailure` reason of the same name.
 */
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
    // The circuit's level I/O is present but sized against the level: no value
    // can cross such a pin intact, so the circuit is unbound rather than run at
    // whichever of the two widths happens to look right.
    if (io.mismatch !== undefined) return { error: 'missing-io' };
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

// ---------------------------------------------------------------------------
// the case list the board plays
// ---------------------------------------------------------------------------

/** One case a level's checks drive: the vector in, what the level expects back. */
export interface TestCase {
  readonly inputs: Readonly<Record<string, number>>;
  /** The outputs this case asserts; empty for a case that asserts nothing. */
  readonly expected: Readonly<Record<string, number>>;
  /**
   * Clock edges to apply after driving, before reading. Always 0 for a
   * combinational level; a `script` step states the tick it belongs to.
   */
  readonly tick: number;
  /**
   * True when the circuit is cleared before this case is driven.
   *
   * THE ONE THING THAT MAKES A CASE LIST PLAYABLE, and it is per case rather than
   * per level because a level may declare checks of both shapes --
   * `ch2-30-odd-ticks` declares two scripts, and a level with a table and a
   * script would declare one of each. A truth table, a constraint and a fuzz
   * check each drive one vector into a freshly reset circuit, so every one of
   * their cases says `true`. A script's steps are one run -- step 3 reads a
   * register step 2 clocked -- so only its first step does, and the rest carry
   * the clock on from where the previous one left it.
   */
  readonly reset: boolean;
}

/** What a level will test, or why it cannot be laid out case by case. */
export type TestPlan =
  | { readonly kind: 'cases'; readonly cases: readonly TestCase[] }
  | { readonly kind: 'none'; readonly reason: 'program' | 'custom' | 'empty' };

/**
 * The cases this level's checks drive, in the order the checker drives them.
 *
 * WHY THIS EXISTS. The bottom panel used to be a report rather than a plan: it
 * showed the failures the last grade happened to record, so a player could not
 * see what a level would test until after it had already judged them, and a
 * circuit that passed left nothing to look at. The cases are declared data -- a
 * truth table's `rows`, the inputs a `constraint` enumerates, a `fuzz` check's
 * own seeded vectors, a `script`'s steps -- so they can be laid out before the
 * circuit is built and then played one at a time.
 *
 * IT IS DERIVED FROM THE PRIMITIVES THE CHECKER ITSELF USES: `enumerateInputs`
 * and `evaluateRule` for a constraint, `planFuzz` and `fuzzVectors` for a fuzz
 * check, and the checks' own `rows` and `steps`. A list that drifted from what
 * `runChecks` drives would animate a test the level never runs, which is worse
 * than no animation at all; `test/levels/testcases.test.ts` pins the agreement
 * by driving a known-wrong circuit through the real checker and matching its
 * failure records against this list, vector by vector.
 *
 * `program` AND `custom` HAVE NO LIST, and they are not an oversight. A program's
 * vectors only mean anything with the assembled image loaded into the circuit's
 * RAM, which is the check's own business; a custom check's cases live in code
 * this module cannot see. Both report a reason, and the test button still grades
 * them -- it just cannot play them.
 *
 * NEVER THROWS. It is called from the panel's render path, on every board edit,
 * with level data that reaches the kernel untyped. A malformed check, an input
 * function that throws, a value the enumeration cannot express: each drops those
 * cases rather than taking the board down with it -- the rule `runChecks`
 * follows, one level up.
 */
export function testCases(spec: LevelSpec): TestPlan {
  const cases: TestCase[] = [];
  let blocked: 'program' | 'custom' | null = null;
  const checks: readonly LevelCheck[] = Array.isArray(spec.checks) ? spec.checks : [];

  for (const entry of checks) {
    if (!isRecord(entry) || typeof entry.kind !== 'string') continue;
    const check: LevelCheck = entry;
    try {
      if (check.kind === 'truth-table') {
        for (const row of check.rows ?? []) {
          cases.push({
            inputs: numericOnly(row.inputs ?? {}),
            expected: numericOnly(row.outputs ?? {}),
            tick: 0,
            reset: true,
          });
        }
        continue;
      }
      if (check.kind === 'constraint') {
        for (const inputs of enumerateInputs(spec)) {
          const want = evaluateRule(check.rule, inputs, outputWidth(spec, check.rule.output));
          cases.push({
            inputs,
            expected: { [check.rule.output]: want },
            tick: 0,
            reset: true,
          });
        }
        continue;
      }
      if (check.kind === 'fuzz') {
        const plan = planFuzz(check, spec);
        if (plan.kind !== 'plan') continue;
        // `fuzzVectors` yields the values the pins are DRIVEN with, which is the
        // same record `runChecks` writes into a failure -- not the raw draw.
        for (const inputs of fuzzVectors(check.seed, plan)) {
          const expected: Record<string, number> = {};
          for (const pin of plan.outputs) {
            const value: unknown = pin.fn(inputs);
            if (typeof value === 'number') expected[pin.id] = value;
          }
          cases.push({ inputs, expected, tick: 0, reset: true });
        }
        continue;
      }
      if (check.kind === 'script') {
        const steps = check.steps ?? [];
        for (const [index, step] of steps.entries()) {
          cases.push({
            inputs: numericOnly(step.inputs ?? {}),
            expected: numericOnly(step.expect ?? {}),
            tick: step.tick,
            // Only a script's FIRST step starts from a cleared circuit:
            // `runChecks` resets once per check and then walks the steps. A
            // level that declares two scripts (`ch2-30-odd-ticks`) resets twice,
            // once at each script's front.
            reset: index === 0,
          });
        }
        continue;
      }
      if (check.kind === 'program') blocked ??= 'program';
      else if (check.kind === 'custom') blocked ??= 'custom';
    } catch {
      // Deliberately silent: see "NEVER THROWS" above. The checker reports the
      // same defect properly, with a reason and a detail, when it is run.
    }
  }

  if (cases.length === 0) {
    return blocked === null ? { kind: 'none', reason: 'empty' } : { kind: 'none', reason: blocked };
  }
  return { kind: 'cases', cases };
}

export { formatPort };
