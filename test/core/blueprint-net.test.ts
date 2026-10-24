import { describe, expect, it } from 'vitest';
import {
  addInstance,
  cloneGraph,
  connect,
  emptyGraph,
  type CustomComponentDef,
  type Graph,
} from '../../src/core/graph';
import { compile, delayOf, gateCostOf, Simulation } from '../../src/core/net';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { blueprintDef } from '../../src/levels/blueprints';

/**
 * What a custom component IS, tested through the kernel that has to expand it.
 *
 * Three claims carry the feature, and each is here because the spec states it as
 * a rule rather than as an aspiration (spec §3.4):
 *
 *  1. INSTANCES ARE INDEPENDENT. One definition, two instances, two sets of
 *     storage. The claim fails silently -- a shared slot would look like a
 *     working circuit and only misbehave once two instances disagree -- so it is
 *     tested with a storage element whose two instances are loaded differently.
 *  2. WRAPPING IS FREE. Gate count and delay are measured through the expansion,
 *     so putting a circuit inside a component cannot change what it costs. The
 *     test measures the same circuit twice, once flat and once wrapped, and
 *     demands equal numbers.
 *  3. A CYCLE IS REFUSED. `bp1` containing `bp1` must be rejected, not expanded
 *     until the size cap fires.
 */
const base = createRegistry(BASE_DEFS);

/**
 * A component holding a self-refreshing `mem1`: one input (`set`), one output.
 *
 * The body feeds the memory's `out` back into its `value`, so the stored bit is
 * re-written on every edge and survives -- which is what makes "two instances
 * disagree" observable at all. A component that merely passed a wire through
 * would read the same in both.
 */
function latchComponent(id: string): CustomComponentDef {
  const body = emptyGraph();
  const mem = addInstance(body, 'mem1', 0, 0);
  const out = addInstance(body, 'level_output', 160, 0, 'OUT');
  out.params.width = 1;
  connect(body, { inst: mem.id, port: 'out' }, { inst: mem.id, port: 'value' });
  connect(body, { inst: mem.id, port: 'out' }, { inst: out.id, port: 'in' });
  return {
    id,
    name: { zh: `锁存 ${id}`, en: `latch ${id}` },
    inputs: [{ id: 'set', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    binds: {
      inputs: { set: { inst: mem.id, port: 'set' } },
      outputs: { out: { inst: out.id, port: 'mirror' } },
    },
    body,
  };
}

/** The registry a document compiles against: the catalog plus its components. */
function withComponents(components: readonly CustomComponentDef[]) {
  const registry = createRegistry(BASE_DEFS);
  for (const component of components) registry.register(blueprintDef(component));
  return registry;
}

/**
 * Two instances of one component, each with its own memory loaded.
 *
 * `RAM_A`/`RAM_B` are inside the component, so both instances compile to the path
 * `<instance>/i1` -- the ids collide, and only the path tells them apart. That is
 * the point of the fixture: if the two instances shared storage, the second load
 * would overwrite the first and both reads would agree.
 */
function twoInstances(): { graph: Graph; sim: Simulation } {
  const component = latchComponent('bp1');
  const registry = withComponents([component]);
  const graph = emptyGraph();
  graph.customComponents.push(component);
  addInstance(graph, 'bp1', 0, 0);
  addInstance(graph, 'bp1', 200, 0);
  const net = compile(graph, registry);
  const sim = new Simulation(net, registry);
  sim.reset();
  return { graph, sim };
}

describe('custom components in the kernel', () => {
  it('gives each instance its own storage', () => {
    const { sim } = twoInstances();
    // The two instances have distinct compiled paths (`i1/i1` and `i2/i1`), which
    // is what `loadImage` is addressed by -- the ids the player used are the same
    // inside both.
    sim.loadImage('i1/i1', [1]);
    sim.loadImage('i2/i1', [0]);
    // `loadImage` writes the state; `settle` is what publishes it to the pins.
    sim.settle();
    expect(sim.read(sim.net.outputBase('i1/i1.out'), 1)).toBe(1);
    expect(sim.read(sim.net.outputBase('i2/i1.out'), 1)).toBe(0);
    // And the component's own declared pin is an alias of the body pin, so the
    // board reads the same value through the surface the player wired up.
    expect(sim.read(sim.net.outputBase('i1.out'), 1)).toBe(1);
    expect(sim.read(sim.net.outputBase('i2.out'), 1)).toBe(0);
  });

  it('expands a component to its leaves, once per instance', () => {
    const { sim } = twoInstances();
    // One instance of the component is 2 leaves (the memory and the connector),
    // so two instances are 4 -- and the compiled ids are paths, not document ids.
    expect(sim.net.instanceCount).toBe(4);
    expect(sim.net.instanceIds()).toContain('i1/i1');
    expect(sim.net.instanceIds()).toContain('i2/i1');
    expect(sim.net.pathsOf('i1')).toEqual(['i1/i1', 'i1/OUT']);
    expect(sim.net.pathsOf('i2')).toEqual(['i2/i1', 'i2/OUT']);
    expect(sim.net.pathsOf('nope')).toEqual([]);
  });

  it('aliases a component input pin to the body slot it binds', () => {
    // The Arduino exporter walks `drive` from `inputSlot`, so an alias has to be
    // the body pin's own base rather than one it happens to read like.
    const { sim } = twoInstances();
    expect(sim.net.inputSlot('i1.set')).toBe(sim.net.inputSlot('i1/i1.set'));
    expect(sim.net.outputBase('i1.out')).toBe(sim.net.outputBase('i1/OUT.mirror'));
  });

  it('drives a component input through to the body pin it binds', () => {
    const component = latchComponent('bp1');
    const registry = withComponents([component]);
    const graph = emptyGraph();
    graph.customComponents.push(component);
    const a = addInstance(graph, 'bp1', 0, 0);
    const source = addInstance(graph, 'const_on', -160, 0);
    connect(graph, { inst: source.id, port: 'out' }, { inst: a.id, port: 'set' });
    const sim = new Simulation(compile(graph, registry), registry);
    sim.reset();
    sim.tick();
    sim.tick();
    // `set` high on every edge writes `value` (which is the held bit, 0) -- so the
    // observable proof is that the body saw the wire at all: the memory's own
    // input slot reads 1, through the component's declared pin.
    expect(sim.read(sim.net.inputBase('i1/i1.set'), 1)).toBe(1);
    expect(sim.read(sim.net.inputBase('i1.set'), 1)).toBe(1);
  });

  it('charges the body, not the wrapper, on both metrics', () => {
    // The same circuit twice: once flat, once wrapped in a component. `nand` (1
    // gate, 1 delay) then `not` (2 gates, 1 delay), plus a `const_on` source.
    const flat = emptyGraph();
    const rail = addInstance(flat, 'const_on', 0, 0);
    const gate = addInstance(flat, 'nand', 100, 0);
    const inv = addInstance(flat, 'not', 200, 0);
    connect(flat, { inst: rail.id, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(flat, { inst: gate.id, port: 'out' }, { inst: inv.id, port: 'a' });

    const wrapped = emptyGraph();
    const body = cloneGraph(flat);
    const component: CustomComponentDef = {
      id: 'bp1',
      name: { zh: '两个门', en: 'two gates' },
      inputs: [{ id: 'a', width: 1 }],
      outputs: [{ id: 'out', width: 1 }],
      binds: {
        inputs: { a: { inst: gate.id, port: 'b' } },
        outputs: { out: { inst: inv.id, port: 'out' } },
      },
      body,
    };
    wrapped.customComponents.push(component);
    addInstance(wrapped, 'bp1', 0, 0);

    const registry = withComponents([component]);
    expect(gateCostOf(wrapped, registry)).toBe(gateCostOf(flat, base));
    expect(delayOf(wrapped, registry)).toBe(delayOf(flat, base));
    // Spelled out, so a change to the gate basis shows up here rather than as a
    // mysterious shift in a level's three-star target: nand 1 + not 2.
    expect(gateCostOf(flat, base)).toBe(2);
    expect(delayOf(flat, base)).toBe(2);
  });

  it('refuses a component that contains itself', () => {
    const selfBody = emptyGraph();
    const self = latchComponent('bp1');
    addInstance(selfBody, 'bp1', 0, 0);
    const cyclic: CustomComponentDef = { ...self, body: selfBody };
    const registry = withComponents([cyclic]);
    const graph = emptyGraph();
    graph.customComponents.push(cyclic);
    addInstance(graph, 'bp1', 0, 0);

    // The walk does not terminate on a cycle, so it must be refused rather than
    // trusted to the size cap -- and `validateGraph` refuses it one layer up.
    expect(() => compile(graph, registry)).toThrow(/recursive-blueprint|contains itself/);
  });
});
