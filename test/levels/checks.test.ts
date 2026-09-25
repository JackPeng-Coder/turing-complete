import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry, type ComponentDef } from '../../src/core/registry';
import type { LevelSpec } from '../../src/levels/spec';
import { generateRows, countTicksUsed, runChecks } from '../../src/levels/checks';

const registry = createRegistry(BASE_DEFS);

/** The truth table for AND. Level data is explicit; nothing is inferred. */
const AND_ROWS = [
  { inputs: { a: 0, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 0, b: 1 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 0 }, outputs: { out: 0 } },
  { inputs: { a: 1, b: 1 }, outputs: { out: 1 } },
] as const;

const andSpec: LevelSpec = {
  id: 'test-and',
  chapter: 1,
  index: 1,
  name: { zh: '测试与门', en: 'Test AND' },
  brief: { zh: '', en: '' },
  hint: { zh: '', en: '' },
  allowedComponents: ['nand', 'not', 'level_input', 'level_output'],
  io: {
    inputs: [
      { id: 'a', width: 1 },
      { id: 'b', width: 1 },
    ],
    outputs: [{ id: 'out', width: 1 }],
  },
  checks: [{ kind: 'truth-table', rows: AND_ROWS }],
};

/**
 * AND built from NAND + NOT, with explicit level input/output connectors.
 *
 * The connector instance ids must be `IN_<pinId>` with the pin id EXACTLY as the
 * level declares it -- `IN_a` for pin `a`, not `IN_A`. Pin names come from the
 * component def (`level_input.out`), so the id is the only thing that can carry
 * the binding, and Task 8's `build()` fixture generates `IN_${name}` the same
 * way.
 */
function andSolution(): Graph {
  const g = emptyGraph();
  const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
  const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
  const nand = addInstance(g, 'nand', 60, 20);
  const not = addInstance(g, 'not', 120, 20);
  const out = addInstance(g, 'level_output', 180, 20, 'OUT');
  connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
  connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
  connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
  return g;
}

describe('runChecks / truth-table', () => {
  it('fails an empty circuit without throwing', () => {
    const outcome = runChecks(emptyGraph(), registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('fails a circuit with an unstable feedback loop without throwing', () => {
    // Two cross-coupled NANDs with BOTH free inputs tied high, so each acts as
    // an inverter and the loop has no stable state. Note the trap the original
    // draft fell into: cross-coupled NANDs with the free inputs left UNWIRED
    // are a STABLE fixed point (nand(x, 0) === 1 for every x) -- that is a
    // perfectly good SR latch, not an unstable circuit. Tying them high is what
    // makes it oscillate.
    const g = emptyGraph();
    const one = addInstance(g, 'const_on', 0, 0);
    const n1 = addInstance(g, 'nand', 0, 40);
    const n2 = addInstance(g, 'nand', 0, 80);
    connect(g, { inst: one.id, port: 'out' }, { inst: n1.id, port: 'b' });
    connect(g, { inst: one.id, port: 'out' }, { inst: n2.id, port: 'b' });
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    expect(() => runChecks(g, registry, andSpec)).not.toThrow();
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'unstable')).toBe(true);
  });

  it('refuses a truth-table check that declares no rows', () => {
    const outcome = runChecks(andSolution(), registry, {
      ...andSpec,
      checks: [{ kind: 'truth-table' }],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'missing-rows')).toBe(true);
  });

  it('refuses a truth-table row that declares no output to compare', () => {
    // A row that compares nothing is the same hazard as a check with no rows:
    // without the guard, this correct AND solution would "pass" a check that
    // asserts nothing at all.
    const outcome = runChecks(andSolution(), registry, {
      ...andSpec,
      checks: [{ kind: 'truth-table', rows: [{ inputs: { a: 0, b: 0 }, outputs: {} }] }],
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'missing-rows')).toBe(true);
  });

  it('reports an unbuildable circuit as a failed outcome instead of throwing', () => {
    // An unknown def is an error-severity issue, so `compile` throws a
    // `CircuitValidationError` -- which must surface as a failed check, because
    // `grade()` checks a half-edited circuit on every keystroke.
    const g = emptyGraph();
    addInstance(g, 'level_input', 0, 0, 'IN_a');
    addInstance(g, 'no-such-component', 60, 0);
    expect(() => runChecks(g, registry, andSpec)).not.toThrow();
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]!.reason).toBe('invalid');
  });
});

describe('runChecks / malformed level data', () => {
  // Level data is authored by hand and `grade()` runs on every board edit, so a
  // bad number in a level row must degrade to a failed check -- never a throw.
  // Before this guard, `{ a: 2 }` on a 1-bit pin travelled through
  // `bindLevelIo.writeInput` into `Simulation.write` -> `assertWidth`, which
  // raised a `RangeError` straight out of the grading path.
  const rowWithInput = (a: number): LevelSpec => ({
    ...andSpec,
    checks: [{ kind: 'truth-table', rows: [{ inputs: { a, b: 1 }, outputs: { out: 1 } }] }],
  });

  it.each([2, 0.5, -1, Number.NaN])(
    'rejects an unpinnable authored input value (%s) instead of throwing',
    (a) => {
      const spec = rowWithInput(a);
      expect(() => runChecks(andSolution(), registry, spec)).not.toThrow();
      const outcome = runChecks(andSolution(), registry, spec);
      // Rejected, not clamped: the write is skipped, the pin keeps its zero
      // default, so the AND with b=1 reads 0 and the row is a plain mismatch.
      expect(outcome.passed).toBe(false);
      expect(outcome.failures[0]!.reason).toBe('mismatch');
      expect(outcome.failures[0]!.actual).toEqual({ out: 0 });
    },
  );

  it('classifies a RangeError raised inside a check as an invalid failure', () => {
    // Injection, not a shipped component: with `writeInput` guarded, no authored
    // value can reach `assertWidth` any more, so this pins the catch clause that
    // absorbs any FUTURE in-check `RangeError` as a failed check rather than
    // letting it escape `runChecks`.
    const boom: ComponentDef = {
      id: 'boom',
      name: { zh: '注入错误', en: 'Injected RangeError' },
      category: 'logic1',
      inputs: [{ id: 'a', width: 1 }],
      outputs: [{ id: 'out', width: 1 }],
      cost: 1,
      sequential: false,
      stateBytes: 0,
      evaluate: () => {
        throw new RangeError('injected: value 2 does not fit a 1-bit port width');
      },
    };
    const boomRegistry = createRegistry([...BASE_DEFS, boom]);
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const bomb = addInstance(g, 'boom', 60, 0);
    const out = addInstance(g, 'level_output', 120, 0, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: bomb.id, port: 'a' });
    connect(g, { inst: bomb.id, port: 'out' }, { inst: out.id, port: 'in' });
    const spec: LevelSpec = {
      ...andSpec,
      io: { inputs: [{ id: 'a', width: 1 }], outputs: [{ id: 'out', width: 1 }] },
      checks: [{ kind: 'truth-table', rows: [{ inputs: { a: 0 }, outputs: { out: 0 } }] }],
    };
    expect(() => runChecks(g, boomRegistry, spec)).not.toThrow();
    const outcome = runChecks(g, boomRegistry, spec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.some((f) => f.reason === 'invalid')).toBe(true);
  });
});

describe('truth-table discrimination', () => {
  it('passes the or-of-nands-with-inverters solution (NOR-as-AND is wrong, AND is right)', () => {
    expect(runChecks(andSolution(), registry, andSpec).passed).toBe(true);
  });

  it('rejects a NAND that is missing the final inverter', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const nand = addInstance(g, 'nand', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, andSpec);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]!.reason).toBe('mismatch');
    expect(outcome.failures[0]!.inputs).toEqual({ a: 0, b: 0 });
    expect(outcome.failures[0]!.expected).toEqual({ out: 0 });
    expect(outcome.failures[0]!.actual).toEqual({ out: 1 });
  });

  it('rejects a circuit whose level output is never wired', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const nand = addInstance(g, 'nand', 60, 20);
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    // no level_output instance at all: every row reads 0, which is wrong for a=0,b=0
    expect(runChecks(g, registry, andSpec).passed).toBe(false);
  });
});

describe('generateRows', () => {
  it('generates a complete table that the same circuits pass and fail against', () => {
    const rows = generateRows(andSpec, ({ a, b }) => (a && b ? 1 : 0));
    const generated: LevelSpec = { ...andSpec, checks: [{ kind: 'truth-table', rows }] };
    expect(rows).toHaveLength(4);
    expect(runChecks(andSolution(), registry, generated).passed).toBe(true);

    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const nand = addInstance(g, 'nand', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, generated).passed).toBe(false);
  });
});

describe('multi-output binding', () => {
  // Task 9's level 12 has four 1-bit outputs wired to connectors named
  // `OUT_out3` .. `OUT_out0`, so the `OUT_<pinId>` half of the convention is
  // load-bearing: with a single hard-coded `OUT` lookup there would be no way
  // to tell four outputs apart.
  const halfAdder: LevelSpec = {
    ...andSpec,
    id: 'test-half-adder',
    io: {
      inputs: [
        { id: 'a', width: 1 },
        { id: 'b', width: 1 },
      ],
      outputs: [
        { id: 'sum', width: 1 },
        { id: 'carry', width: 1 },
      ],
    },
    checks: [
      {
        kind: 'truth-table',
        rows: [
          { inputs: { a: 0, b: 0 }, outputs: { sum: 0, carry: 0 } },
          { inputs: { a: 0, b: 1 }, outputs: { sum: 1, carry: 0 } },
          { inputs: { a: 1, b: 0 }, outputs: { sum: 1, carry: 0 } },
          { inputs: { a: 1, b: 1 }, outputs: { sum: 0, carry: 1 } },
        ],
      },
    ],
  };

  it('binds one OUT_<pinId> connector per output pin', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const xor = addInstance(g, 'xor', 60, 20);
    const and = addInstance(g, 'and', 60, 80);
    const sum = addInstance(g, 'level_output', 160, 20, 'OUT_sum');
    const carry = addInstance(g, 'level_output', 160, 80, 'OUT_carry');
    connect(g, { inst: inA.id, port: 'out' }, { inst: xor.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: xor.id, port: 'b' });
    connect(g, { inst: inA.id, port: 'out' }, { inst: and.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: and.id, port: 'b' });
    connect(g, { inst: xor.id, port: 'out' }, { inst: sum.id, port: 'in' });
    connect(g, { inst: and.id, port: 'out' }, { inst: carry.id, port: 'in' });
    expect(runChecks(g, registry, halfAdder).passed).toBe(true);
  });

  it('rejects a half adder whose carry output is left unwired', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const xor = addInstance(g, 'xor', 60, 20);
    const and = addInstance(g, 'and', 60, 80);
    const sum = addInstance(g, 'level_output', 160, 20, 'OUT_sum');
    const carry = addInstance(g, 'level_output', 160, 80, 'OUT_carry');
    connect(g, { inst: inA.id, port: 'out' }, { inst: xor.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: xor.id, port: 'b' });
    connect(g, { inst: inA.id, port: 'out' }, { inst: and.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: and.id, port: 'b' });
    connect(g, { inst: xor.id, port: 'out' }, { inst: sum.id, port: 'in' });
    // OUT_carry exists but nothing drives it: the carry pin reads 0 forever
    expect(runChecks(g, registry, halfAdder).passed).toBe(false);
  });
});

describe('script check', () => {
  const secondTick: LevelSpec = {
    ...andSpec,
    id: 'test-second-tick',
    io: { inputs: [], outputs: [{ id: 'out', width: 1 }] },
    checks: [{ kind: 'script', steps: [{ tick: 2, expect: { out: 1 } }] }],
  };

  it('passes const_on through a delay line', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const d = addInstance(g, 'delay_line', 60, 0);
    const out = addInstance(g, 'level_output', 120, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: d.id, port: 'in' });
    connect(g, { inst: d.id, port: 'out' }, { inst: out.id, port: 'in' });
    const outcome = runChecks(g, registry, secondTick);
    expect(outcome.passed).toBe(true);
    expect(outcome.ticksUsed).toBe(2);
    expect(countTicksUsed(g, registry, secondTick)).toBe(2);
  });

  it('rejects a bare const_on because it is high from tick 0', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const out = addInstance(g, 'level_output', 60, 0, 'OUT');
    connect(g, { inst: src.id, port: 'out' }, { inst: out.id, port: 'in' });
    // expected high at tick 2, but a plain constant is also high at tick 0 --
    // this level additionally requires the output to be LOW at tick 0
    const strict: LevelSpec = {
      ...secondTick,
      checks: [
        {
          kind: 'script',
          steps: [
            { tick: 0, expect: { out: 0 } },
            { tick: 2, expect: { out: 1 } },
          ],
        },
      ],
    };
    expect(runChecks(g, registry, strict).passed).toBe(false);
  });
});

describe('constraint check', () => {
  const parity: LevelSpec = {
    ...andSpec,
    id: 'test-constraint',
    io: {
      inputs: [
        { id: 'a', width: 1 },
        { id: 'b', width: 1 },
      ],
      outputs: [{ id: 'out', width: 1 }],
    },
    checks: [
      { kind: 'constraint', rule: { kind: 'sum-equals', inputs: ['a', 'b'], output: 'out' } },
    ],
  };

  it('accepts a half adder sum built from XOR', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const xor = addInstance(g, 'xor', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: xor.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: xor.id, port: 'b' });
    connect(g, { inst: xor.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(true);
  });

  it('rejects OR where parity is required', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_b');
    const or = addInstance(g, 'or', 60, 20);
    const out = addInstance(g, 'level_output', 120, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: or.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: or.id, port: 'b' });
    connect(g, { inst: or.id, port: 'out' }, { inst: out.id, port: 'in' });
    expect(runChecks(g, registry, parity).passed).toBe(false);
  });
});
