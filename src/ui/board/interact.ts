/**
 * Board input: pointer and keyboard editing.
 *
 * Every mutation goes through the `CommandStack` so the whole editing session is
 * undoable, and every mutation is followed by `options.onChange()` so the app
 * can re-render and re-grade. The module keeps only the *transient* pointer
 * bookkeeping (which pin a drag started from, which part is being moved); the
 * pixels themselves are drawn from the store.
 */
import {
  addInstance,
  connect,
  disconnect,
  removeInstance,
  type Graph,
  type WireEnd,
} from '../../core/graph';
import type { CommandStack } from '../../app/commands';
import type { AppState, Store } from '../../app/store';
import type { LevelSpec } from '../../levels/spec';
import { INSTANCE_HEIGHT } from '../theme';
import { hitTest, screenToWorld, snap, type Point } from './view';

export interface BoardInputOptions {
  /** Called after any model mutation so the UI can re-render and re-grade. */
  onChange(): void;
}

/** The instance id a freshly placed level-IO part takes, and the pin's width. */
export interface LevelIoPlacement {
  /** `IN_<pinId>`, `OUT` or `OUT_<pinId>`, in pin order. */
  readonly id: string;
  /** Width the level declares for that pin, in bits. */
  readonly width: number;
}

/**
 * The level-IO binding a freshly placed part must carry, or `undefined`.
 *
 * `levels/checks.ts` binds a circuit to its level by instance id: `IN_<pin>` for
 * a level input, `OUT` for a single-output level and `OUT_<pin>` for a
 * multi-output one. A part dropped from the palette would otherwise be named by
 * the graph's own allocator (`i1`, `i2`, …), never bind, and make every level
 * unpassable -- so placement hands out the conventional ids in pin order and
 * falls back to the allocator only once the level's pins are all placed (a spare
 * `level_input` is a legal, if redundant, part).
 *
 * The width comes back with the id because it is part of the same binding, and
 * only this function knows which pin the id refers to: `level_input` and
 * `level_output` declare 1-bit pins, so an 8-bit level pin exists only if the
 * instance placed for it says `params.width = 8`. Guessing it back from the id
 * string would be a second, unenforced source of truth.
 */
export function levelIoPlacement(
  level: LevelSpec,
  graph: Graph,
  defId: string,
): LevelIoPlacement | undefined {
  const taken = new Set(graph.instances.map((inst) => inst.id));
  if (defId === 'level_input') {
    for (const pin of level.io.inputs) {
      const id = `IN_${pin.id}`;
      if (!taken.has(id)) return { id, width: pin.width };
    }
    return undefined;
  }
  if (defId === 'level_output') {
    const pins = level.io.outputs;
    if (pins.length === 1) {
      const pin = pins[0]!;
      return taken.has('OUT') ? undefined : { id: 'OUT', width: pin.width };
    }
    for (const pin of pins) {
      const id = `OUT_${pin.id}`;
      if (!taken.has(id)) return { id, width: pin.width };
    }
  }
  return undefined;
}

/**
 * Deletes everything selected as one undoable step, wires included.
 *
 * Its own export rather than only a branch of the key handler: the toolbar's bin
 * button is the same operation, and two copies of the wire-collection rule would
 * be two chances to leave a dangling wire behind. Returns whether anything was
 * deleted, so a caller can tell "nothing selected" from "done".
 */
export function deleteSelection(
  store: Store<AppState>,
  stack: CommandStack,
  onChange: () => void,
): boolean {
  const ids = store.get().selected;
  if (ids.length === 0) return false;
  const removed = store.get().graph.instances.filter((i) => ids.includes(i.id));
  const wires = store
    .get()
    .graph.wires.filter((w) => ids.includes(w.from.inst) || ids.includes(w.to.inst));
  stack.push(
    {
      label: 'delete',
      do: (g) => {
        for (const inst of removed) removeInstance(g, inst.id);
      },
      undo: (g) => {
        for (const inst of removed) g.instances.push(inst);
        for (const wire of wires) g.wires.push(wire);
      },
    },
    store.get().graph,
  );
  store.set({ selected: [] });
  onChange();
  return true;
}

export function attachBoardInput(  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  stack: CommandStack,
  options: BoardInputOptions,
): () => void {
  let pendingFrom: WireEnd | null = null;
  let panning: Point | null = null;
  let moving: {
    id: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  const localPoint = (event: PointerEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const worldPoint = (event: PointerEvent | WheelEvent): Point =>
    screenToWorld(store.get().camera, localPoint(event));

  const instanceOf = (id: string) => store.get().graph.instances.find((i) => i.id === id);

  const armedDef = (): string => (canvas.dataset.pendingDef ?? '').trim();

  const place = (world: Point, defId: string): void => {
    // The cursor lands on the part's pin row (its vertical centre) at its left
    // edge, so a part dropped at (px, py) has its output pin at (px + 64, py):
    // the row the player then drags along to wire it up.
    const x = snap(world.x);
    const y = snap(world.y - INSTANCE_HEIGHT / 2);
    const placement = levelIoPlacement(store.get().level, store.get().graph, defId);
    let created: string | null = null;
    stack.push(
      {
        label: `add ${defId}`,
        do: (g) => {
          const inst = addInstance(g, defId, x, y, placement?.id);
          // The binding is the id AND the width: `compile` sizes a pin from
          // `params.width ?? def.pin.width`, and `bindLevelIo` refuses a pin
          // compiled at a width the level does not declare. A dropped 8-bit
          // level input that carried only the id would therefore be one bit
          // wide and make the level's own board ungradable.
          if (placement) inst.params.width = placement.width;
          created = inst.id;
        },
        undo: (g) => {
          if (created) removeInstance(g, created);
        },
      },
      store.get().graph,
    );
    options.onChange();
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const world = worldPoint(event);
    const state = store.get();
    const hit = hitTest(state.graph, state.registry, world);

    if (event.button === 1 || event.shiftKey) {
      panning = localPoint(event);
      return;
    }
    if (event.button !== 0) return;

    if (hit?.kind === 'pin' && !hit.isInput) {
      pendingFrom = { inst: hit.inst, port: hit.port };
      // Published so the board can draw the wire following the pointer, and
      // light up the pin it is coming from.
      store.set({
        dragging: { kind: 'wire', fromInst: hit.inst, fromPort: hit.port, to: null },
      });
      return;
    }

    if (hit?.kind === 'pin' && hit.isInput) {
      // Clicking a driven input unplugs it; the player then drags the new wire in.
      const existing = state.graph.wires.find((w) => w.to.inst === hit.inst && w.to.port === hit.port);
      if (existing) {
        stack.push(
          {
            label: 'disconnect',
            do: (g) => disconnect(g, existing.id),
            undo: (g) => void g.wires.push(existing),
          },
          state.graph,
        );
        options.onChange();
      }
      return;
    }

    if (hit?.kind === 'instance') {
      const inst = instanceOf(hit.id);
      if (!inst) return;
      moving = {
        id: hit.id,
        startX: inst.x,
        startY: inst.y,
        offsetX: world.x - inst.x,
        offsetY: world.y - inst.y,
      };
      store.set({
        selected: [hit.id],
        dragging: { kind: 'instance', ids: [hit.id], offsetX: moving.offsetX, offsetY: moving.offsetY },
      });
      return;
    }

    if (hit?.kind === 'wire') {
      const wire = state.graph.wires.find((w) => w.id === hit.id);
      if (wire) {
        stack.push(
          {
            label: 'delete wire',
            do: (g) => disconnect(g, wire.id),
            undo: (g) => void g.wires.push(wire),
          },
          state.graph,
        );
        options.onChange();
      }
      return;
    }

    // Empty space: place the currently armed palette part, or clear the selection.
    const defId = armedDef();
    if (defId) place(world, defId);
    else store.set({ selected: [] });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (panning) {
      const now = localPoint(event);
      const camera = store.get().camera;
      store.set({
        camera: {
          x: camera.x + (now.x - panning.x) / camera.zoom,
          y: camera.y + (now.y - panning.y) / camera.zoom,
          zoom: camera.zoom,
        },
      });
      panning = now;
      return;
    }

    if (pendingFrom) {
      // The rubber band. One repaint per move is the point: what moved is the
      // wire.
      store.set({
        dragging: {
          kind: 'wire',
          fromInst: pendingFrom.inst,
          fromPort: pendingFrom.port,
          to: worldPoint(event),
        },
      });
      return;
    }

    if (moving) {
      const inst = instanceOf(moving.id);
      if (!inst) return;
      const world = worldPoint(event);
      inst.x = snap(world.x - moving.offsetX);
      inst.y = snap(world.y - moving.offsetY);
      // An in-place edit notifies nothing by reference, and the store's
      // notification is unconditional by design: `set({})` is the "repaint"
      // call. It is what makes a dragged part follow the pointer.
      store.set({});
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    panning = null;

    if (moving) {
      const current = instanceOf(moving.id);
      const { id, startX, startY } = moving;
      moving = null;
      if (current && (current.x !== startX || current.y !== startY)) {
        // The drag already moved the part; the command only has to record how to
        // replay and reverse that move, so both directions are absolute.
        const endX = current.x;
        const endY = current.y;
        stack.push(
          {
            label: 'move',
            do: (g) => {
              const target = g.instances.find((i) => i.id === id);
              if (target) {
                target.x = endX;
                target.y = endY;
              }
            },
            undo: (g) => {
              const target = g.instances.find((i) => i.id === id);
              if (target) {
                target.x = startX;
                target.y = startY;
              }
            },
          },
          store.get().graph,
        );
        options.onChange();
      }
      store.set({ dragging: null });
      return;
    }

    if (!pendingFrom) {
      store.set({ dragging: null });
      return;
    }

    const from = pendingFrom;
    pendingFrom = null;
    const hit = hitTest(store.get().graph, store.get().registry, worldPoint(event));
    if (hit?.kind === 'pin' && hit.isInput) {
      const to: WireEnd = { inst: hit.inst, port: hit.port };
      // One driver per input: an existing wire into this pin is replaced, and
      // the replacement is a single undoable step.
      const replaced = store
        .get()
        .graph.wires.filter((w) => w.to.inst === to.inst && w.to.port === to.port);
      let createdId: string | null = null;
      stack.push(
        {
          label: 'connect',
          do: (g) => {
            for (const wire of replaced) disconnect(g, wire.id);
            createdId = connect(g, from, to).id;
          },
          undo: (g) => {
            if (createdId) disconnect(g, createdId);
            for (const wire of replaced) g.wires.push(wire);
          },
        },
        store.get().graph,
      );
      options.onChange();
    }
    store.set({ dragging: null });
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = store.get().camera;
    const before = screenToWorld(camera, localPoint(event));
    const zoom = Math.min(4, Math.max(0.25, camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const next = { ...camera, zoom };
    const after = screenToWorld(next, localPoint(event));
    // Keep the world point under the cursor pinned while the scale changes.
    store.set({
      camera: { zoom, x: next.x + (after.x - before.x), y: next.y + (after.y - before.y) },
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const accel = event.ctrlKey || event.metaKey;

    if (accel && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (stack.undo(store.get().graph)) {
        // The recorded commands may bring back or drop whichever parts were
        // selected, so the selection is not carried across a history step.
        store.set({ selected: [] });
        options.onChange();
      }
      return;
    }

    if (accel && ((key === 'z' && event.shiftKey) || key === 'y')) {
      event.preventDefault();
      if (stack.redo(store.get().graph)) {
        store.set({ selected: [] });
        options.onChange();
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelection(store, stack, options.onChange);
      return;
    }

    if (event.key === 'Escape' && armedDef()) {
      // Disarm the palette part: without this, stamping stays on forever and
      // every later click on empty space drops another copy.
      canvas.dataset.pendingDef = '';
      store.set({ status: null });
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  globalThis.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    globalThis.removeEventListener('keydown', onKeyDown);
  };
}
