import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { ComponentDef, Registry } from '../../src/core/registry';
import { CircuitValidationError, UnstableCircuitError } from '../../src/core/errors';
import type { PortValue } from '../../src/core/signal';
import { SETTLE_LIMIT, Simulation, compile, delayOf } from '../../src/core/net';

const registry = createRegistry(BASE_DEFS);

const toNumber = (v: PortValue): number =>
  typeof v === 'number' ? v : Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);

/** A NAND whose pins are addressed by name as `"<instId>.<pinId>"`. */
function nandFixture(): {
  graph: Graph;
  nand: string;
} {
  const g = emptyGraph();
  const nand = addInstance(g, 'nand', 0, 0);
  return { graph: g, nand: nand.id };
}

describe('compile', () => {
  it('allocates one slot per bit of every pin', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect(net.instanceCount).toBe(1);
    // 2 inputs + 1 output
    expect(net.slotCount).toBe(3);
  });

  it('records the origin instance of every expanded instance', () => {
    const { graph } = nandFixture();
    const net = compile(graph, registry);
    expect([...net.refs.values()]).toEqual([graph.instances[0]!.id]);
  });

  it('rejects invalid graphs', () => {
    const g = emptyGraph();
    addInstance(g, 'nope', 0, 0);
    expect(() => compile(g, registry)).toThrow(/invalid/i);
  });

  it('sizes the signal table for the circuit instead of the 65,536 default', () => {
    // 16,500 three-input gates occupy 66,000 slots (4 each), which is more than
    // `createSignalTable`'s default capacity: compiling them proves the capacity
    // is derived from the circuit rather than inherited from the default.
    const g = emptyGraph();
    const gates = 16_500;
    for (let i = 0; i < gates; i += 1) addInstance(g, 'and3', 0, 0, `i${i}`);
    const net = compile(g, registry);
    expect(net.slotCount).toBe(gates * 4);
    expect(net.slotCount).toBeGreaterThan(65_536);
    expect(new Simulation(net, registry).settle().stable).toBe(true);
  });

  // `4097` is one past the documented cap and `MAX_SAFE_INTEGER` is what a
  // hand-authored width looks like when it is not hand-authored at all: the
  // first would allocate a table far larger than any level needs, the second
  // makes `capacityFor` ask for more bytes than a `Uint8Array` can hold, so the
  // `RangeError` from the allocation would escape `compile` -- and from there
  // `createSim`, `runChecks` and `grade` -- instead of surfacing as the
  // catchable `CircuitValidationError` this test pins.
  it.each([0, -1, 1.5, Number.NaN, 4097, Number.MAX_SAFE_INTEGER])(
    'rejects a malformed params.width (%s) as a validation issue',
    (width) => {
      // An instance width feeds slot allocation, so a value `alloc` cannot take
      // has to be reported like an unknown def -- as a `GraphIssue` that
      // `compile` turns into a catchable `CircuitValidationError` -- rather than
      // allowed to reach `table.alloc`, which throws a bare `RangeError` out of
      // the level-grading path.
      const g = emptyGraph();
      addInstance(g, 'level_input', 0, 0, 'feed').params.width = width;
      let caught: unknown;
      try {
        compile(g, registry);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CircuitValidationError);
      expect((caught as CircuitValidationError).issues.map((issue) => issue.code)).toEqual([
        'invalid-params',
      ]);
    },
  );
});

describe('Simulation', () => {
  it('evaluates a NAND for every input combination', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const a = net.inputBase(`${nand.id}.a`);
    const b = net.inputBase(`${nand.id}.b`);
    const out = net.outputBase(`${nand.id}.out`);
    for (const [va, vb, want] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as const) {
      sim.write(a, 1, va);
      sim.write(b, 1, vb);
      sim.settle();
      expect(sim.read(out, 1), `nand(${va},${vb})`).toBe(want);
    }
  });

  it('propagates through a chain of gates in one settle', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'not', 40, 0);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.write(net.inputBase(`${n1.id}.a`), 1, 1);
    sim.write(net.inputBase(`${n1.id}.b`), 1, 1);
    sim.settle();
    // nand(1,1) = 0, then not(0) = 1.
    expect(sim.read(net.outputBase(`${n2.id}.out`), 1)).toBe(1);
  });

  it('treats an unwired input as zero', () => {
    const g = emptyGraph();
    const nand = addInstance(g, 'nand', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.settle();
    // nand(0,0) = 1
    expect(sim.read(net.outputBase(`${nand.id}.out`), 1)).toBe(1);
  });

  it('throws UnstableCircuitError for a combinational feedback loop', () => {
    // Two cross-coupled NANDs whose free input is tied high, so each one is an
    // inverter: the loop has no stable state and must exhaust the settle cap.
    const g = emptyGraph();
    const one = addInstance(g, 'const_on', 0, 0);
    const n1 = addInstance(g, 'nand', 0, 40);
    const n2 = addInstance(g, 'nand', 0, 80);
    connect(g, { inst: one.id, port: 'out' }, { inst: n1.id, port: 'b' });
    connect(g, { inst: one.id, port: 'out' }, { inst: n2.id, port: 'b' });
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    expect(() => sim.settle()).toThrow(UnstableCircuitError);

    let caught: unknown;
    try {
      sim.settle();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnstableCircuitError);
    expect((caught as UnstableCircuitError).iterations).toBe(SETTLE_LIMIT);
    expect((caught as UnstableCircuitError).blame).toContain(n1.id);
  });

  it('settles a delay_line held loop and publishes state on the edge', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const out = net.outputBase(`${delay.id}.out`);
    sim.reset();
    expect(sim.read(out, 1)).toBe(0); // starts empty
    sim.tick();
    expect(sim.read(out, 1)).toBe(1); // one edge later the input has arrived
  });

  it('a delay line holds its sampled value when its input changes', () => {
    // The timing test that pins the storage semantics: a delay line publishes
    // what it holds, so flipping its input between clock edges must not change
    // its output. If `settle` published the input instead of the state, or if the
    // settle loop skipped storage elements, the delay line would be a plain wire.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: feed.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const feedSlot = net.outputBase(`${feed.id}.out`);
    const out = net.outputBase(`${delay.id}.out`);

    sim.reset();
    sim.write(feedSlot, 1, 1); // raise the input
    sim.settle();
    expect(sim.read(out, 1)).toBe(0); // still holding the old 0: no edge yet

    sim.tick(); // first edge samples the raised input
    expect(sim.read(out, 1)).toBe(1);

    sim.write(feedSlot, 1, 0); // drop the input again
    sim.settle();
    expect(sim.read(out, 1)).toBe(1); // must STILL read 1 until the next edge

    sim.tick(); // second edge samples the dropped input
    expect(sim.read(out, 1)).toBe(0);
  });

  it('keeps an externally driven output (level_input) through a settle', () => {
    // `level_input.evaluate` writes nothing; the checker drives its output slot.
    // The settle sweep must leave such a pin alone instead of zeroing it.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0);
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const slot = net.outputBase(`${feed.id}.out`);
    sim.write(slot, 1, 1);
    sim.settle();
    expect(sim.read(slot, 1)).toBe(1);
  });

  it('binds level I/O by pin name: drives a level_input, reads a level_output pin', () => {
    // The level checker (Task 6) drives `level_input` output slots and reads the
    // slot driving a `level_output` input pin. Both only work if a settle sweep
    // leaves externally driven pins alone and `inputBase` reports the driver.
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0, 'IN_A');
    const inB = addInstance(g, 'level_input', 0, 60, 'IN_B');
    const nand = addInstance(g, 'nand', 60, 20);
    const not = addInstance(g, 'not', 120, 20);
    const out = addInstance(g, 'level_output', 180, 20, 'OUT');
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: inB.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
    connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    for (const [va, vb, want] of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 1],
    ] as const) {
      sim.reset();
      sim.write(net.outputBase(`${inA.id}.out`), 1, va);
      sim.write(net.outputBase(`${inB.id}.out`), 1, vb);
      sim.settle();
      expect(sim.read(net.inputBase(`${out.id}.in`), 1), `and(${va},${vb})`).toBe(want);
    }
  });

  it('settles a feedback loop that a storage element breaks', () => {
    // delay_line -> not -> delay_line is a real loop, but the delay line samples
    // its input instead of propagating it, so the loop is not combinational: the
    // circuit settles between edges and toggles once per edge.
    const g = emptyGraph();
    const delay = addInstance(g, 'delay_line', 0, 0);
    const inv = addInstance(g, 'not', 60, 0);
    connect(g, { inst: delay.id, port: 'out' }, { inst: inv.id, port: 'a' });
    connect(g, { inst: inv.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const out = net.outputBase(`${delay.id}.out`);
    sim.reset();
    expect(sim.read(out, 1)).toBe(0);
    expect(sim.read(net.outputBase(`${inv.id}.out`), 1)).toBe(1); // settled, not oscillating
    sim.tick();
    expect(sim.read(out, 1)).toBe(1);
    sim.tick();
    expect(sim.read(out, 1)).toBe(0);
  });

  it('settles a wide pin whose read-back form differs from the written form', () => {
    // A 12-bit def writes a number; the table reads a wide port back as two
    // bytes. Comparing those representations instead of their bits would see a
    // change on every sweep and report a healthy circuit as unstable.
    const widePass: ComponentDef = {
      id: 'wide_pass',
      name: { zh: '宽通道', en: 'Wide Pass' },
      category: 'wide',
      inputs: [{ id: 'in', width: 12 }],
      outputs: [{ id: 'out', width: 12 }],
      cost: 1,
      sequential: false,
      stateBytes: 0,
      evaluate: (i, o) => {
        o[0] = toNumber(i[0] ?? 0);
      },
    };
    const wide = createRegistry([...BASE_DEFS, widePass]);
    const g = emptyGraph();
    const pass = addInstance(g, 'wide_pass', 0, 0);
    const net = compile(g, wide);
    const sim = new Simulation(net, wide);
    sim.write(net.inputBase(`${pass.id}.in`), 12, 0xabc);
    expect(sim.settle().stable).toBe(true);
    expect(toNumber(sim.read(net.outputBase(`${pass.id}.out`), 12))).toBe(0xabc);
  });

  it('reset clears state and the tick counter', () => {
    const g = emptyGraph();
    const src = addInstance(g, 'const_on', 0, 0);
    const delay = addInstance(g, 'delay_line', 40, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    sim.tick();
    expect(sim.tickCount).toBe(1);
    sim.reset();
    expect(sim.tickCount).toBe(0);
    expect(sim.read(net.outputBase(`${delay.id}.out`), 1)).toBe(0);
  });
});

/**
 * A source the test drives directly through its output slot: `level_input` at an
 * arbitrary width. `evaluate` writes nothing on purpose, so whatever the test
 * wrote into the slot survives the settle sweep -- which is how these tests put
 * a live, toggling signal in the slots next to a pin under test.
 */
function feedDef(width: number): ComponentDef {
  return {
    id: `feed${width}`,
    name: { zh: '测试源', en: 'Test Feed' },
    category: 'wide',
    inputs: [],
    outputs: [{ id: 'out', width }],
    cost: 0,
    sequential: false,
    stateBytes: 0,
    evaluate: () => {},
  };
}

/** Copies its one input pin to its one output pin, bit for bit, at any width. */
function passDef(width: number): ComponentDef {
  return {
    id: `pass${width}`,
    name: { zh: '直通', en: 'Pass' },
    category: 'wide',
    inputs: [{ id: 'in', width }],
    outputs: [{ id: 'out', width }],
    cost: 1,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      o[0] = typeof i[0] === 'number' ? i[0] : toNumber(i[0] ?? 0);
    },
  };
}

interface WideFixture {
  readonly graph: Graph;
  readonly registry: Registry;
}

/**
 * `bit.out -> wide.in`, i.e. a 1-bit output driving an 8-bit input, with a
 * directly driven 8-bit feed sitting in the slots right after the driver.
 *
 * Slot order is what makes this a reproduction rather than an arbitrary shape.
 * Instances are allocated in document order and, within an instance, inputs
 * before outputs, so this document gives:
 *
 *   `bit.in` 0, `bit.out` 1, `feed.out` 2..9, `wide.in` 10..17, `wide.out` 18..25
 *
 * `bit.out` therefore sits directly against the seven live bits of `feed.out`,
 * which is exactly the layout the old read (`getPort(drive[wide.in], 8)`, eight
 * consecutive slots from the driver) turned into silent corruption.
 */
function narrowDriverFixture(): WideFixture {
  const registry = createRegistry([...BASE_DEFS, feedDef(8), passDef(1), passDef(8)]);
  const g = emptyGraph();
  const bit = addInstance(g, 'pass1', 0, 0, 'bit');
  const feed = addInstance(g, 'feed8', 0, 40, 'feed');
  const wide = addInstance(g, 'pass8', 0, 80, 'wide');
  connect(g, { inst: bit.id, port: 'out' }, { inst: wide.id, port: 'in' });
  return { graph: g, registry };
}

describe('wide ports', () => {
  it('shows only the driving bit when a 1-bit output feeds an 8-bit input beside a live signal', () => {
    // The reproduction of the silent corruption. `wide.in` is driven by one bit
    // and is 8 bits wide, so its read must be `bit` in position 0 and zeros
    // above -- not the seven slots that happen to follow the driver in the
    // table, which here hold `feed`'s live bits.
    const { graph, registry: reg } = narrowDriverFixture();
    const net = compile(graph, reg);
    const sim = new Simulation(net, reg);
    const feed = net.outputBase('feed.out');
    const bitIn = net.inputBase('bit.in');
    const observed = net.outputBase('wide.out');

    // The reproduction depends on that adjacency; assert it rather than trust
    // the allocation order documented above.
    expect(feed).toBe(net.outputBase('bit.out') + 1);

    for (const [feedValue, bit] of [
      [0xff, 1],
      [0xff, 0],
      [0x00, 1],
      [0x00, 0],
    ] as const) {
      sim.reset();
      sim.write(feed, 8, feedValue); // the neighbouring pin toggles 0xff <-> 0x00
      sim.write(bitIn, 1, bit);
      sim.settle();
      expect(toNumber(sim.read(observed, 8)), `feed=${feedValue} bit=${bit}`).toBe(bit);
    }
  });

  it('takes only the low bit when an 8-bit output drives a 1-bit input', () => {
    const reg = createRegistry([...BASE_DEFS, feedDef(8), passDef(1)]);
    const g = emptyGraph();
    const feed = addInstance(g, 'feed8', 0, 0, 'feed');
    const one = addInstance(g, 'pass1', 0, 40, 'one');
    connect(g, { inst: feed.id, port: 'out' }, { inst: one.id, port: 'in' });
    const net = compile(g, reg);
    const sim = new Simulation(net, reg);
    const feedBase = net.outputBase('feed.out');

    expect(net.inputBase('one.in')).toBe(feedBase);
    for (const value of [0x00, 0x01, 0x42, 0xab, 0xfe, 0xff]) {
      sim.write(feedBase, 8, value);
      sim.settle();
      expect(toNumber(sim.read(net.outputBase('one.out'), 1)), `value=${value}`).toBe(value & 1);
      expect(toNumber(sim.read(net.inputBase('one.in'), 1)), `value=${value}`).toBe(value & 1);
    }
  });

  it('transfers every bit when an 8-bit output drives an 8-bit input', () => {
    const reg = createRegistry([...BASE_DEFS, feedDef(8), passDef(8)]);
    const g = emptyGraph();
    const feed = addInstance(g, 'feed8', 0, 0, 'feed');
    const wide = addInstance(g, 'pass8', 0, 40, 'wide');
    connect(g, { inst: feed.id, port: 'out' }, { inst: wide.id, port: 'in' });
    const net = compile(g, reg);
    const sim = new Simulation(net, reg);
    const feedBase = net.outputBase('feed.out');

    // Equal widths are a contiguous run of the driver's own slots, so the pin
    // reads them directly.
    expect(net.inputBase('wide.in')).toBe(feedBase);
    for (const value of [0x00, 0x01, 0x55, 0x80, 0xab, 0xff]) {
      sim.write(feedBase, 8, value);
      sim.settle();
      expect(toNumber(sim.read(net.outputBase('wide.out'), 8)), `value=${value}`).toBe(value);
      expect(toNumber(sim.read(net.inputBase('wide.in'), 8)), `value=${value}`).toBe(value);
    }
  });

  it('hands back a read region that belongs to one pin and is fresh after settle', () => {
    const { graph, registry: reg } = narrowDriverFixture();
    const net = compile(graph, reg);
    const sim = new Simulation(net, reg);
    const feed = net.outputBase('feed.out');
    const bitIn = net.inputBase('bit.in');
    const base = net.inputBase('wide.in');

    // Not the driver's base: `read(driverBase, 8)` would sweep up the seven live
    // slots that follow it, which is the corruption this task removes.
    expect(base).not.toBe(net.outputBase('bit.out'));

    sim.write(feed, 8, 0xff);
    sim.write(bitIn, 1, 1);
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(1); // bit 0 only, no extra call needed

    sim.write(feed, 8, 0x00); // the neighbour changes; the pin does not
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(1);

    sim.write(bitIn, 1, 0);
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(0); // refreshed by that settle
    // Coherent with what the pin's own consumer sees, bit for bit.
    expect(toNumber(sim.read(base, 8))).toBe(toNumber(sim.read(net.outputBase('wide.out'), 8)));
  });

  it('zero-extends a narrower driver into a 12-bit input', () => {
    // Widths above 8 read back as bytes, so this covers the other branch of the
    // gather (and of the region refresh): bits 8..11 have no driver and are 0.
    const reg = createRegistry([...BASE_DEFS, feedDef(8), passDef(12)]);
    const g = emptyGraph();
    const feed = addInstance(g, 'feed8', 0, 0, 'feed');
    const wide = addInstance(g, 'pass12', 0, 40, 'wide');
    connect(g, { inst: feed.id, port: 'out' }, { inst: wide.id, port: 'in' });
    const net = compile(g, reg);
    const sim = new Simulation(net, reg);
    const feedBase = net.outputBase('feed.out');

    for (const value of [0x00, 0x01, 0xab, 0xff]) {
      sim.write(feedBase, 8, value);
      sim.settle();
      expect(toNumber(sim.read(net.outputBase('wide.out'), 12)), `value=${value}`).toBe(value);
      expect(toNumber(sim.read(net.inputBase('wide.in'), 12)), `value=${value}`).toBe(value);
    }
  });

  it('materialises a region only for a pin whose driver is narrower', () => {
    // Equal widths: out(8) + in(8) + out(8) pin bits and no region.
    const same = createRegistry([...BASE_DEFS, feedDef(8), passDef(8)]);
    const sameGraph = emptyGraph();
    const src = addInstance(sameGraph, 'feed8', 0, 0, 'feed');
    const dst = addInstance(sameGraph, 'pass8', 0, 40, 'wide');
    connect(sameGraph, { inst: src.id, port: 'out' }, { inst: dst.id, port: 'in' });
    expect(compile(sameGraph, same).slotCount).toBe(24);

    // Narrower driver: the same circuit plus one 8-bit region for the wide input
    // (2 + 8 + 16 pin bits, + 8 region bits).
    const { graph, registry: reg } = narrowDriverFixture();
    expect(compile(graph, reg).slotCount).toBe(34);
  });
});

/**
 * `bit.out -> wide.in`, where EVERY width above one comes from `params.width`
 * rather than from a def: `bit` is a 1-bit `pass1`, `feed` is a `level_input`
 * whose one-bit def pin is widened to 8, and `wide` is another `pass1` raised to
 * 8 bits. Slot order is the same as `narrowDriverFixture`'s, because instances
 * are allocated in document order with inputs before outputs:
 *
 *   `bit.in` 0, `bit.out` 1, `feed.out` 2..9, `wide.in` 10..17, `wide.out` 18..25
 *
 * `bit.out` therefore sits directly against the seven live bits of `feed.out`,
 * so this is the Task-1 reproduction with the width resolved per instance.
 */
function paramsWideFixture(): WideFixture {
  const registry = createRegistry([...BASE_DEFS, passDef(1)]);
  const g = emptyGraph();
  const bit = addInstance(g, 'pass1', 0, 0, 'bit');
  const feed = addInstance(g, 'level_input', 0, 40, 'feed');
  feed.params.width = 8;
  const wide = addInstance(g, 'pass1', 0, 80, 'wide');
  wide.params.width = 8;
  connect(g, { inst: bit.id, port: 'out' }, { inst: wide.id, port: 'in' });
  return { graph: g, registry };
}

describe('per-instance pin widths', () => {
  it('resolves a pin width from the instance over the def', () => {
    // `level_input.out` is declared 1 bit wide; this instance says 8, and that
    // is what the netlist allocates, reports and lets a caller write.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'feed');
    feed.params.width = 8;
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const base = net.outputBase('feed.out');

    expect(net.outputWidth('feed.out')).toBe(8);
    expect(net.slotCount).toBe(8);
    sim.write(base, 8, 0xa5);
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(0xa5);
  });

  it('leaves every width at the def default when the instance sets no params', () => {
    // The Phase-0 regression, pinned by hand as well as by the whole existing
    // suite: an instance with empty params is allocated, sized and reported
    // exactly as its def declares.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'feed');
    const sink = addInstance(g, 'level_output', 0, 40, 'OUT');
    connect(g, { inst: feed.id, port: 'out' }, { inst: sink.id, port: 'in' });
    const net = compile(g, registry);

    expect(net.outputWidth('feed.out')).toBe(1);
    expect(net.inputWidth('OUT.in')).toBe(1);
    expect(net.outputWidth('OUT.mirror')).toBe(1);
    // feed.out + OUT.in + OUT.mirror, one bit each.
    expect(net.slotCount).toBe(3);
  });

  it('reports an unknown pin by name and direction', () => {
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'feed');
    feed.params.width = 8;
    const net = compile(g, registry);
    expect(() => net.inputWidth('feed.out')).toThrow(/no such input pin: feed\.out/);
    expect(() => net.outputWidth('feed.in')).toThrow(/no such output pin: feed\.in/);
  });

  it('gathers a params-wide pin per bit when its driver is narrower', () => {
    const { graph, registry: reg } = paramsWideFixture();
    const net = compile(graph, reg);
    const sim = new Simulation(net, reg);
    const feed = net.outputBase('feed.out');
    const bitIn = net.inputBase('bit.in');
    const observed = net.outputBase('wide.out');

    expect(net.inputWidth('wide.in')).toBe(8);
    // The reproduction depends on that adjacency; assert it rather than trust
    // the allocation order documented above.
    expect(feed).toBe(net.outputBase('bit.out') + 1);

    for (const [feedValue, bit] of [
      [0xff, 1],
      [0xff, 0],
      [0x00, 1],
      [0x00, 0],
    ] as const) {
      sim.reset();
      sim.write(feed, 8, feedValue); // the neighbouring pin toggles 0xff <-> 0x00
      sim.write(bitIn, 1, bit);
      sim.settle();
      expect(toNumber(sim.read(observed, 8)), `feed=${feedValue} bit=${bit}`).toBe(bit);
    }
  });

  it('gives a params-wide pin a coherent 8-bit region when its driver is narrower', () => {
    const { graph, registry: reg } = paramsWideFixture();
    const net = compile(graph, reg);
    const sim = new Simulation(net, reg);
    const feed = net.outputBase('feed.out');
    const bitIn = net.inputBase('bit.in');
    const base = net.inputBase('wide.in');

    // Sized from `params.width`, and not the driver's base: `read(driver, 8)`
    // would sweep up the seven live slots that follow the one-bit driver.
    expect(net.inputWidth('wide.in')).toBe(8);
    expect(base).not.toBe(net.outputBase('bit.out'));
    // 2 + 8 + 16 pin bits, plus one 8-bit region.
    expect(net.slotCount).toBe(34);

    sim.write(feed, 8, 0xff);
    sim.write(bitIn, 1, 1);
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(1); // bit 0 only, no extra call needed

    sim.write(feed, 8, 0x00); // the neighbour changes; the pin does not
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(1);

    sim.write(bitIn, 1, 0);
    sim.settle();
    expect(toNumber(sim.read(base, 8))).toBe(0); // refreshed by that settle
    // Coherent with what the pin's own consumer sees, bit for bit.
    expect(toNumber(sim.read(base, 8))).toBe(toNumber(sim.read(net.outputBase('wide.out'), 8)));
  });

  it('reads a params-wide pin straight from an equally wide driver', () => {
    const reg = createRegistry([...BASE_DEFS, passDef(1)]);
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'feed');
    feed.params.width = 8;
    const wide = addInstance(g, 'pass1', 0, 40, 'wide');
    wide.params.width = 8;
    connect(g, { inst: feed.id, port: 'out' }, { inst: wide.id, port: 'in' });
    const net = compile(g, reg);
    const sim = new Simulation(net, reg);

    // Equal widths are one contiguous run of the driver's own slots, so nothing
    // is materialised and the pin reads the driver's base directly.
    expect(net.inputBase('wide.in')).toBe(net.outputBase('feed.out'));
    expect(net.slotCount).toBe(24);
    for (const value of [0x00, 0x01, 0x55, 0x80, 0xab, 0xff]) {
      sim.write(net.outputBase('feed.out'), 8, value);
      sim.settle();
      expect(toNumber(sim.read(net.outputBase('wide.out'), 8)), `value=${value}`).toBe(value);
      expect(toNumber(sim.read(net.inputBase('wide.in'), 8)), `value=${value}`).toBe(value);
    }
  });

  it('reserves table capacity for params-derived widths and their read regions', () => {
    // The capacity is fixed at compile time, so it has to be derived from the
    // SAME widths the allocation loop uses -- read regions included. 24 one-bit
    // sources driving 24 eight-bit `pass1` instances need 17*24 pin slots plus
    // 8*24 region slots = 600. A capacity computed from the def widths (or from
    // the params widths but without the regions) is smaller than that, so
    // `alloc` would throw "signal table is full" instead of the circuit
    // compiling -- a wrongly sized region, one step earlier.
    const reg = createRegistry([...BASE_DEFS, passDef(1)]);
    const g = emptyGraph();
    const count = 24;
    for (let i = 0; i < count; i += 1) {
      const src = addInstance(g, 'level_input', 0, i * 40, `src${i}`);
      const dst = addInstance(g, 'pass1', 0, i * 40 + 20, `dst${i}`);
      dst.params.width = 8;
      connect(g, { inst: src.id, port: 'out' }, { inst: dst.id, port: 'in' });
    }
    const net = compile(g, reg);

    expect(net.slotCount).toBe(count * 25);
    expect(new Simulation(net, reg).settle().stable).toBe(true);
  });
});

describe('delayOf', () => {
  it('sums gate costs along the longest path and counts sources as free', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0);
    const nand = addInstance(g, 'nand', 60, 0);
    const not = addInstance(g, 'not', 120, 0);
    const out = addInstance(g, 'level_output', 180, 0);
    connect(g, { inst: inA.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
    connect(g, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });
    // level_input 0 + nand 1 + not 1 + level_output 0
    expect(delayOf(g, registry)).toBe(2);
    expect(delayOf(emptyGraph(), registry)).toBe(0);
  });

  it('breaks the path at a storage element instead of counting through it', () => {
    const g = emptyGraph();
    const inA = addInstance(g, 'level_input', 0, 0);
    const first = addInstance(g, 'not', 60, 0);
    const latch = addInstance(g, 'delay_line', 120, 0);
    const second = addInstance(g, 'not', 180, 0);
    connect(g, { inst: inA.id, port: 'out' }, { inst: first.id, port: 'a' });
    connect(g, { inst: first.id, port: 'out' }, { inst: latch.id, port: 'in' });
    connect(g, { inst: latch.id, port: 'out' }, { inst: second.id, port: 'a' });
    // `first` (1) and `second` (1) are separate combinational paths, not a chain
    // of two: the delay line neither inherits nor passes on a path.
    expect(delayOf(g, registry)).toBe(1);
  });

  it('walks a diamond ladder in linear time instead of enumerating every path', () => {
    // 30 reconverging stages give 2^30 distinct source-to-output paths. A
    // path-enumerating `delayOf` would hang here; the Kahn longest path returns
    // immediately. Vitest's per-test timeout is the assertion.
    const g = emptyGraph();
    let prev = addInstance(g, 'level_input', 0, 0).id;
    for (let stage = 0; stage < 30; stage += 1) {
      const left = addInstance(g, 'not', 0, 0);
      const right = addInstance(g, 'not', 0, 0);
      const join = addInstance(g, 'and', 0, 0);
      connect(g, { inst: prev, port: 'out' }, { inst: left.id, port: 'a' });
      connect(g, { inst: prev, port: 'out' }, { inst: right.id, port: 'a' });
      connect(g, { inst: left.id, port: 'out' }, { inst: join.id, port: 'a' });
      connect(g, { inst: right.id, port: 'out' }, { inst: join.id, port: 'b' });
      prev = join.id;
    }
    // 30 stages of not(1) + and(1).
    expect(delayOf(g, registry)).toBe(60);
  });

  it('terminates on a combinational loop and does not count it as depth', () => {
    const g = emptyGraph();
    const n1 = addInstance(g, 'nand', 0, 0);
    const n2 = addInstance(g, 'nand', 0, 40);
    const src = addInstance(g, 'const_on', 0, 80);
    const inv = addInstance(g, 'not', 80, 80);
    connect(g, { inst: n1.id, port: 'out' }, { inst: n2.id, port: 'a' });
    connect(g, { inst: n2.id, port: 'out' }, { inst: n1.id, port: 'a' });
    connect(g, { inst: src.id, port: 'out' }, { inst: inv.id, port: 'a' });
    expect(delayOf(g, registry)).toBe(1);
  });
});
