import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';
import type { ComponentDef, Registry } from '../../src/core/registry';
import { CircuitValidationError, UnstableCircuitError } from '../../src/core/errors';
import type { PortValue } from '../../src/core/signal';
import { SETTLE_LIMIT, Simulation, compile, delayOf, type Netlist } from '../../src/core/net';

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
 * Slot-addressed accessors for the storage tests, in the two directions a test
 * needs: `out` reads a pin as an unsigned number, `set` drives one the way a
 * level drives a `level_input`'s output slot.
 *
 * Both go through the netlist's resolved per-instance widths, so a test cannot
 * accidentally read a neighbouring pin's bits instead of the whole pin.
 */
interface Probe {
  out(key: string): number;
  set(key: string, value: number): void;
}

function probe(sim: Simulation, net: Netlist): Probe {
  return {
    out: (key) => toNumber(sim.read(net.outputBase(key), net.outputWidth(key))),
    set: (key, value) => sim.write(net.outputBase(key), net.outputWidth(key), value),
  };
}

/**
 * The storage fixture: one instance of `def` whose every input pin is wired from
 * its own `level_input`.
 *
 * A `level_input` declares 1-bit pins, so the width a wide input needs exists
 * only on the instance (`params.width`) -- the same value the palette's drop
 * path writes. `in` resolves a pin name to the feed that drives it and throws on
 * a name the def does not have, so a typo in a test is not a silently unwired
 * pin reading 0.
 */
function storageFixture(def: string): {
  graph: Graph;
  /** `"<instId>.out"` of the part under test. */
  out: string;
  /** `"<feedId>.out"` of the `level_input` driving one of its input pins. */
  in: (pin: string) => string;
} {
  const g = emptyGraph();
  const unit = addInstance(g, def, 320, 0, 'unit');
  const feeds = new Map<string, string>();
  registry.get(def).inputs.forEach((pin, i) => {
    const feed = addInstance(g, 'level_input', 0, i * 40, `IN_${pin.id}`);
    feed.params.width = pin.width;
    connect(g, { inst: feed.id, port: 'out' }, { inst: unit.id, port: pin.id });
    feeds.set(pin.id, feed.id);
  });
  return {
    graph: g,
    out: `${unit.id}.out`,
    in: (pin) => {
      const feed = feeds.get(pin);
      if (!feed) throw new Error(`${def} has no input pin ${pin}`);
      return `${feed}.out`;
    },
  };
}

/**
 * A combinational pass-through that RECORDS the value it read on every sweep.
 *
 * `evaluate` runs once per settle sweep, so the head of `seen` is what the table
 * held when that settle's first sweep began -- which is what makes the pass
 * observable at all: `#publishState` writes the held value into the table before
 * the sweep starts, so a watcher downstream of a storage element reads the
 * post-edge value in the first sweep rather than the pre-edge one. Nothing else
 * can see the difference (the sweep republishes through `evaluate` regardless),
 * which is why the two `#publishState` tests below are built on this def.
 */
function watcherDef(id: string, width: number, seen: number[]): ComponentDef {
  return {
    id,
    name: { zh: '观察器', en: 'Watcher' },
    category: 'wide',
    inputs: [{ id: 'in', width }],
    outputs: [{ id: 'out', width }],
    cost: 1,
    sequential: false,
    stateBytes: 0,
    evaluate: (i, o) => {
      const value = toNumber(i[0] ?? 0);
      seen.push(value);
      o[0] = value;
    },
  };
}

/**
 * A storage element that publishes the COMPLEMENT of the bit it holds.
 *
 * A legal def -- `evaluate` reads `state` and never an input -- and the only
 * shape that makes the RESET half of the pre-seed observable. `reset()` zeroes
 * the table and every state byte together, so a def that publishes its zero
 * state (`delay8`, `reg8`, `counter8`) publishes a value the cleared table
 * already holds and the pass leaves no trace. This one publishes 1 from a zeroed
 * state, so whether the first sweep of `reset()`'s settle reads 1 or 0 is
 * exactly whether the pass ran.
 */
const invertingLatchDef: ComponentDef = {
  id: 'latch_not',
  name: { zh: '反相锁存器', en: 'Inverting Latch' },
  category: 'memory1',
  inputs: [{ id: 'in', width: 1 }],
  outputs: [{ id: 'out', width: 1 }],
  cost: 0,
  sequential: true,
  stateBytes: 1,
  evaluate: (_i, o, state) => {
    o[0] = state?.[0] === 1 ? 0 : 1;
  },
  clockEdge: (i, _o, state) => {
    state[0] = i[0] === 1 ? 1 : 0;
  },
};

/**
 * The stateful half of the wide family, through the kernel.
 *
 * Three of these are the acceptance classes the phase names -- a latch, an
 * oscillator and a counter -- and the rest pin the mechanism they all depend on:
 * the kernel publishes storage from the def's own `evaluate`, so an 8-bit
 * register publishes eight bits and `ram8` publishes the addressed byte. The
 * assertions deliberately sit *between* the input flip and the clock edge: a
 * test that only reads after a tick cannot tell a register from a wire, which is
 * exactly how phase 0's `delay_line` degraded unnoticed.
 */
describe('wide storage', () => {
  it('publishes every bit of a wide register, not just the low one', () => {
    // The kernel's publish pass used to write `state[p]` onto output pin `p`,
    // one bit per pin -- one bit of an eight-bit register's byte. Whatever the
    // route, what a caller reads after a tick has to be the whole byte, and every
    // byte below has a bit above the low one set, so a publish that kept only the
    // low bit cannot pass.
    const { graph, out, in: pin } = storageFixture('reg8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    expect(net.outputWidth(out)).toBe(8);
    sim.reset();
    p.set(pin('load'), 1);
    p.set(pin('reset'), 0);
    for (const byte of [0xa5, 0x5a, 0xfe, 0x01]) {
      p.set(pin('d'), byte);
      sim.tick();
      expect(p.out(out), `d = 0x${byte.toString(16)}`).toBe(byte);
    }
  });

  it('publishes a multi-byte storage def through the same path', () => {
    // The mechanism is not "eight bits wide": a def says how many state bytes it
    // has and what to publish, and the kernel runs that. This 12-bit holder keeps
    // TWO state bytes and publishes a byte-array port -- the form `PortValue`
    // takes above eight bits, which no shipped storage def reaches.
    const reg12: ComponentDef = {
      id: 'reg12',
      name: { zh: '12 位寄存器', en: '12-Bit Register' },
      category: 'wide',
      inputs: [{ id: 'd', width: 12 }],
      outputs: [{ id: 'out', width: 12 }],
      cost: 0,
      sequential: true,
      stateBytes: 2,
      evaluate: (_i, o, state) => {
        o[0] = new Uint8Array([state?.[0] ?? 0, state?.[1] ?? 0]);
      },
      clockEdge: (i, _o, state) => {
        const d = toNumber(i[0] ?? 0);
        state[0] = d & 0xff;
        state[1] = (d >>> 8) & 0x0f;
      },
    };
    const wide = createRegistry([...BASE_DEFS, reg12]);
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'IN_D');
    feed.params.width = 12;
    const unit = addInstance(g, 'reg12', 80, 0, 'unit');
    connect(g, { inst: feed.id, port: 'out' }, { inst: unit.id, port: 'd' });
    const net = compile(g, wide);
    const sim = new Simulation(net, wide);
    const p = probe(sim, net);

    sim.reset();
    expect(p.out('unit.out')).toBe(0x000);
    p.set('IN_D.out', 0xabc);
    sim.settle();
    expect(p.out('unit.out'), 'no edge yet').toBe(0x000);
    sim.tick();
    expect(p.out('unit.out')).toBe(0xabc);
    p.set('IN_D.out', 0xfff);
    sim.settle();
    expect(p.out('unit.out'), 'held between edges').toBe(0xabc);
    sim.tick();
    expect(p.out('unit.out')).toBe(0xfff);
  });

  it('pre-seeds the held byte into the table before the settle that follows a tick', () => {
    // `#publishState` is a PRE-SEED, not a second copy of the correctness: the
    // settle that follows every `tick()` republishes through `evaluate` anyway,
    // which is why reverting the pass to the old `state[p]` -> pin `p` body
    // leaves the rest of this file green. What the pass buys is the ordering the
    // kernel documents -- a caller reading right after `reset`/`tick` sees the
    // held value without waiting on the sweep -- and the watcher def observes it
    // from inside the settle: the FIRST sweep already reads the post-edge byte
    // instead of the pre-edge one.
    const seen: number[] = [];
    const reg = createRegistry([...BASE_DEFS, watcherDef('watcher8', 8, seen)]);
    const { graph, out, in: pin } = storageFixture('delay8');
    const watch = addInstance(graph, 'watcher8', 480, 0, 'watch');
    connect(graph, { inst: 'unit', port: 'out' }, { inst: watch.id, port: 'in' });
    const net = compile(graph, reg);
    const sim = new Simulation(net, reg);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('a'), 0xa5);
    sim.settle();
    expect(p.out(out), 'no edge yet').toBe(0x00);

    // Only the settle of the tick below is observed.
    seen.length = 0;
    const report = sim.tick();
    expect(p.out(out), 'the held byte, right after the edge').toBe(0xa5);
    // The pass wrote 0xa5 into the output's slots before the sweep began, so the
    // first sweep already reads it. Break or delete the pass and this reads
    // 0x00: the settled value stays 0xa5 either way, which is why nothing else
    // in the suite fails.
    expect(seen[0], 'the first sweep after the edge already read the held byte').toBe(0xa5);
    // The same fact read a second way: the pre-seed carries the byte to the
    // watcher in sweep 1 and commits it there, so the settle confirms in sweep 2.
    // Without the pass, sweep 1 still carries the pre-edge 0x00 and the settle
    // needs a third sweep.
    expect(report.iterations, 'the pre-seed spends a sweep and saves one').toBe(2);
    expect(report.stable).toBe(true);
  });

  it('pre-seeds a storage output whose zeroed state publishes a 1, before reset() settles', () => {
    // The reset half of the same property, and the reason it needs an invented
    // def: `reset()` clears the table and the state together, so a holder that
    // publishes 0 from a zero state has nothing to pre-seed into a zeroed slot.
    // This def publishes the complement of the bit it holds, so the value the
    // first sweep of `reset()`'s settle reads is 1 with the pass and 0 without
    // it -- while the settled value is 1 either way, because the sweep
    // republishes through `evaluate` regardless.
    const seen: number[] = [];
    const reg = createRegistry([
      ...BASE_DEFS,
      invertingLatchDef,
      watcherDef('watcher1', 1, seen),
    ]);
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'IN');
    const latch = addInstance(g, 'latch_not', 80, 0, 'unit');
    const watch = addInstance(g, 'watcher1', 160, 0, 'watch');
    connect(g, { inst: feed.id, port: 'out' }, { inst: latch.id, port: 'in' });
    connect(g, { inst: latch.id, port: 'out' }, { inst: watch.id, port: 'in' });
    const net = compile(g, reg);
    const sim = new Simulation(net, reg);
    const p = probe(sim, net);

    sim.reset();
    expect(seen[0], 'the first sweep of reset() already read the published 1').toBe(1);
    expect(p.out('unit.out'), 'and reset() settles on it').toBe(1);

    // The tick half of the same contract, on the same def: the edge samples the
    // 1 and the complement is published before the settle, so again the first
    // sweep sees it.
    p.set('IN.out', 1);
    seen.length = 0;
    sim.tick();
    expect(seen[0], 'the first sweep after the edge already read the published 0').toBe(0);
    expect(p.out('unit.out'), 'and the settle agrees: 1 held, 0 published').toBe(0);
  });

  it('holds its byte between the input flip and the next clock edge (latch)', () => {
    const { graph, out, in: pin } = storageFixture('reg8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('load'), 1);
    p.set(pin('reset'), 0);
    p.set(pin('d'), 0x3c);
    sim.tick();
    expect(p.out(out)).toBe(0x3c);

    // Flip the data and drop `load`, with no edge in between: neither may reach
    // the output.
    p.set(pin('d'), 0x00);
    p.set(pin('load'), 0);
    sim.settle();
    expect(p.out(out), 'input flipped, no edge yet').toBe(0x3c);

    sim.tick();
    expect(p.out(out), 'load was low at the edge').toBe(0x3c);

    // Raising `load` again is not an edge either.
    p.set(pin('load'), 1);
    sim.settle();
    expect(p.out(out), 'load raised, no edge yet').toBe(0x3c);

    sim.tick();
    expect(p.out(out), 'the edge samples the flipped input').toBe(0x00);
  });

  it('clears on reset, and reset beats load on the same edge', () => {
    const { graph, out, in: pin } = storageFixture('reg8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('load'), 1);
    p.set(pin('reset'), 0);
    p.set(pin('d'), 0xff);
    sim.tick();
    expect(p.out(out)).toBe(0xff);

    // DECIDED (task 4): `reset` wins over `load` when both are asserted on the
    // same edge, and `reset` is sampled at the edge rather than level-triggered.
    p.set(pin('reset'), 1);
    sim.settle();
    expect(p.out(out), 'reset is sampled at the edge, like every input').toBe(0xff);
    sim.tick();
    expect(p.out(out), 'reset beats load').toBe(0x00);

    // The clear was that edge's business, not a permanent mask: with `reset`
    // dropped, the next edge samples `d` again.
    p.set(pin('reset'), 0);
    sim.tick();
    expect(p.out(out)).toBe(0xff);
  });

  it('delays a byte by exactly one tick', () => {
    const { graph, out, in: pin } = storageFixture('delay8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    expect(p.out(out)).toBe(0x00);
    p.set(pin('a'), 0xa5);
    sim.settle();
    expect(p.out(out), 'no edge yet').toBe(0x00);
    sim.tick();
    expect(p.out(out)).toBe(0xa5);

    p.set(pin('a'), 0x00);
    sim.settle();
    expect(p.out(out), 'the sampled byte is held until the next edge').toBe(0xa5);
    sim.tick();
    expect(p.out(out)).toBe(0x00);
  });

  it('shifts a value one stage per tick through two delay lines in series', () => {
    // The chain regression for spec §4.1's snapshot-before-edge rule: the second
    // stage must sample what the first stage PUBLISHED at the start of the tick,
    // not the byte the first stage's edge wrote moments earlier. Interleave the
    // snapshot and the edge loops (or move the snapshot after the edges) and the
    // pair updates together -- a CPU's `pc8` -> `regfile6` would then move
    // through both in one tick.
    //
    // STATUS ON THE KERNEL AS FOUND: this passes. `tick()` snapshots every
    // sequential instance before any `clockEdge`, and an edge writes only the
    // private `#state`, never the table, so no chain shape shifts two stages in
    // one tick. Kept as the regression that fails if that mechanism is ever
    // reordered; it is not evidence of a live defect and carries no kernel change.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'IN');
    feed.params.width = 8;
    const first = addInstance(g, 'delay8', 120, 0, 'first');
    const second = addInstance(g, 'delay8', 240, 0, 'second');
    connect(g, { inst: feed.id, port: 'out' }, { inst: first.id, port: 'a' });
    connect(g, { inst: first.id, port: 'out' }, { inst: second.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);
    const stage1 = `${first.id}.out`;
    const stage2 = `${second.id}.out`;

    sim.reset();
    expect(p.out(stage1)).toBe(0x00);
    expect(p.out(stage2)).toBe(0x00);

    p.set('IN.out', 0xa5);
    sim.tick();
    expect(p.out(stage1), 'stage 1 latched the driven byte').toBe(0xa5);
    expect(p.out(stage2), 'stage 2 still holds its previous value').toBe(0x00);

    p.set('IN.out', 0x3c);
    sim.tick();
    expect(p.out(stage1), 'stage 1 latched the new byte').toBe(0x3c);
    expect(p.out(stage2), 'the 0xa5 advanced by exactly one stage').toBe(0xa5);
  });

  it('counts one step per tick, holds when en is low, and wraps to 0 at 256', () => {
    const { graph, out, in: pin } = storageFixture('counter8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('en'), 1);
    p.set(pin('reset'), 0);
    sim.tick();
    expect(p.out(out)).toBe(1);

    // DECIDED (task 4): `reset` beats `en` on the same edge.
    p.set(pin('reset'), 1);
    sim.settle();
    expect(p.out(out), 'reset is sampled at the edge, like every input').toBe(1);
    sim.tick();
    expect(p.out(out), 'reset beats en').toBe(0);

    p.set(pin('reset'), 0);
    sim.tick();
    expect(p.out(out)).toBe(1);
    sim.tick();
    expect(p.out(out)).toBe(2);
    sim.tick();
    expect(p.out(out)).toBe(3);

    p.set(pin('en'), 0);
    sim.settle();
    expect(p.out(out), 'en low is not an edge').toBe(3);
    sim.tick();
    sim.tick();
    expect(p.out(out), 'en low: two edges change nothing').toBe(3);

    p.set(pin('en'), 1);
    for (let i = 0; i < 252; i += 1) sim.tick();
    expect(p.out(out), '3 + 252 = 255, the top of the byte').toBe(255);
    // DECIDED (task 4): the wrap is to 0 -- an 8-bit rollover, not a saturation.
    sim.tick();
    expect(p.out(out), '255 + 1 wraps to 0').toBe(0);
    sim.tick();
    expect(p.out(out), 'and keeps counting from there').toBe(1);
  });

  it('settles a 1-bit inverting ring that a delay_line breaks, and toggles once per tick', () => {
    // Spec §12's oscillator: `nand(a, 1)` inverts, and the delay line samples
    // instead of propagating, so the loop is not combinational and the circuit
    // has a stable state between edges.
    const g = emptyGraph();
    const one = addInstance(g, 'const_on', 0, 0);
    const nand = addInstance(g, 'nand', 60, 0);
    const delay = addInstance(g, 'delay_line', 120, 0);
    connect(g, { inst: one.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(g, { inst: delay.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(g, { inst: nand.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    expect(sim.settle().stable, 'the storage element breaks the loop').toBe(true);
    expect(p.out(`${delay.id}.out`)).toBe(0);
    expect(p.out(`${nand.id}.out`), 'settled, not oscillating').toBe(1);
    sim.tick();
    expect(p.out(`${delay.id}.out`)).toBe(1);
    sim.tick();
    expect(p.out(`${delay.id}.out`)).toBe(0);
  });

  it('settles an 8-bit inverting ring that a delay8 breaks, and toggles the whole byte', () => {
    // The same ring one byte wide. It doubles as the wide publish's regression:
    // the byte the ring carries is 0xff, so a publish that kept only the low bit
    // would put 0x01 on this pin.
    const g = emptyGraph();
    const inv = addInstance(g, 'not8', 60, 0);
    const delay = addInstance(g, 'delay8', 120, 0);
    connect(g, { inst: delay.id, port: 'out' }, { inst: inv.id, port: 'a' });
    connect(g, { inst: inv.id, port: 'out' }, { inst: delay.id, port: 'a' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    expect(sim.settle().stable, 'the storage element breaks the loop').toBe(true);
    expect(p.out(`${delay.id}.out`)).toBe(0x00);
    expect(p.out(`${inv.id}.out`), 'the whole byte, not its low bit').toBe(0xff);
    sim.tick();
    expect(p.out(`${delay.id}.out`)).toBe(0xff);
    sim.tick();
    expect(p.out(`${delay.id}.out`)).toBe(0x00);
    sim.tick();
    expect(p.out(`${delay.id}.out`)).toBe(0xff);
  });

  it('throws UnstableCircuitError for the same rings with the storage element gone', () => {
    // The other half of the oscillator claim: both rings above are stable
    // *because* of the storage element, not because the settle loop is lenient.
    // Each twin has the same shape with the delay taken out of the loop.
    const bit = emptyGraph();
    const one = addInstance(bit, 'const_on', 0, 0);
    const nand = addInstance(bit, 'nand', 60, 0);
    connect(bit, { inst: one.id, port: 'out' }, { inst: nand.id, port: 'b' });
    connect(bit, { inst: nand.id, port: 'out' }, { inst: nand.id, port: 'a' });
    expect(() => new Simulation(compile(bit, registry), registry).settle()).toThrow(
      UnstableCircuitError,
    );

    // `switch8` with `on` high is a plain wire, so this is `not8` feeding itself.
    const wide = emptyGraph();
    const not = addInstance(wide, 'not8', 60, 0);
    const wire = addInstance(wide, 'switch8', 120, 0);
    const on = addInstance(wide, 'const_on', 0, 0);
    connect(wide, { inst: not.id, port: 'out' }, { inst: wire.id, port: 'a' });
    connect(wide, { inst: on.id, port: 'out' }, { inst: wire.id, port: 'on' });
    connect(wide, { inst: wire.id, port: 'out' }, { inst: not.id, port: 'a' });
    expect(() => new Simulation(compile(wide, registry), registry).settle()).toThrow(
      UnstableCircuitError,
    );
  });

  it('stores and reads back a byte at any address, 0 and 255 included', () => {
    const { graph, out, in: pin } = storageFixture('ram8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('load'), 1);
    for (const [addr, value] of [
      [0x00, 0xff],
      [0x10, 0xa5],
      [0xff, 0x5a],
    ] as const) {
      p.set(pin('addr'), addr);
      p.set(pin('d'), value);
      sim.tick();
      expect(p.out(out), `addr 0x${addr.toString(16)}`).toBe(value);
    }

    // Read back with no further edge: the read path is combinational, so
    // selecting another address is enough, and an address never written reads 0.
    p.set(pin('load'), 0);
    for (const [addr, want] of [
      [0x10, 0xa5],
      [0xff, 0x5a],
      [0x00, 0xff],
      [0x0f, 0x00],
    ] as const) {
      p.set(pin('addr'), addr);
      sim.settle();
      expect(p.out(out), `addr 0x${addr.toString(16)} with no edge`).toBe(want);
    }
  });

  it('is combinational on its read path and edge-triggered on its write path', () => {
    // The subtlest def in the family: `addr` selects which stored byte the
    // output shows right now, while `d` and `load` are only sampled at the edge.
    const { graph, out, in: pin } = storageFixture('ram8');
    const net = compile(graph, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    p.set(pin('addr'), 3);
    p.set(pin('d'), 0x11);
    p.set(pin('load'), 1);
    sim.tick();
    expect(p.out(out)).toBe(0x11);

    // `d` changes with `load` still asserted: nothing may show before an edge.
    p.set(pin('d'), 0xab);
    sim.settle();
    expect(p.out(out), 'd does not leak into the read path').toBe(0x11);

    // An address change needs no edge at all.
    p.set(pin('addr'), 4);
    sim.settle();
    expect(p.out(out), 'an unwritten address reads 0').toBe(0x00);
    p.set(pin('addr'), 3);
    sim.settle();
    expect(p.out(out), 'back to 3, still no edge').toBe(0x11);

    sim.tick();
    expect(p.out(out), 'the edge latched 0xab at 3').toBe(0xab);
    p.set(pin('addr'), 4);
    sim.settle();
    expect(p.out(out), 'address 4 was never written').toBe(0x00);
  });

  it('gives every instance its own 256 bytes', () => {
    const g = emptyGraph();
    const units: string[] = [];
    // One `level_input` per input pin, in `def.inputs` order: d, addr, load.
    const pins: string[][] = [];
    for (const [i, name] of ['one', 'two'].entries()) {
      const unit = addInstance(g, 'ram8', 320, i * 240, name);
      const keys: string[] = [];
      registry.get('ram8').inputs.forEach((pin, j) => {
        const feed = addInstance(g, 'level_input', 0, i * 240 + j * 40, `${name}_${pin.id}`);
        feed.params.width = pin.width;
        connect(g, { inst: feed.id, port: 'out' }, { inst: unit.id, port: pin.id });
        keys.push(`${feed.id}.out`);
      });
      units.push(`${unit.id}.out`);
      pins.push(keys);
    }
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    sim.reset();
    for (const [i, byte] of [0x11, 0x22].entries()) {
      const [d, addr, load] = pins[i]!;
      p.set(d!, byte);
      p.set(addr!, 0x40);
      p.set(load!, 1);
    }
    sim.tick();
    // Same address, same edge, two memories: neither one wrote into the other.
    expect(p.out(units[0]!)).toBe(0x11);
    expect(p.out(units[1]!)).toBe(0x22);
  });

  it('reserves table capacity for a bank of 8-bit storage parts and their read regions', () => {
    // `ram8` is the widest part in the kernel so far: 17 input slots and 8
    // output slots per instance, plus a materialised read region for every wide
    // input a narrower driver feeds (a 1-bit `level_input` is narrower than both
    // `d` and `addr`). `capacityFor` has to reserve all of it up front -- the
    // table is fixed and `alloc` only throws.
    const g = emptyGraph();
    const banks = 200;
    for (let i = 0; i < banks; i += 1) {
      const unit = addInstance(g, 'ram8', 320, i * 200);
      for (const [j, pin] of ['d', 'addr', 'load'].entries()) {
        const feed = addInstance(g, 'level_input', 0, i * 200 + j * 30);
        connect(g, { inst: feed.id, port: 'out' }, { inst: unit.id, port: pin });
      }
    }
    const net = compile(g, registry);
    // Per bank: 3 feed slots + (8 + 8 + 1) input slots + 8 output slots + (8 + 8)
    // region slots = 44, all of them allocated.
    expect(net.slotCount).toBe(banks * 44);
    expect(new Simulation(net, registry).settle().stable).toBe(true);
  });

  it('publishes a 1-bit storage def across a pin an instance widened', () => {
    // `delay_line` declares 1-bit pins and task 2 resolved widths per instance,
    // so a `params.width = 8` delay line has an 8-bit output pin. The held `1`
    // must still land as 0b00000001, with no stale high byte -- the behaviour the
    // pre-task-4 publish path documented and this one inherits unchanged.
    const g = emptyGraph();
    const feed = addInstance(g, 'level_input', 0, 0, 'IN_A');
    feed.params.width = 8;
    const delay = addInstance(g, 'delay_line', 80, 0, 'delay');
    delay.params.width = 8;
    connect(g, { inst: feed.id, port: 'out' }, { inst: delay.id, port: 'in' });
    const net = compile(g, registry);
    const sim = new Simulation(net, registry);
    const p = probe(sim, net);

    expect(net.outputWidth('delay.out')).toBe(8);
    sim.reset();
    p.set('IN_A.out', 1);
    sim.settle();
    expect(p.out('delay.out'), 'no edge yet').toBe(0);
    sim.tick();
    expect(p.out('delay.out')).toBe(0b0000_0001);
    p.set('IN_A.out', 0);
    sim.tick();
    expect(p.out('delay.out')).toBe(0);
  });

  it('refuses a storage def that could never publish what it holds', () => {
    // The publish pass runs a def's `evaluate`; it has no state layout of its own
    // to fall back on (see `Simulation.#publishState`), so a storage def with
    // state and no `evaluate` could only ever hold zero in silence. `compile` is
    // where a netlist becomes runnable, so it is refused there instead.
    const mute: ComponentDef = {
      id: 'mute_store',
      name: { zh: '沉默存储', en: 'Mute Store' },
      category: 'memory1',
      inputs: [{ id: 'in', width: 1 }],
      outputs: [{ id: 'out', width: 1 }],
      cost: 0,
      sequential: true,
      stateBytes: 1,
      clockEdge: (i, _o, state) => {
        state[0] = i[0] === 1 ? 1 : 0;
      },
    };
    const withMute = createRegistry([...BASE_DEFS, mute]);
    const g = emptyGraph();
    addInstance(g, 'mute_store', 0, 0);
    // A `CircuitValidationError`, not a bare `Error`: the level checker re-throws
    // anything that is neither that nor `UnstableCircuitError`, so a def-authoring
    // mistake has to arrive as a validation issue to become a failed `'invalid'`
    // check instead of escaping `runChecks` into the board-edit path. The issue
    // names both the instance and the def, which the error's own message (a list
    // of issue codes) does not.
    let caught: unknown;
    try {
      compile(g, withMute);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CircuitValidationError);
    const issues = (caught as CircuitValidationError).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.inst).toBe('i1');
    expect(issues[0]!.message.en).toMatch(/mute_store/);
    expect(issues[0]!.message.en).toMatch(/evaluate/);
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
