// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createStore, type AppState, type Store } from '../../src/app/store';
import { emptyProgress } from '../../src/app/progress';
import { CommandStack } from '../../src/app/commands';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { attachBoardInput } from '../../src/ui/board/interact';
import { planRoutes } from '../../src/ui/board/routes';
import type { Point } from '../../src/ui/board/routing';

/**
 * Right-click on the board: the shortcut for the two commonest edits there are.
 *
 * Everything here goes through `attachBoardInput` with a real (jsdom) canvas and
 * a real command stack, because the contract is not "a function removes a part"
 * -- it is "a right-click on the pixel under the pointer removes exactly what is
 * drawn there, as one undoable step, and leaves the rest of the board alone".
 * `hitTest` and the router are what decide that, so a test that built the graph
 * by hand would be testing a different program.
 */
const registry = createRegistry(BASE_DEFS);

/** A board with a source wired into a gate: two parts and one wire. */
function board(): { store: Store<AppState>; stack: CommandStack; graph: Graph } {
  const graph = emptyGraph('test-context-menu');
  const source = addInstance(graph, 'const_on', 0, 0);
  const gate = addInstance(graph, 'and', 200, 0);
  connect(graph, { inst: source.id, port: 'out' }, { inst: gate.id, port: 'a' });
  const store = createStore<AppState>({
    level: { id: 'test-context-menu' } as AppState['level'],
    graph,
    registry,
    progress: emptyProgress(),
    camera: { x: 0, y: 0, zoom: 1 },
    selected: [],
    dragging: null,
    dev: false,
    metrics: null,
    lastGrade: null,
    status: null,
  });
  return { store, stack: new CommandStack(), graph };
}

/**
 * Attaches board input to a fresh canvas and returns the two things a test
 * needs: a right-click at a world point, and the detach.
 *
 * jsdom lays nothing out, so `getBoundingClientRect()` is all zeros and page
 * coordinates ARE world coordinates here -- which is why the points below can be
 * read as the geometry they name.
 */
function attach(store: Store<AppState>, stack: CommandStack): {
  rightClick(at: Point): boolean;
  detach(): void;
} {
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = () => {};
  const detach = attachBoardInput(canvas, store, stack, { onChange: () => {} });
  return {
    rightClick(at: Point): boolean {
      const event = new MouseEvent('contextmenu', {
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
      });
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    },
    detach,
  };
}

describe('right-click on the board', () => {
  it('removes the part under the pointer and every wire that touched it', () => {
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      // Inside the gate's body, clear of its pins and of the wire reaching it.
      expect(rightClick({ x: 250, y: 60 })).toBe(true);
      expect(graph.instances.map((inst) => inst.def)).toEqual(['const_on']);
      expect(graph.wires).toEqual([]);
    } finally {
      detach();
    }
  });

  it('is ONE undoable step, and the undo brings the wires back too', () => {
    // A part and the wires that reached it are one thing the player drew. An
    // undo that restored a bare part would leave the circuit it was cut out of
    // still cut.
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      rightClick({ x: 250, y: 60 });
      expect(stack.undo(graph)).toBe(true);
      expect(graph.instances.map((inst) => inst.def)).toEqual(['const_on', 'and']);
      expect(graph.wires).toHaveLength(1);
    } finally {
      detach();
    }
  });

  it('removes a wire on its own when that is what is under the pointer', () => {
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      // A point ON the route the board actually draws, taken from the router
      // rather than guessed: the wire does not run along the straight chord.
      const route = planRoutes(graph, registry).get('w1')!;
      const onWire = route[1]!;
      expect(rightClick(onWire)).toBe(true);
      expect(graph.wires).toEqual([]);
      expect(graph.instances).toHaveLength(2);
    } finally {
      detach();
    }
  });

  it('leaves the selection alone: a right-click means the part under it', () => {
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      const gate = graph.instances.find((inst) => inst.def === 'and')!;
      store.set({ selected: [graph.instances[0]!.id] });
      rightClick({ x: 250, y: 60 });
      expect(store.get().selected).toEqual([graph.instances[0]!.id]);
      expect(graph.instances.some((inst) => inst.id === gate.id)).toBe(false);
    } finally {
      detach();
    }
  });

  it('drops a part that was selected, so the bin cannot delete it twice', () => {
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      const gate = graph.instances.find((inst) => inst.def === 'and')!;
      store.set({ selected: [gate.id] });
      rightClick({ x: 250, y: 60 });
      expect(store.get().selected).toEqual([]);
    } finally {
      detach();
    }
  });

  it('does nothing on bare board, and still suppresses the browser menu', () => {
    // The menu is suppressed hit or miss: this is a work surface, and a context
    // menu over the circuit is never what a right-click here was for.
    const { store, stack, graph } = board();
    const { rightClick, detach } = attach(store, stack);
    try {
      expect(rightClick({ x: 900, y: 700 })).toBe(true);
      expect(graph.instances).toHaveLength(2);
      expect(graph.wires).toHaveLength(1);
      expect(stack.canUndo()).toBe(false);
    } finally {
      detach();
    }
  });
});
