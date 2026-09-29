import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import { CPU_DEF_IDS } from '../../src/core/defs/cpu';
import {
  DECODER_DEFS,
  DECODER_DEF_IDS,
  DECODER_MAX_WIDTH,
  DECODER_WIDTHS,
  WIDE_DEF_IDS,
  WIDE_STORAGE_DEF_IDS,
  createDecoderDef,
  createWideDefs,
} from '../../src/core/defs/wide';
import { extractField, insertField, packBits, unpackBits } from '../../src/core/fields';
import { LEVELS } from '../../src/levels/index';
import type { LevelSpec } from '../../src/levels/spec';

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
    // Phase 0's two one-bit memories, task 4's eight-bit half, and the CPU
    // family's three holders (`defs/cpu.ts`: the register file, the program
    // counter and the program RAM). The combinational members of those families
    // -- `mux8`, `alu8`, `instr_decoder`, `halt` -- are deliberately absent, so
    // this stays the exact set rather than "at least these".
    expect(sequential.sort()).toEqual([
      'counter8',
      'delay8',
      'delay_line',
      'mem1',
      'pc8',
      'ram8',
      'ram_prog',
      'reg8',
      'regfile6',
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
      // The 9-NAND full-adder cell `wide.ts` prices `add8` with (8 x 9 = 72),
      // reused rather than restated: see the `FULL_ADDER` constant there.
      full_adder: 9,
    };
    for (const [id, want] of Object.entries(NAND_EQUIVALENTS)) {
      expect(r.get(id).gateCost, id).toBe(want);
    }
    // These ten ARE the `logic1` family, so an eleventh gate added without a
    // count cannot slip past the loop above.
    expect(r.byCategory('logic1').map((d) => d.id).sort()).toEqual(
      Object.keys(NAND_EQUIVALENTS).sort(),
    );
  });

  it('registers full_adder as a 1-bit gate on the same 9-NAND cell as add8', () => {
    // Level 20 rewards `full_adder` by name, so the id has to be spelled here
    // exactly as the level data spells it.
    expect([...DEF_IDS]).toContain('full_adder');
    const def = r.get('full_adder');
    // A 1-bit gate-level part, like `and3` / `or3` -- not an eight-bit operator.
    expect(def.category).toBe('logic1');
    // The DELAY unit, one per node: never the gate count.
    expect(def.cost).toBe(1);
    // The GATE metric: the standard 9-NAND cell (the construction is written out
    // in `defs/index.ts`, and `FULL_ADDER` in `wide.ts` is the same number
    // rather than a second literal). The identity below is the part that cannot
    // be satisfied by editing one number: an 8-bit ripple adder is eight of
    // these cells and nothing else.
    expect(def.gateCost).toBe(9);
    expect(r.get('add8').gateCost).toBe(8 * (def.gateCost ?? 0));
    expect(def.sequential).toBe(false);
    expect(def.stateBytes).toBe(0);
    // Pin ids and widths are the contract the level data and the palette
    // address, so they are pinned here as `id:width` pairs.
    expect(def.inputs.map((p) => `${p.id}:${p.width}`)).toEqual(['a:1', 'b:1', 'cin:1']);
    expect(def.outputs.map((p) => `${p.id}:${p.width}`)).toEqual(['sum:1', 'cout:1']);
    expect(def.name).toEqual({ zh: '全加器', en: 'Full Adder' });
  });

  it('leaves gateCost to the `?? cost` fallback only where both metrics are zero', () => {
    // The fallback still has a job: a rail, level plumbing, a wire and the
    // storage elements are zero gates AND zero delay, so a second explicit 0
    // would only give the two zeroes a way to drift apart. Every part that is
    // worth a gate states its own count instead.
    //
    // The decoder family joins the operators and the storage parts here because
    // it is a wide part too: one DELAY unit, and a gate count it states itself
    // (1 / 10 / 27), so the `?? cost` fallback would price a 3-bit decoder at 1.
    //
    // The CPU family joins them for the same reason and by its own declaration
    // (`CPU_DEF_IDS`, next to the defs in `defs/cpu.ts`): `alu8` and
    // `instr_decoder` are worth more than one NAND and `halt` states an explicit
    // 0, while the family's three storage defs really do lean on the fallback --
    // `regfile6`, `pc8` and `ram_prog` are free on both metrics. The set is
    // still built from the families' registration tuples, so a def in none of
    // them that states a count or a delay fails below.
    const statedCounts = new Set<string>([
      ...WIDE_DEF_IDS,
      ...WIDE_STORAGE_DEF_IDS,
      ...DECODER_DEF_IDS,
      ...CPU_DEF_IDS,
    ]);
    for (const d of r.all()) {
      if (statedCounts.has(d.id) || d.category === 'logic1') continue;
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

  it('evaluates the full adder over all eight input combinations', () => {
    const def = r.get('full_adder');
    // Written out rather than computed from the def, so the test states the
    // contract instead of agreeing with the implementation. The index is the
    // input vector with `a` as bit 0 (`a + 2b + 4cin`), the same convention the
    // one-output truth tables above use, and each row is `[sum, cout]`: `sum` is
    // the XOR of the three inputs, `cout` the majority. This is the cell level
    // 22 cascades eight of into a byte adder.
    const TABLE: readonly (readonly [number, number])[] = [
      [0, 0], // 000
      [1, 0], // a
      [1, 0], // b
      [0, 1], // a b
      [1, 0], // cin
      [0, 1], // a cin
      [0, 1], // b cin
      [1, 1], // a b cin
    ];
    for (let pattern = 0; pattern < 8; pattern += 1) {
      const bits = [pattern & 1, (pattern >> 1) & 1, (pattern >> 2) & 1];
      const out: (number | Uint8Array)[] = [0, 0];
      def.evaluate!(bits, out, undefined, { tick: 0 });
      expect([out[0], out[1]], `full_adder(${bits.join(',')})`).toEqual(TABLE[pattern]);
    }
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

  it('declares 1-bit pins on every def outside the wide and CPU families', () => {
    // Phase 0 shipped only 1-bit parts, and every def it shipped still is one.
    // The wide family -- task 3's operators, task 4's storage parts and task 10's
    // decoders -- is where a pin wider than one bit appears, and
    // `defs-wide.test.ts` pins the operators' and the storage family's exact pin
    // widths against each task brief's table, a stronger statement than this loop
    // makes; those defs are excluded here rather than weakening this invariant to
    // "some pins". `decoder1` is the sharpest case: its `out` is 2 bits wide by
    // contract (a 1-to-2 decoder's whole point), so it belongs to that exclusion
    // and is pinned by the decoder tests above.
    //
    // The CPU family is the second such exclusion, declared the same way -- by
    // its own id tuple in `defs/cpu.ts` -- because five of its six parts carry
    // wide pins by contract (`alu8`'s and `ram_prog`'s 8-bit pins,
    // `instr_decoder`'s 2/3/6-bit field pins, `regfile6`'s 3- and 8-bit pins) and
    // `test/core/defs-cpu.test.ts` pins their exact widths. `halt` is the family's
    // 1-bit member; it is excluded with the rest so that this loop keeps meaning
    // "every def in neither of the two described families", not "every def whose
    // author remembered this test".
    const wideAndCpu = new Set<string>([
      ...WIDE_DEF_IDS,
      ...WIDE_STORAGE_DEF_IDS,
      ...DECODER_DEF_IDS,
      ...CPU_DEF_IDS,
    ]);
    for (const d of r.all()) {
      if (wideAndCpu.has(d.id)) continue;
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

/**
 * The decoder family: `decoder1` and `decoder3` are the parts levels 25 and 26
 * reward, and `decoder2` is the same generator at width 2.
 *
 * ONE-HOT, NOT A NUMBER. A decoder turns an address into a one-of-N select line:
 * the value on `out` is `1 << sel` -- bit `sel` high and every other bit low --
 * and NOT `sel` itself. Level 26's own check states the same expectation
 * (`truthTable(IO_SEL3_OUT8, { out: ({ sel }) => 1 << (sel ?? 0) })`), and the
 * tables below are written out rather than computed from the def, so the level
 * and the part cannot agree by sharing one mistake. A decoder that published
 * `sel` would be a wire: it would pass `sel = 0` and `sel = 1` on both widths and
 * teach nothing.
 *
 * WHY THE IDS ARE PINNED HERE. `rewards.components` and `allowedComponents` are
 * `readonly string[]`, so the compiler cannot see a reward that names no def --
 * the defect class the walk at the bottom of this file covers. These tests are
 * the other half: the parts those two levels hand out behave like decoders.
 */
describe('the decoder family', () => {
  const r = createRegistry(BASE_DEFS);

  /** Runs a def the way `settle` does: one input, one output slot, no state. */
  const decode = (id: string, sel: number): number | Uint8Array | undefined => {
    const out: (number | Uint8Array)[] = [0];
    r.get(id).evaluate!([sel], out, undefined, { tick: 0 });
    return out[0];
  };

  it('decodes one select bit into a two-line one-hot vector', () => {
    // The index IS the select value: sel 0 lights bit 0 (out reads 1) and sel 1
    // lights bit 1 (out reads 2). Written out, so the table states the contract
    // instead of agreeing with the implementation.
    const TABLE: readonly number[] = [0b01, 0b10];
    for (let sel = 0; sel < TABLE.length; sel += 1) {
      expect(decode('decoder1', sel), `decoder1(sel=${sel})`).toBe(TABLE[sel]);
    }
    // The pass-through a decoder is not: `sel = 1` reads 2, never 1.
    expect(decode('decoder1', 1)).not.toBe(1);
  });

  it('decodes three select bits into eight one-hot lines', () => {
    const TABLE: readonly number[] = [
      0b0000_0001, // sel 0 -> bit 0
      0b0000_0010, // sel 1 -> bit 1
      0b0000_0100, // sel 2 -> bit 2
      0b0000_1000, // sel 3 -> bit 3
      0b0001_0000, // sel 4 -> bit 4
      0b0010_0000, // sel 5 -> bit 5
      0b0100_0000, // sel 6 -> bit 6
      0b1000_0000, // sel 7 -> bit 7
    ];
    /** Set bits in a byte: a one-hot vector has exactly one, whatever it decodes. */
    const ones = (value: number): number => {
      let count = 0;
      for (let bit = 0; bit < 8; bit += 1) count += (value >> bit) & 1;
      return count;
    };
    for (let sel = 0; sel < TABLE.length; sel += 1) {
      const got = decode('decoder3', sel);
      expect(got, `decoder3(sel=${sel})`).toBe(TABLE[sel]);
      // Every row is a one-hot vector -- eight outputs, exactly one high...
      expect(ones(Number(got)), `decoder3(sel=${sel}) is not one-hot`).toBe(1);
      // ...and from sel 2 up the high bit is not where the NUMBER `sel` would put
      // it, which is the only place the two readings differ: a def that published
      // `sel` (the "pass-through decoder" level 26's test file names) passes the
      // first two rows and fails every row below.
      if (sel >= 2) expect(got, `decoder3(sel=${sel}) published sel`).not.toBe(sel);
    }
  });

  it('registers every width as a wide, combinational, one-delay-unit part', () => {
    // The whole surface in one row per part: id, select width, output width and
    // NAND equivalents. `out` is a WIDE pin carrying a one-hot vector, which is
    // why these are `category: 'wide'`, and the three rows are the whole family
    // this phase registers -- `defs/index.ts` spreads `DECODER_DEF_IDS` rather
    // than assuming the operator generator's 8.
    const ROWS: readonly (readonly [string, number, number, number])[] = [
      ['decoder1', 1, 2, 1],
      ['decoder2', 2, 4, 10],
      ['decoder3', 3, 8, 27],
    ];
    for (const [id, selWidth, outWidth, gateCost] of ROWS) {
      expect([...DEF_IDS], id).toContain(id);
      expect(r.has(id), id).toBe(true);
      const def = r.get(id);
      expect(def.category, id).toBe('wide');
      // The DELAY unit, one per node -- never the gate count.
      expect(def.cost, id).toBe(1);
      expect(def.sequential, id).toBe(false);
      expect(def.stateBytes, id).toBe(0);
      expect(def.clockEdge, id).toBeUndefined();
      // Stated explicitly, not inherited from `cost`: the two fields exist
      // because a 27-NAND decoder is still one node of delay.
      expect(typeof def.gateCost, id).toBe('number');
      expect(def.gateCost, id).toBe(gateCost);
      expect(def.inputs.map((p) => `${p.id}:${p.width}`), id).toEqual([`sel:${selWidth}`]);
      expect(def.outputs.map((p) => `${p.id}:${p.width}`), id).toEqual([`out:${outWidth}`]);
      // A palette part, not plumbing: `ui/palette.ts` drops a hidden def even
      // when the level lists it, which is the silence this family ends.
      expect(def.hidden, id).toBeUndefined();
    }
    expect(r.get('decoder1').name).toEqual({ zh: '1 位解码器', en: '1-Bit Decoder' });
    expect(r.get('decoder3').name).toEqual({ zh: '3 位解码器', en: '3-Bit Decoder' });
  });

  it('prices the shared minterm tree, which is the number level 26 was measured at', () => {
    const gate = (id: string): number => r.get(id).gateCost ?? -1;
    // THE DERIVATION, written out at `decoderNand` in `wide.ts`: `w` inverters,
    // then one minterm layer of `2 ** j` AND gates per extra select bit, so the
    // layers total `2 ** (w + 1) - 4` ANDs. On the file's basis (NOT 1, AND 2):
    expect(gate('decoder1')).toBe(1 * 1 + 0 * 2);
    expect(gate('decoder2')).toBe(2 * 1 + 4 * 2);
    expect(gate('decoder3')).toBe(3 * 1 + 12 * 2);
    // The recurrence that table implies, so a single edited number cannot pass
    // while the construction it claims stops adding up: each extra select bit
    // adds its own inverter and doubles the last minterm layer.
    expect(gate('decoder2')).toBe(gate('decoder1') + 1 + 2 ** 2 * 2);
    expect(gate('decoder3')).toBe(gate('decoder2') + 1 + 2 ** 3 * 2);
    // THE CROSS-CHECK, and the reason these are the numbers rather than a
    // drawing invented here: level 25's reference solution is one `not` with the
    // `maker` free (1) and level 26's is the two-level tree (3 NOTs + 4 ANDs + 8
    // ANDs = 27). Both level targets are this tree's own arithmetic.
    expect(gate('decoder1')).toBe(1);
    expect(gate('decoder3')).toBe(27);
    // ...and neither is a single NAND, which is what `cost` alone would say.
    expect(gate('decoder3')).toBeGreaterThan(r.get('decoder3').cost);
  });

  it('is generated per width, the only knob that can give its two pins different sizes', () => {
    // `params.width` cannot do this job: the kernel resolves a pin's width as
    // `inst.params.width ?? pin.width` for EVERY pin of the instance (`net.ts`,
    // `effectiveWidth`), so an instance knob makes `sel` and `out` the same
    // width and cannot express `sel:3 -> out:8` at all. The pin count is a
    // parameter of the DEF, exactly as `createWideDefs(width)` builds the
    // splitter's pin list, and `decoder2` is that generator at width 2 rather
    // than a second hand-written part.
    expect(DECODER_WIDTHS).toEqual([1, 2, 3]);
    expect(DECODER_DEF_IDS).toEqual(['decoder1', 'decoder2', 'decoder3']);
    // The literal tuple and the generator cannot drift apart.
    expect(DECODER_WIDTHS.map((w) => `decoder${w}`)).toEqual([...DECODER_DEF_IDS]);
    expect(DECODER_DEFS.map((d) => d.id)).toEqual([...DECODER_DEF_IDS]);
    for (const def of DECODER_DEFS) expect([...DEF_IDS], def.id).toContain(def.id);

    // Every width the generator builds -- the registered three and the two above
    // them that no level names -- is the same one-hot decode, so the widths are
    // one definition rather than three implementations.
    for (let w = 1; w <= DECODER_MAX_WIDTH; w += 1) {
      const def = createDecoderDef(w);
      expect(def.id).toBe(`decoder${w}`);
      expect(def.inputs.map((p) => `${p.id}:${p.width}`)).toEqual([`sel:${w}`]);
      expect(def.outputs.map((p) => `${p.id}:${p.width}`)).toEqual([`out:${2 ** w}`]);
      const out: (number | Uint8Array)[] = [0];
      for (let sel = 0; sel < 2 ** w; sel += 1) {
        def.evaluate!([sel], out, undefined, { tick: 0 });
        expect(out[0], `decoder${w}(sel=${sel})`).toBe(2 ** sel);
      }
    }

    // A decoder's `out` pin is `2 ** w` bits, so the OPERATOR generator -- which
    // builds one width for every pin of every def it produces -- must never grow
    // one: its decoder would be a 256-bit port under an id (`decoder8`) that no
    // level data spells.
    expect(createWideDefs(8).map((d) => d.id).filter((id) => id.startsWith('decoder'))).toEqual(
      [],
    );
    // An out-of-range width is refused loudly rather than clamped into a part
    // with a different pin shape: `clampWidth` would answer a request for 6 with
    // 6, whose `out` pin is 64 bits -- wider than the `number` carrier the def
    // publishes.
    expect(() => createDecoderDef(0)).toThrow(/1\.\.5/);
    expect(() => createDecoderDef(DECODER_MAX_WIDTH + 1)).toThrow(/1\.\.5/);
    expect(() => createDecoderDef(1.5)).toThrow(/1\.\.5/);
  });
});

/**
 * The defect class this block guards: a level whose `rewards.components` names
 * an id that no def declares.
 *
 * WHY IT SURVIVED EVERYTHING ELSE. `rewards.components` is `readonly string[]`
 * (`levels/spec.ts`), not `readonly DefId[]`, so the compiler cannot see the
 * mistake; and a reward is only read when the player FINISHES the level
 * (`unlockedComponents`) or opens a palette that lists it (`paletteDefsFor`),
 * so a reward naming nothing is invisible for the whole of authoring, review and
 * every test that grades a level's reference solution. Level 20 was the live
 * case: it rewards `full_adder`, and no def in `src/` declared that id -- the
 * per-chapter tests spelled the reward as a string literal and agreed with
 * themselves.
 *
 * WHAT IS WALKED. The game's own level set, `LEVELS` -- which is every shipped
 * level, chapter 1 and chapter 2, in play order. `CH2_BATCH2` and `CH2_BATCH3`
 * used to be named here as separate "written-but-unjoined" arrays because level
 * 20 lives in the second (it rewards `full_adder`) and levels 25 and 26 in the
 * third (they reward `decoder1` / `decoder3`), and a walk that only covered
 * chapter 1 would have passed this test while those holes stood. They are joined
 * now -- `LEVELS` reaches all four batches through `content/index.ts` -- so naming
 * them again here would not widen the walk, it would only walk levels 18-27 two
 * more times. The anchors below are what keeps the walk honest instead.
 */
describe('shipped level rewards', () => {
  const r = createRegistry(BASE_DEFS);

  /** Every shipped level, in the game's own order. */
  const SHIPPED: readonly LevelSpec[] = LEVELS;

  it('names only registered defs in rewards.components', () => {
    const named = new Set<string>();
    const missing: string[] = [];
    for (const level of SHIPPED) {
      for (const def of level.rewards?.components ?? []) {
        named.add(def);
        if (!r.has(def)) missing.push(`${level.id} rewards ${def}`);
      }
    }
    // Every offender at once, not just the first: a batch of new rewards is
    // cheaper to fix from one list than from one failure per run.
    expect(missing, 'rewards that name no def').toEqual([]);
    // NON-VACUITY. An empty walk passes the assertion above no matter what the
    // level data says, so the walk proves it reached the levels the defect class
    // lived in: `full_adder` is level 20's reward and `decoder1` / `decoder3` are
    // levels 25 and 26's -- a hole in any of those batches fails here rather than
    // passing silently.
    expect([...named]).toContain('full_adder');
    expect([...named]).toContain('decoder1');
    expect([...named]).toContain('decoder3');
    expect(named.size).toBeGreaterThan(1);
  });

  it('names only registered defs in allowedComponents', () => {
    // The palette half of the same defect, and just as silent: `ui/palette.ts`
    // filters the ids it is handed through `registry.has`, so a level offering a
    // part no def declares simply never shows it. Level 20 was the live case on
    // both halves at once -- it rewarded `full_adder` AND listed it in its own
    // palette, and neither reached the player.
    //
    // Stated here rather than in the rewards test because the two lists are
    // different claims: a reward decides what the level UNLOCKS, a palette entry
    // what it lets you BUILD with.
    const offered = new Set<string>();
    const missing: string[] = [];
    for (const level of SHIPPED) {
      for (const def of level.allowedComponents) {
        offered.add(def);
        if (!r.has(def)) missing.push(`${level.id} offers ${def}`);
      }
    }
    expect(missing, 'palette ids that name no def').toEqual([]);
    // The same non-vacuity anchors as above: `full_adder` and `decoder1` /
    // `decoder3` -- which levels 25 and 26 offer in their own palettes -- are the
    // ids that were unreachable while their batches were unjoined.
    expect([...offered]).toContain('full_adder');
    expect([...offered]).toContain('decoder1');
    expect([...offered]).toContain('decoder3');
  });
});
