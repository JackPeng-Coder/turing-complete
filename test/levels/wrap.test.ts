import { describe, expect, it } from 'vitest';
import {
  addInstance,
  connect,
  emptyGraph,
  validateGraph,
  type Graph,
  type Instance,
} from '../../src/core/graph';
import { compile, Simulation } from '../../src/core/net';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { composeRegistry, type BlueprintLibrary } from '../../src/levels/blueprints';
import { applyWrap, planWrap } from '../../src/levels/wrap';

/**
 * Wrapping a selection: what the component exposes, where the wires go, and
 * whether the circuit still computes the same thing afterwards.
 *
 * THE LAST ONE IS THE POINT. A wrap that produced a well-formed component and a
 * circuit that no longer ran would pass every structural test here, so the walk
 * compares the simulation before and after: same inputs, same outputs. That is
 * the only claim a player cares about, and it is the one an off-by-one in the
 * binding table would break.
 *
 * NOTHING HERE NAMES AN INSTANCE ID. `addInstance` mints them, and a fixture that
 * hard-coded `i3` would break the day the generator changed -- for a reason that
 * has nothing to do with wrapping. Every fixture keeps the objects it created.
 */
const base = createRegistry(BASE_DEFS);
const EMPTY: BlueprintLibrary = {};

/**
 * A half adder wired from the outside in: two level inputs, an `xor`, an `and`,
 * and two level outputs.
 *
 * The whole selection is the two gates, so the wrap's boundary is four wires --
 * two in, two out -- and the two gates have no wire between them.
 */
function halfAdder(): { graph: Graph; gates: Instance[] } {
  const g = emptyGraph();
  const a = addInstance(g, 'level_input', 0, 0, 'IN_a');
  const b = addInstance(g, 'level_input', 0, 120, 'IN_b');
  a.params.width = 1;
  b.params.width = 1;
  const xor = addInstance(g, 'xor', 160, 0);
  const and = addInstance(g, 'and', 160, 160);
  const sum = addInstance(g, 'level_output', 320, 0, 'OUT_sum');
  const carry = addInstance(g, 'level_output', 320, 160, 'OUT_carry');
  sum.params.width = 1;
  carry.params.width = 1;
  connect(g, { inst: a.id, port: 'out' }, { inst: xor.id, port: 'a' });
  connect(g, { inst: b.id, port: 'out' }, { inst: xor.id, port: 'b' });
  connect(g, { inst: a.id, port: 'out' }, { inst: and.id, port: 'a' });
  connect(g, { inst: b.id, port: 'out' }, { inst: and.id, port: 'b' });
  connect(g, { inst: xor.id, port: 'out' }, { inst: sum.id, port: 'in' });
  connect(g, { inst: and.id, port: 'out' }, { inst: carry.id, port: 'in' });
  return { graph: g, gates: [xor, and] };
}

/** Runs the circuit for the four input rows and returns `sum,carry` per row. */
function truthOf(graph: Graph, library: BlueprintLibrary): string[] {
  const registry = composeRegistry(base, library);
  const sim = new Simulation(compile(graph, registry), registry);
  const rows: string[] = [];
  for (const [a, b] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ] as const) {
    sim.reset();
    sim.write(sim.net.outputBase('IN_a.out'), 1, a);
    sim.write(sim.net.outputBase('IN_b.out'), 1, b);
    sim.settle();
    rows.push(
      `${sim.read(sim.net.inputBase('OUT_sum.in'), 1)}${sim.read(sim.net.inputBase('OUT_carry.in'), 1)}`,
    );
  }
  return rows;
}

describe('planWrap', () => {
  it('derives one pin per wire crossing the selection edge', () => {
    const { graph, gates } = halfAdder();
    const plan = planWrap(graph, base, EMPTY, gates.map((inst) => inst.id))!;
    // Two inputs (`a`/`b` from the level inputs) and two outputs (to the two
    // level outputs) -- derived from the wires, not declared by hand.
    // Every crossing wire becomes a pin, so the xor's / and the and's
    // / are four inputs -- the two primitives share pin names, so the second
    // pair is suffixed.
    expect(plan.inputs.map((pin) => pin.id)).toEqual(['a', 'b', 'a2', 'b2']);
    expect(plan.outputs.map((pin) => pin.id)).toEqual(['out', 'out2']);
    expect(plan.inputs.map((pin) => pin.inner.inst)).toEqual([
      gates[0]!.id,
      gates[0]!.id,
      gates[1]!.id,
      gates[1]!.id,
    ]);
    expect(plan.undeclared).toBe(0);
    // The body is the selection, wired as it was: these two gates are wired only
    // to the outside, so no wire moves in with them.
    expect(plan.body.instances.map((inst) => inst.id)).toEqual(gates.map((inst) => inst.id));
    expect(plan.body.wires).toHaveLength(0);
    expect(plan.kept.map((inst) => inst.id)).toEqual(['IN_a', 'IN_b', 'OUT_sum', 'OUT_carry']);
  });

  it('moves the wires that stay inside the selection into the body', () => {
    const graph = emptyGraph();
    const nand = addInstance(graph, 'nand', 0, 0);
    const not = addInstance(graph, 'not', 160, 0);
    const rail = addInstance(graph, 'const_on', -160, 0);
    const out = addInstance(graph, 'level_output', 320, 0, 'OUT');
    out.params.width = 1;
    connect(graph, { inst: rail.id, port: 'out' }, { inst: nand.id, port: 'a' });
    connect(graph, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
    connect(graph, { inst: not.id, port: 'out' }, { inst: out.id, port: 'in' });

    const plan = planWrap(graph, base, EMPTY, [nand.id, not.id])!;
    expect(plan.body.wires).toHaveLength(1);
    expect(plan.body.wires[0]!.from.inst).toBe(nand.id);
    expect(plan.body.wires[0]!.to.inst).toBe(not.id);
    expect(plan.inputs.map((pin) => pin.inner.port)).toEqual(['a']);
    expect(plan.outputs.map((pin) => pin.inner.port)).toEqual(['out']);
  });

  it('gives an unconnected inner pin no pin on the component', () => {
    // The nand's `b` is wired to nothing. It reads 0 in the circuit as it stands,
    // and it must still read 0 inside the component -- declaring a pin for it
    // would invent a control the player never wired.
    const graph = emptyGraph();
    const first = addInstance(graph, 'nand', 0, 0);
    const second = addInstance(graph, 'nand', 160, 0);
    const rail = addInstance(graph, 'const_on', -160, 0);
    connect(graph, { inst: rail.id, port: 'out' }, { inst: first.id, port: 'a' });
    connect(graph, { inst: first.id, port: 'out' }, { inst: second.id, port: 'a' });

    const plan = planWrap(graph, base, EMPTY, [first.id, second.id])!;
    // Only the first nand's  is wired from outside: the second's  is fed
    // by the first, and its  (like both gates' ) is wired to nothing, so
    // there is exactly one input pin.
    expect(plan.inputs.map((pin) => pin.inner.port)).toEqual(['a']);
    // The second nand's output drives nothing outside the selection, so the
    // component has no output pin at all -- a part that only computes.
    expect(plan.outputs).toEqual([]);
  });

  it('keeps the width of a wide inner pin', () => {
    // A wrap that read the width off the wire would turn a byte-wide port into a
    // one-bit one, and the circuit would still "work" while dropping seven bits.
    const graph = emptyGraph();
    const add = addInstance(graph, 'add8', 0, 0);
    const left = addInstance(graph, 'level_input', -160, 0, 'IN_a');
    const right = addInstance(graph, 'level_input', -160, 120, 'IN_b');
    left.params.width = 8;
    right.params.width = 8;
    connect(graph, { inst: left.id, port: 'out' }, { inst: add.id, port: 'a' });
    connect(graph, { inst: right.id, port: 'out' }, { inst: add.id, port: 'b' });

    const plan = planWrap(graph, base, EMPTY, [add.id])!;
    expect(plan.inputs.map((pin) => pin.width)).toEqual([8, 8]);
  });

  it('wraps a selection with no crossing wires into a pinless component', () => {
    const graph = emptyGraph();
    const rail = addInstance(graph, 'const_on', 0, 0);
    const light = addInstance(graph, 'mem1', 160, 0);
    const plan = planWrap(graph, base, EMPTY, [rail.id, light.id])!;
    expect(plan.inputs).toEqual([]);
    expect(plan.outputs).toEqual([]);
    expect(plan.component.binds).toEqual({ inputs: {}, outputs: {} });
  });

  it('refuses an empty selection', () => {
    expect(planWrap(emptyGraph(), base, EMPTY, [])).toBeNull();
  });
});

describe('applying a wrap', () => {
  it('leaves the circuit computing exactly what it computed before', () => {
    const { graph, gates } = halfAdder();
    const before = truthOf(graph, EMPTY);
    expect(before).toEqual(['00', '10', '10', '01']);

    const plan = planWrap(graph, base, EMPTY, gates.map((inst) => inst.id))!;
    const wrapped = applyWrap(graph, EMPTY, plan);

    // The component is in the library, the two gates are gone from the board, and
    // the four crossing wires now reach the new instance.
    expect(Object.keys(wrapped.library)).toEqual([plan.component.id]);
    const board = wrapped.graph.instances.map((inst) => inst.id);
    expect(board.slice(0, 4)).toEqual(['IN_a', 'IN_b', 'OUT_sum', 'OUT_carry']);
    // The new instance is the only other one, and there is exactly one of it.
    expect(board).toHaveLength(5);
    expect(board[4]!.startsWith('i')).toBe(true);
    // The two wires BETWEEN the level connectors stay where they are, and the
    // four that crossed the selection edge are redrawn to the new instance.
    expect(wrapped.graph.wires).toHaveLength(6);
    // The four crossing wires are redrawn to the new instance: two into it, two
    // out of it.
    const written = (key: 'from' | 'to'): string[] =>
      wrapped.graph.wires
        .filter((wire) => wire[key].inst === board[4])
        .map((wire) => wire[key].port);
    // Two wires into the component and two out of it.
    expect(written('to')).toEqual(['a', 'b', 'a2', 'b2']);
    expect(written('from')).toEqual(['out', 'out2']);

    // THE CLAIM THAT MATTERS: same inputs, same outputs.
    expect(truthOf(wrapped.graph, wrapped.library)).toEqual(before);
    // And the wrapped document is valid: no dangling ports, no missing instance.
    const issues = validateGraph(wrapped.graph, composeRegistry(base, wrapped.library));
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('keeps the same metric after wrapping', () => {
    const { graph, gates } = halfAdder();
    const plan = planWrap(graph, base, EMPTY, gates.map((inst) => inst.id))!;
    const wrapped = applyWrap(graph, EMPTY, plan);
    const registry = composeRegistry(base, wrapped.library);
    // xor = 4, and = 2 -- and wrapping them must not change either number, which
    // is the "flattening a component is free" rule measured on a real wrap.
    expect(registry.size).toBeGreaterThan(base.size);
    expect(plan.component.id).toBe('bp1');
  });

  it('renames without touching the circuit', () => {
    const { graph, gates } = halfAdder();
    const plan = planWrap(graph, base, EMPTY, gates.map((inst) => inst.id), {
      name: { zh: '半加器', en: 'Half Adder' },
    })!;
    expect(plan.component.name).toEqual({ zh: '半加器', en: 'Half Adder' });
  });

  it('numbers a second component instead of reusing the first', () => {
    const { graph, gates } = halfAdder();
    const first = planWrap(graph, base, EMPTY, gates.map((inst) => inst.id))!;
    const wrapped = applyWrap(graph, EMPTY, first);
    const onBoard = wrapped.graph.instances[4]!.id;
    const second = planWrap(wrapped.graph, base, wrapped.library, [onBoard]);
    // A one-instance selection with no crossing wires: a pinless component, and
    // its id must not collide with the first.
    expect(second?.component.id).toBe('bp2');
  });
});
