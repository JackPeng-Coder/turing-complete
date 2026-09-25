import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import { WIDE_DEF_IDS, WIDE_STORAGE_DEF_IDS } from '../../src/core/defs/wide';
import { extractField, insertField, packBits, unpackBits } from '../../src/core/fields';

// `evaluate(inputs, outputs, state, ctx)`: `state` is the instance's private
// storage, placed third. Only storage elements read it -- every combinational
// def ignores it, so its call sites pass `undefined` (the parameter cannot be
// omitted: `state: Uint8Array | undefined` is required, which is what forces a
// storage def to say out loud that it has no state to read).

describe('registry', () => {
  it('registers every base def and can look them up', () => {
    const r = createRegistry(BASE_DEFS);
    expect(r.size).toBe(BASE_DEFS.length);
    for (const id of DEF_IDS) expect(r.has(id)).toBe(true);
    expect(r.get('nand').name.zh).toBe('与非门');
  });

  it('throws on unknown component ids', () => {
    const r = createRegistry(BASE_DEFS);
    expect(() => r.get('does-not-exist')).toThrow(/unknown component/i);
  });

  it('rejects duplicate ids', () => {
    const r = createRegistry([]);
    r.register(BASE_DEFS[0]!);
    expect(() => r.register(BASE_DEFS[0]!)).toThrow(/duplicate/i);
  });

  it('filters by category', () => {
    const r = createRegistry(BASE_DEFS);
    const logic = r.byCategory('logic1').map((d) => d.id);
    expect(logic).toContain('nand');
    expect(logic).toContain('xor');
    expect(logic).not.toContain('const_on');
  });
});

describe('base defs', () => {
  const r = createRegistry(BASE_DEFS);

  it('marks exactly the storage elements as sequential', () => {
    const sequential = r.all().filter((d) => d.sequential).map((d) => d.id);
    // Phase 0's two one-bit memories plus task 4's eight-bit half; `mux8` is
    // combinational and is deliberately absent.
    expect(sequential.sort()).toEqual([
      'counter8',
      'delay8',
      'delay_line',
      'mem1',
      'ram8',
      'reg8',
    ]);
  });

  it('hides the level IO plumbing from the palette but keeps it registered', () => {
    const plumbing = r.all().filter((d) => d.category === 'level');
    expect(plumbing.map((d) => d.id).sort()).toEqual(['level_input', 'level_output']);
    expect(plumbing.every((d) => d.hidden === true)).toBe(true);
    expect(r.get('level_input').cost).toBe(0);
    expect(r.get('level_output').cost).toBe(0);
  });

  it('gives every def at least one output and no duplicate pin ids', () => {
    for (const d of r.all()) {
      expect(d.outputs.length, d.id).toBeGreaterThan(0);
      const ids = [...d.inputs, ...d.outputs].map((p) => p.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
    }
  });

  it('marks sources as zero cost and gates as one', () => {
    expect(r.get('const_on').cost).toBe(0);
    expect(r.get('const_off').cost).toBe(0);
    for (const id of ['nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor', 'and3', 'or3']) {
      expect(r.get(id).cost, id).toBe(1);
    }
  });

  it('prices every 1-bit gate on the NAND-equivalent basis, explicitly', () => {
    // `gateCost` is the NAND-equivalent GATE unit (spec §5.4), NOT the delay
    // unit: NAND 1, NOT 1, AND 2, OR 3, NOR 4, XOR 4, XNOR 5, AND3 4, OR3 6, with
    // each cell's construction written out in `defs/index.ts`. Every gate states
    // the field, so no count here is inherited from `cost` -- inheriting it is
    // what made an `and` worth 1 while one bit of `and8` was worth 2.
    const NAND_EQUIVALENTS: Record<string, number> = {
      nand: 1,
      not: 1,
      and: 2,
      or: 3,
      nor: 4,
      xor: 4,
      xnor: 5,
      and3: 4,
      or3: 6,
    };
    for (const [id, want] of Object.entries(NAND_EQUIVALENTS)) {
      expect(r.get(id).gateCost, id).toBe(want);
    }
    // These nine ARE the `logic1` family, so a tenth gate added without a count
    // cannot slip past the loop above.
    expect(r.byCategory('logic1').map((d) => d.id).sort()).toEqual(
      Object.keys(NAND_EQUIVALENTS).sort(),
    );
  });

  it('leaves gateCost to the `?? cost` fallback only where both metrics are zero', () => {
    // The fallback still has a job: a rail, level plumbing, a wire and the
    // storage elements are zero gates AND zero delay, so a second explicit 0
    // would only give the two zeroes a way to drift apart. Every part that is
    // worth a gate states its own count instead.
    const wide = new Set<string>([...WIDE_DEF_IDS, ...WIDE_STORAGE_DEF_IDS]);
    for (const d of r.all()) {
      if (wide.has(d.id) || d.category === 'logic1') continue;
      expect(d.cost, `${d.id} leans on the fallback but is not free`).toBe(0);
      expect(d.gateCost, d.id).toBeUndefined();
    }
  });

  it('evaluates NAND', () => {
    const def = r.get('nand');
    for (const [a, b, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      const out: (number | Uint8Array)[] = [0];
      def.evaluate!([a, b], out, undefined, { tick: 0 });
      expect(out[0], `nand(${a},${b})`).toBe(want);
    }
  });

  it('evaluates the 3-input gates', () => {
    const and3 = r.get('and3');
    const or3 = r.get('or3');
    const o1: (number | Uint8Array)[] = [0];
    and3.evaluate!([1, 1, 1], o1, undefined, { tick: 0 });
    expect(o1[0]).toBe(1);
    and3.evaluate!([1, 0, 1], o1, undefined, { tick: 0 });
    expect(o1[0]).toBe(0);
    or3.evaluate!([0, 0, 1], o1, undefined, { tick: 0 });
    expect(o1[0]).toBe(1);
    or3.evaluate!([0, 0, 0], o1, undefined, { tick: 0 });
    expect(o1[0]).toBe(0);
  });

  it('evaluates XOR and XNOR', () => {
    const xor = r.get('xor');
    const xnor = r.get('xnor');
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      const ox: (number | Uint8Array)[] = [0];
      xor.evaluate!([a, b], ox, undefined, { tick: 0 });
      expect(ox[0], `xor(${a},${b})`).toBe(a ^ b);
      const on: (number | Uint8Array)[] = [0];
      xnor.evaluate!([a, b], on, undefined, { tick: 0 });
      expect(on[0], `xnor(${a},${b})`).toBe(a ^ b ? 0 : 1);
    }
  });

  it('propagates undefined inputs as zero', () => {
    const nand = r.get('nand');
    const out: (number | Uint8Array)[] = [0];
    nand.evaluate!([0, undefined as unknown as number], out, undefined, { tick: 0 });
    expect(out[0]).toBe(1);
  });

  // The two tests below pin the storage contract: `evaluate` PUBLISHES the held
  // value and ignores its inputs; `clockEdge` SAMPLES inputs into state only and
  // never writes outputs. Every `evaluate` input below is deliberately the
  // opposite of the held value, so a def that mirrors its input fails them.
  it('delay_line holds its value: evaluate publishes state and ignores its input', () => {
    const def = r.get('delay_line');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    out[0] = 0;
    def.clockEdge!([1], out, state, { tick: 0 });
    expect(state[0]).toBe(1);
    expect(out[0]).toBe(0); // output still holds the pre-edge value
    // The input is 0, the OPPOSITE of the held 1: publishing is all `evaluate`
    // may do here, so a mirroring implementation would drop the output to 0.
    def.evaluate!([0], out, state, { tick: 0 });
    expect(out[0]).toBe(1);
    // The next edge samples the low input; only then does the output follow.
    def.clockEdge!([0], out, state, { tick: 1 });
    expect(state[0]).toBe(0);
    def.evaluate!([1], out, state, { tick: 1 });
    expect(out[0]).toBe(0);
  });

  it('mem1 publishes its latched bit and ignores its inputs', () => {
    const def = r.get('mem1');
    const state = new Uint8Array(def.stateBytes);
    const out: (number | Uint8Array)[] = [0];
    // inputs: [set, value]
    def.clockEdge!([0, 1], out, state, { tick: 0 });
    expect(state[0]).toBe(0); // `set` low: nothing is written
    def.clockEdge!([1, 1], out, state, { tick: 1 });
    expect(state[0]).toBe(1); // the write is latched into state
    expect(out[0]).toBe(0); // and `clockEdge` must not touch the outputs
    // All inputs are zero here: a real memory still publishes the latched 1.
    def.evaluate!([0, 0], out, state, { tick: 1 });
    expect(out[0]).toBe(1);
  });
});

// Beyond the brief: guards the task's global constraints (1-bit pins on the
// phase-0 parts, the cost rules, the publish rule) and the truth tables the
// brief only checks for cost.
describe('base defs: extra coverage', () => {
  const r = createRegistry(BASE_DEFS);
  const evalTo = (id: string, inputs: number[]): number | Uint8Array | undefined => {
    const out: (number | Uint8Array)[] = [0];
    r.get(id).evaluate!(inputs, out, undefined, { tick: 0 });
    return out[0];
  };

  it('declares 1-bit pins on every def outside the wide family', () => {
    // Phase 0 shipped only 1-bit parts, and every def it shipped still is one.
    // The wide family -- task 3's operators and task 4's storage parts -- is
    // where a pin wider than one bit appears, and `defs-wide.test.ts` pins its
    // exact pin widths against each task brief's table, a stronger statement
    // than this loop makes; those defs are excluded here rather than weakening
    // this invariant to "some pins".
    const wide = new Set<string>([...WIDE_DEF_IDS, ...WIDE_STORAGE_DEF_IDS]);
    for (const d of r.all()) {
      if (wide.has(d.id)) continue;
      for (const p of [...d.inputs, ...d.outputs]) {
        expect(p.width, `${d.id}.${p.id}`).toBe(1);
      }
    }
    expect(r.byCategory('wide').length).toBeGreaterThan(0);
  });

  it('gives every def a publisher, and sizes storage honestly', () => {
    // The kernel's publish pass calls `evaluate` and knows no state layout of
    // its own (see `Simulation.#publishState`), so a def with state and no
    // `evaluate` could never publish what it holds -- `compile` refuses one
    // rather than letting it hold zero in silence. This is the catalog half of
    // that rule.
    for (const d of r.all()) {
      expect(typeof d.evaluate, d.id).toBe('function');
      expect(typeof d.clockEdge, d.id).toBe(d.sequential ? 'function' : 'undefined');
      // A combinational def holds nothing; a storage def holds something, and
      // enough of it to publish every bit of its output pins. The exact numbers
      // are pinned per def in `defs-wide.test.ts`; this is the rule they obey,
      // and it replaces phase 0's "one state byte per output pin", which a
      // 256-byte `ram8` cannot satisfy and an 8-bit register should not need.
      expect(d.stateBytes > 0, d.id).toBe(d.sequential);
      if (d.sequential) {
        const outputBits = d.outputs.reduce((bits, pin) => bits + pin.width, 0);
        expect(d.stateBytes * 8, d.id).toBeGreaterThanOrEqual(outputBits);
      }
    }
    // ...but the inequality above is the WIDE rule, loosened for a 256-byte
    // `ram8`, and it must not cost phase 0 its exactness: the two 1-bit memories
    // hold exactly one state byte each, one bit per output pin, which is the
    // layout their `evaluate` publishes and the reason they need no more. Pinned
    // by def id rather than by category -- `memory1` is a palette-grouping
    // question and these two are the phase-0 contract.
    for (const id of ['delay_line', 'mem1']) {
      expect(r.get(id).stateBytes, id).toBe(1);
      expect(r.get(id).outputs.length, id).toBe(1);
    }
  });

  it('matches an independently written truth table for every gate', () => {
    const one = (v: boolean): number => (v ? 1 : 0);
    const predicates: Record<string, (b: readonly number[]) => number> = {
      nand: (b) => one(!(b[0] === 1 && b[1] === 1)),
      not: (b) => one(b[0] !== 1),
      and: (b) => one(b[0] === 1 && b[1] === 1),
      or: (b) => one(b[0] === 1 || b[1] === 1),
      nor: (b) => one(b[0] !== 1 && b[1] !== 1),
      xor: (b) => one((b[0] === 1) !== (b[1] === 1)),
      xnor: (b) => one((b[0] === 1) === (b[1] === 1)),
      and3: (b) => one(b[0] === 1 && b[1] === 1 && b[2] === 1),
      or3: (b) => one(b[0] === 1 || b[1] === 1 || b[2] === 1),
    };
    for (const [id, predicate] of Object.entries(predicates)) {
      const def = r.get(id);
      const pins = def.inputs.length;
      for (let pattern = 0; pattern < 1 << pins; pattern += 1) {
        const bits = Array.from({ length: pins }, (_, i) => (pattern >>> i) & 1);
        expect(evalTo(id, bits), `${id}(${bits.join(',')})`).toBe(predicate(bits));
      }
    }
  });

  it('drives the constants and mirrors level IO', () => {
    expect(evalTo('const_on', [])).toBe(1);
    expect(evalTo('const_off', [])).toBe(0);
    expect(evalTo('level_output', [1])).toBe(1);
    expect(evalTo('level_output', [0])).toBe(0);
  });

  it('keeps a stored bit through a no-write edge and samples a zero', () => {
    const line = r.get('delay_line');
    const lineState = new Uint8Array(line.stateBytes);
    const lineOut: (number | Uint8Array)[] = [0];
    line.clockEdge!([0], lineOut, lineState, { tick: 0 });
    expect(lineState[0]).toBe(0);

    const mem = r.get('mem1');
    const memState = new Uint8Array(mem.stateBytes);
    const memOut: (number | Uint8Array)[] = [0];
    mem.clockEdge!([1, 1], memOut, memState, { tick: 0 });
    mem.clockEdge!([1, 0], memOut, memState, { tick: 1 });
    expect(memState[0]).toBe(0);
    mem.clockEdge!([0, 1], memOut, memState, { tick: 2 });
    expect(memState[0]).toBe(0); // `set` low: the value pin is ignored
  });
});

describe('fields', () => {
  it('packs bit arrays low-bit-first', () => {
    expect(packBits([1, 0, 1])).toBe(0b101);
    expect(packBits([])).toBe(0);
    expect(packBits([1, 1, 1, 1, 1, 1, 1, 1])).toBe(255);
  });

  it('unpacks to bit arrays', () => {
    expect(unpackBits(0b101, 3)).toEqual([1, 0, 1]);
    expect(unpackBits(0, 2)).toEqual([0, 0]);
  });

  it('extracts and inserts fields', () => {
    const instr = 0b11_000101; // opcode 0b11, arg 5
    expect(extractField(instr, 0, 6)).toBe(5);
    expect(extractField(instr, 6, 2)).toBe(3);
    const withNewArg = insertField(instr, 0, 6, 63);
    expect(extractField(withNewArg, 0, 6)).toBe(63);
    expect(extractField(withNewArg, 6, 2)).toBe(3);
  });

  it('rejects out-of-range inserts', () => {
    expect(() => insertField(0, 0, 2, 4)).toThrow(/range/i);
  });

  it('round-trips fields in the high bits without sign leakage', () => {
    const packed = insertField(0, 24, 8, 0xff);
    expect(packed).toBe(0xff00_0000);
    expect(extractField(packed, 24, 8)).toBe(0xff);
    expect(extractField(packed, 0, 24)).toBe(0);
    expect(insertField(0xffff_ffff, 0, 32, 0)).toBe(0);
  });
});
