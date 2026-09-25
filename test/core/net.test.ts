import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { ComponentDef } from '../../src/core/registry';
import { UnstableCircuitError } from '../../src/core/errors';
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
