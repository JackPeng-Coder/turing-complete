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
import { placementAt, instanceRect } from './geometry';
import { hitTest, screenToWorld, snap, type Point } from './view';

export interface BoardInputOptions {
  /** Called after any model mutation so the UI can re-render and re-grade. */
  onChange(): void;
  /**
   * A CLICK -- not a drag -- on a part, reported by instance id.
   *
   * What a click means belongs to the caller: the board does not know which
   * parts are switches. It is how a level's input is flipped without going to
   * the readout panel, which is the difference between driving a circuit and
   * filling in a form.
   */
  onPick?(instId: string): void;
  /**
   * Where the pointer is, in world units, or `null` when it has left the board.
   *
   * Reported only while a part is armed, because that is the only thing on this
   * board that follows the pointer: an unarmed hover has nothing to say, and a
   * repaint per mouse move for nothing is a repaint per mouse move.
   */
  onHover?(at: Point | null): void;
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
  if (store.get().selected.length === 0) return false;
  if (!deleteParts(store, stack, store.get().selected)) return false;
  store.set({ selected: [] });
  onChange();
  return true;
}

/**
 * Takes parts off the board, and every wire that touched one, as ONE step.
 *
 * The undo has to bring the wires back too: a part and the wires that reached it
 * are a single thing the player drew, and an undo that restored a bare part
 * would leave the circuit it was cut out of still cut.
 */
function deleteParts(
  store: Store<AppState>,
  stack: CommandStack,
  ids: readonly string[],
): boolean {
  const graph = store.get().graph;
  const removed = graph.instances.filter((inst) => ids.includes(inst.id));
  if (removed.length === 0) return false;
  const wires = graph.wires.filter((w) => ids.includes(w.from.inst) || ids.includes(w.to.inst));
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
    graph,
  );
  return true;
}

/**
 * How far the pointer may wander and still count as a click, in screen pixels.
 *
 * Four, because a hand is not a mouse trap: with an exact comparison a one-pixel
 * twitch during a click turned it into a pan, and the click that should have
 * cleared the selection cleared nothing. Every interface has a number like this;
 * this is where the board keeps its own.
 */
const CLICK_SLOP = 4;

export function attachBoardInput(  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  stack: CommandStack,
  options: BoardInputOptions,
): () => void {
  let pendingFrom: WireEnd | null = null;
  let panning: Point | null = null;
  /**
   * A press on bare board that has not become a pan yet.
   *
   * The gesture is only a pan once the pointer has moved past `CLICK_SLOP`, and
   * until then nothing has happened at all: a release here is a CLICK on bare
   * board, which clears the selection -- the gesture that used to be lost the
   * moment panning moved onto empty space.
   */
  let panFrom: Point | null = null;
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

  const armedDef = (): string => store.get().armed ?? '';

  const place = (world: Point, defId: string): void => {
    // The cursor lands on the part's pin row (its vertical centre) at its left
    // edge, so a part dropped at (px, py) has its output pin at (px + 72, py):
    // the row the player then drags along to wire it up. `placementAt` states
    // that rule once, because the ghost on the pointer is drawn from it too.
    const reg = store.get().registry;
    const { x, y } = reg.has(defId)
      ? placementAt(world, reg.get(defId))
      : { x: snap(world.x), y: snap(world.y - INSTANCE_HEIGHT / 2) };
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
    // The part is on the board now, so the ghost would be drawn straight over
    // it -- the thing you just placed sitting under a translucent copy of
    // itself until you moved the mouse. It comes back with the next move, which
    // is also when it has somewhere new to be.
    options.onHover?.(null);
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const world = worldPoint(event);
    const state = store.get();
    const hit = hitTest(state.graph, state.registry, world);

    if (event.button === 1) {
      // The middle button is unambiguous, so it pans at once and never means a
      // click on bare board.
      panning = localPoint(event);
      panFrom = null;
      return;
    }
    if (event.button !== 0) return;

    // CTRL DRAGS A SELECTION BAND, wherever it starts: on bare board, on a part,
    // on a wire. Ctrl is the modifier for "this drag is about selecting", so it
    // cannot also mean "move this part" -- and a band that starts on top of a
    // part is exactly how you select that part and its neighbours together.
    if (event.ctrlKey || event.metaKey) {
      options.onHover?.(null);
      store.set({ dragging: { kind: 'marquee', x0: world.x, y0: world.y, x1: world.x, y1: world.y } });
      return;
    }

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

    // EMPTY SPACE PANS. The board is larger than the window on every level past
    // the first, and dragging the paper is what a hand tries first; the middle
    // button still works for anyone who reaches for it out of habit.
    //
    // An armed palette part still takes the click, because stamping is a mode
    // the player turned on deliberately and it has to be exitable by clicking.
    const defId = armedDef();
    if (defId) place(world, defId);
    else panFrom = localPoint(event);
  };

  const onPointerMove = (event: PointerEvent): void => {
    // The ghost only exists while a part is in hand and NOTHING is being dragged:
    // during a band or a wire the pointer is drawing something else, and a
    // translucent part riding along on top of it is in the way of the thing the
    // player is actually doing.
    if (options.onHover && armedDef() && store.get().dragging === null) {
      options.onHover(worldPoint(event));
    }

    const band = store.get().dragging;
    if (band?.kind === 'marquee') {
      const at = worldPoint(event);
      store.set({
        dragging: { kind: 'marquee', x0: band.x0, y0: band.y0, x1: at.x, y1: at.y },
      });
      return;
    }

    // A press on bare board is not a pan until it has moved far enough to be
    // one. Promoting it here rather than at the press means a click moves the
    // view by exactly nothing -- the earlier version panned the pixels a
    // twitching hand had wandered and then called it a click.
    if (panFrom && !panning) {
      const now = localPoint(event);
      if (Math.hypot(now.x - panFrom.x, now.y - panFrom.y) <= CLICK_SLOP) return;
      panning = panFrom;
    }

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
    const band = store.get().dragging;
    if (band?.kind === 'marquee') {
      // Everything the band touched, in one selection. A band that never moved
      // is a point, so it selects the part under it and nothing else -- which
      // makes Ctrl+click the way to select one part without clearing the rest.
      const left = Math.min(band.x0, band.x1);
      const right = Math.max(band.x0, band.x1);
      const top = Math.min(band.y0, band.y1);
      const bottom = Math.max(band.y0, band.y1);
      const { graph, registry } = store.get();
      const selected: string[] = [];
      for (const inst of graph.instances) {
        if (!registry.has(inst.def)) continue;
        const rect = instanceRect(inst, registry.get(inst.def));
        const overlaps =
          rect.x <= right &&
          rect.x + rect.w >= left &&
          rect.y <= bottom &&
          rect.y + rect.h >= top;
        if (overlaps) selected.push(inst.id);
      }
      store.set({ selected, dragging: null });
      return;
    }

    if (panFrom || panning) {
      const dragged = panning !== null;
      panFrom = null;
      panning = null;
      // It never became a drag, so it was a click on bare board: clear the
      // selection. A pan deliberately does NOT -- looking around the board is
      // not a statement about what you had selected.
      if (!dragged) store.set({ selected: [] });
      store.set({ dragging: null });
      return;
    }

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
      } else if (current) {
        // It did not move, so it was a click. Positions are snapped, so a press
        // and release inside one grid cell lands back on the part's own
        // coordinates and needs no undo entry.
        options.onPick?.(id);
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
      store.set({ armed: null, status: null });
    }
  };

  /** The pointer left the board: there is nowhere for a ghost to be. */
  const onPointerLeave = (): void => options.onHover?.(null);

  /**
   * RIGHT-CLICK REMOVES WHAT IS UNDER THE POINTER, and nothing else.
   *
   * It is the shortcut for the two commonest edits on a board -- undo a part
   * dropped in the wrong place, and cut a wire that went somewhere silly -- and
   * both are one undoable step, so a right-click that was a mistake costs one
   * Ctrl+Z. It deliberately does NOT touch the selection: a player who has
   * selected five parts and right-clicks a sixth means that sixth one.
   *
   * The browser's own menu is suppressed over the whole board, hit or miss: this
   * is a work surface, and a context menu covering the circuit is never what a
   * right-click here was for.
   */
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(store.get().camera, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const graph = store.get().graph;
    const hit = hitTest(graph, store.get().registry, world);
    if (!hit) return;

    if (hit.kind === 'wire') {
      const wire = graph.wires.find((w) => w.id === hit.id);
      if (!wire) return;
      stack.push(
        {
          label: 'delete wire',
          do: (g) => disconnect(g, wire.id),
          undo: (g) => void g.wires.push(wire),
        },
        graph,
      );
      options.onChange();
      return;
    }

    const id = hit.kind === 'instance' ? hit.id : hit.inst;
    if (!deleteParts(store, stack, [id])) return;
    // A part that was selected and is now gone must not stay in the selection,
    // or the next press of the bin button would try to delete it twice.
    store.set({ selected: store.get().selected.filter((selected) => selected !== id) });
    options.onChange();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('pointerleave', onPointerLeave);
  globalThis.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    globalThis.removeEventListener('keydown', onKeyDown);
  };
}
