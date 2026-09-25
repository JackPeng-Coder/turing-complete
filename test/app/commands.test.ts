import { describe, expect, it } from 'vitest';
import { addInstance, connect, disconnect, emptyGraph, removeInstance } from '../../src/core/graph';
import { CommandStack } from '../../src/app/commands';

describe('CommandStack', () => {
  it('undoes and redoes an add', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    // Fixture note (brief conflict, see task-10-report.md): `push` runs `do`,
    // so the graph has to start empty -- the brief's fixture pre-added the
    // instance and then asserted a length of 1, which only holds if pushing
    // records the command without applying it. Allocate the id through
    // `addInstance`, take it back out, and let the command do the adding.
    const inst = addInstance(g, 'nand', 10, 10);
    removeInstance(g, inst.id);
    stack.push(
      {
        label: 'add nand',
        do: (graph) => void graph.instances.push(inst),
        undo: (graph) => removeInstance(graph, inst.id),
      },
      g,
    );
    expect(g.instances).toHaveLength(1);
    expect(stack.undo(g)).toBe(true);
    expect(g.instances).toHaveLength(0);
    expect(stack.redo(g)).toBe(true);
    expect(g.instances).toHaveLength(1);
  });

  it('reports when there is nothing to undo', () => {
    const stack = new CommandStack();
    expect(stack.undo(emptyGraph())).toBe(false);
    expect(stack.canUndo()).toBe(false);
  });

  it('drops the redo branch after a new command', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    const a = addInstance(g, 'nand', 0, 0);
    stack.push({ label: 'a', do: () => {}, undo: () => removeInstance(g, a.id) }, g);
    stack.undo(g);
    expect(stack.canRedo()).toBe(true);
    stack.push({ label: 'b', do: () => {}, undo: () => {} }, g);
    expect(stack.canRedo()).toBe(false);
  });

  it('caps history depth', () => {
    const g = emptyGraph();
    const stack = new CommandStack(3);
    for (let i = 0; i < 10; i += 1) {
      stack.push({ label: `c${i}`, do: () => {}, undo: () => {} }, g);
    }
    expect(stack.depth).toBe(3);
  });

  it('round-trips a mutation that reassigns the graph arrays', () => {
    // `removeInstance` / `disconnect` reassign `g.wires` to a filtered copy
    // while `connect` pushes into it, so undo has to rebuild the wire (same id)
    // rather than replay a captured array reference.
    const g = emptyGraph();
    const input = addInstance(g, 'level_input', 0, 0, 'IN_a');
    const gate = addInstance(g, 'nand', 40, 0, 'G1');
    const wire = connect(g, { inst: input.id, port: 'out' }, { inst: gate.id, port: 'a' });
    const stack = new CommandStack();
    stack.push(
      {
        label: 'cut wire',
        do: (graph) => disconnect(graph, wire.id),
        undo: (graph) => void connect(graph, wire.from, wire.to, wire.id),
      },
      g,
    );
    expect(g.wires).toHaveLength(0);
    expect(stack.undo(g)).toBe(true);
    expect(g.wires.map((w) => w.id)).toEqual([wire.id]);
    expect(stack.redo(g)).toBe(true);
    expect(g.wires).toHaveLength(0);
  });

  it('clear forgets both branches', () => {
    const g = emptyGraph();
    const stack = new CommandStack();
    stack.push({ label: 'a', do: () => {}, undo: () => {} }, g);
    stack.push({ label: 'b', do: () => {}, undo: () => {} }, g);
    stack.undo(g);
    expect(stack.depth).toBe(1);
    expect(stack.canRedo()).toBe(true);
    stack.clear();
    expect(stack.depth).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });
});
