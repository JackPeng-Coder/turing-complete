import { afterEach, describe, expect, it } from 'vitest';
import { UnstableCircuitError } from '../../src/core/errors';
import type { Graph } from '../../src/core/graph';
import { DEFAULT_FUZZ_ROUNDS, FUZZ_ROUNDS_CAP, runChecks } from '../../src/levels/checks';
import {
  customCheckIds,
  registerCustomCheck,
  unregisterCustomCheck,
  type CustomChecker,
} from '../../src/levels/custom/index';
import { grade } from '../../src/levels/grader';
import { FAILURE_REASONS } from '../../src/levels/spec';
import type {
  CheckFailure,
  CheckOutcome,
  FuzzCheck,
  FuzzVector,
  LevelCheck,
  LevelSpec,
} from '../../src/levels/spec';
import { build, registry } from '../fixtures/build';

/**
 * The two checker kinds that share this file: `fuzz` (random vectors from a
 * seeded PRNG) and `custom` (a level-specific hook looked up in a registry).
 *
 * Both exist for the same reason -- chapter 2's 8-bit arithmetic cannot be
 * pinned down by a handful of hand-written rows, and chapters 3 and 7 need an
 * escape hatch -- and both carry the same hazard: a check with nothing to
 * compare would pass every circuit ever built, exactly like the Phase-0
 * `truth-table` check with an omitted `rows`.
 *
 * Every test here therefore goes through a real `LevelSpec` and a real compiled
 * circuit via `runChecks` / `grade`, never by calling an internal helper.
 */

const withChecks = (level: LevelSpec, checks: readonly LevelCheck[]): LevelSpec => ({
  ...level,
  checks,
});

// ---------------------------------------------------------------------------
// Fixtures: an 8-bit single-output level and an 8-bit adder with a carry.
// ---------------------------------------------------------------------------

const AND_IO: LevelSpec['io'] = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
  ],
  outputs: [{ id: 'out', width: 8 }],
};

const andLevel: LevelSpec = {
  id: 'test-fuzz-and8',
  chapter: 2,
  index: 1,
  name: { zh: '测试八位与门', en: 'Test 8-Bit AND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['and8', 'level_input', 'level_output'],
  io: AND_IO,
  checks: [],
};

const ADD_IO: LevelSpec['io'] = {
  inputs: [
    { id: 'a', width: 8 },
    { id: 'b', width: 8 },
  ],
  outputs: [
    { id: 'out', width: 8 },
    { id: 'carry', width: 1 },
  ],
};

const addLevel: LevelSpec = {
  ...andLevel,
  id: 'test-fuzz-add8',
  index: 2,
  name: { zh: '测试八位加法器', en: 'Test 8-Bit Adder' },
  allowedComponents: ['add8', 'const_off', 'level_input', 'level_output'],
  io: ADD_IO,
};

/** `IN_a --and8--> OUT`, both level pins 8 bits wide. */
function andCircuit(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'and8', id: 'and', from: ['a', 'b'] },
    { kind: 'output', from: 'and.out', width: 8 },
  ]);
}

/** The same level I/O, but wired to `or8`: a circuit the AND checker rejects. */
function orCircuit(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'or8', id: 'or', from: ['a', 'b'] },
    { kind: 'output', from: 'or.out', width: 8 },
  ]);
}

/** `a + b + 0`, with `sum` on `OUT_out` and the ninth bit on `OUT_carry`. */
function addCircuit(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'const_off', id: 'zero', from: [] },
    { kind: 'part', def: 'add8', id: 'add', from: ['a', 'b', 'zero'] },
    { kind: 'output', name: 'OUT_out', from: 'add.out', width: 8 },
    { kind: 'output', name: 'OUT_carry', from: 'add.cout', width: 1 },
  ]);
}

/** Addition expectations for the two-output adder level, at tick 0. */
const sum8 = (v: FuzzVector): number => ((v.a ?? 0) + (v.b ?? 0)) & 0xff;
const carry8 = (v: FuzzVector): number => (((v.a ?? 0) + (v.b ?? 0)) >> 8) & 1;

const addCheck: FuzzCheck = {
  kind: 'fuzz',
  seed: 0x5eed,
  rounds: 128,
  inputs: { a: (sample) => sample.a ?? 0, b: (sample) => sample.b ?? 0 },
  outputs: { out: sum8, carry: carry8 },
};

/** An `and8` circuit that is wired to `OUT_out` only, so `carry` reads 0. */
function andWiredAsAdder(): Graph {
  return build([
    { kind: 'input', name: 'a', width: 8 },
    { kind: 'input', name: 'b', width: 8 },
    { kind: 'part', def: 'and8', id: 'and', from: ['a', 'b'] },
    { kind: 'output', name: 'OUT_out', from: 'and.out', width: 8 },
  ]);
}

// ---------------------------------------------------------------------------
// fuzz
// ---------------------------------------------------------------------------

describe('runChecks / fuzz', () => {
  it('passes a correct 8-bit adder, wide output and carry included', () => {
    const spec = withChecks(addLevel, [addCheck]);
    const outcome = runChecks(addCircuit(), registry, spec);
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    // Fuzz drives combinational vectors at tick 0, like truth-table rows.
    expect(outcome.ticksUsed).toBe(0);
    expect(grade(addCircuit(), registry, spec).passed).toBe(true);
  });

  it('reports the failing round, its input vector, the expectation and the actual', () => {
    // A fuzz failure that only said "fuzz failed" would be undebuggable on an
    // 8-bit level, so the record has to name the round and the exact vector.
    // The vectors are captured through the check's own output function, which
    // is what the kernel drives: the round reported must be the FIRST round
    // whose vector actually fails, and the vector must be that round's.
    const seen: FuzzVector[] = [];
    const check: FuzzCheck = {
      ...addCheck,
      outputs: {
        out: (v) => {
          seen.push(v);
          return sum8(v);
        },
        carry: carry8,
      },
    };
    const outcome = runChecks(andWiredAsAdder(), registry, withChecks(addLevel, [check]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toHaveLength(1);

    const failure = outcome.failures[0]!;
    const firstBad = seen.findIndex((v) => sum8(v) !== (v.a! & v.b!) || carry8(v) !== 0);
    expect(firstBad).toBeGreaterThanOrEqual(0);
    expect(failure.reason).toBe('mismatch');
    expect(failure.round).toBe(firstBad);
    expect(failure.inputs).toEqual(seen[firstBad]);
    expect(failure.expected).toEqual({ out: sum8(failure.inputs), carry: carry8(failure.inputs) });
    expect(failure.actual).toEqual({ out: failure.inputs.a! & failure.inputs.b!, carry: 0 });
    expect(failure.detail).toContain(`round ${firstBad}`);
  });

  it('generates the same vector sequence from the same seed in two independent constructions', () => {
    // Two separately-built circuits and two separately-built specs: the vectors
    // the kernel drives must match element for element, or a level's difficulty
    // would depend on nothing at all.
    const capture = (sink: FuzzVector[], seed: number): FuzzCheck => ({
      ...addCheck,
      seed,
      rounds: 16,
      outputs: {
        out: (v) => {
          sink.push(v);
          return sum8(v);
        },
        carry: carry8,
      },
    });

    const first: FuzzVector[] = [];
    const second: FuzzVector[] = [];
    const run = (sink: FuzzVector[]): boolean =>
      runChecks(addCircuit(), registry, withChecks(addLevel, [capture(sink, 0x1234)])).passed;
    expect(run(first)).toBe(true);
    expect(run(second)).toBe(true);

    expect(first).toHaveLength(16);
    expect(second).toEqual(first);
    // ...and the sequence has to actually vary, or "same vectors" would be a
    // statement about one repeated vector.
    expect(new Set(first.map((v) => `${v.a},${v.b}`)).size).toBeGreaterThan(8);
  });

  it('varies the vectors for seed 0 instead of repeating the PRNG fixed point', () => {
    // xorshift32 with an all-zero state returns 0 forever, which would drive the
    // same vector on every round while claiming to fuzz. The kernel remaps the
    // zero seed; this is the test that would catch its removal.
    const seen: FuzzVector[] = [];
    const check: FuzzCheck = {
      ...addCheck,
      seed: 0,
      rounds: 8,
      outputs: {
        out: (v) => {
          seen.push(v);
          return sum8(v);
        },
        carry: carry8,
      },
    };
    expect(runChecks(addCircuit(), registry, withChecks(addLevel, [check])).passed).toBe(true);
    expect(seen).toHaveLength(8);
    expect(new Set(seen.map((v) => `${v.a},${v.b}`)).size).toBeGreaterThan(1);
  });

  it('names the round an unstable circuit died in', () => {
    // Two cross-coupled NANDs with both free inputs tied high never settle, so
    // `runRow` throws out of the settle loop -- a kernel error, not an authored
    // one. It still has to say which round, or an 8-bit level's oscillation is
    // undebuggable.
    const g = build([
      { kind: 'part', def: 'const_on', id: 'one', from: [] },
      { kind: 'part', def: 'nand', id: 'n1', from: ['one', 'n2'] },
      { kind: 'part', def: 'nand', id: 'n2', from: ['n1', 'one'] },
    ]);
    const spec = withChecks(addLevel, [{ ...addCheck, rounds: 4 }]);
    expect(() => runChecks(g, registry, spec)).not.toThrow();
    const outcome = runChecks(g, registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('unstable');
    expect(outcome.failures[0]?.round).toBe(0);
    expect(outcome.failures[0]?.detail).toContain('round 0');
  });

  it('ties the sequence to the seed', () => {
    const capture = (sink: FuzzVector[], seed: number): FuzzCheck => ({
      ...addCheck,
      seed,
      rounds: 8,
      outputs: {
        out: (v) => {
          sink.push(v);
          return sum8(v);
        },
        carry: carry8,
      },
    });
    const a: FuzzVector[] = [];
    const b: FuzzVector[] = [];
    runChecks(addCircuit(), registry, withChecks(addLevel, [capture(a, 1)]));
    runChecks(addCircuit(), registry, withChecks(addLevel, [capture(b, 2)]));
    expect(b).not.toEqual(a);
  });

  it('pins the first vectors of a known seed', () => {
    // A characterization pin, not a derivation: if the PRNG changes, this test
    // says so instead of quietly changing what every fuzz level covers.
    const seen: FuzzVector[] = [];
    const check: FuzzCheck = {
      ...addCheck,
      seed: 0x1234,
      rounds: 3,
      outputs: {
        out: (v) => {
          seen.push(v);
          return sum8(v);
        },
        carry: carry8,
      },
    };
    runChecks(addCircuit(), registry, withChecks(addLevel, [check]));
    expect(seen.map((v) => [v.a, v.b])).toEqual([
      [0xf7, 0xe2],
      [0x2e, 0xf3],
      [0x20, 0x2b],
    ]);
  });

  it('runs the documented default number of rounds when `rounds` is omitted', () => {
    let rounds = 0;
    const check: FuzzCheck = {
      kind: 'fuzz',
      seed: 7,
      inputs: { a: (sample) => sample.a ?? 0, b: (sample) => sample.b ?? 0 },
      outputs: {
        out: (v) => {
          rounds += 1;
          return (v.a ?? 0) & (v.b ?? 0);
        },
      },
    };
    expect(runChecks(andCircuit(), registry, withChecks(andLevel, [check])).passed).toBe(true);
    expect(rounds).toBe(DEFAULT_FUZZ_ROUNDS);
  });

  it('clamps a huge `rounds` to the documented cap instead of hanging the editor', () => {
    let rounds = 0;
    const check: FuzzCheck = {
      kind: 'fuzz',
      seed: 7,
      rounds: FUZZ_ROUNDS_CAP + 10_000,
      inputs: { a: (sample) => sample.a ?? 0, b: (sample) => sample.b ?? 0 },
      outputs: {
        out: (v) => {
          rounds += 1;
          return (v.a ?? 0) & (v.b ?? 0);
        },
      },
    };
    expect(runChecks(andCircuit(), registry, withChecks(andLevel, [check])).passed).toBe(true);
    expect(rounds).toBe(FUZZ_ROUNDS_CAP);
  });

  it.each([0, -1, 2.5, Number.NaN])(
    'refuses a fuzz check with rounds=%s instead of passing it',
    (rounds) => {
      const spec = withChecks(addLevel, [{ ...addCheck, rounds }]);
      const outcome = runChecks(addCircuit(), registry, spec);
      expect(outcome.passed).toBe(false);
      expect(outcome.failures[0]?.reason).toBe('missing-vectors');
      expect(outcome.failures[0]?.check).toBe('fuzz');
      expect(grade(addCircuit(), registry, spec).failures[0]?.reason).toBe('missing-vectors');
    },
  );

  it('refuses a fuzz check that declares no input functions', () => {
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [{ ...addCheck, inputs: {} }]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-vectors');
    expect(outcome.failures[0]?.detail).toContain('input');
  });

  it('refuses a fuzz check that declares no output expectations', () => {
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [{ ...addCheck, outputs: {} }]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-vectors');
    expect(outcome.failures[0]?.detail).toContain('output');
  });

  it('refuses a fuzz check on a level with no input pins to vary', () => {
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks({ ...addLevel, io: { inputs: [], outputs: ADD_IO.outputs } }, [addCheck]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.check).toBe('fuzz');
    expect(outcome.failures[0]?.reason).toBe('missing-vectors');
    expect(outcome.failures[0]?.detail).toContain('no input pins');
  });

  it('refuses a fuzz check on a level with no output pins to compare against', () => {
    // The sibling of the case above: a level can be vacuous in either
    // direction, and both are reported before any authored function is bound.
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks({ ...addLevel, io: { inputs: ADD_IO.inputs, outputs: [] } }, [addCheck]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.check).toBe('fuzz');
    expect(outcome.failures[0]?.reason).toBe('missing-vectors');
    expect(outcome.failures[0]?.detail).toContain('no output pins');
  });

  it('refuses a fuzz check with a function missing for one of the level pins', () => {
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [{ ...addCheck, inputs: { a: (sample) => sample.a ?? 0 } }]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('"b"');
  });

  it('refuses a fuzz function declared for a pin the level does not have', () => {
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [{ ...addCheck, outputs: { ...addCheck.outputs, nope: () => 0 } }]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('"nope"');
  });

  it('refuses an input function whose value does not fit its pin', () => {
    // Silently dropping the write would keep the pin at 0 and compare the
    // circuit against a vector it never saw: the failure has to name the pin
    // and the value instead.
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [
        { ...addCheck, inputs: { a: () => 256, b: (sample) => sample.b ?? 0 } },
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('256');
    expect(outcome.failures[0]?.detail).toContain('"a"');
  });

  it('refuses an expectation that does not fit its pin', () => {
    // `a + b` reaches 510 on an 8-bit pin. Masking it here would hide an
    // authoring mistake; stating it is a permanent, loud mismatch.
    const outcome = runChecks(
      addCircuit(),
      registry,
      withChecks(addLevel, [
        {
          ...addCheck,
          outputs: { out: (v) => (v.a ?? 0) + (v.b ?? 0), carry: carry8 },
        },
      ]),
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('"out"');
    expect(outcome.failures[0]?.expected.out).toBeGreaterThan(255);
  });

  it('turns an authored function that throws into a recorded failure', () => {
    const spec = withChecks(addLevel, [
      {
        ...addCheck,
        rounds: 4,
        outputs: {
          out: () => {
            throw new TypeError('authored expectation exploded');
          },
          carry: carry8,
        },
      },
    ]);
    expect(() => runChecks(addCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(addCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.round).toBe(0);
    expect(outcome.failures[0]?.detail).toContain('authored expectation exploded');
    expect(() => grade(addCircuit(), registry, spec)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// custom
// ---------------------------------------------------------------------------

const registered: string[] = [];

/** Registers a checker for one test; `afterEach` unregisters it again. */
function useChecker(id: string, checker: CustomChecker): void {
  registerCustomCheck(id, checker);
  registered.push(id);
}

afterEach(() => {
  for (const id of registered.splice(0)) unregisterCustomCheck(id);
});

/** A checker that drives the level's own pins and reports what it saw. */
const sweepAnd: CustomChecker = (io, spec) => {
  const failures: CheckFailure[] = [];
  for (const [a, b] of [
    [0x0f, 0x33],
    [0xff, 0xff],
    [0x80, 0x01],
  ] as const) {
    io.reset();
    io.writeInput('a', a);
    io.writeInput('b', b);
    io.sim.settle();
    const got = io.readOutput('out');
    if (got !== (a & b)) {
      failures.push({
        check: 'custom',
        inputs: { a, b },
        expected: { out: a & b },
        actual: { out: got },
        tick: io.sim.tickCount,
        reason: 'mismatch',
      });
    }
  }
  // Ticking is the checker's business: it reports how many ticks it used.
  io.tick();
  io.tick();
  return { passed: failures.length === 0, failures, ticksUsed: io.sim.tickCount };
};

describe('runChecks / custom', () => {
  const customSpec = (id: string, level: LevelSpec = andLevel): LevelSpec =>
    withChecks(level, [{ kind: 'custom', id }]);

  it('ships no custom checks of its own', () => {
    expect(customCheckIds()).toEqual([]);
  });

  it('calls a registered checker with the level io and adopts its outcome', () => {
    let calls = 0;
    useChecker('sweep-and', (io, spec) => {
      calls += 1;
      expect(spec.id).toBe('test-fuzz-and8');
      return sweepAnd(io, spec);
    });

    const outcome = runChecks(andCircuit(), registry, customSpec('sweep-and'));
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(2);
    expect(calls).toBe(1);

    const result = grade(andCircuit(), registry, customSpec('sweep-and'));
    expect(result.passed).toBe(true);
    expect(result.metrics.tick).toBe(2);
  });

  it('adopts the failure records of a registered checker verbatim', () => {
    useChecker('sweep-and', sweepAnd);
    const outcome = runChecks(orCircuit(), registry, customSpec('sweep-and'));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures[0]?.check).toBe('custom');
    expect(outcome.failures[0]?.reason).toBe('mismatch');
    expect(outcome.failures[0]?.inputs).toEqual({ a: 0x0f, b: 0x33 });
    expect(outcome.failures[0]?.actual).toEqual({ out: 0x0f | 0x33 });
  });

  it('fails an unregistered id with missing-check rather than passing it', () => {
    const spec = customSpec('nobody-registered-this');
    expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.check).toBe('custom');
    expect(outcome.failures[0]?.reason).toBe('missing-check');
    expect(outcome.failures[0]?.detail).toContain('nobody-registered-this');

    const result = grade(andCircuit(), registry, spec);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.reason).toBe('missing-check');
  });

  it('refuses a checker inlined in level data', () => {
    // Ruling: the kernel looks an id up in a registry. A function carried in
    // level data is neither serialisable nor reviewable, so it is not run.
    let called = false;
    const inlined = ((): CheckOutcome => {
      called = true;
      return { passed: true, failures: [], ticksUsed: 0 };
    }) as unknown as string;
    const outcome = runChecks(andCircuit(), registry, customSpec(inlined));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('missing-check');
    expect(outcome.failures[0]?.detail).toContain('inline');
    expect(called).toBe(false);
  });

  it.each([
    ['an Error', new Error('checker exploded')],
    ['a TypeError', new TypeError('checker exploded')],
    ['a RangeError', new RangeError('checker exploded')],
  ])('turns a checker that throws %s into a recorded failure', (_label, thrown) => {
    const id = `throws-${_label}`;
    useChecker(id, () => {
      throw thrown;
    });
    const spec = customSpec(id);
    expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('checker exploded');
    expect(() => grade(andCircuit(), registry, spec)).not.toThrow();
    expect(grade(andCircuit(), registry, spec).passed).toBe(false);
  });

  it('classifies an UnstableCircuitError escaping a checker as unstable', () => {
    // A checker that calls `io.sim.settle()` on an oscillating circuit lets the
    // kernel's own error out: it is the circuit that is unstable, not the
    // checker, so the failure keeps the reason the rest of the loop uses.
    useChecker('oscillating', () => {
      throw new UnstableCircuitError(512, ['n1']);
    });
    const outcome = runChecks(andCircuit(), registry, customSpec('oscillating'));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('unstable');
    expect(outcome.failures[0]?.detail).toContain('oscillating');
  });

  // Each case states the fragment of the reason that has to appear, so a case
  // cannot pass by accident: the checker's id is interpolated into the same
  // `detail`, and a "contains malformed" assertion would be satisfied by it.
  it.each<[string, unknown, string]>([
    ['undefined', undefined, 'instead of a CheckOutcome'],
    ['null', null, 'instead of a CheckOutcome'],
    ['a string', 'passed', 'instead of a CheckOutcome'],
    ['a number', 42, 'instead of a CheckOutcome'],
    ['an array', [], 'instead of a CheckOutcome'],
    ['a missing passed', { failures: [], ticksUsed: 0 }, '"passed" is undefined'],
    ['a non-boolean passed', { passed: 'yes', failures: [], ticksUsed: 0 }, '"passed" is "yes"'],
    ['a non-array failures', { passed: true, failures: 'none', ticksUsed: 0 }, '"failures" is'],
    ['a negative ticksUsed', { passed: true, failures: [], ticksUsed: -1 }, '"ticksUsed" is -1'],
    ['a fractional ticksUsed', { passed: true, failures: [], ticksUsed: 1.5 }, '"ticksUsed" is 1.5'],
    [
      'a null failure record',
      { passed: false, failures: [null], ticksUsed: 0 },
      'failure record 0 is null',
    ],
    [
      'a failure record with no actual',
      {
        passed: false,
        failures: [{ check: 'custom', inputs: {}, expected: {}, tick: 0 }],
        ticksUsed: 0,
      },
      'has actual=undefined',
    ],
    [
      'a failure record with an unknown reason',
      {
        passed: false,
        failures: [
          { check: 'custom', inputs: {}, expected: {}, actual: {}, tick: 0, reason: 'nonsense' },
        ],
        ticksUsed: 0,
      },
      'not a known failure reason',
    ],
    [
      'a failure record keyed by a pin this level does not have',
      {
        passed: false,
        failures: [{ check: 'custom', inputs: { nope: 1 }, expected: {}, actual: {}, tick: 0 }],
        ticksUsed: 0,
      },
      'not a pin of this level',
    ],
    [
      'a failure record with a non-numeric value',
      {
        passed: false,
        failures: [{ check: 'custom', inputs: {}, expected: { out: '1' }, actual: {}, tick: 0 }],
        ticksUsed: 0,
      },
      'expected a finite number',
    ],
    [
      'a failure record with a NaN value',
      {
        passed: false,
        failures: [
          { check: 'custom', inputs: {}, expected: {}, actual: { out: Number.NaN }, tick: 0 },
        ],
        ticksUsed: 0,
      },
      'expected a finite number',
    ],
  ])('turns %s outcome into a recorded invalid failure', (_label, value, fragment) => {
    const id = `malformed-${_label}`;
    useChecker(id, () => value as CheckOutcome);
    const spec = customSpec(id);
    expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('malformed');
    expect(outcome.failures[0]?.detail).toContain(fragment);
    expect(() => grade(andCircuit(), registry, spec)).not.toThrow();
  });

  it('adopts failures a checker reported while claiming to have passed', () => {
    const record: CheckFailure = {
      check: 'custom',
      inputs: { a: 0, b: 0 },
      expected: { out: 1 },
      actual: { out: 0 },
      tick: 0,
      reason: 'mismatch',
    };
    useChecker('contradiction', () => ({ passed: true, failures: [record], ticksUsed: 0 }));
    const outcome = runChecks(andCircuit(), registry, customSpec('contradiction'));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toContainEqual(record);
  });

  it('synthesizes a failure for a checker that reports failure without a record', () => {
    useChecker('silent', () => ({ passed: false, failures: [], ticksUsed: 0 }));
    const outcome = runChecks(andCircuit(), registry, customSpec('silent'));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('without a failure record');
  });

  it.each([...FAILURE_REASONS])('adopts a failure record whose reason is %s', (reason) => {
    // The list validation uses is derived from the type, so every reason the
    // type declares has to be a legal thing for a checker to say. A reason
    // added to the union but not to the array would otherwise be rejected as
    // "malformed" the moment a checker used it.
    const id = `reason-${reason}`;
    const record: CheckFailure = {
      check: 'custom',
      inputs: { a: 1, b: 2 },
      expected: { out: 3 },
      actual: { out: 0 },
      tick: 0,
      reason,
    };
    useChecker(id, () => ({ passed: false, failures: [record], ticksUsed: 0 }));
    const outcome = runChecks(andCircuit(), registry, customSpec(id));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toEqual([record]);
  });

  it.each(['passed', 'failures', 'ticksUsed'] as const)(
    'records a failure when an outcome accessor for %s throws',
    (field) => {
      // A hostile outcome is level-adjacent code: reading it is exactly as
      // untrusted as calling the checker, so the throw has to become a failure
      // rather than escape `runChecks` (the outer catch rethrows anything that
      // is not a kernel error, and the board edits on every keystroke).
      const id = `hostile-${field}`;
      useChecker(id, () => {
        const outcome = { passed: true, failures: [], ticksUsed: 0 } as Record<string, unknown>;
        Object.defineProperty(outcome, field, {
          get() {
            throw new TypeError(`${field} accessor exploded`);
          },
        });
        return outcome as unknown as CheckOutcome;
      });
      const spec = customSpec(id);
      expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
      const outcome = runChecks(andCircuit(), registry, spec);
      expect(outcome.passed).toBe(false);
      expect(outcome.failures[0]?.reason).toBe('invalid');
      expect(outcome.failures[0]?.detail).toContain('accessor exploded');
      expect(() => grade(andCircuit(), registry, spec)).not.toThrow();
    },
  );

  it('runs truth-table, fuzz and custom checks in one spec', () => {
    useChecker('sweep-and', sweepAnd);
    const spec = withChecks(andLevel, [
      {
        kind: 'truth-table',
        rows: [
          { inputs: { a: 0x0f, b: 0x33 }, outputs: { out: 0x0f & 0x33 } },
          { inputs: { a: 0xff, b: 0xff }, outputs: { out: 0xff } },
        ],
      },
      {
        kind: 'fuzz',
        seed: 99,
        rounds: 32,
        inputs: { a: (sample) => sample.a ?? 0, b: (sample) => sample.b ?? 0 },
        outputs: { out: (v) => (v.a ?? 0) & (v.b ?? 0) },
      },
      { kind: 'custom', id: 'sweep-and' },
    ]);
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.failures).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(grade(andCircuit(), registry, spec).passed).toBe(true);
  });

  it('fails loudly on a check kind this kernel does not know', () => {
    // Level data is untrusted, and the dispatch used to fall through to the
    // script branch: an unknown kind reached `check.steps` and threw out of
    // `runChecks`. It has to be a recorded failure instead.
    const bogus = { kind: 'mystery' } as unknown as LevelCheck;
    const outcome = runChecks(andCircuit(), registry, withChecks(andLevel, [bogus]));
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('mystery');
  });
});

// ---------------------------------------------------------------------------
// spec.checks is level data too
// ---------------------------------------------------------------------------

describe('runChecks / unreadable check entries', () => {
  // `spec.checks` is typed, but level data reaches the kernel untyped: an entry
  // that is `null` (or that carries no string `kind`) has to become a recorded
  // failure. Reading `check.kind` for it used to throw a `TypeError` out of
  // `runChecks` -- straight into the board-edit path.
  it.each<[string, unknown, string]>([
    ['a null entry', null, 'is null'],
    ['an undefined entry', undefined, 'is undefined'],
    ['a number', 42, 'is 42'],
    ['a string', 'truth-table', 'is "truth-table"'],
    ['an entry whose kind is not a string', { kind: 7 }, 'kind=7'],
  ])('records a failure for %s instead of throwing', (_label, entry, fragment) => {
    const spec = withChecks(andLevel, [entry as LevelCheck]);
    expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain(fragment);
    expect(() => grade(andCircuit(), registry, spec)).not.toThrow();
    expect(grade(andCircuit(), registry, spec).passed).toBe(false);
  });

  it('guards the element before the no-circuit failure, which reads its kind too', () => {
    // The `'error' in created` push runs when the circuit cannot be bound (here
    // a pin whose compiled width disagrees with the level's) and it sits
    // outside the loop's `try`: it reads `check.kind` as well, so the element
    // guard has to come before it, not just before the dispatch.
    const spec = withChecks(
      {
        ...andLevel,
        io: {
          inputs: [
            { id: 'a', width: 4 },
            { id: 'b', width: 8 },
          ],
          outputs: AND_IO.outputs,
        },
      },
      [null as unknown as LevelCheck],
    );
    expect(() => runChecks(andCircuit(), registry, spec)).not.toThrow();
    const outcome = runChecks(andCircuit(), registry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.reason).toBe('invalid');
    expect(outcome.failures[0]?.detail).toContain('is null');
  });
});
