import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { SANDBOX_LEVEL } from '../../src/levels/sandbox';
import { LEVELS } from '../../src/levels/index';
import { blueprintDef } from '../../src/levels/blueprints';
import { buildImage } from '../../src/flash/build';
import { emitSketch } from '../../src/flash/emit';
import { isImage, type ProgramImage } from '../../src/flash/image';
import type { PinMap } from '../../src/flash/pins';

const registry = createRegistry(BASE_DEFS);

/** A sandbox board, labelled for the circuit editor. */
function board(): { graph: Graph; input(id: string, width: number): string; output(id: string, width: number): string } {
  const graph = emptyGraph('sandbox');
  return {
    graph,
    input: (id, width) => {
      const inst = addInstance(graph, 'level_input', 0, 0, id);
      inst.params.width = width;
      return inst.id;
    },
    output: (id, width) => {
      const inst = addInstance(graph, 'level_output', 0, 240, id);
      inst.params.width = width;
      return inst.id;
    },
  };
}

function build(graph: Graph, custom = registry, pins: PinMap = {}): ProgramImage {
  const result = buildImage(graph, custom, SANDBOX_LEVEL, 'arduino:avr:uno', pins);
  if (!isImage(result)) throw new Error(`refused: ${result.refusal.code} ${result.refusal.en}`);
  return result.image;
}

/** A NAND chain driven by one input connector, one output at the end. */
function chain(gates: number): ProgramImage {
  const place = board();
  const input = place.input('IN_1', 1);
  const output = place.output('OUT_1', 1);
  let previous = input;
  for (let index = 0; index < gates; index += 1) {
    const gate = addInstance(place.graph, index === 0 ? 'not' : 'nand', index * 40, 80);
    if (index === 0) {
      connect(place.graph, { inst: input, port: 'out' }, { inst: gate.id, port: 'a' });
    } else if (index === 1) {
      connect(place.graph, { inst: previous, port: 'out' }, { inst: gate.id, port: 'a' });
      connect(place.graph, { inst: input, port: 'out' }, { inst: gate.id, port: 'b' });
    } else {
      connect(place.graph, { inst: previous, port: 'out' }, { inst: gate.id, port: 'a' });
      connect(place.graph, { inst: input, port: 'out' }, { inst: gate.id, port: 'b' });
    }
    previous = gate.id;
  }
  connect(place.graph, { inst: previous, port: 'out' }, { inst: output, port: 'in' });
  return build(place.graph);
}

describe('buildImage', () => {
  it('turns connectors and gates into sources, nodes and mirror copies', () => {
    const place = board();
    const input = place.input('IN_1', 8);
    const output = place.output('OUT_1', 8);
    const gate = addInstance(place.graph, 'nand', 80, 80);
    connect(place.graph, { inst: input, port: 'out' }, { inst: gate.id, port: 'a' });
    connect(place.graph, { inst: gate.id, port: 'out' }, { inst: output, port: 'in' });

    const image = build(place.graph);
    expect(image.mode).toBe('dag');
    expect(image.inputs).toEqual([{ id: 'IN_1', index: 0, width: 8, base: expect.any(Number) }]);
    expect(image.outputs).toHaveLength(1);
    expect(image.outputs[0]!.id).toBe('OUT_1');
    expect(image.sources).toHaveLength(8);
    // One truth-table node for the NAND and one copy per output bit.
    expect(image.nodes.filter((node) => node.kind === 'tab')).toHaveLength(1);
    expect(image.nodes.filter((node) => node.kind === 'copy')).toHaveLength(8);
    expect(image.hash).toBeGreaterThan(0);
    expect(image.report.ramBytes).toBeLessThan(1900);
  });

  it('extracts a full adder as two output tables over the same three inputs', () => {
    const place = board();
    place.input('IN_1', 3);
    place.output('OUT_1', 2);
    const input = place.graph.instances.find((inst) => inst.id === 'IN_1')!;
    const output = place.graph.instances.find((inst) => inst.id === 'OUT_1')!;
    const adder = addInstance(place.graph, 'full_adder', 80, 80);
    connect(place.graph, { inst: input.id, port: 'out' }, { inst: adder.id, port: 'a' });
    connect(place.graph, { inst: input.id, port: 'out' }, { inst: adder.id, port: 'b' });
    connect(place.graph, { inst: input.id, port: 'out' }, { inst: adder.id, port: 'cin' });
    connect(place.graph, { inst: adder.id, port: 'sum' }, { inst: output.id, port: 'in' });
    const image = build(place.graph);
    const tables = image.nodes.filter((node) => node.kind === 'tab');
    expect(tables).toHaveLength(2);
    expect(tables[0]!.inputs).toEqual(tables[1]!.inputs);
    expect(tables[0]!.inputs).toHaveLength(3);
    // sum(1,1,0) = 0 and cout(1,1,0) = 1, at vector 0b011 in `a,b,cin` order.
    const sum = image.tables[tables[0]!.table]!;
    const cout = image.tables[tables[1]!.table]!;
    expect(Array.from(sum)).toEqual([0, 1, 1, 0, 1, 0, 0, 1]);
    expect(Array.from(cout)).toEqual([0, 0, 0, 1, 0, 1, 1, 1]);
  });

  it('compiles the two one-bit memories to a publish node and an edge', () => {
    const place = board();
    const input = place.input('IN_1', 1);
    const output = place.output('OUT_1', 1);
    const delay = addInstance(place.graph, 'delay_line', 80, 80);
    connect(place.graph, { inst: input, port: 'out' }, { inst: delay.id, port: 'in' });
    connect(place.graph, { inst: delay.id, port: 'out' }, { inst: output, port: 'in' });
    const image = build(place.graph);
    expect(image.stateCount).toBe(1);
    expect(image.edges).toHaveLength(1);
    expect(image.nodes.filter((node) => node.kind === 'pub')).toHaveLength(1);
    const publish = image.tables[image.nodes.find((node) => node.kind === 'pub')!.table]!;
    expect(Array.from(publish)).toEqual([0, 1]);
    // state 0 with in=0/1, then state 1 with in=0/1: the delay line samples its
    // input on every edge, so each held state can go back to either state.
    expect(Array.from(image.tables[image.edges[0]!.table]!)).toEqual([0, 1, 0, 1]);
  });

  it('uses Jacobi when the gate graph has a cycle, and a DAG order otherwise', () => {
    // A cross-coupled NAND latch: set and reset both low, both outputs high, a
    // stable state that no topological order can produce.
    const place = board();
    const set = place.input('IN_S', 1);
    const reset = place.input('IN_R', 1);
    const output = place.output('OUT_1', 1);
    const first = addInstance(place.graph, 'nand', 80, 80);
    const second = addInstance(place.graph, 'nand', 160, 80);
    connect(place.graph, { inst: set, port: 'out' }, { inst: first.id, port: 'a' });
    connect(place.graph, { inst: second.id, port: 'out' }, { inst: first.id, port: 'b' });
    connect(place.graph, { inst: reset, port: 'out' }, { inst: second.id, port: 'a' });
    connect(place.graph, { inst: first.id, port: 'out' }, { inst: second.id, port: 'b' });
    connect(place.graph, { inst: first.id, port: 'out' }, { inst: output, port: 'in' });
    const image = build(place.graph);
    expect(image.mode).toBe('jacobi');
    expect(image.report.ramBytes).toBeGreaterThan(Math.ceil(image.slots / 8));

    // The same latch with only one input is still a cycle; dropping the feedback
    // makes it a DAG, which is the contrast the mode is computed from.
    const acyclic = chain(2);
    expect(acyclic.mode).toBe('dag');
  });

  it('refuses a combinational loop that never settles', () => {
    const place = board();
    const power = addInstance(place.graph, 'const_on', 0, 0);
    place.input('IN_1', 1);
    const one = addInstance(place.graph, 'nand', 80, 80);
    const two = addInstance(place.graph, 'nand', 160, 80);
    connect(place.graph, { inst: power.id, port: 'out' }, { inst: one.id, port: 'a' });
    connect(place.graph, { inst: power.id, port: 'out' }, { inst: two.id, port: 'a' });
    connect(place.graph, { inst: two.id, port: 'out' }, { inst: one.id, port: 'b' });
    connect(place.graph, { inst: one.id, port: 'out' }, { inst: two.id, port: 'b' });
    const result = buildImage(place.graph, registry, SANDBOX_LEVEL);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('unstable');
  });

  it('refuses unsupported parts by name', () => {
    const place = board();
    place.input('IN_1', 1);
    place.output('OUT_1', 8);
    const wide = addInstance(place.graph, 'and8', 80, 80);
    const result = buildImage(place.graph, registry, SANDBOX_LEVEL);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('unsupported');
    expect(result.refusal.instances.join(' ')).toContain(wide.id);
    expect(result.refusal.en).toContain('and8');
  });

  it('refuses a board with no connectors', () => {
    const place = board();
    addInstance(place.graph, 'nand', 0, 0);
    const result = buildImage(place.graph, registry, SANDBOX_LEVEL);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('no-connectors');
  });

  it('refuses a level board rather than a sandbox', () => {
    const place = board();
    place.input('IN_1', 1);
    place.output('OUT_1', 1);
    // A real level, not a doctored sandbox: `LevelSpec.sandbox` is typed
    // `true`, so "not the sandbox" is a level that simply does not carry it.
    const level = LEVELS.find((entry) => entry.sandbox !== true);
    if (level === undefined) throw new Error('the campaign has no level');
    const result = buildImage(place.graph, registry, level);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('sandbox-only');
  });

  /**
   * A shallow fan of 1,000 one-bit memories: no cycle and no deep settle, but
   * 1,000 state bytes plus a 1,000-entry edge table exceed the Uno's budget. A
   * chain would hit the kernel's 512-sweep settle cap first, so the shape here
   * is deliberately wide rather than deep.
   */
  function memoryFan(): Graph {
    const place = board();
    const input = place.input('IN_1', 1);
    for (let index = 0; index < 1_000; index += 1) {
      const memory = addInstance(place.graph, 'mem1', index * 20, 80);
      const output = place.output(`OUT_${index + 1}`, 1);
      connect(place.graph, { inst: input, port: 'out' }, { inst: memory.id, port: 'set' });
      connect(place.graph, { inst: memory.id, port: 'out' }, { inst: output, port: 'in' });
    }
    return place.graph;
  }

  it('refuses a circuit that will not fit the Uno', () => {
    const result = buildImage(memoryFan(), registry, SANDBOX_LEVEL);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('too-big');
    expect(result.refusal.en).toMatch(/RAM|flash/);
  });

  it('accepts that circuit for a Mega, whose budget is the board the player picked', () => {
    // The same circuit, two boards: the refusal has to be about the board's
    // SRAM, not about the exporter's opinion of the circuit.
    const uno = buildImage(memoryFan(), registry, SANDBOX_LEVEL, 'arduino:avr:uno');
    expect(isImage(uno)).toBe(false);
    const result = buildImage(memoryFan(), registry, SANDBOX_LEVEL, 'arduino:avr:mega');
    if (!isImage(result)) throw new Error(`Mega refused: ${result.refusal.code} ${result.refusal.en}`);
    expect(result.image.report.ramBytes).toBeGreaterThan(1_900);
    expect(result.image.report.ramBytes).toBeLessThanOrEqual(7_900);
    expect(result.image.report.flashBytes).toBeLessThanOrEqual(250_000);
    // The image is the same bytes on every AVR: only the budget changed.
    expect(result.image.hash).toBeTypeOf('number');
  });

  it('refuses a connector wider than the protocol carries', () => {
    const place = board();
    place.input('IN_1', 33);
    place.output('OUT_1', 1);
    const result = buildImage(place.graph, registry, SANDBOX_LEVEL);
    expect(isImage(result)).toBe(false);
    if (isImage(result)) return;
    expect(result.refusal.code).toBe('too-big');
  });

  it('expands a player component to its leaves and builds it', () => {
    const body = emptyGraph();
    const nand = addInstance(body, 'nand', 0, 0);
    const component = {
      id: 'bp1',
      name: { zh: '自定义', en: 'custom' },
      inputs: [
        { id: 'a', width: 1 },
        { id: 'b', width: 1 },
      ],
      outputs: [{ id: 'out', width: 1 }],
      binds: {
        inputs: {
          a: { inst: nand.id, port: 'a' },
          b: { inst: nand.id, port: 'b' },
        },
        outputs: { out: { inst: nand.id, port: 'out' } },
      },
      body,
    };
    const composed = createRegistry(BASE_DEFS);
    composed.register(blueprintDef(component));
    const place = board();
    const input = place.input('IN_1', 2);
    const output = place.output('OUT_1', 1);
    const instance = addInstance(place.graph, 'bp1', 80, 80);
    place.graph.customComponents.push(component);
    connect(place.graph, { inst: input, port: 'out' }, { inst: instance.id, port: 'a' });
    connect(place.graph, { inst: input, port: 'out' }, { inst: instance.id, port: 'b' });
    connect(place.graph, { inst: instance.id, port: 'out' }, { inst: output, port: 'in' });
    const image = build(place.graph, composed);
    expect(image.nodes.filter((node) => node.kind === 'tab')).toHaveLength(1);
    expect(image.report.instances).toBe(3);
    // `IN_1`, `OUT_1` and the component's NAND: the component itself is a name,
    // not a leaf.
    expect(image.report.expanded).toBe(3);
  });

  it('puts a connector on a board pin, and the pin is part of the image', () => {
    const place = board();
    const input = place.input('IN_1', 1);
    const output = place.output('OUT_1', 1);
    connect(place.graph, { inst: input, port: 'out' }, { inst: output, port: 'in' });
    const plain = build(place.graph);
    const pinned = build(place.graph, registry, { IN_1: '2', OUT_1: '13' });
    expect(pinned.pinInputs).toEqual([{ ext: 0, pin: 2 }]);
    expect(pinned.pinOutputs).toHaveLength(1);
    expect(pinned.pinOutputs[0]!.pin).toBe(13);
    // The mapping changes what the firmware does, so it changes the banner hash.
    expect(pinned.hash).not.toBe(plain.hash);
    // The compiled-in pin tables cost their descriptor bytes exactly: 2 for the
    // input pin, 3 for the output pin, and one RAM byte for the poll snapshot.
    expect(pinned.report.flashBytes - plain.report.flashBytes).toBe(5);
    expect(pinned.report.ramBytes - plain.report.ramBytes).toBe(1);
    const sketch = emitSketch(pinned);
    expect(sketch).toContain('static const TcPinIn TC_PIN_IN[1] PROGMEM');
    expect(sketch).toContain('static const TcPinOut TC_PIN_OUT[1] PROGMEM');
    expect(sketch).toContain('{2,0}');
    expect(sketch).toMatch(/\{13,\d+\}/);
    expect(sketch).toContain('INPUT_PULLUP');
  });

  it('ignores a remembered pin for a connector the circuit no longer has', () => {
    const place = board();
    const input = place.input('IN_1', 1);
    const output = place.output('OUT_1', 1);
    connect(place.graph, { inst: input, port: 'out' }, { inst: output, port: 'in' });
    const plain = build(place.graph);
    const stale = build(place.graph, registry, { GONE: '13' });
    expect(stale.hash).toBe(plain.hash);
  });

  it('refuses pin assignments that cannot work', () => {
    const place = board();
    const input = place.input('IN_1', 1);
    const output = place.output('OUT_1', 1);
    place.input('IN_2', 8);
    connect(place.graph, { inst: input, port: 'out' }, { inst: output, port: 'in' });
    const refusalOf = (pins: PinMap) => {
      const result = buildImage(place.graph, registry, SANDBOX_LEVEL, 'arduino:avr:uno', pins);
      if (isImage(result)) throw new Error('expected a refusal');
      return result.refusal;
    };
    const shared = refusalOf({ IN_1: '13', OUT_1: '13' });
    expect(shared.code).toBe('pins');
    expect(shared.en).toContain('both');
    // The connector that arrived second is the one the refusal names; the first
    // stays the holder of the pin.
    expect(shared.instances).toEqual(['OUT_1']);
    expect(refusalOf({ OUT_1: '22' }).code).toBe('pins');
    const wide = refusalOf({ IN_2: '3' });
    expect(wide.code).toBe('pins');
    expect(wide.zh).toContain('IN_2');
  });

  it('is deterministic: one circuit, one hash, one sketch', () => {
    const first = chain(12);
    const second = chain(12);
    expect(second.hash).toBe(first.hash);
    expect(emitSketch(second)).toBe(emitSketch(first));
    const sketch = emitSketch(first);
    expect(sketch).toContain('#define TC_HASH 0x');
    expect(sketch).toContain(`#define TC_NODE_COUNT ${first.nodes.length}`);
    expect(sketch).toContain('void setup()');
    expect(sketch).toContain('void loop()');
    expect(sketch).toContain('#TC1 ');
  });
});
