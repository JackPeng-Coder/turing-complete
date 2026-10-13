import { describe, expect, it } from 'vitest';
import {
  addInstance,
  connect,
  emptyGraph,
  validateGraph,
  type CustomComponentDef,
  type Graph,
} from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { blueprintDef } from '../../src/levels/blueprints';

/**
 * A custom component as the editor would build one.
 *
 * The body is a `nand` whose output feeds a `not`, so the component has one input
 * (the nand's `a`) and one output (the not's `out`) and the binding table has
 * something real to point at. `defId` and the body ids are parameters because the
 * recursion tests need a component that contains itself.
 */
function component(id: string, body?: Graph): CustomComponentDef {
  const inner = body ?? emptyGraph();
  const n = addInstance(inner, 'nand', 0, 0);
  const o = addInstance(inner, 'not', 80, 0);
  connect(inner, { inst: n.id, port: 'out' }, { inst: o.id, port: 'a' });
  return {
    id,
    name: { zh: `元件 ${id}`, en: `part ${id}` },
    inputs: [{ id: 'a', width: 1 }],
    outputs: [{ id: 'out', width: 1 }],
    binds: {
      inputs: { a: { inst: n.id, port: 'a' } },
      outputs: { out: { inst: o.id, port: 'out' } },
    },
    body: inner,
  };
}

/** The registry a document compiles against: the catalog plus its components. */
function registryFor(components: readonly CustomComponentDef[]) {
  const registry = createRegistry(BASE_DEFS);
  for (const entry of components) registry.register(blueprintDef(entry));
  return registry;
}

/** A document that instances one component and wires nothing to it. */
function using(components: readonly CustomComponentDef[], defId: string): Graph {
  const g = emptyGraph();
  g.customComponents.push(...components);
  addInstance(g, defId, 0, 0);
  return g;
}

/**
 * The defects of a document, less the warnings.
 *
 * `dangling-input` is a WARNING and every fixture here has one -- nothing is wired
 * to the component under test -- so a walk that judged these graphs by their whole
 * issue list would be asserting that an unwired pin is an error. The distinction
 * is the point: an unwired input reads 0 and is the player still working, while
 * everything below is a document the simulator must refuse.
 */
const errorsOf = (g: Graph, components: readonly CustomComponentDef[]): string[] =>
  validateGraph(g, registryFor(components))
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);

describe('validateGraph / custom components', () => {
  it('accepts a component whose surface matches its body', () => {
    const part = component('bp1');
    expect(errorsOf(using([part], 'bp1'), [part])).toEqual([]);
  });

  it('accepts a component that instances another one', () => {
    // Nesting is the whole point of the feature, so the two-level case is the
    // baseline the recursion tests are exceptions to.
    const inner = component('bp1');
    const outerBody = emptyGraph();
    addInstance(outerBody, 'bp1', 0, 0);
    const outer = component('bp2', outerBody);

    expect(errorsOf(using([inner, outer], 'bp2'), [inner, outer])).toEqual([]);
  });

  it('refuses a component that contains itself, without recursing for ever', () => {
    // The body instances the component being defined. Expanding this would never
    // terminate, so it is refused at validation rather than at the size cap --
    // and the test finishing at all is half the assertion.
    const selfBody = emptyGraph();
    addInstance(selfBody, 'bp1', 0, 0);
    const self = component('bp1', selfBody);

    const issues = validateGraph(using([self], 'bp1'), registryFor([self]));
    expect(issues.map((i) => i.code)).toContain('recursive-blueprint');
    expect(issues.find((i) => i.code === 'recursive-blueprint')?.message.en).toContain('bp1');
  });

  it('refuses a cycle between two components', () => {
    const aBody = emptyGraph();
    addInstance(aBody, 'bp2', 0, 0);
    const bBody = emptyGraph();
    addInstance(bBody, 'bp1', 0, 0);
    const a = component('bp1', aBody);
    const b = component('bp2', bBody);

    expect(errorsOf(using([a, b], 'bp1'), [a, b])).toContain('recursive-blueprint');
  });

  it('reports a missing binding', () => {
    // A pin with nothing behind it is the failure mode the surface/body split
    // exists to make visible: compile would resolve the wire to nothing and the
    // pin would read 0 while looking wired.
    const part = { ...component('bp1'), binds: { inputs: {}, outputs: {} } };
    const codes = errorsOf(using([part], 'bp1'), [part]);
    expect(codes.filter((code) => code === 'invalid-params')).toHaveLength(2);
  });

  it('reports a binding to a body instance that does not exist', () => {
    const part: CustomComponentDef = {
      ...component('bp1'),
      binds: {
        inputs: { a: { inst: 'nope', port: 'a' } },
        outputs: { out: { inst: 'nope', port: 'out' } },
      },
    };
    const codes = errorsOf(using([part], 'bp1'), [part]);
    expect(codes.filter((code) => code === 'unknown-instance')).toHaveLength(2);
  });

  it('reports an input bound to an output pin, and the reverse', () => {
    // The wrong side reads as a pin that is simply never driven: `compile` walks
    // the input binding to find where the wire lands, and a pin that is not an
    // input has nowhere to land.
    const body = emptyGraph();
    const n = addInstance(body, 'nand', 0, 0);
    const o = addInstance(body, 'not', 80, 0);
    const part: CustomComponentDef = {
      ...component('bp1', body),
      binds: {
        inputs: { a: { inst: n.id, port: 'out' } },
        outputs: { out: { inst: o.id, port: 'a' } },
      },
    };
    const issues = validateGraph(using([part], 'bp1'), registryFor([part]));
    expect(issues.filter((i) => i.code === 'unknown-port')).toHaveLength(2);
  });

  it('validates the body as a graph of its own', () => {
    // A defect inside a component is a defect of the document that carries it --
    // otherwise a player could hide an unknown def (or a doubly-driven input) one
    // level down, where nothing else looks.
    const body = emptyGraph();
    addInstance(body, 'no-such-part', 0, 0);
    const part = component('bp1', body);

    const issues = validateGraph(using([part], 'bp1'), registryFor([part]));
    const unknown = issues.find((i) => i.code === 'unknown-def');
    expect(unknown).toBeDefined();
    // The path names the component, so the message points at something the player
    // can find rather than at a bare `i2` that exists in every component.
    expect(unknown?.inst).toBe('bp1/i1');
  });

  it('refuses an instance id that contains the path separator', () => {
    // `compile` addresses a component instance as `<outer>/<inner>`, so an id with
    // a slash in it would collide with an instance inside a component -- two
    // different parts sharing one machine rather than a rejected document.
    const g = emptyGraph();
    addInstance(g, 'nand', 0, 0, 'i1/x');
    const issues = validateGraph(g, createRegistry(BASE_DEFS));
    expect(issues.map((i) => i.code)).toContain('invalid-params');
  });
});
