import { describe, expect, it } from 'vitest';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import {
  DEFAULT_WIDE_WIDTH,
  MAX_WIDE_WIDTH,
  WIDE_DEF_IDS,
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

  it('categorizes the operators as wide and const8 as a source', () => {
    const r = createRegistry(BASE_DEFS);
    expect(r.byCategory('wide').map((d) => d.id).sort()).toEqual([...WIDE_OP_IDS].sort());
    // `const8` has no inputs and only drives a level, so it belongs with
    // `const_on` / `const_off` rather than with the gates.
    expect(r.get('const8').category).toBe('io');
    expect(r.byCategory('io').map((d) => d.id)).toContain('const8');
  });

  it('costs one gate per part, nothing for a source or a wire', () => {
    // `delayOf` charges `def.cost` per node, so a cost above 1 would give a wide
    // part a multi-unit delay and contradict the phase-1 rule that every
    // component contributes exactly one unit of delay. Wide parts are one gate
    // each for the metrics; the NAND-equivalent expansion is a later phase's
    // `expand()` and can re-derive these numbers then.
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

  it('registers the whole family without a duplicate id', () => {
    expect(new Set(CONTRACT_IDS).size).toBe(CONTRACT_IDS.length);
    expect(new Set(BASE_DEFS.map((d) => d.id)).size).toBe(BASE_DEFS.length);
    expect(createRegistry(BASE_DEFS).size).toBe(BASE_DEFS.length);
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
