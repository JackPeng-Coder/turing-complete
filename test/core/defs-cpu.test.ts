import { describe, expect, it } from 'vitest';
import { CPU_DEFS, CPU_DEF_IDS } from '../../src/core/defs/cpu';
import { BASE_DEFS, DEF_IDS } from '../../src/core/defs/index';
import { Simulation, compile, type Netlist } from '../../src/core/net';
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
 * The plan's Task 2 table, transcribed verbatim: the ids, pin names, widths and
 * costs below are the contract chapter 3's level data is written against (level
 * data written by other tasks binds `instr_decoder`'s five field pins by name,
 * and `ram_prog`'s instance by id). A rename or a width change here silently
 * breaks four later tasks, so this asserts the whole surface rather than
 * spot-checking a part.
 *
 * `gateCost: undefined` is "same as `cost`", which is 0, and it is stated rather
 * than left out of the table so the three storage defs' omission is deliberate:
 * a storage element is free on BOTH metrics (`wide.ts`'s storage ruling, which
 * `reg8` / `ram8` / `regfile6` / `pc8` / `ram_prog` follow). `instr_decoder` and
 * `halt` state an explicit 0 because they are not storage -- they are a wire and
 * a wire -- and the fallback is not what prices them.
 */
const CONTRACT: readonly (ContractRow & {
  readonly zh: string;
  readonly en: string;
  readonly sequential: boolean;
  readonly stateBytes: number;
  readonly cost: number;
  readonly gateCost: number | undefined;
})[] = [
  {
    id: 'alu8',
    zh: '8 位运算器',
    en: '8-Bit ALU',
    inputs: [['a', 8], ['b', 8], ['op', 3]],
    outputs: [['out', 8]],
    sequential: false,
    stateBytes: 0,
    cost: 1,
    gateCost: 264,
  },
  {
    id: 'regfile6',
    zh: '六级寄存器堆',
    en: '6-Register File',
    inputs: [['addrA', 3], ['addrB', 3], ['waddr', 3], ['data', 8], ['we', 1]],
    outputs: [['a', 8], ['b', 8]],
    sequential: true,
    // Six registers, one byte each -- and no seventh byte for waddr 6/7 to alias.
    stateBytes: 6,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'instr_decoder',
    zh: '指令解码器',
    en: 'Instruction Decoder',
    inputs: [['instr', 8]],
    outputs: [['mode', 2], ['op', 3], ['dst', 3], ['src', 3], ['imm', 6]],
    sequential: false,
    stateBytes: 0,
    // Wiring, on both metrics: five bit slices of one input (see `cpu.ts`).
    cost: 0,
    gateCost: 0,
  },
  {
    id: 'pc8',
    zh: '程序计数器',
    en: 'Program Counter',
    inputs: [['load', 1], ['in', 8]],
    outputs: [['out', 8]],
    sequential: true,
    stateBytes: 1,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'ram_prog',
    zh: '程序存储器',
    en: 'Program RAM',
    inputs: [['addr', 8]],
    outputs: [['out', 8]],
    sequential: true,
    // One byte per address, 2 ** 8 of them.
    stateBytes: 256,
    cost: 0,
    gateCost: undefined,
  },
  {
    id: 'halt',
    zh: '停机',
    en: 'Halt',
    inputs: [['in', 1]],
    outputs: [['out', 1]],
    sequential: false,
    stateBytes: 0,
    cost: 0,
    gateCost: 0,
  },
];

const CONTRACT_IDS = CONTRACT.map((row) => row.id);

const toNumber = (v: PortValue | undefined): number => {
  if (typeof v === 'number') return v;
  return Array.from(v ?? []).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
};

/** Runs a def the way `settle` does: inputs in, outputs staged, no state. */
function outputsOf(id: string, inputs: readonly PortValue[]): number[] {
  const outputs: PortValue[] = [];
  registry.get(id).evaluate!(inputs, outputs, undefined, { tick: 0 });
  return outputs.map(toNumber);
}

/** The first output pin of a registered def. */
function at(id: string, ...inputs: number[]): number {
  return outputsOf(id, inputs)[0]!;
}

/** `evaluate` for a storage def: held state in, pins out. */
function publish(def: ComponentDef, state: Uint8Array, inputs: readonly PortValue[]): number[] {
  const outputs: PortValue[] = [];
  def.evaluate!(inputs, outputs, state, { tick: 0 });
  return outputs.map(toNumber);
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

/** The byte values every grid below crosses: the boundaries and a spread between. */
const BYTES = [0, 1, 2, 3, 0x0f, 0x10, 0x55, 0x7f, 0x80, 0xaa, 0xff] as const;

describe('the CPU family: the plan\'s Task 2 contract', () => {
  it('declares every id with the pin ids, widths, state and costs the plan gives', () => {
    for (const row of CONTRACT) {
      const def = registry.get(row.id);
      expect(def.inputs.map((p) => [p.id, p.width]), `${row.id} inputs`).toEqual(row.inputs);
      expect(def.outputs.map((p) => [p.id, p.width]), `${row.id} outputs`).toEqual(row.outputs);
      expect(def.name, row.id).toEqual({ zh: row.zh, en: row.en });
      expect(def.sequential, row.id).toBe(row.sequential);
      // Storage holds state, a combinational def holds none, and the kernel
      // allocates exactly this many bytes per instance.
      expect(def.stateBytes, row.id).toBe(row.stateBytes);
      expect(def.cost, row.id).toBe(row.cost);
      expect(def.gateCost, row.id).toBe(row.gateCost);
      // One publisher per def and one sampler per storage def: `compile` refuses
      // a stateful def with no `evaluate`, and the kernel hands a def its state
      // only when it is sequential.
      expect(typeof def.evaluate, row.id).toBe('function');
      expect(typeof def.clockEdge, row.id).toBe(row.sequential ? 'function' : 'undefined');
      // Palette parts, not plumbing: `ui/palette.ts` drops a hidden def.
      expect(def.hidden, row.id).toBeUndefined();
    }
  });

  it('is registered, and every id is one level data can spell', () => {
    const r = createRegistry(BASE_DEFS);
    for (const id of CONTRACT_IDS) {
      expect(r.has(id), id).toBe(true);
      expect(r.get(id).id, id).toBe(id);
      // Level data and the palette address defs by id, and `DefId` is derived
      // from `DEF_IDS`: an id missing there cannot be used by a level at all.
      expect([...DEF_IDS], id).toContain(id);
    }
    // The composition, checked the way `defs-wide.test.ts` checks the wide
    // family's: the module's own tuple, the defs it registers, and the ids
    // `DEF_IDS` actually carries must be the same six, in the same order.
    expect(CPU_DEF_IDS).toEqual(CONTRACT_IDS);
    expect(CPU_DEFS.map((def) => def.id)).toEqual([...CPU_DEF_IDS]);
    expect([...DEF_IDS].filter((id) => (CPU_DEF_IDS as readonly string[]).includes(id))).toEqual([
      ...CPU_DEF_IDS,
    ]);
    // ...and the composed catalog has no duplicate id anywhere: a CPU def
    // registered under an existing id would be dropped by `createRegistry`
    // rather than shadow anything, silently.
    expect(new Set(CONTRACT_IDS).size).toBe(CONTRACT_IDS.length);
    expect(new Set(DEF_IDS).size).toBe(DEF_IDS.length);
    expect(new Set(BASE_DEFS.map((def) => def.id)).size).toBe(BASE_DEFS.length);
    expect(r.size).toBe(BASE_DEFS.length);
  });

  it('files the whole family under its own `cpu` category', () => {
    const r = createRegistry(BASE_DEFS);
    // An exact set, in registration order: `byCategory('cpu')` is the CPU family
    // and nothing else. Filed under `wide` instead, these six would make
    // `byCategory('wide')` disagree with the family `wide.ts` declares, which
    // `defs-wide.test.ts` pins as an exact set too.
    expect(r.byCategory('cpu').map((def) => def.id)).toEqual([...CPU_DEF_IDS]);
    for (const id of CPU_DEF_IDS) expect(r.get(id).category, id).toBe('cpu');
  });

  /**
   * NAND equivalents per def, as literal numbers. The constructions behind them
   * are written out at each def in `cpu.ts`; this table is the independent
   * statement of what those constructions add up to, so changing a count has to
   * be a deliberate edit in two places. `undefined` is "same as `cost`", i.e. 0:
   * the three storage defs are free on both metrics.
   */
  const GATE_COST: Record<string, number | undefined> = {
    // The sum at `alu8`: adder 72 + controlled inverter 32 + and 16 + or 24 +
    // and/or select 32 + nand/nor invert 32 + arithmetic/logic select 32 +
    // reserved-op mask 16 + op decode 8.
    alu8: 264,
    // 0 by omission (storage), reading `cost`'s 0 -- the shape `reg8` has.
    regfile6: undefined,
    // 0 stated: five bit slices of one input, i.e. wiring, like `splitter`.
    instr_decoder: 0,
    pc8: undefined,
    ram_prog: undefined,
    // 0 stated: a one-bit wire, like `level_output` and `splitter`.
    halt: 0,
  };

  it('states each gateCost the def\'s own comment documents', () => {
    // Explicit wherever the part is worth a NAND, so no count is inherited from
    // `cost` -- and ABSENT exactly on the storage defs, where the doc says so.
    expect(Object.keys(GATE_COST).sort()).toEqual([...CPU_DEF_IDS].sort());
    for (const id of CPU_DEF_IDS) {
      const def = registry.get(id);
      expect(def.gateCost, id).toBe(GATE_COST[id]);
      // The number the grader actually reads is `gateCost ?? cost`
      // (`levels/grader.ts`), so absence is a 0 and not a hole.
      expect(def.gateCost ?? def.cost, id).toBe(GATE_COST[id] ?? 0);
    }
    // The fields the gate metric omits are exactly the storage defs, so
    // "absent" cannot spread to a part that is worth gates: a combinational def
    // in this family states its count.
    for (const id of CPU_DEF_IDS) {
      const def = registry.get(id);
      expect(def.gateCost === undefined, `${id} omission vs sequential`).toBe(def.sequential);
    }
  });

  it('rebuilds alu8\'s count out of the registered parts, so the comment is auditable', () => {
    // Each term is one line of the derivation at `alu8` in `cpu.ts`, read from
    // the OTHER defs' own `gateCost`s rather than restated, so a single edited
    // number breaks the identity even after the table above is updated to match.
    const gate = (id: string): number => {
      const count = registry.get(id).gateCost;
      if (count === undefined) throw new Error(`no gateCost on ${id}`);
      return count;
    };
    const XOR = gate('xor'); // the 4-NAND cell one bit of each inverter is
    const NOT = gate('not');
    const AND = gate('and');
    expect(gate('alu8')).toBe(
      gate('add8') + // the ripple adder
        8 * XOR + // sub's controlled inverter, the +1 being the adder's cin
        gate('and8') + // and
        gate('or8') + // or
        gate('mux8') + // and/or select
        8 * XOR + // nand/nor invert
        gate('mux8') + // arithmetic/logic select
        gate('switch8') + // reserved-op zero mask, one AND per bit
        (2 * NOT + 2 * AND + AND), // op decode: two NOTs, an AND3, and op2 & op1
    );

    // Wiring is 0 on the gate metric, exactly as the two packers are...
    expect(gate('instr_decoder')).toBe(0);
    expect(gate('instr_decoder')).toBe(gate('splitter'));
    expect(gate('instr_decoder')).toBe(gate('maker'));
    // ...and 0 on the DELAY metric too, while `alu8` is the family's one
    // operator: one delay unit, and a gate count an order of magnitude above it.
    expect(registry.get('instr_decoder').cost).toBe(0);
    expect(registry.get('halt').cost).toBe(0);
    expect(registry.get('alu8').cost).toBe(1);
    expect(registry.get('alu8').gateCost!).toBeGreaterThan(registry.get('alu8').cost);
  });
});

// ---------------------------------------------------------------------------
// `alu8`
// ---------------------------------------------------------------------------

/**
 * The eight functions, written independently of the def: index IS the `op`
 * value, so a test failure names the opcode. Ops 6 and 7 are the reserved ones
 * the def decides to publish 0 for.
 */
const ALU_REFERENCE: readonly ((a: number, b: number) => number)[] = [
  (a, b) => (a + b) & 0xff,
  (a, b) => (a - b) & 0xff, // two's complement: 0 - 1 = 255
  (a, b) => a & b,
  (a, b) => a | b,
  (a, b) => ~(a & b) & 0xff,
  (a, b) => ~(a | b) & 0xff,
  () => 0,
  () => 0,
];

describe('alu8', () => {
  it('matches a hand-written table at the boundaries of every operation', () => {
    const TABLE: readonly (readonly [number, number, number, number])[] = [
      // a, b, op, out
      [0, 0, 0, 0],
      [1, 2, 0, 3],
      [0x7f, 1, 0, 0x80],
      [0xff, 1, 0, 0x00], // wraps; there is no carry-out pin
      [0xff, 0xff, 0, 0xfe],
      [5, 5, 1, 0],
      [1, 0, 1, 1],
      [0, 1, 1, 0xff], // the two's-complement case: 0 - 1 is 255, not -1
      [0, 2, 1, 0xfe],
      [0xf0, 0x0f, 2, 0x00],
      [0xff, 0xff, 2, 0xff],
      [0xf0, 0x0f, 3, 0xff],
      [0x0f, 0x0f, 4, 0xf0],
      [0xf0, 0x0f, 5, 0x00],
      // The reserved ops, on inputs that would make add/and/or produce
      // something: the value published is 0, not a fall-through.
      [0xff, 0xff, 6, 0x00],
      [0x12, 0x34, 6, 0x00],
      [0xff, 0xff, 7, 0x00],
      [0x12, 0x34, 7, 0x00],
    ];
    for (const [a, b, op, want] of TABLE) {
      expect(at('alu8', a, b, op), `alu8(${a},${b},op=${op})`).toBe(want);
    }
  });

  it('matches an independently written reference across every op and byte pair', () => {
    for (let op = 0; op < ALU_REFERENCE.length; op += 1) {
      for (const a of BYTES) {
        for (const b of BYTES) {
          expect(at('alu8', a, b, op), `alu8(${a},${b},op=${op})`).toBe(
            ALU_REFERENCE[op]!(a, b),
          );
        }
      }
    }
  });

  it('publishes 0 for the two reserved ops, and not an alias of an implemented one', () => {
    // The behaviour is only real if something checks it, and the two codes are
    // reachable: `op` is a pin, and a malformed instruction word can carry 110
    // or 111 into it. Decided in `cpu.ts` rather than left undefined.
    for (const op of [6, 7]) {
      for (const a of BYTES) {
        for (const b of BYTES) {
          expect(at('alu8', a, b, op), `alu8(${a},${b},op=${op})`).toBe(0);
        }
      }
      // A reserved op is NOT "whatever add would have said" -- the cheap
      // `default:` fall-through this def rejects. The operands are chosen so
      // neither `add` (0x46) nor `and` (0x10) is 0, which is what makes the
      // negative assertions mean something.
      expect(at('alu8', 0x12, 0x34, op), `alu8(18,52,op=${op})`).not.toBe(at('alu8', 0x12, 0x34, 0));
      expect(at('alu8', 0x12, 0x34, op)).not.toBe(at('alu8', 0x12, 0x34, 2));
    }
  });

  it('keeps every result an unsigned byte and reads an unwired pin as zero', () => {
    for (let op = 0; op < 8; op += 1) {
      for (const a of BYTES) {
        for (const b of BYTES) {
          const out = at('alu8', a, b, op);
          expect(out, `alu8(${a},${b},op=${op})`).toBeGreaterThanOrEqual(0);
          expect(out, `alu8(${a},${b},op=${op})`).toBeLessThanOrEqual(255);
        }
      }
    }
    // An unwired `b` reads 0, exactly as the kernel reads an unwired bit.
    expect(at('alu8', 0xff, undefined as unknown as number, 0)).toBe(0xff);
    expect(at('alu8', 0xff, undefined as unknown as number, 1)).toBe(0xff);
  });
});

// ---------------------------------------------------------------------------
// `regfile6`
// ---------------------------------------------------------------------------

/** `regfile6`'s inputs in pin order: `[addrA, addrB, waddr, data, we]`. */
const regInputs = (
  addrA: number,
  addrB: number,
  waddr: number,
  data: number,
  we: number,
): PortValue[] => [addrA, addrB, waddr, data, we];

describe('regfile6', () => {
  const def = registry.get('regfile6');

  it('writes the addressed register on the edge, but only while we is high', () => {
    const state = new Uint8Array(def.stateBytes);
    // The positive control first: with `we` high this is a write.
    edge(def, state, regInputs(0, 0, 0, 0x11, 1));
    expect(state[0]).toBe(0x11);
    expect(publish(def, state, regInputs(0, 1, 0, 0x00, 0))).toEqual([0x11, 0x00]);

    // THE TEST THAT WOULD PASS IF `we` WERE IGNORED: a low `we` with every
    // other input pointing at a write. `data` CHANGES (0x11 -> 0x22) and
    // `waddr` points at a different register, and the edge must still change
    // nothing at all -- not the target, not any other register.
    const before = Array.from(state);
    edge(def, state, regInputs(0, 0, 1, 0x22, 0));
    expect(Array.from(state), 'we low: no byte may change').toEqual(before);
    expect(state[0], 'the register that was written keeps its byte').toBe(0x11);
    expect(state[1], 'the register addressed with we low stays empty').toBe(0x00);
    expect(publish(def, state, regInputs(1, 0, 1, 0x22, 0))).toEqual([0x00, 0x11]);

    // ...and the same edge with `we` high DOES write, so the assertion above is
    // about the gate and not about a dead input.
    edge(def, state, regInputs(0, 0, 1, 0x22, 1));
    expect(state[1]).toBe(0x22);
    expect(state[0], 'the other register is untouched by that write').toBe(0x11);
  });

  it('holds every register across any number of we-low edges', () => {
    const state = new Uint8Array(def.stateBytes);
    for (let r = 0; r < 6; r += 1) edge(def, state, regInputs(0, 0, r, r * 0x11, 1));
    const held = Array.from(state);
    expect(held).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
    for (let i = 0; i < 10; i += 1) {
      edge(def, state, regInputs(0, 0, i % 6, 0xff - i, 0));
    }
    expect(Array.from(state), 'ten unwritten edges change nothing').toEqual(held);
    // The read ports still publish the held bytes after all those edges.
    expect(publish(def, state, regInputs(3, 5, 0, 0x00, 0))).toEqual([0x33, 0x55]);
  });

  it('reads two registers independently, the same one or different ones', () => {
    const state = new Uint8Array(def.stateBytes);
    const values = [0x0f, 0x10, 0x33, 0x7f, 0x80, 0xfe];
    for (let r = 0; r < 6; r += 1) edge(def, state, regInputs(0, 0, r, values[r]!, 1));

    // Different registers, and both orders of the same pair: two independent
    // ports, not one address published twice.
    expect(publish(def, state, regInputs(2, 5, 0, 0, 0))).toEqual([0x33, 0xfe]);
    expect(publish(def, state, regInputs(5, 2, 0, 0, 0))).toEqual([0xfe, 0x33]);
    // The same register on both ports.
    expect(publish(def, state, regInputs(4, 4, 0, 0, 0))).toEqual([0x80, 0x80]);
    // Every register, read through both ports at once.
    for (let r = 0; r < 6; r += 1) {
      expect(publish(def, state, regInputs(r, r, 0, 0, 0)), `REG${r}`).toEqual([
        values[r],
        values[r],
      ]);
    }
    expect(publish(def, state, regInputs(0, 1, 0, 0, 0))).toEqual([0x0f, 0x10]);
  });

  it('ignores waddr 6 and 7, which name inp and out rather than a register', () => {
    const state = new Uint8Array(def.stateBytes);
    edge(def, state, regInputs(0, 0, 0, 0x5a, 1));
    const before = Array.from(state);
    // Codes 6 / 7 are `inp` / `out` in ruling 5's source/target encoding: ports,
    // not registers, so a write to them has no state to land in -- and must not
    // alias REG0, which folding the address modulo six would do.
    for (const waddr of [6, 7]) {
      edge(def, state, regInputs(0, 0, waddr, 0xff, 1));
      expect(Array.from(state), `waddr ${waddr}`).toEqual(before);
    }
    // A read of 6 / 7 publishes 0: the value of a byte that was never written,
    // the same reading an unwired pin gets.
    expect(publish(def, state, regInputs(6, 7, 0, 0, 0))).toEqual([0x00, 0x00]);
    expect(publish(def, state, regInputs(0, 6, 0, 0, 0))).toEqual([0x5a, 0x00]);
  });

  it('publishes only what it holds: data, we and waddr never reach a port', () => {
    const state = new Uint8Array(def.stateBytes);
    edge(def, state, regInputs(0, 0, 3, 0x24, 1));
    // `addrA` / `addrB` are INDICES into state -- the storage contract's one
    // permitted exception. Every other input is hostile here: a def that read
    // `data` (0xab) or let `we` force a value would show it.
    expect(publish(def, state, regInputs(3, 3, 0, 0xab, 1))).toEqual([0x24, 0x24]);
    expect(publish(def, state, regInputs(0, 0, 3, 0xab, 1))).toEqual([0x00, 0x00]);
    expect(state[3], 'publishing changes nothing').toBe(0x24);
  });

  it('keeps its six bytes per instance, not per def', () => {
    const one = new Uint8Array(def.stateBytes);
    const other = new Uint8Array(def.stateBytes);
    edge(def, one, regInputs(0, 0, 5, 0x99, 1));
    expect(one[5]).toBe(0x99);
    expect(Array.from(other), 'a second instance starts empty').toEqual([0, 0, 0, 0, 0, 0]);
    expect(publish(def, other, regInputs(5, 5, 0, 0, 0))).toEqual([0x00, 0x00]);
  });
});

// ---------------------------------------------------------------------------
// `instr_decoder`
// ---------------------------------------------------------------------------

describe('instr_decoder', () => {
  it('decodes one instruction from each of the four modes, fields hand-computed', () => {
    // instr, mode, op, dst, src, imm -- the expected values are computed by hand
    // from ruling 5's layout (mode = [7:6], op = src = [5:3], dst = [2:0],
    // imm = [5:0]), not by re-running the def's own shifts.
    const TABLE: readonly (readonly [number, number, number, number, number, number])[] = [
      // loadi (mode 00): a 6-bit immediate, 42.
      [0b00_101010, 0, 0b101, 0b010, 0b101, 42],
      // calc (mode 01): op 001 = sub, reserved [2:0] = 000.
      [0b01_001_000, 1, 0b001, 0b000, 0b001, 0b001000],
      // move (mode 10): src 3 -> dst 5.
      [0b10_011_101, 2, 0b011, 0b101, 0b011, 0b011101],
      // jump (mode 11): condition 001 = jz, reserved [2:0] = 000.
      [0b11_001_000, 3, 0b001, 0b000, 0b001, 0b001000],
    ];
    for (const [instr, mode, op, dst, src, imm] of TABLE) {
      expect(outputsOf('instr_decoder', [instr]), `instr=0b${instr.toString(2)}`).toEqual([
        mode,
        op,
        dst,
        src,
        imm,
      ]);
    }
  });

  it('slices all 256 instruction words into the five fields', () => {
    // The exhaustive form of level 42's 256-row truth table: every field is a
    // shift-and-mask of the same byte, and `op` and `src` are the same three
    // bits published twice because which one is meaningful depends on `mode`.
    for (let instr = 0; instr < 256; instr += 1) {
      expect(outputsOf('instr_decoder', [instr]), `instr=${instr}`).toEqual([
        (instr >> 6) & 0b11,
        (instr >> 3) & 0b111,
        instr & 0b111,
        (instr >> 3) & 0b111,
        instr & 0b111111,
      ]);
    }
  });

  it('does not validate the reserved bits: it publishes them as dst', () => {
    // Ruling 5 marks [2:0] reserved-and-zero for `calc` and `jump`; checking
    // that is the LEVEL's job, and it does it through this very pin -- a
    // decoder that forced `dst` to 0 would make level 42's check pass for every
    // input. Both reserved-bearing modes are exercised, with the reserved field
    // deliberately non-zero.
    expect(outputsOf('instr_decoder', [0b01_010_111])).toEqual([1, 0b010, 0b111, 0b010, 0b010111]);
    expect(outputsOf('instr_decoder', [0b11_010_111])).toEqual([3, 0b010, 0b111, 0b010, 0b010111]);
    // The same field on a mode that has no reserved bits, for contrast: `move`
    // reads those bits as its destination.
    expect(outputsOf('instr_decoder', [0b10_010_111])).toEqual([2, 0b010, 0b111, 0b010, 0b010111]);
    // An unwired `instr` reads 0, so every field is 0 rather than undefined.
    expect(outputsOf('instr_decoder', [undefined as unknown as number])).toEqual([0, 0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// `pc8`
// ---------------------------------------------------------------------------

describe('pc8', () => {
  const def = registry.get('pc8');

  it('increments on every edge with load low, wrapping at 255 to 0', () => {
    const state = new Uint8Array(def.stateBytes);
    // inputs: [load, in]
    edge(def, state, [0, 0x42]);
    expect(state[0], 'a fresh counter starts at zero and advances to one').toBe(1);
    edge(def, state, [0, 0x42]);
    expect(state[0], '`in` is ignored while load is low').toBe(2);
    state[0] = 0x7f;
    edge(def, state, [0, 0xff]);
    expect(state[0]).toBe(0x80);
    // DECIDED, not incidental: the address space is 256 bytes, so the successor
    // of 255 is 0 -- not a saturation at 255.
    state[0] = 0xff;
    edge(def, state, [0, 0x00]);
    expect(state[0]).toBe(0x00);
    edge(def, state, [0, 0x00]);
    expect(state[0]).toBe(0x01);
  });

  it('loads `in` when load is high, and resumes counting from there', () => {
    const state = new Uint8Array(def.stateBytes);
    state[0] = 0x10;
    edge(def, state, [1, 0x42]);
    expect(state[0]).toBe(0x42);
    edge(def, state, [1, 0x00]);
    expect(state[0], 'a second load wins over the increment again').toBe(0x00);
    edge(def, state, [0, 0x99]);
    expect(state[0], 'load low: the counter counts, it does not load').toBe(0x01);
    // An unwired `load` reads 0, so the edge increments.
    edge(def, state, [undefined as unknown as number, 0x99]);
    expect(state[0]).toBe(0x02);
  });

  it('samples load at the edge and publishes the held address, never its inputs', () => {
    const state = new Uint8Array(def.stateBytes);
    state[0] = 0x43;
    // `evaluate` is hostiled on both inputs: `in` is 0x00 and `load` is high, and
    // the published address must still be the held one. A counter that mirrors
    // `in` would show 0x00; one that published 0 on `load` would show 0.
    expect(publish(def, state, [1, 0x00])).toEqual([0x43]);
    expect(state[0], 'publishing is not sampling').toBe(0x43);
    expect(publish(def, state, [0, 0xff])).toEqual([0x43]);
    // The edge is where sampling happens, and only there.
    edge(def, state, [1, 0x00]);
    expect(publish(def, state, [0, 0xff])).toEqual([0x00]);
  });
});

// ---------------------------------------------------------------------------
// `ram_prog`
// ---------------------------------------------------------------------------

describe('ram_prog', () => {
  const def = registry.get('ram_prog');

  /** Distinct per address (7 is odd, so the map is a bijection mod 256). */
  const image = (addr: number): number => (addr * 7 + 1) & 0xff;

  it('holds 256 bytes and publishes the addressed one', () => {
    expect(def.stateBytes).toBe(256);
    const state = new Uint8Array(def.stateBytes);
    // Nothing loaded yet: a fresh instance is 256 zero bytes, and `addr` 0 is
    // not special.
    expect(publish(def, state, [0])).toEqual([0x00]);
    expect(publish(def, state, [255])).toEqual([0x00]);
  });

  it('publishes a byte placed in its state, which is what loadImage writes', () => {
    // THE KERNEL PATH FOR THIS is `Simulation.loadImage(instanceId, bytes)`
    // (task 4, `net.ts`): it copies the assembled program into exactly this
    // state array after `reset()`, because `compile()` never touches state and
    // `reset()` zeroes it (task 1's recon, `recon-kernel.md`). This test drives
    // the state contract one level down -- the array the loader fills and the
    // `evaluate` that publishes it -- and the fixture below drives the kernel
    // method itself.
    const state = new Uint8Array(def.stateBytes);
    state.set(Array.from({ length: 256 }, (_, addr) => image(addr)));
    for (let addr = 0; addr < 256; addr += 1) {
      expect(publish(def, state, [addr]), `addr ${addr}`).toEqual([image(addr)]);
    }
  });

  it('reads addr as an index into state, not as a value', () => {
    const state = new Uint8Array(def.stateBytes);
    state[0x2a] = 0xab;
    expect(publish(def, state, [0x2a])).toEqual([0xab]);
    // The neighbours are still empty, so the byte came from the addressed slot
    // and not from anywhere else -- a def that published `addr` would give 0x2a.
    expect(publish(def, state, [0x2b])).toEqual([0x00]);
    expect(publish(def, state, [0x29])).toEqual([0x00]);
    expect(publish(def, state, [0x2a])).not.toEqual([0x2a]);
    // An unwired `addr` reads 0.
    expect(publish(def, state, [undefined as unknown as number])).toEqual([0x00]);
  });

  it('cannot be written from the circuit: its clock edge changes nothing', () => {
    const state = new Uint8Array(def.stateBytes);
    state[7] = 0x5a;
    const before = Array.from(state);
    // There is no write pin, so there is no edge on which anything could be
    // sampled -- the pin list, not a flag, is what makes the part read-only.
    edge(def, state, [7]);
    edge(def, state, [0, 0xff, 1]);
    expect(Array.from(state), 'no edge can alter a program image').toEqual(before);
    expect(def.inputs.map((p) => p.id)).toEqual(['addr']);
  });

  it('keeps its image per instance', () => {
    const one = new Uint8Array(def.stateBytes);
    const other = new Uint8Array(def.stateBytes);
    one[3] = 0x77;
    expect(publish(def, one, [3])).toEqual([0x77]);
    expect(publish(def, other, [3]), 'a second instance has its own image').toEqual([0x00]);
  });
});

/**
 * `ram_prog` through the kernel: `Simulation.loadImage` is how a level's
 * assembled program reaches the part, and the two facts below are the ones the
 * `program` checker is built on -- the loaded byte reaches `out` and survives a
 * tick, and `reset()` erases it (which is why the loader runs AFTER the reset).
 *
 * The def-level tests above are the part's own contract; these are the
 * integration, so a kernel change to the loader cannot pass by agreeing with
 * itself.
 */
describe('ram_prog through the kernel', () => {
  /** `addr:8` -> `ram_prog` -> `OUT:8`, plus the RAM instance's document id. */
  function ramFixture(): { ramId: string; sim: Simulation; net: Netlist } {
    const graph = build([
      { kind: 'input', name: 'addr', width: 8 },
      { kind: 'part', def: 'ram_prog', id: 'prog', from: ['addr'] },
      { kind: 'output', name: 'OUT', width: 8, from: 'prog.out' },
    ]);
    const ram = graph.instances.find((inst) => inst.def === 'ram_prog');
    if (!ram) throw new Error('the fixture has no ram_prog instance');
    const net = compile(graph, registry);
    return { ramId: ram.id, sim: new Simulation(net, registry), net };
  }

  /** Drives a level input pin the way `levels/checks.ts` does. */
  const write = (sim: Simulation, net: Netlist, name: string, value: number): void => {
    const key = `IN_${name}.out`;
    sim.write(net.outputBase(key), net.outputWidth(key), value);
  };

  /** Reads a level output pin. */
  const read = (sim: Simulation, net: Netlist, name: string): number => {
    const key = `${name}.in`;
    return toNumber(sim.read(net.inputBase(key), net.inputWidth(key)));
  };

  it('publishes the byte loadImage wrote, addressed and across a tick', () => {
    const { ramId, sim, net } = ramFixture();
    sim.reset();
    // AFTER the reset -- the ordering the recon established: a load before it
    // would be erased by `state.fill(0)`.
    sim.loadImage(ramId, [0x11, 0x22, 0x33, 0xff]);
    for (const [addr, want] of [[0, 0x11], [1, 0x22], [2, 0x33], [3, 0xff], [4, 0x00]] as const) {
      write(sim, net, 'addr', addr);
      sim.settle();
      expect(read(sim, net, 'OUT'), `addr ${addr}`).toBe(want);
    }
    // A program memory is not a delay line: a clock edge must not disturb the
    // image the program is executing from.
    sim.tick();
    write(sim, net, 'addr', 3);
    sim.settle();
    expect(read(sim, net, 'OUT'), 'the image survives a tick').toBe(0xff);
  });

  it('clears its image on reset(), so the loader must run after it', () => {
    const { ramId, sim, net } = ramFixture();
    sim.reset();
    sim.loadImage(ramId, [0xab]);
    write(sim, net, 'addr', 0);
    sim.settle();
    expect(read(sim, net, 'OUT')).toBe(0xab);
    sim.reset();
    sim.settle();
    expect(read(sim, net, 'OUT'), 'reset() zeroes state, image included').toBe(0x00);
  });
});

// ---------------------------------------------------------------------------
// `halt`
// ---------------------------------------------------------------------------

describe('halt', () => {
  it('passes its single input through, combinationally', () => {
    expect(at('halt', 0)).toBe(0);
    expect(at('halt', 1)).toBe(1);
    // An unwired input reads 0, so `out` is 0 rather than undefined.
    expect(outputsOf('halt', [undefined as unknown as number])).toEqual([0]);
    // A wire, not a rail: it carries the signal it names, because the level
    // asserts on the halt line GOING HIGH.
    expect(at('halt', 1)).not.toBe(0);
  });

  it('is free on both metrics and holds no state', () => {
    const def = registry.get('halt');
    expect(def.cost).toBe(0);
    expect(def.gateCost).toBe(0);
    expect(def.stateBytes).toBe(0);
    expect(def.sequential).toBe(false);
    expect(def.clockEdge).toBeUndefined();
  });
});
