import { describe, expect, it } from 'vitest';
import { addInstance, connect, emptyGraph, type CustomComponentDef } from '../../src/core/graph';
import { compile, Simulation } from '../../src/core/net';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { composeRegistry, libraryClosure, referencedComponents } from '../../src/levels/blueprints';
import {
  CIRCUIT_FORMAT,
  CIRCUIT_VERSION,
  parseCircuit,
  serializeCircuit,
} from '../../src/persist/circuit';

/**
 * The circuit file, round tripped.
 *
 * A FILE FORMAT IS ONLY WORTH ANYTHING IF IT SURVIVES THE TRIP, so the central
 * test exports a circuit that USES a player-built component, imports it into a
 * reader who has never seen that component, and runs it. The rest is the failure
 * surface: a file whose header is wrong must not half-load, and a file whose
 * component ids clash with the reader's own must not overwrite them.
 */
const base = createRegistry(BASE_DEFS);

/** A NAND-then-NOT inverter, as the wrap would have left one. */
function inverter(): CustomComponentDef {
  const body = emptyGraph();
  const nand = addInstance(body, 'nand', 0, 0);
  const not = addInstance(body, 'not', 160, 0);
  connect(body, { inst: nand.id, port: 'out' }, { inst: not.id, port: 'a' });
  return {
    id: 'bp1',
    name: { zh: '反相器', en: 'Inverter' },
    inputs: [{ id: 'a', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    binds: {
      inputs: { a: { inst: nand.id, port: 'a' } },
      outputs: { out: { inst: not.id, port: 'out' } },
    },
    body,
  };
}

/** `const_on -> bp1 -> level_output`: a circuit that needs its component. */
function usesInverter(component: CustomComponentDef) {
  const graph = emptyGraph('sandbox');
  const rail = addInstance(graph, 'const_on', 0, 0);
  const part = addInstance(graph, component.id, 160, 0);
  const out = addInstance(graph, 'level_output', 320, 0, 'OUT');
  out.params.width = 1;
  connect(graph, { inst: rail.id, port: 'out' }, { inst: part.id, port: 'a' });
  connect(graph, { inst: part.id, port: 'out' }, { inst: out.id, port: 'in' });
  return graph;
}

/** The library a writer would export from. */
function libraryOf(component: CustomComponentDef) {
  return { [component.id]: { name: { ...component.name }, def: component } };
}

describe('a circuit file', () => {
  it('round trips a circuit that needs a player-built component', () => {
    const component = inverter();
    const graph = usesInverter(component);
    const text = serializeCircuit(
      graph,
      libraryClosure(libraryOf(component), referencedComponents(graph)),
    );

    // The header is the spec's, so a file says what it is.
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw.format).toBe(CIRCUIT_FORMAT);
    expect(raw.version).toBe(CIRCUIT_VERSION);

    // Imported into a reader who has NOTHING, with no extra arguments: the file
    // carries its component, so this is where a half-travelled file would show up.
    const parsed = parseCircuit(text);
    expect('graph' in parsed).toBe(true);
    if (!('graph' in parsed)) return;
    expect(Object.keys(parsed.blueprints)).toEqual(['bp1']);

    // And it RUNS, with the signal the fixture computes: `const_on` drives the
    // NAND's `a`, its `b` is unwired and reads 0, so the NAND reads 1 and the
    // `not` behind it reads 0. (Asserting 1 here was wrong the first time, and the
    // kernel was right: a nand with one input high is high.)
    const registry = composeRegistry(base, parsed.blueprints);
    const sim = new Simulation(compile(parsed.graph, registry), registry);
    sim.reset();
    sim.settle();
    expect(sim.read(sim.net.outputBase('i2/i1.out'), 1)).toBe(1);
    expect(sim.read(sim.net.inputBase('OUT.in'), 1)).toBe(0);
  });

  it('renames a component the reader already has, and repoints the circuit', () => {
    // The reader's own `bp1` is a DIFFERENT circuit. Overwriting it would change
    // every `bp1` already on their board, so the imported one is renamed -- and the
    // imported instances have to follow it, or the file arrives pointing at the
    // reader's part.
    const named = (component: CustomComponentDef, name: { zh: string; en: string }): CustomComponentDef => ({
      ...component,
      name,
    });
    const mine = named(inverter(), { zh: '我的反相器', en: 'My inverter' });
    const theirs = named(inverter(), { zh: '别人的反相器', en: 'Their inverter' });
    // Distinguished by their bodies, so the two are really different parts.
    addInstance(theirs.body, 'and', 320, 0);

    const graph = usesInverter(theirs);
    const text = serializeCircuit(
      graph,
      libraryClosure(libraryOf(theirs), referencedComponents(graph)),
    );

    const parsed = parseCircuit(text, libraryOf(mine));
    expect('graph' in parsed).toBe(true);
    if (!('graph' in parsed)) return;
    expect(Object.keys(parsed.blueprints).sort()).toEqual(['bp1', 'bp1_2']);
    // The reader's own definition is untouched, and the imported circuit's
    // instance now names the renamed one.
    expect(parsed.blueprints.bp1!.name.zh).toBe('我的反相器');
    expect(parsed.blueprints.bp1_2!.name.zh).toBe('别人的反相器');
    expect(parsed.graph.instances.some((inst) => inst.def === 'bp1_2')).toBe(true);
    expect(parsed.graph.instances.some((inst) => inst.def === 'bp1')).toBe(false);
    // The body it points at is the imported one: it has the extra gate.
    expect(parsed.blueprints.bp1_2!.def.body.instances).toHaveLength(3);
  });

  it('refuses a file that is not one, without loading part of it', () => {
    const cases: Array<[string, string]> = [
      ['', 'JSON'],
      ['{"format":"something-else","version":1,"instances":[],"wires":[]}', 'format'],
      [`{"format":"${CIRCUIT_FORMAT}","version":99,"instances":[],"wires":[]}`, 'version'],
      [`{"format":"${CIRCUIT_FORMAT}","version":1}`, 'instance'],
      ['[]', 'circuit'],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseCircuit(text);
      const refusal = 'error' in parsed;
      expect(refusal, `expected a refusal for ${JSON.stringify(text)}`).toBe(true);
      if (!refusal) continue;
      expect(parsed.error.en.toLowerCase()).toContain(expected.toLowerCase());
    }
  });

  it('drops malformed entries instead of trusting the file', () => {
    // A hand-edited file is data from outside, so the reader typechecks rather
    // than casting: an instance with no id or a wire with one end is dropped, and
    // the rest of the circuit still loads.
    const text = JSON.stringify({
      format: CIRCUIT_FORMAT,
      version: 1,
      level: 'sandbox',
      instances: [
        { id: 'i1', def: 'nand', x: 0, y: 0 },
        { def: 'nand' },
        'not an instance',
      ],
      wires: [
        { id: 'w1', from: { inst: 'i1', port: 'out' }, to: { inst: 'i2', port: 'a' } },
        { id: 'w2', from: { inst: 'i1', port: 'out' } },
      ],
      blueprints: [],
    });
    const parsed = parseCircuit(text);
    expect('graph' in parsed).toBe(true);
    if (!('graph' in parsed)) return;
    expect(parsed.graph.instances).toHaveLength(1);
    expect(parsed.graph.wires).toHaveLength(1);
    // The defaults a missing field falls back to are real values, not NaN.
    expect(parsed.graph.instances[0]!.x).toBe(0);
    expect(parsed.graph.instances[0]!.params).toEqual({});
  });
});
