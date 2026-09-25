import { describe, expect, it } from 'vitest';
import {
  addInstance,
  cloneGraph,
  connect,
  disconnect,
  emptyGraph,
  nextId,
  removeInstance,
  validateGraph,
} from '../../src/core/graph';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';

const registry = createRegistry(BASE_DEFS);

describe('graph construction', () => {
  it('adds instances with generated ids', () => {
    const g = emptyGraph('ch1-01');
    const a = addInstance(g, 'nand', 10, 20);
    const b = addInstance(g, 'nand', 30, 40);
    expect(a.id).not.toBe(b.id);
    expect(g.instances).toHaveLength(2);
    expect(a.rot).toBe(0);
  });

  it('clones deeply so mutations do not leak', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const copy = cloneGraph(g);
    copy.instances[0]!.x = 999;
    copy.instances.push(addInstance(copy, 'not', 1, 1));
    expect(g.instances).toHaveLength(1);
    expect(a.x).toBe(0);
  });

  it('clones custom component bodies, not just their references', () => {
    const inner = emptyGraph();
    const n = addInstance(inner, 'nand', 0, 0);
    const o = addInstance(inner, 'not', 50, 0);
    connect(inner, { inst: n.id, port: 'out' }, { inst: o.id, port: 'a' });

    const g = emptyGraph();
    g.customComponents.push({
      id: 'c1',
      name: { zh: '自定义门', en: 'Custom Gate' },
      inputs: [{ id: 'a', width: 1 }],
      outputs: [{ id: 'out', width: 1 }],
      body: inner,
    });

    const copy = cloneGraph(g);
    const orig = g.customComponents[0]!;
    const cloned = copy.customComponents[0]!;
    expect(cloned).not.toBe(orig);
    expect(cloned.name).not.toBe(orig.name);
    expect(cloned.inputs[0]).not.toBe(orig.inputs[0]);
    expect(cloned.outputs[0]).not.toBe(orig.outputs[0]);
    expect(cloned.body).not.toBe(orig.body);
    expect(cloned.body.wires[0]!.from).not.toBe(orig.body.wires[0]!.from);
    expect(cloned.body.wires[0]!.to).not.toBe(orig.body.wires[0]!.to);

    cloned.name.en = 'Renamed';
    cloned.body.instances[0]!.x = 999;
    cloned.body.instances.push(addInstance(cloned.body, 'and', 0, 0));
    expect(orig.name.en).toBe('Custom Gate');
    expect(orig.body.instances).toHaveLength(2);
    expect(orig.body.instances[0]!.x).toBe(0);
  });

  it('removes an instance together with its wires', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(g.wires).toHaveLength(1);
    removeInstance(g, a.id);
    expect(g.instances).toHaveLength(1);
    expect(g.wires).toHaveLength(0);
  });

  it('disconnects a single wire', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    const w = connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    disconnect(g, w.id);
    expect(g.wires).toHaveLength(0);
    expect(g.instances).toHaveLength(2);
  });

  it('generates non-colliding ids', () => {
    const existing = [{ id: 'i1' }, { id: 'i3' }];
    expect(nextId('i', existing)).toBe('i4');
    expect(nextId('i', [])).toBe('i1');
  });
});

describe('validateGraph', () => {
  it('accepts a well-formed circuit', () => {
    // "Well-formed" means fully wired: every input pin has exactly one driver,
    // so the validator has nothing to say. The brief's fixture omitted the
    // NAND's two input wires and still expected zero issues -- unsatisfiable,
    // because the brief's validator reports an unwired input as `dangling-input`
    // (it reads 0). A source was added so the circuit really is well-formed and
    // the strong `toHaveLength(0)` assertion survives.
    const g = emptyGraph();
    const src = addInstance(g, 'const_off', 0, 0);
    const a = addInstance(g, 'nand', 50, 0);
    const b = addInstance(g, 'not', 100, 0);
    connect(g, { inst: src.id, port: 'out' }, { inst: a.id, port: 'a' });
    connect(g, { inst: src.id, port: 'out' }, { inst: a.id, port: 'b' });
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(validateGraph(g, registry)).toHaveLength(0);
  });

  it('warns about unwired inputs instead of rejecting the circuit', () => {
    // Pins the behaviour the fixture above used to assert by accident: leaving a
    // gate's inputs unwired is a warning (they read 0), never an error, so the
    // simulator still accepts the circuit.
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    const issues = validateGraph(g, registry);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.map((i) => i.code)).toEqual(['dangling-input', 'dangling-input']);
    expect(issues.map((i) => i.port)).toEqual(['a', 'b']);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('reports unknown defs', () => {
    const g = emptyGraph();
    addInstance(g, 'warp_drive', 0, 0);
    const issues = validateGraph(g, registry);
    expect(issues.map((i) => i.code)).toContain('unknown-def');
  });

  it('reports an unknown def instead of throwing when a wire points at it', () => {
    // `registry.get` throws on an unknown id, so every lookup has to be gated on
    // `registry.has` -- including the ones the wire walk performs on instances
    // that have a bogus def.
    const g = emptyGraph();
    const a = addInstance(g, 'warp_drive', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    expect(() => validateGraph(g, registry)).not.toThrow();
    const codes = validateGraph(g, registry).map((i) => i.code);
    expect(codes).toContain('unknown-def');
    // An unknown def has no known pin surface, so no port can be judged, and the
    // wire does still drive `b.a`.
    expect(codes).not.toContain('unknown-port');
    expect(codes).not.toContain('dangling-input');
  });

  it('reports wires that point at missing instances', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'out' }, to: { inst: 'ghost', port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-instance');
  });

  it('reports wires that point at missing ports', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'not', 50, 0);
    g.wires.push({ id: 'w1', from: { inst: a.id, port: 'nope' }, to: { inst: b.id, port: 'a' } });
    expect(validateGraph(g, registry).map((i) => i.code)).toContain('unknown-port');
  });

  it('reports two drivers on one input pin', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    const c = addInstance(g, 'not', 50, 0);
    connect(g, { inst: a.id, port: 'out' }, { inst: c.id, port: 'a' });
    connect(g, { inst: b.id, port: 'out' }, { inst: c.id, port: 'a' });
    const issues = validateGraph(g, registry);
    const md = issues.filter((i) => i.code === 'multiple-drivers');
    expect(md).toHaveLength(1);
    expect(md[0]!.inst).toBe(c.id);
    expect(md[0]!.port).toBe('a');
  });

  it('reports dangling inputs and feedback loops', () => {
    const g = emptyGraph();
    const a = addInstance(g, 'nand', 0, 0);
    const b = addInstance(g, 'nand', 0, 60);
    connect(g, { inst: b.id, port: 'out' }, { inst: a.id, port: 'a' });
    connect(g, { inst: a.id, port: 'out' }, { inst: b.id, port: 'a' });
    const codes = validateGraph(g, registry).map((i) => i.code);
    expect(codes).toContain('feedback-loop');
    expect(codes).toContain('dangling-input');
  });

  it('scans a 50,000-instance cycle without recursing', () => {
    // The loop scan is deliberately iterative; a recursive DFS would exceed the
    // JS stack at this depth. The chain is long enough that the cycle closes
    // only after ~50k frames of descent.
    const depth = 50_000;
    const g = emptyGraph();
    for (let i = 0; i < depth; i += 1) addInstance(g, 'nand', 0, 0, `n${i}`);
    for (let i = 1; i < depth; i += 1) {
      connect(g, { inst: `n${i - 1}`, port: 'out' }, { inst: `n${i}`, port: 'a' }, `w${i}`);
    }
    connect(g, { inst: `n${depth - 1}`, port: 'out' }, { inst: 'n0', port: 'b' }, 'wback');

    const issues = validateGraph(g, registry);
    expect(issues.filter((i) => i.code === 'feedback-loop')).toHaveLength(1);
    // Every node but n0 leaves its `b` unwired: depth - 1, plus n0's `a`.
    expect(issues.filter((i) => i.code === 'dangling-input')).toHaveLength(depth);
  });
});
