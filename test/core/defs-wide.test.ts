import { describe, expect, it } from 'vitest';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import {
  DECODER_DEF_IDS,
  DEFAULT_WIDE_WIDTH,
  MAX_WIDE_WIDTH,
  WIDE_DEF_IDS,
  WIDE_STORAGE_DEFS,
  WIDE_STORAGE_DEF_IDS,
  clampWidth,
  createWideDefs,
} from '../../src/core/defs/wide';
import { Simulation, compile } from '../../src/core/net';
import { createRegistry, type ComponentDef } from '../../src/core/registry';
import type { PortValue } from '../../src/core/signal';
import { build } from '../fixtures/build';

const registry = createRegistry(BASE_DEFS);

interface ContractRow {
  readonly id: string;
  readonly inputs: readonly (readonly [string, number])[];
  readonly outputs: readonly (readonly [string, number])[];
}

/**
 * The task brief's table, transcribed verbatim: the ids and pin names below are
 * the contract the chapter-2 level data is written against. A rename here
 * silently breaks four later tasks, so the test asserts the whole surface rather
 * than spot-checking an operator or two.
 */
const CONTRACT: readonly ContractRow[] = [
  { id: 'and8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'or8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'nand8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'nor8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'xor8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'xnor8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'not8', inputs: [['a', 8]], outputs: [['out', 8]] },
  { id: 'add8', inputs: [['a', 8], ['b', 8], ['cin', 1]], outputs: [['out', 8], ['cout', 1]] },
  { id: 'neg8', inputs: [['a', 8]], outputs: [['out', 8]] },
  { id: 'less_s', inputs: [['a', 8], ['b', 8]], outputs: [['out', 1]] },
  { id: 'less_u', inputs: [['a', 8], ['b', 8]], outputs: [['out', 1]] },
  { id: 'equal8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 1]] },
  { id: 'shift_l8', inputs: [['a', 8], ['amount', 8]], outputs: [['out', 8]] },
  { id: 'shift_r8', inputs: [['a', 8], ['amount', 8]], outputs: [['out', 8]] },
  { id: 'ashr8', inputs: [['a', 8], ['amount', 8]], outputs: [['out', 8]] },
  { id: 'rot_l8', inputs: [['a', 8], ['amount', 8]], outputs: [['out', 8]] },
  { id: 'rot_r8', inputs: [['a', 8], ['amount', 8]], outputs: [['out', 8]] },
  { id: 'mul8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'div8', inputs: [['a', 8], ['b', 8]], outputs: [['out', 8]] },
  { id: 'const8', inputs: [], outputs: [['out', 8]] },
  {
    id: 'splitter',
    inputs: [['in', 8]],
    outputs: [['b0', 1], ['b1', 1], ['b2', 1], ['b3', 1], ['b4', 1], ['b5', 1], ['b6', 1], ['b7', 1]],
  },
  {
    id: 'maker',
    inputs: [['b0', 1], ['b1', 1], ['b2', 1], ['b3', 1], ['b4', 1], ['b5', 1], ['b6', 1], ['b7', 1]],
    outputs: [['out', 8]],
  },
  { id: 'switch', inputs: [['a', 1], ['on', 1]], outputs: [['out', 1]] },
  { id: 'switch8', inputs: [['a', 8], ['on', 1]], outputs: [['out', 8]] },
];

const CONTRACT_IDS = CONTRACT.map((row) => row.id);
/** The 8-bit operators; `const8` is a source and lives under `io`. */
const WIDE_OP_IDS = CONTRACT_IDS.filter((id) => id !== 'const8');

/**
 * The Task-4 brief's table, transcribed verbatim: the storage family. The ids
 * and pin names are the same kind of contract as the operators above -- the
 * chapter-2 level data addresses them literally -- and each row states what only
 * a storage def has on top of that: whether it is sequential, how many state
 * BYTES it holds, and both metrics.
 *
 * `gateCost: undefined` is "same as `cost`", which is 0: a storage element is
 * free on the GATE metric exactly as phase 0's `delay_line` and `mem1` are
 * (`registry.ts` documents the pair of zeroes). Nothing in a register is a NAND
 * in the combinational expansion -- its cost shows up in the tick metric
 * instead. `mux8` is the one combinational def here, so it states its count:
 * 8 bits x MUX2(4) = 32 on the basis documented in `wide.ts`.
 */
const STORAGE_CONTRACT: readonly (ContractRow & {
  readonly sequential: boolean;
  readonly stateBytes: number;
  readonly cost: number;
  readonly gateCost: number | undefined;
})[] = [
  {
    id: 'mux8',
    inputs: [['a', 8], ['b', 8], ['sel', 1]],
    outputs: [['out', 8]],
    sequential: false,
    stateBytes: 0,
    cost: 1,
    gateCost: 32,
  },
  {
    id: 'delay8',
    inputs: [['a', 8]],
    outputs: [['out', 8]],
    sequential: true,
    stateBytes: 1,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'reg8',
    inputs: [['d', 8], ['load', 1], ['reset', 1]],
    outputs: [['out', 8]],
    sequential: true,
    stateBytes: 1,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'counter8',
    inputs: [['en', 1], ['reset', 1]],
    outputs: [['out', 8]],
    sequential: true,
    stateBytes: 1,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'ram8',
    inputs: [['d', 8], ['addr', 8], ['load', 1]],
    outputs: [['out', 8]],
    sequential: true,
    stateBytes: 256,
    cost: 0,
    gateCost: undefined,
  },
];

const STORAGE_IDS = STORAGE_CONTRACT.map((row) => row.id);

/**
 * Every id the wide module registers, read from the module's own exported id
 * tuples -- the same three `defs/index.ts` builds `DEF_IDS` from -- instead of
 * being typed out here.
 *
 * THIS REPLACES A HAND-MAINTAINED LIST THAT A GENERATED FAMILY BROKE. The
 * category assertion below used to expect `[...WIDE_OP_IDS, ...STORAGE_IDS]`,
 * where `WIDE_OP_IDS` is derived from the CONTRACT table above and `STORAGE_IDS`
 * from the storage one: two lists a human keeps in step, checked against defs a
 * generator produces. The decoder family landed as a third generated tuple in
 * `wide.ts` (`DECODER_DEF_IDS`, registered from `DECODER_WIDTHS`) and the
 * assertion failed on three ids the family's author had no reason to know were
 * listed in a test file. Deriving the set from the tuples means the expectation
 * moves with the module, and a fourth generated family needs its tuple added to
 * this one expression rather than a list of ids re-typed by hand.
 *
 * IT IS STILL AN ASSERTION, AND NOT A TAUTOLOGY, because of where these ids come
 * from: the module's REGISTRATION TUPLES, not the registered defs' own
 * `category` fields and not `byCategory('wide')`. An expectation built from
 * either of those would move with the bug -- a part filed under the wrong
 * category would drop out of the expected set and out of `byCategory('wide')` at
 * the same time, and the assertion would pass on exactly the mistake it exists
 * to catch. Here a mis-filed part is still missing from `byCategory('wide')`
 * while remaining in this set, so the assertion fails.
 */
const WIDE_MODULE_IDS = [...WIDE_DEF_IDS, ...WIDE_STORAGE_DEF_IDS, ...DECODER_DEF_IDS] as const;

/**
 * `WIDE_MODULE_IDS` minus `const8`, the module's ONE deliberate exception: it is
 * a constant source with no inputs, filed with `const_on` / `const_off` under
 * `io` rather than with the gates. The exception is filtered out here and
 * asserted directly below (`const8` is the only id in the module's tuples that
 * is not `wide`), so it is stated rather than smuggled in by a list that happens
 * not to name it.
 */
const WIDE_CATEGORY_IDS = WIDE_MODULE_IDS.filter((id) => id !== 'const8');

/** Runs a def the way `settle` does: inputs in, outputs staged, no state. */
function evalDef(def: ComponentDef, inputs: readonly PortValue[]): PortValue[] {
  const outputs: PortValue[] = [];
  def.evaluate!(inputs, outputs, undefined, { tick: 0 });
  return outputs;
}

const toNumber = (v: PortValue | undefined): number => {
  if (typeof v === 'number') return v;
  return Array.from(v ?? []).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
};

/** Every output pin of a registered def, as numbers, for `inputs`. */
function outputsOf(id: string, inputs: readonly PortValue[]): number[] {
  return evalDef(registry.get(id), inputs).map(toNumber);
}

/** The first output pin of a registered def. */
function at(id: string, ...inputs: number[]): number {
  return outputsOf(id, inputs)[0]!;
}

/** The same, for the generator at a non-default width. */
function outputsAt(width: number, id: string, inputs: readonly number[]): number[] {
  const def = createWideDefs(width).find((d) => d.id === id);
  if (!def) throw new Error(`createWideDefs(${width}) has no ${id}`);
  return evalDef(def, inputs).map(toNumber);
}

const BYTE_PAIRS = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 255],
  [255, 1],
  [255, 255],
  [0x0f, 0xf0],
  [0xaa, 0x55],
  [0x80, 0x7f],
] as const;
const BYTES = [0, 1, 2, 0x0f, 0x10, 0x55, 0x7f, 0x80, 0xaa, 0xfe, 0xff] as const;

describe('wide defs: the brief\'s contract', () => {
  it('declares every id with the exact pin ids and widths the brief gives', () => {
    for (const row of CONTRACT) {
      const def = registry.get(row.id);
      expect(def.inputs.map((p) => [p.id, p.width]), `${row.id} inputs`).toEqual(row.inputs);
      expect(def.outputs.map((p) => [p.id, p.width]), `${row.id} outputs`).toEqual(row.outputs);
    }
  });

  it('is reachable through the registry the way the game reaches it', () => {
    const r = createRegistry(BASE_DEFS);
    for (const id of CONTRACT_IDS) {
      expect(r.has(id), id).toBe(true);
      expect(r.get(id).id, id).toBe(id);
    }
    // The palette and the level data address defs by id, and `DefId` is derived
    // from `DEF_IDS`, so a wide id missing there is invisible to level authors.
    for (const id of CONTRACT_IDS) expect([...DEF_IDS], id).toContain(id);
    expect(WIDE_DEF_IDS).toEqual(CONTRACT_IDS);
    expect(createWideDefs().map((d) => d.id)).toEqual(CONTRACT_IDS);
    // The task-4 storage family is registered from its own literal list rather
    // than generated by the width parameter (`createWideDefs(32)` must never
    // build a 4 GiB RAM), so the same pair of assertions pins it here.
    expect(WIDE_STORAGE_DEF_IDS).toEqual(STORAGE_IDS);
    expect(WIDE_STORAGE_DEFS.map((d) => d.id)).toEqual(STORAGE_IDS);
  });

  it('keeps every wide def pure combinational', () => {
    for (const id of CONTRACT_IDS) {
      const def = registry.get(id);
      expect(typeof def.evaluate, id).toBe('function');
      expect(def.sequential, id).toBe(false);
      expect(def.stateBytes, id).toBe(0);
      expect(def.clockEdge, id).toBeUndefined();
      expect(def.hidden, id).toBeUndefined();
    }
  });

  it('categorizes every wide part as wide and const8 as a source', () => {
    const r = createRegistry(BASE_DEFS);
    // The expected set is the wide module's own registration tuples -- the
    // operators, the storage family (built at eight bits too, so it belongs to
    // `wide` alongside them: `memory1` is phase 0's ONE-BIT memory group,
    // `delay_line` and `mem1`, and there is no `memory8`) and the decoders.
    // See `WIDE_MODULE_IDS`: it is derived, because the hand-maintained version
    // of this line could not know about a family it had never heard of.
    expect(r.byCategory('wide').map((d) => d.id).sort()).toEqual([...WIDE_CATEGORY_IDS].sort());
    // The same membership stated as the exception it is, so it can never quietly
    // become two: exactly `const8` is registered under a category that is not
    // `wide`. A decoder filed as `logic1`, or a byte operator filed as `io`,
    // joins this list and fails -- including when the id is still in the set
    // above, which is what keeps the derived expectation honest.
    expect(WIDE_MODULE_IDS.filter((id) => r.get(id).category !== 'wide')).toEqual(['const8']);
    // `const8` has no inputs and only drives a level, so it belongs with
    // `const_on` / `const_off` rather than with the gates.
    expect(r.get('const8').category).toBe('io');
    expect(r.byCategory('io').map((d) => d.id)).toContain('const8');
  });

  it('keeps the DELAY cost at one unit per operator, nothing for a source or a wire', () => {
    // `cost` is the delay unit `delayOf` charges per node, so a value above 1
    // would give a wide part a multi-unit delay and contradict the phase-1 rule
    // that every component contributes exactly one unit of delay (spec §3.2).
    // It is NOT the gate metric: the NAND-equivalent expansion lives in
    // `gateCost`, which is pinned separately below. If this test and that one
    // ever collapse into one number, the delay metric has silently become the
    // gate metric again.
    for (const id of WIDE_OP_IDS) {
      if (id === 'splitter' || id === 'maker') continue;
      expect(registry.get(id).cost, id).toBe(1);
    }
    // Pure wiring and a constant source cost nothing, like `level_output` and
    // `const_on` in phase 0.
    expect(registry.get('splitter').cost).toBe(0);
    expect(registry.get('maker').cost).toBe(0);
    expect(registry.get('const8').cost).toBe(0);
  });

  /**
   * NAND equivalents per def, as literal numbers. The constructions behind them
   * are documented in `wide.ts` (the "GATE COST" block plus the comment on each
   * def); this table is the independent statement of what those constructions
   * add up to, so changing a count has to be a deliberate edit in two places.
   *
   * Every number is the 8-bit case of a per-width formula.
   */
  const NAND_EQUIVALENTS: Record<string, number> = {
    // Bit-sliced: one 1-bit cell per bit. AND 2, OR 3, NAND 1, NOR 4, XOR 4,
    // XNOR 5, NOT 1 -- all from the standard all-NAND cells.
    and8: 16,
    or8: 24,
    nand8: 8,
    nor8: 32,
    xor8: 32,
    xnor8: 40,
    not8: 8,
    // 8 full adders at 9 NANDs each.
    add8: 72,
    // NOT8 (8) + add8 (72), `cin` tied high: the constant is a rail, not a gate.
    neg8: 80,
    // less_u: NOT b (8) + add (72) + NOT cout (1) = subtract and read the borrow.
    less_u: 81,
    // less_s: less_u (81) + XOR of the sign bits (4) + the 2:1 sign-fix mux (4).
    less_s: 89,
    // equal8: 8 XNOR (40) into a 7-gate AND tree (14). The XOR/OR/NOT mirror
    // also totals 54.
    equal8: 54,
    // 3-stage 8-wide barrel (96) + the "amount >= 8 -> 0" logic: OR-reduce the
    // five high amount bits (12), invert (1), AND the 8 outputs (16).
    shift_l8: 125,
    shift_r8: 125,
    // The same barrel, but the over-shift case selects the sign bit instead of
    // zero: OR-reduce (12, no inverter needed) + an 8-wide 2:1 mux (32).
    ashr8: 140,
    // A rotator is the barrel alone: `amount % 8` falls out of acting on the
    // low three amount bits, so there is no over-shift logic at all.
    rot_l8: 96,
    rot_r8: 96,
    // Shift-and-add: 8 partial products (8 x AND8 = 128) accumulated by 8 add8s
    // (8 x 72 = 576).
    mul8: 704,
    // Restoring division, 8 iterations of (NOT b + add + conditional restore) =
    // 8 x 112, plus the divide-by-zero rule: zero-detect (22) and a last 8-wide
    // conditional pass onto all ones (32).
    div8: 950,
    // A rail, a wire with eight ends, and a wire with eight ends.
    const8: 0,
    splitter: 0,
    maker: 0,
    // `a AND on`: one AND, and eight of them.
    switch: 2,
    switch8: 16,
  };

  it('states a NAND-equivalent gateCost for every def, explicitly', () => {
    // Explicit on every def, including the zeroes: none of the wide family
    // leans on the `?? cost` fallback, so these 24 numbers are the whole gate
    // metric for the family and a missing one is a test failure rather than a
    // silent 1.
    expect(Object.keys(NAND_EQUIVALENTS).sort()).toEqual([...CONTRACT_IDS].sort());
    for (const id of CONTRACT_IDS) {
      expect(registry.get(id).gateCost, id).toBeTypeOf('number');
      expect(registry.get(id).gateCost, id).toBe(NAND_EQUIVALENTS[id]);
    }
  });

  it('gives every operator more than one NAND equivalent, and no part less than its delay', () => {
    for (const id of CONTRACT_IDS) {
      const def = registry.get(id);
      expect(def.gateCost!, id).toBeGreaterThanOrEqual(def.cost);
    }
    for (const id of WIDE_OP_IDS) {
      if (id === 'splitter' || id === 'maker') continue;
      expect(registry.get(id).gateCost!, id).toBeGreaterThan(1);
    }
  });

  it('composes each count out of the others, so the constructions are checkable', () => {
    // Each identity is one line of the derivation in `wide.ts`; a single edited
    // number breaks the identity even if the table above were updated to match
    // it.
    const gate = (id: string): number => registry.get(id).gateCost!;
    expect(gate('nor8')).toBe(gate('or8') + gate('not8')); // OR8 + NOT8
    expect(gate('xnor8')).toBe(gate('xor8') + gate('not8')); // XOR8 + NOT8
    expect(gate('neg8')).toBe(gate('not8') + gate('add8')); // NOT8 + add8, cin high
    expect(gate('less_s')).toBe(gate('less_u') + 4 + 4); // sign XOR + sign-fix mux
    expect(gate('mul8')).toBe(8 * (gate('and8') + gate('add8'))); // 8 partials, 8 adds
    expect(gate('switch8')).toBe(8 * gate('switch')); // one AND per bit
    expect(gate('shift_l8')).toBe(gate('rot_l8') + 12 + 1 + gate('switch8')); // barrel + OR(12) + NOT(1) + 8 ANDs
    expect(gate('ashr8')).toBe(gate('rot_l8') + 12 + 8 * 4); // barrel + OR(12) + 8 sign-fill muxes at 4 NANDs
    expect(gate('shift_r8')).toBe(gate('shift_l8')); // same structure, other direction
    expect(gate('rot_r8')).toBe(gate('rot_l8'));
  });

  it('prices each bit-sliced cell on the same NAND basis as the registered 1-bit gate', () => {
    // The finding fix round 2 answered: one bit of `and8` is the same AND cell as
    // the built-in `and`, so the two cannot be priced differently (the built-ins
    // used to fall through `?? cost` and be worth 1). `nand8`/`not8` are in the
    // table for completeness -- both numbers are 1 either way, so they are not
    // evidence of anything.
    const oneBit = (id: string): number => {
      const count = registry.get(id).gateCost;
      if (count === undefined) throw new Error(`no gateCost on the 1-bit gate ${id}`);
      return count;
    };
    const cells: readonly (readonly [string, string])[] = [
      ['and8', 'and'],
      ['or8', 'or'],
      ['nand8', 'nand'],
      ['nor8', 'nor'],
      ['xor8', 'xor'],
      ['xnor8', 'xnor'],
      ['not8', 'not'],
    ];
    for (const [wide, one] of cells) {
      expect(registry.get(wide).gateCost, `${wide} vs ${DEFAULT_WIDE_WIDTH} x ${one}`).toBe(
        DEFAULT_WIDE_WIDTH * oneBit(one),
      );
    }
  });

  it('scales every count with the width the generator is asked for', () => {
    const at = (width: number, id: string): number => {
      const def = createWideDefs(width).find((d) => d.id === id);
      if (!def) throw new Error(`createWideDefs(${width}) has no ${id}`);
      return def.gateCost!;
    };
    expect(at(1, 'not1')).toBe(1); // 1 x NOT
    expect(at(1, 'add1')).toBe(9); // 1 full adder
    expect(at(1, 'switch')).toBe(2); // the bare id is always the 1-bit switch
    expect(at(4, 'and4')).toBe(8); // 4 x AND
    expect(at(4, 'add4')).toBe(36); // 4 x 9
    expect(at(4, 'rot_l4')).toBe(32); // 2 stages x 4 muxes x 4
    expect(at(16, 'and16')).toBe(32);
    expect(at(16, 'add16')).toBe(144);
    expect(at(16, 'rot_l16')).toBe(256); // 4 stages x 16 muxes x 4
  });

  it('registers the whole family without a duplicate id', () => {
    expect(new Set(CONTRACT_IDS).size).toBe(CONTRACT_IDS.length);
    expect(new Set(BASE_DEFS.map((d) => d.id)).size).toBe(BASE_DEFS.length);
    expect(createRegistry(BASE_DEFS).size).toBe(BASE_DEFS.length);
  });
});

// ---------------------------------------------------------------------------
// Task 4: the storage family.
//
// Same contract discipline as the operators above, plus the rules this task
// DECIDES rather than inherits. Each is argued at its def in `wide.ts` and
// pinned here as behaviour:
//
//   * `reset` beats `load` / `en` when both are asserted on one edge.
//   * `counter8` wraps to 0 at 256 -- an 8-bit rollover, not a saturation.
//   * `ram8` reads combinationally (an address change is visible at once) and
//     writes on the edge. Its `evaluate` reads `addr` as a SELECTOR into state
//     and never `d` / `load`, so no input's value can flow through to a pin --
//     which is the property the storage contract exists to protect.
//   * `mux8` is pure combinational and worth 8 x MUX2 = 32 NANDs.
// ---------------------------------------------------------------------------
describe('wide storage defs: the brief\'s contract and the decided edge rules', () => {
  const r = createRegistry(BASE_DEFS);

  /** Runs `evaluate` the way `settle` does: state in, outputs staged. */
  function publish(
    def: ComponentDef,
    state: Uint8Array,
    inputs: readonly PortValue[] = [],
  ): number {
    const outputs: PortValue[] = [];
    def.evaluate!(inputs, outputs, state, { tick: 0 });
    return toNumber(outputs[0]);
  }

  /**
   * Applies one clock edge the way `tick` does -- and asserts the half of the
   * storage contract `clockEdge` must never break: it samples into `state` and
   * writes no outputs at all.
   */
  function edge(def: ComponentDef, state: Uint8Array, inputs: readonly PortValue[]): void {
    const outputs: PortValue[] = [];
    def.clockEdge!(inputs, outputs, state, { tick: 1 });
    expect(outputs, `${def.id}: clockEdge wrote outputs`).toEqual([]);
  }

  it('declares every storage def with the ids, pins, state and costs the brief gives', () => {
    for (const row of STORAGE_CONTRACT) {
      const def = r.get(row.id);
      expect(def.inputs.map((p) => [p.id, p.width]), `${row.id} inputs`).toEqual(row.inputs);
      expect(def.outputs.map((p) => [p.id, p.width]), `${row.id} outputs`).toEqual(row.outputs);
      expect(def.sequential, row.id).toBe(row.sequential);
      // Storage holds state, a combinational def holds none, and the kernel
      // allocates exactly this many bytes per instance.
      expect(def.stateBytes, row.id).toBe(row.stateBytes);
      expect(def.cost, row.id).toBe(row.cost);
      expect(def.gateCost, row.id).toBe(row.gateCost);
      // One publisher per def, and one sampler per storage def: `evaluate` is
      // how the kernel publishes (`Simulation.#publishState`), so a storage def
      // without it is refused by `compile` rather than holding zero in silence.
      expect(typeof def.evaluate, row.id).toBe('function');
      expect(typeof def.clockEdge, row.id).toBe(row.sequential ? 'function' : 'undefined');
      expect(def.hidden, row.id).toBeUndefined();
    }
  });

  it('is registered, and every id is one level data can spell', () => {
    for (const id of STORAGE_IDS) {
      expect(r.has(id), id).toBe(true);
      expect(r.get(id).id, id).toBe(id);
      // Level data and the palette address defs by id, and `DefId` is derived
      // from `DEF_IDS`: an id missing there cannot be used by a level at all.
      expect([...DEF_IDS], id).toContain(id);
    }
    // The two families are disjoint, so a storage id is never also an operator's.
    expect(new Set([...STORAGE_IDS, ...CONTRACT_IDS]).size).toBe(
      STORAGE_IDS.length + CONTRACT_IDS.length,
    );
  });

  it('mux8 selects a or b on sel, combinationally', () => {
    const def = r.get('mux8');
    expect(def.stateBytes).toBe(0);
    expect(def.clockEdge).toBeUndefined();
    for (const [a, b] of BYTE_PAIRS) {
      expect(at('mux8', a, b, 0), `sel=0, a=0x${a.toString(16)}`).toBe(a);
      expect(at('mux8', a, b, 1), `sel=1, b=0x${b.toString(16)}`).toBe(b);
    }
    expect(at('mux8', 0xf0, 0x0f, 0)).toBe(0xf0);
    expect(at('mux8', 0xf0, 0x0f, 1)).toBe(0x0f);
    // An unwired `sel` reads 0 like every other unwired pin, so `a` passes.
    expect(at('mux8', 0xf0, 0x0f)).toBe(0xf0);
  });

  it('delay8 publishes the byte it holds and never its inputs', () => {
    const def = r.get('delay8');
    const state = new Uint8Array(def.stateBytes);
    state[0] = 0x5a;
    // The input is the opposite of the held byte: publishing is all `evaluate`
    // may do here, so a mirroring implementation would show 0x00.
    expect(publish(def, state, [0x00])).toBe(0x5a);
    edge(def, state, [0x3c]);
    expect(state[0]).toBe(0x3c);
    expect(publish(def, state, [0xff])).toBe(0x3c);
    // Sample-then-publish is the whole delay: what arrives on the edge appears
    // only after it.
    edge(def, state, [0x00]);
    expect(publish(def, state, [0xff])).toBe(0x00);
  });

  it('reg8 samples d on the edge when load is high, and reset beats load', () => {
    const def = r.get('reg8');
    const state = new Uint8Array(def.stateBytes);
    // inputs: [d, load, reset]
    edge(def, state, [0x12, 0, 0]);
    expect(state[0], 'load low: nothing is written').toBe(0x00);
    edge(def, state, [0x12, 1, 0]);
    expect(state[0]).toBe(0x12);
    edge(def, state, [0x34, 0, 0]);
    expect(state[0], 'load low: the held byte stays').toBe(0x12);
    // DECIDED (task 4): reset wins when both are asserted on the same edge.
    edge(def, state, [0x34, 1, 1]);
    expect(state[0], 'reset beats load').toBe(0x00);
    edge(def, state, [0x56, 1, 0]);
    expect(state[0]).toBe(0x56);
    edge(def, state, [0x78, 0, 1]);
    expect(state[0], 'reset alone still clears').toBe(0x00);
    edge(def, state, [0x9a, 1, 0]);
    // `evaluate` is state only, so all three inputs are hostile here.
    expect(publish(def, state, [0x00, 0, 1])).toBe(0x9a);
  });

  it('counter8 counts on the edge when en is high, wraps to 0, and reset beats en', () => {
    const def = r.get('counter8');
    const state = new Uint8Array(def.stateBytes);
    // inputs: [en, reset]
    edge(def, state, [0, 0]);
    expect(state[0], 'en low: no count').toBe(0x00);
    edge(def, state, [1, 0]);
    expect(state[0]).toBe(0x01);
    state[0] = 0x7f;
    edge(def, state, [1, 0]);
    expect(state[0]).toBe(0x80);
    // DECIDED (task 4): 255 + 1 wraps to 0 rather than saturating.
    state[0] = 0xff;
    edge(def, state, [1, 0]);
    expect(state[0]).toBe(0x00);
    state[0] = 0x05;
    edge(def, state, [1, 1]);
    expect(state[0], 'reset beats en').toBe(0x00);
    state[0] = 0x05;
    edge(def, state, [0, 1]);
    expect(state[0], 'reset alone still clears').toBe(0x00);
    state[0] = 0x2a;
    expect(publish(def, state, [1, 1]), 'en and reset never reach the output').toBe(0x2a);
  });

  it('ram8 writes the addressed byte on the edge and selects it on the fly', () => {
    const def = r.get('ram8');
    const state = new Uint8Array(def.stateBytes);
    expect(def.stateBytes, '256 bytes of storage').toBe(256);
    // inputs: [d, addr, load]
    expect(publish(def, state, [0xff, 0, 0]), 'memory starts empty').toBe(0x00);
    edge(def, state, [0xff, 0, 1]);
    expect(state[0]).toBe(0xff);
    expect(state[1], 'only the addressed byte is written').toBe(0x00);
    edge(def, state, [0x11, 255, 1]);
    expect(state[255]).toBe(0x11);
    edge(def, state, [0x22, 0x10, 0]);
    expect(state[0x10], 'load low: nothing is written').toBe(0x00);
    // The read is a SELECTION from state: `addr` picks the byte, and neither `d`
    // nor `load` -- both hostile below -- can reach the output.
    expect(publish(def, state, [0xab, 0, 1])).toBe(0xff);
    expect(publish(def, state, [0xab, 255, 1])).toBe(0x11);
    expect(publish(def, state, [0xab, 0x80, 1]), 'never written, so not d').toBe(0x00);
    expect(publish(def, state, [0xab, 0x10, 0])).toBe(0x00);
  });

  it('ram8 keeps all 256 of its bytes, and keeps them per instance', () => {
    const def = r.get('ram8');
    const state = new Uint8Array(def.stateBytes);
    const other = new Uint8Array(def.stateBytes);
    // Distinct per address (7 is odd, so the map is a bijection mod 256): an
    // aliasing bug -- a 128-byte store, or an `addr & 0x7f` mask -- cannot pass.
    const value = (addr: number): number => (addr * 7 + 1) & 0xff;
    for (let addr = 0; addr < 256; addr += 1) edge(def, state, [value(addr), addr, 1]);
    for (let addr = 0; addr < 256; addr += 1) {
      expect(publish(def, state, [0x00, addr, 0]), `addr ${addr}`).toBe(value(addr));
    }
    // The state is the instance's, not the def's: a second array is untouched.
    expect(Array.from(other).every((byte) => byte === 0)).toBe(true);
  });
});

describe('wide bitwise operators', () => {
  const expected: Record<string, (a: number, b: number) => number> = {
    and8: (a, b) => a & b,
    or8: (a, b) => a | b,
    nand8: (a, b) => ~(a & b) & 0xff,
    nor8: (a, b) => ~(a | b) & 0xff,
    xor8: (a, b) => a ^ b,
    xnor8: (a, b) => ~(a ^ b) & 0xff,
  };

  it('matches a reference truth table on the boundary vectors', () => {
    for (const [id, fn] of Object.entries(expected)) {
      for (const [a, b] of BYTE_PAIRS) {
        expect(at(id, a, b), `${id}(${a},${b})`).toBe(fn(a, b));
      }
    }
  });

  it('treats the 8-bit patterns as unsigned, never as negative numbers', () => {
    // `-1` as an int32 would be accepted by nothing downstream: a port value
    // must fit the pin, and `assertWidth` takes 0..255 for an 8-bit port.
    for (const id of Object.keys(expected)) {
      for (const value of outputsOf(id, [255, 255])) {
        expect(value, id).toBeGreaterThanOrEqual(0);
        expect(value, id).toBeLessThanOrEqual(255);
      }
    }
  });

  it('evaluates NOT and its double negation', () => {
    for (const a of BYTES) {
      expect(at('not8', a), `not8(${a})`).toBe(~a & 0xff);
      expect(at('not8', at('not8', a)), `not8(not8(${a}))`).toBe(a);
    }
  });

  it('is its own inverse under XOR', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        expect(at('xor8', at('xor8', a, b), b), `xor8(xor8(${a},${b}),${b})`).toBe(a);
      }
    }
  });

  it('relates nand8/nor8/xnor8 to their negations', () => {
    for (const [a, b] of BYTE_PAIRS) {
      expect(at('nand8', a, b)).toBe(at('not8', at('and8', a, b)));
      expect(at('nor8', a, b)).toBe(at('not8', at('or8', a, b)));
      expect(at('xnor8', a, b)).toBe(at('not8', at('xor8', a, b)));
    }
  });

  it('reads an unwired input as zero', () => {
    expect(evalDef(registry.get('and8'), [0xff, undefined as unknown as number])[0]).toBe(0);
    expect(evalDef(registry.get('or8'), [undefined as unknown as number, 0x0f])[0]).toBe(0x0f);
  });
});

describe('add8', () => {
  it('adds with carry-in on the boundary vectors', () => {
    const cases: readonly (readonly [number, number, number, number, number])[] = [
      // a, b, cin, out, cout
      [0, 0, 0, 0, 0],
      [0, 0, 1, 1, 0],
      [1, 0, 0, 1, 0],
      [0x7f, 1, 0, 0x80, 0],
      [0x80, 0x80, 0, 0x00, 1],
      [255, 1, 0, 0, 1],
      [255, 0, 1, 0, 1],
      [255, 255, 0, 254, 1],
      [255, 255, 1, 255, 1],
      [1, 254, 1, 0, 1],
      [0x0f, 0x0f, 0, 0x1e, 0],
    ];
    for (const [a, b, cin, out, cout] of cases) {
      expect(outputsOf('add8', [a, b, cin]), `add8(${a},${b},${cin})`).toEqual([out, cout]);
    }
  });

  it('reports bit 8 as the carry out and wraps the low eight bits', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        for (const cin of [0, 1]) {
          const sum = a + b + cin;
          expect(outputsOf('add8', [a, b, cin]), `add8(${a},${b},${cin})`).toEqual([
            sum & 0xff,
            (sum >> 8) & 1,
          ]);
        }
      }
    }
  });
});

describe('neg8', () => {
  it('negates the boundary vectors by two\'s complement', () => {
    expect(at('neg8', 0)).toBe(0);
    expect(at('neg8', 1)).toBe(255);
    expect(at('neg8', 255)).toBe(1);
    expect(at('neg8', 0x80)).toBe(0x80);
    expect(at('neg8', 0x7f)).toBe(0x81);
  });

  it('equals (256 - a) & 0xff for every byte, and inverts itself', () => {
    for (let a = 0; a < 256; a += 1) {
      const want = (256 - a) & 0xff;
      expect(at('neg8', a), `neg8(${a})`).toBe(want);
      expect(at('neg8', want), `neg8(neg8(${a}))`).toBe(a);
      // a + (-a) == 0 mod 256. The carry out is 1 for every a but 0, because
      // the two's-complement inverse is `256 - a`: the sum really is 256.
      expect(outputsOf('add8', [a, want, 0]), `add8(${a},neg8(${a}))`).toEqual([
        0,
        a === 0 ? 0 : 1,
      ]);
    }
  });
});

describe('comparators', () => {
  it('compares unsigned patterns', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
      [0x7f, 0x80, 1],
      [0x80, 0x7f, 0],
      [0, 255, 1],
      [255, 0, 0],
      [255, 255, 0],
      [0x80, 0x80, 0],
    ];
    for (const [a, b, want] of cases) {
      expect(at('less_u', a, b), `less_u(${a},${b})`).toBe(want);
    }
  });

  it('compares signed patterns across the sign boundary', () => {
    const signed = (v: number): number => (v >= 0x80 ? v - 256 : v);
    const cases: readonly (readonly [number, number, number])[] = [
      // The sign bit decides everything that unsigned comparison gets backwards.
      [0x80, 0x7f, 1],
      [0x7f, 0x80, 0],
      [0xff, 0x00, 1],
      [0x00, 0xff, 0],
      [0x80, 0x80, 0],
      [0x7f, 0x7f, 0],
      [0xfe, 0xff, 1],
      [0, 1, 1],
    ];
    for (const [a, b, want] of cases) {
      expect(at('less_s', a, b), `less_s(${a},${b})`).toBe(want);
    }
    for (const a of BYTES) {
      for (const b of BYTES) {
        expect(at('less_s', a, b), `less_s(${a},${b})`).toBe(signed(a) < signed(b) ? 1 : 0);
        expect(at('less_u', a, b), `less_u(${a},${b})`).toBe(a < b ? 1 : 0);
      }
    }
  });

  it('reports equality for every pair, and its result is a single bit', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        expect(at('equal8', a, b), `equal8(${a},${b})`).toBe(a === b ? 1 : 0);
      }
    }
    for (const id of ['less_s', 'less_u', 'equal8']) {
      expect(registry.get(id).outputs.map((p) => p.width)).toEqual([1]);
    }
  });
});

describe('shifts', () => {
  const shl = (a: number, k: number): number => (k >= 8 ? 0 : (a << k) & 0xff);
  const shr = (a: number, k: number): number => (k >= 8 ? 0 : (a >>> k) & 0xff);
  const ashr = (a: number, k: number): number =>
    k >= 8 ? (a & 0x80 ? 0xff : 0) : (((a << 24) >> 24) >> k) & 0xff;

  it('shifts left, dropping bits above bit 7', () => {
    expect(at('shift_l8', 0xff, 0)).toBe(0xff);
    expect(at('shift_l8', 1, 7)).toBe(0x80);
    expect(at('shift_l8', 0x81, 1)).toBe(0x02);
    expect(at('shift_l8', 0x80, 1)).toBe(0x00);
  });

  it('shifts right logically, filling with zeros', () => {
    expect(at('shift_r8', 0xff, 0)).toBe(0xff);
    expect(at('shift_r8', 0x80, 7)).toBe(0x01);
    expect(at('shift_r8', 0xff, 1)).toBe(0x7f);
    expect(at('shift_r8', 0x81, 1)).toBe(0x40);
  });

  it('shifts right arithmetically, replicating the sign bit', () => {
    expect(at('ashr8', 0x80, 1)).toBe(0xc0);
    expect(at('ashr8', 0x80, 7)).toBe(0xff);
    expect(at('ashr8', 0xff, 4)).toBe(0xff);
    expect(at('ashr8', 0x7f, 4)).toBe(0x07);
    expect(at('ashr8', 0x40, 3)).toBe(0x08);
    // Negative in, non-negative out: the pattern is unsigned on the wire.
    for (const a of BYTES) {
      for (const k of [0, 1, 3, 7, 8, 9, 255]) {
        const got = at('ashr8', a, k);
        expect(got, `ashr8(${a},${k})`).toBeGreaterThanOrEqual(0);
        expect(got, `ashr8(${a},${k})`).toBeLessThanOrEqual(255);
      }
    }
  });

  it('gives 0 for an amount of 8 or more, and matches the reference below that', () => {
    for (const a of BYTES) {
      for (let k = 8; k < 16; k += 1) {
        expect(at('shift_l8', a, k), `shift_l8(${a},${k})`).toBe(0);
        expect(at('shift_r8', a, k), `shift_r8(${a},${k})`).toBe(0);
        expect(at('ashr8', a, k), `ashr8(${a},${k})`).toBe(ashr(a, k));
      }
      expect(at('shift_l8', a, 255)).toBe(0);
      expect(at('shift_r8', a, 255)).toBe(0);
      for (let k = 0; k < 8; k += 1) {
        expect(at('shift_l8', a, k), `shift_l8(${a},${k})`).toBe(shl(a, k));
        expect(at('shift_r8', a, k), `shift_r8(${a},${k})`).toBe(shr(a, k));
        expect(at('ashr8', a, k), `ashr8(${a},${k})`).toBe(ashr(a, k));
      }
    }
  });
});

describe('rotates', () => {
  const rotl = (a: number, k: number): number => {
    const s = k % 8;
    return ((a << s) | (a >>> (8 - s))) & 0xff;
  };
  const rotr = (a: number, k: number): number => {
    const s = k % 8;
    return ((a >>> s) | (a << (8 - s))) & 0xff;
  };

  it('rotates around the byte', () => {
    expect(at('rot_l8', 0x81, 0)).toBe(0x81);
    expect(at('rot_l8', 0x81, 1)).toBe(0x03);
    expect(at('rot_l8', 0x81, 7)).toBe(0xc0);
    expect(at('rot_r8', 0x81, 0)).toBe(0x81);
    expect(at('rot_r8', 0x81, 1)).toBe(0xc0);
    expect(at('rot_r8', 0x81, 7)).toBe(0x03);
    expect(at('rot_l8', 0xff, 3)).toBe(0xff);
    expect(at('rot_r8', 0xff, 3)).toBe(0xff);
  });

  it('treats an amount of 8 or more as amount % 8', () => {
    for (const a of BYTES) {
      for (let k = 0; k < 33; k += 1) {
        expect(at('rot_l8', a, k), `rot_l8(${a},${k})`).toBe(rotl(a, k));
        expect(at('rot_r8', a, k), `rot_r8(${a},${k})`).toBe(rotr(a, k));
      }
      // A whole number of byte rotations is the identity; 255 is 31 of them
      // plus 7, so it rotates by seven.
      for (const k of [8, 16, 24]) {
        expect(at('rot_l8', a, k), `rot_l8(${a},${k})`).toBe(a);
        expect(at('rot_r8', a, k), `rot_r8(${a},${k})`).toBe(a);
      }
      expect(at('rot_l8', a, 255), `rot_l8(${a},255)`).toBe(rotl(a, 255));
      expect(at('rot_r8', a, 255), `rot_r8(${a},255)`).toBe(rotr(a, 255));
    }
  });

  it('is the inverse of the other direction', () => {
    for (const a of BYTES) {
      for (let k = 0; k < 9; k += 1) {
        expect(at('rot_r8', at('rot_l8', a, k), k), `rot_r8(rot_l8(${a},${k}))`).toBe(a);
      }
    }
  });
});

describe('mul8 and div8', () => {
  it('multiplies, keeping the low eight bits', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 255, 0],
      [1, 255, 255],
      [16, 16, 0], // 256 wraps to 0
      [15, 17, 255],
      [2, 100, 200],
      [0x10, 0x0f, 240],
      [255, 255, 1], // 65025 & 0xff
    ];
    for (const [a, b, want] of cases) {
      expect(at('mul8', a, b), `mul8(${a},${b})`).toBe(want);
    }
  });

  it('equals (a * b) & 0xff on a grid', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        expect(at('mul8', a, b), `mul8(${a},${b})`).toBe((a * b) & 0xff);
      }
    }
  });

  it('divides with truncation toward zero', () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 1, 0],
      [0, 255, 0],
      [1, 255, 0],
      [7, 2, 3],
      [255, 1, 255],
      [255, 2, 127],
      [255, 255, 1],
      [254, 255, 0],
      [100, 10, 10],
    ];
    for (const [a, b, want] of cases) {
      expect(at('div8', a, b), `div8(${a},${b})`).toBe(want);
    }
  });

  it('returns 0xff for division by zero, as decided, and never throws', () => {
    // Not undefined behaviour and not a trap: the brief fixes 0xff. Every
    // numerator gets the same answer, so a level can rely on it.
    for (const a of BYTES) {
      expect(at('div8', a, 0), `div8(${a},0)`).toBe(0xff);
    }
  });

  it('divides by a non-zero divisor exactly as floor does', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        if (b === 0) continue;
        expect(at('div8', a, b), `div8(${a},${b})`).toBe(Math.floor(a / b));
      }
    }
  });
});

describe('const8, switch and switch8', () => {
  it('drives a constant with no inputs', () => {
    expect(registry.get('const8').inputs).toHaveLength(0);
    const out = outputsOf('const8', []);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(0xff);
  });

  it('passes a through when on is 1 and forces zero when on is 0', () => {
    expect(at('switch', 1, 1)).toBe(1);
    expect(at('switch', 1, 0)).toBe(0);
    expect(at('switch', 0, 1)).toBe(0);
    expect(at('switch', 0, 0)).toBe(0);
    for (const a of BYTES) {
      expect(at('switch8', a, 1), `switch8(${a},1)`).toBe(a);
      expect(at('switch8', a, 0), `switch8(${a},0)`).toBe(0);
    }
  });

  it('cascades: switching an already-switched value stays off', () => {
    // Ruling 1's "conditional pass" is the safe form to chain: the forced zero
    // survives a second stage, which a pass-through-and-ignore form would not.
    for (const a of BYTES) {
      expect(at('switch8', at('switch8', a, 1), 0)).toBe(0);
      expect(at('switch8', at('switch8', a, 0), 1)).toBe(0);
      expect(at('switch8', at('switch8', a, 1), 1)).toBe(a);
    }
  });
});

describe('splitter and maker', () => {
  it('splits a byte into eight one-bit pins, least significant first', () => {
    expect(outputsOf('splitter', [0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(outputsOf('splitter', [0xff])).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(outputsOf('splitter', [0x81])).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
    expect(outputsOf('splitter', [0x0f])).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('makes a byte out of eight one-bit pins', () => {
    expect(outputsOf('maker', [0, 0, 0, 0, 0, 0, 0, 0])).toEqual([0]);
    expect(outputsOf('maker', [1, 1, 1, 1, 1, 1, 1, 1])).toEqual([0xff]);
    expect(outputsOf('maker', [1, 0, 0, 0, 0, 0, 0, 1])).toEqual([0x81]);
  });

  it('round-trips maker(splitter(x)) === x for every byte', () => {
    for (let x = 0; x < 256; x += 1) {
      const bits = evalDef(registry.get('splitter'), [x]);
      expect(evalDef(registry.get('maker'), bits)[0], `maker(splitter(${x}))`).toBe(x);
    }
  });
});

describe('the width generator', () => {
  it('defaults to eight bits', () => {
    expect(DEFAULT_WIDE_WIDTH).toBe(8);
    expect(clampWidth(undefined)).toBe(8);
    const splitter = createWideDefs().find((d) => d.id === 'splitter')!;
    expect(splitter.outputs).toHaveLength(8);
    expect(splitter.inputs.map((p) => p.width)).toEqual([8]);
  });

  it('builds the whole family at a non-default width', () => {
    // The parameter is the point of these two components: a four-bit splitter
    // has four output pins, not eight.
    const defs = createWideDefs(4);
    const splitter = defs.find((d) => d.id === 'splitter')!;
    const maker = defs.find((d) => d.id === 'maker')!;
    expect(splitter.inputs.map((p) => [p.id, p.width])).toEqual([['in', 4]]);
    expect(splitter.outputs.map((p) => [p.id, p.width])).toEqual([
      ['b0', 1],
      ['b1', 1],
      ['b2', 1],
      ['b3', 1],
    ]);
    expect(maker.inputs.map((p) => p.id)).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(maker.outputs.map((p) => [p.id, p.width])).toEqual([['out', 4]]);

    expect(outputsAt(4, 'splitter', [0b1010])).toEqual([0, 1, 0, 1]);
    expect(outputsAt(4, 'maker', [0, 1, 0, 1])).toEqual([0b1010]);
    for (let x = 0; x < 16; x += 1) {
      const bits = outputsAt(4, 'splitter', [x]);
      expect(outputsAt(4, 'maker', bits)[0], `maker(splitter(${x}))`).toBe(x);
    }
  });

  it('parameterises the suffixed operators too', () => {
    expect(outputsAt(4, 'add4', [15, 1, 0])).toEqual([0, 1]);
    expect(outputsAt(4, 'not4', [0b1010])).toEqual([0b0101]);
    expect(outputsAt(4, 'less_s', [0x8, 0x7])).toEqual([1]);
    expect(outputsAt(16, 'add16', [0xffff, 1, 0])).toEqual([0, 1]);
    expect(outputsAt(16, 'shift_l16', [1, 15])).toEqual([0x8000]);
    const ids = createWideDefs(4).map((d) => d.id);
    expect(ids).toContain('and4');
    expect(ids).toContain('splitter');
    expect(ids).not.toContain('and8');
  });

  it('clamps a requested width into the range it documents', () => {
    expect(clampWidth(8)).toBe(8);
    expect(clampWidth(1)).toBe(1);
    expect(clampWidth(4.9)).toBe(4);
    expect(clampWidth(0)).toBe(1);
    expect(clampWidth(-3)).toBe(1);
    expect(clampWidth(Number.NaN)).toBe(8);
    expect(Number.isFinite(clampWidth(Number.POSITIVE_INFINITY))).toBe(true);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(MAX_WIDE_WIDTH);
    expect(MAX_WIDE_WIDTH).toBe(32);
  });

  it('clamps before it allocates, so an absurd width cannot ask for gigabytes', () => {
    // 1e9 pins would be a >4 GB `Uint8Array` in the signal table; the clamp is
    // what keeps a hand-authored width from ever reaching `alloc`.
    const splitter = createWideDefs(1e9).find((d) => d.id === 'splitter')!;
    expect(splitter.outputs).toHaveLength(MAX_WIDE_WIDTH);
    expect(splitter.inputs.map((p) => p.width)).toEqual([MAX_WIDE_WIDTH]);
  });

  it('rejects nothing silently: an unknown id is simply absent', () => {
    expect(createWideDefs().find((d) => d.id === 'add16')).toBeUndefined();
  });

  it('is not re-counted by params.width, which widens every pin instead', () => {
    // This is WHY the pin count is a def parameter: the kernel resolves a pin's
    // width as `params.width ?? pin.width` for EVERY pin of the instance, so the
    // instance knob cannot shorten the pin list -- `params.width = 4` gives the
    // splitter eight four-bit outputs, not four one-bit ones. Asserting it here
    // means a future def-level count hook in `net.ts` (the only place that could
    // change it) fails this test instead of quietly disagreeing with the docs.
    const g = build([
      { kind: 'input', name: 'x', width: 8 },
      { kind: 'part', def: 'splitter', id: 'split', from: ['x'] },
    ]);
    const splitter = g.instances.find((inst) => inst.def === 'splitter')!;
    splitter.params.width = 4;
    const net = compile(g, createRegistry(BASE_DEFS));
    const key = (pin: string): string => `${splitter.id}.${pin}`;
    expect(net.inputWidth(key('in'))).toBe(4);
    expect(net.outputWidth(key('b0'))).toBe(4);
    expect(net.outputWidth(key('b7'))).toBe(4);

    // Bit 0 of each of those wide pins still carries the split bit, which is
    // what makes the registered 8-bit splitter usable against a 4-bit level
    // input: the narrow consumer reads bit 0 and the rest read as zero.
    const s = new Simulation(net, createRegistry(BASE_DEFS));
    const xKey = 'IN_x.out';
    s.write(net.outputBase(xKey), net.outputWidth(xKey), 0b1011);
    s.settle();
    for (const [bit, want] of [['b0', 1], ['b1', 1], ['b2', 0], ['b3', 1]] as const) {
      const pin = key(bit);
      expect(toNumber(s.read(net.outputBase(pin), net.outputWidth(pin))), pin).toBe(want);
    }
  });
});

describe('wide defs through the kernel', () => {
  function sim(graph: ReturnType<typeof build>): {
    sim: Simulation;
    write: (name: string, value: number) => void;
    read: (name: string) => number;
  } {
    const net = compile(graph, registry);
    const s = new Simulation(net, registry);
    return {
      sim: s,
      write: (name, value) => {
        const key = `IN_${name}.out`;
        s.write(net.outputBase(key), net.outputWidth(key), value);
      },
      read: (name) => {
        const key = `${name}.in`;
        return toNumber(s.read(net.inputBase(key), net.inputWidth(key)));
      },
    };
  }

  it('adds two level inputs and carries out of bit 8', () => {
    const g = build([
      { kind: 'input', name: 'a', width: 8 },
      { kind: 'input', name: 'b', width: 8 },
      { kind: 'input', name: 'cin' },
      { kind: 'part', def: 'add8', id: 'sum', from: ['a', 'b', 'cin'] },
      { kind: 'output', name: 'OUT', width: 8, from: 'sum.out' },
      { kind: 'output', name: 'COUT', from: 'sum.cout' },
    ]);
    const { sim: s, write, read } = sim(g);
    for (const [a, b, cin] of [
      [0, 0, 0],
      [0x7f, 1, 0],
      [255, 1, 0],
      [255, 255, 1],
      [0x2a, 0x11, 0],
    ] as const) {
      write('a', a);
      write('b', b);
      write('cin', cin);
      s.settle();
      const sum = a + b + cin;
      expect(read('OUT'), `a=${a} b=${b} cin=${cin}`).toBe(sum & 0xff);
      expect(read('COUT'), `a=${a} b=${b} cin=${cin}`).toBe((sum >> 8) & 1);
    }
  });

  it('carries every byte through splitter -> maker at the pin level', () => {
    // This is the first circuit in the project with a pin wider than one bit, so
    // it exercises the per-bit input gather and the coherent read region the
    // kernel gained in tasks 1 and 2 rather than any arithmetic.
    const g = build([
      { kind: 'input', name: 'x', width: 8 },
      { kind: 'part', def: 'splitter', id: 'split', from: ['x'] },
      {
        kind: 'part',
        def: 'maker',
        id: 'pack',
        from: ['split.b0', 'split.b1', 'split.b2', 'split.b3', 'split.b4', 'split.b5', 'split.b6', 'split.b7'],
      },
      { kind: 'output', name: 'OUT', width: 8, from: 'pack.out' },
    ]);
    const { sim: s, write, read } = sim(g);
    for (let x = 0; x < 256; x += 1) {
      write('x', x);
      s.settle();
      expect(read('OUT'), `x=${x}`).toBe(x);
    }
  });

  it('drives an 8-bit operator from 1-bit level inputs', () => {
    // A narrow driver onto a wide pin is the corruption tasks 1 and 2 fixed: the
    // high bits must read 0, not the neighbouring pin's signal.
    const g = build([
      { kind: 'input', name: 'bit' },
      { kind: 'input', name: 'on' },
      { kind: 'part', def: 'switch8', id: 'pass', from: ['bit', 'on'] },
      { kind: 'part', def: 'not8', id: 'inv', from: ['pass.out'] },
      { kind: 'output', name: 'OUT', width: 8, from: 'inv.out' },
    ]);
    const { sim: s, write, read } = sim(g);
    write('bit', 1);
    write('on', 1);
    s.settle();
    expect(read('OUT')).toBe(0xfe);
    write('on', 0);
    s.settle();
    expect(read('OUT')).toBe(0xff);
  });
});
