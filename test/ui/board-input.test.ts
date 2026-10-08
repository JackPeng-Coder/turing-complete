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
    armed: null,
    dev: false,
    programs: {},
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
  drag(from: Point, to: Point, options?: { ctrl?: boolean }): void;
  detach(): void;
} {
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = () => {};
  const detach = attachBoardInput(canvas, store, stack, { onChange: () => {} });
  const send = (type: string, at: Point, ctrl = false): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        clientX: at.x,
        clientY: at.y,
        button: 0,
        ctrlKey: ctrl,
        pointerId: 1,
        bubbles: true,
      }),
    );
  };
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
    drag(from: Point, to: Point, options?: { ctrl?: boolean }): void {
      const ctrl = options?.ctrl ?? false;
      send('pointerdown', from, ctrl);
      send('pointermove', to, ctrl);
      send('pointerup', to, ctrl);
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

/**
 * Dragging bare board moves the view, and CLICKING it clears the selection.
 *
 * Both are the same gesture until the pointer moves, which is why the board
 * separates them on release rather than on press: an exact comparison used to
 * turn a one-pixel twitch into a pan, and the click that should have deselected
 * the part you just placed deselected nothing.
 */
describe('dragging bare board', () => {
  it('pans, and leaves the selection alone', () => {
    const { store, stack } = board();
    const { drag, detach } = attach(store, stack);
    try {
      store.set({ selected: [store.get().graph.instances[0]!.id] });
      drag({ x: 600, y: 500 }, { x: 660, y: 540 });
      expect(store.get().camera.x).toBe(60);
      expect(store.get().camera.y).toBe(40);
      // Looking around the board is not a statement about what was selected.
      expect(store.get().selected).toHaveLength(1);
    } finally {
      detach();
    }
  });

  it('clears the selection when the pointer did not really move', () => {
    const { store, stack } = board();
    const { drag, detach } = attach(store, stack);
    try {
      store.set({ selected: [store.get().graph.instances[0]!.id] });
      // A hand is not a mouse trap: two pixels of drift is still a click.
      drag({ x: 600, y: 500 }, { x: 602, y: 501 });
      expect(store.get().selected).toEqual([]);
      expect(store.get().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    } finally {
      detach();
    }
  });
});

/**
 * Ctrl+drag is the selection band, and it is the reason the pan and the band can
 * share the left button: Ctrl is the modifier for "this drag is about selecting",
 * so it wins wherever it starts -- over bare board, over a part, over a wire --
 * and a plain drag keeps meaning whatever the thing under it means.
 */
describe('the selection band', () => {
  it('selects every part it sweeps over, and only those', () => {
    const { store, stack, graph } = board();
    const { drag, detach } = attach(store, stack);
    try {
      // The source is at (0,0)-(72,72); the gate at (200,0)-(272,72).
      drag({ x: -20, y: -20 }, { x: 100, y: 100 }, { ctrl: true });
      expect(store.get().selected).toEqual([graph.instances[0]!.id]);
      expect(store.get().camera).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(store.get().dragging).toBeNull();
    } finally {
      detach();
    }
  });

  it('takes both when the band covers both', () => {
    const { store, stack, graph } = board();
    const { drag, detach } = attach(store, stack);
    try {
      drag({ x: -20, y: -20 }, { x: 400, y: 100 }, { ctrl: true });
      expect(store.get().selected).toHaveLength(2);
      expect(store.get().selected).toContain(graph.instances[1]!.id);
    } finally {
      detach();
    }
  });

  it('is a band across bare board, not a pan', () => {
    // The two gestures share the left button, so this is the assertion that the
    // modifier is what separates them.
    const { store, stack } = board();
    const { drag, detach } = attach(store, stack);
    try {
      drag({ x: 600, y: 400 }, { x: 700, y: 500 }, { ctrl: true });
      expect(store.get().camera).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(store.get().selected).toEqual([]);
    } finally {
      detach();
    }
  });
});
