import {
  addInstance,
  emptyGraph,
  nextId,
  type CustomComponentDef,
  type Graph,
  type Instance,
  type Wire,
  type WireEnd,
} from '../core/graph';
import type { Registry } from '../core/registry';
import { nextBlueprintId, type BlueprintLibrary } from './blueprints';

/**
 * A pin of the component a selection is about to become.
 *
 * `inner` is the body endpoint the pin stands for: the selected instance's pin
 * that the wire from outside reaches. The id is the pin's name on the new
 * component, which the draft panel lets the player change before committing.
 */
export interface DraftPin {
  /** Suggested id, unique within the draft. */
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inner: WireEnd;
  /** The outside pin this one is wired to, for the panel to show. */
  readonly label: string;
  /** The inner pin's width, which the component's pin inherits. */
  readonly width: number;
}

/**
 * A selection turned into a component, as pure data.
 *
 * NOTHING HERE TOUCHES THE DOCUMENT. The wrap is the one edit in the app that
 * changes two things at once -- the circuit loses the selection and gains an
 * instance, the library gains a definition -- so it is computed first and applied
 * in one step (`commands.ts`). Keeping it a function of (graph, selection)
 * also makes the interesting half testable without a board: which pins the
 * component exposes, how the wires are redrawn, and what the body is.
 */
export interface WrapPlan {
  /** Instances that move into the body, in the order they were on the board. */
  readonly body: Graph;
  /** The definition the library gains. */
  readonly component: CustomComponentDef;
  /** Other instances on the board, unchanged. */
  readonly kept: readonly Instance[];
  /** Wires that stay on the board, with the ones crossing the cut redrawn. */
  readonly wires: readonly Wire[];
  /** The wires that moved into the body. */
  readonly movedWires: readonly Wire[];
  /** Where the new instance goes: the middle of the selection. */
  readonly at: { x: number; y: number };
  readonly inputs: readonly DraftPin[];
  readonly outputs: readonly DraftPin[];
  /** Boundary wires the player drew but did not declare a pin for. */
  readonly undeclared: number;
}

/** The selected board instances, in board order. */
export function selectionOf(graph: Graph, ids: readonly string[]): Instance[] {
  const wanted = new Set(ids);
  return graph.instances.filter((inst) => wanted.has(inst.id));
}

/**
 * Works out what wrapping `selection` would produce.
 *
 * THE BOUNDARY IS DERIVED FROM THE WIRES, which is the only honest source: a
 * component's pins are exactly the places where a wire crosses the selection's
 * edge, so a player who wires something new around the selection gets a new pin
 * without declaring anything, and one who declares nothing gets a component with
 * no way in or out -- which is what their circuit does.
 *
 *  * a wire from OUTSIDE to a selected input pin  -> an INPUT pin of the component
 *  * a wire from a selected output pin to OUTSIDE -> an OUTPUT pin
 *  * a wire between two selected instances        -> body wiring, moved as-is
 *  * a selected input pin with no wire at all     -> reads 0 inside the body, the
 *    same as it does now, so it is deliberately NOT given a pin: declaring one
 *    would invent a control the circuit does not have.
 *
 * The component's declared pins are the DERIVED ones, one per crossing wire, and
 * every crossing wire is redrawn to the new instance. `undeclared` counts the
 * crossings that could not be redrawn -- a wire whose endpoint vanished, which
 * `validateGraph` has already reported -- so the caller can say so rather than
 * silently dropping a connection.
 */
export function planWrap(
  graph: Graph,
  registry: Registry,
  library: BlueprintLibrary,
  ids: readonly string[],
  options: { name?: { zh: string; en: string } } = {},
): WrapPlan | null {
  const selection = selectionOf(graph, ids);
  if (selection.length === 0) return null;
  const inside = new Set(selection.map((inst) => inst.id));
  const id = nextBlueprintId(library);

  const body = emptyGraph();
  for (const inst of selection) {
    // A COPY, not the instance itself: the body outlives this plan, and handing
    // the document's own object to the library would make the two share a record.
    // The id, position and params are what the body needs, so the copy carries
    // them and nothing else changes.
    body.instances.push({ ...inst, params: { ...inst.params } });
  }

  const inputs: DraftPin[] = [];
  const outputs: DraftPin[] = [];
  const wires: Wire[] = [];
  const movedWires: Wire[] = [];
  let undeclared = 0;

  /** The selected instance an endpoint names, or `null` for an outer endpoint. */
  const selectedAt = (end: WireEnd): Instance | null =>
    inside.has(end.inst) ? (selection.find((inst) => inst.id === end.inst) ?? null) : null;

  for (const wire of graph.wires) {
    const from = selectedAt(wire.from);
    const to = selectedAt(wire.to);
    if (from && to) {
      movedWires.push({ ...wire, from: { ...wire.from }, to: { ...wire.to } });
      continue;
    }
    if (!from && !to) {
      wires.push({ ...wire, from: { ...wire.from }, to: { ...wire.to } });
      continue;
    }
    // One end inside, one outside: this wire becomes a pin. The pin keeps the
    // width of the INNER pin it reaches -- a component whose `a` is one bit wide
    // because the wire happened to be one bit would quietly cut a byte in half.
    const inner = from ? wire.from : wire.to;
    const outer = from ? wire.to : wire.from;
    const host = selection.find((inst) => inst.id === inner.inst)!;
    const def = registry.has(host.def) ? registry.get(host.def) : null;
    if (!def || def.body !== undefined) {
      // A plumbing pin (`level_*`) or a nested component inside the selection:
      // there is no pin of its own to expose, so the wire cannot be redrawn.
      undeclared += 1;
      continue;
    }
    const pins = from ? def.outputs : def.inputs;
    const width = host.params.width ?? pins.find((pin) => pin.id === inner.port)?.width ?? 1;
    if (from) {
      // A wire OUT of the selection: the component now drives the outside pin, so
      // the component's own pin is the SOURCE of the redrawn wire.
      const pin: DraftPin = {
        id: uniquePinId(outputs, inner.port),
        name: { zh: inner.port, en: inner.port },
        inner: { inst: inner.inst, port: inner.port },
        label: `${outer.inst}.${outer.port}`,
        width,
      };
      outputs.push(pin);
      wires.push({
        ...wire,
        from: { inst: NEW_INSTANCE, port: pin.id },
        to: { ...outer },
      });
    } else {
      // A wire INTO the selection: the outside pin now drives the component, so
      // the component's own pin is the DESTINATION.
      const pin: DraftPin = {
        id: uniquePinId(inputs, inner.port),
        name: { zh: inner.port, en: inner.port },
        inner: { inst: inner.inst, port: inner.port },
        label: `${outer.inst}.${outer.port}`,
        width,
      };
      inputs.push(pin);
      wires.push({
        ...wire,
        from: { ...outer },
        to: { inst: NEW_INSTANCE, port: pin.id },
      });
    }
  }

  body.wires.push(...movedWires);
  const component: CustomComponentDef = {
    id,
    name: options.name ?? { zh: `自制元件 ${id}`, en: `Part ${id}` },
    inputs: inputs.map((pin) => ({ id: pin.id, width: pin.width })),
    outputs: outputs.map((pin) => ({ id: pin.id, width: pin.width })),
    binds: {
      inputs: Object.fromEntries(inputs.map((pin) => [pin.id, { ...pin.inner }])),
      outputs: Object.fromEntries(outputs.map((pin) => [pin.id, { ...pin.inner }])),
    },
    body,
  };

  const xs = selection.map((inst) => inst.x);
  const ys = selection.map((inst) => inst.y);
  return {
    body,
    component,
    kept: graph.instances.filter((inst) => !inside.has(inst.id)),
    wires,
    movedWires,
    at: {
      x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
    },
    inputs,
    outputs,
    undeclared,
  };
}

/**
 * The id the new instance carries while the plan is being built.
 *
 * A placeholder, not an id: `applyWrap` mints the real one against the graph it
 * writes into (the plan is pure and cannot know what is free). Every wire the
 * plan redraws names this placeholder, and applying the plan resolves it once.
 */
export const NEW_INSTANCE = '\u0000new';

/**
 * A pin id that is not already taken, so two `a` pins become `a` and `a2`.
 *
 * The uniqueness is per PLACEHOLDER, not per component: `new` and `out` may both
 * exist, and suffixes only appear where a name really repeats. A component whose
 * second input was forced to `a2` because an output is called `a` would be
 * renamed for no reason a player could see.
 */
function uniquePinId(taken: readonly DraftPin[], port: string): string {
  const used = new Set(taken.map((pin) => pin.id));
  if (!used.has(port)) return port;
  let n = 2;
  while (used.has(`${port}${n}`)) n += 1;
  return `${port}${n}`;
}

/**
 * The plan applied to a graph and a library, as the two values they become.
 *
 * The new instance's id is minted here, from the graph the wrap writes into, so
 * the placeholder in the plan's redrawn wires is replaced in the same pass. The
 * result is a plain `{ graph, library }` so the caller can hand it to a command
 * without this module knowing what a command is.
 */
export function applyWrap(
  graph: Graph,
  library: BlueprintLibrary,
  plan: WrapPlan,
): { graph: Graph; library: BlueprintLibrary } {
  const next: Graph = {
    instances: plan.kept.map((inst) => ({ ...inst, params: { ...inst.params } })),
    wires: plan.wires.map((wire) => ({
      ...wire,
      from: { ...wire.from },
      to: { ...wire.to },
    })),
    customComponents: [...graph.customComponents],
  };
  if (graph.level !== undefined) next.level = graph.level;

  // THE ID IS MINTED FROM THE GRAPH THE PLAYER HAS, not from the one being built.
  // The instances that moved into the body have left `next.instances`, and minting
  // against that shortened list would re-issue an id one of them still uses inside
  // the component -- so a wire to the new instance would silently resolve to a
  // body instance of the same name, and the circuit would wire itself in a loop.
  const instanceId = nextId('i', graph.instances);
  const instance = addInstance(next, plan.component.id, plan.at.x, plan.at.y, instanceId);
  // Rebound as a value: `WireEnd` is readonly, so the placeholder is replaced by
  // building the endpoint again rather than by assigning through it.
  next.wires = next.wires.map((wire) => ({
    ...wire,
    from: wire.from.inst === NEW_INSTANCE ? { inst: instance.id, port: wire.from.port } : wire.from,
    to: wire.to.inst === NEW_INSTANCE ? { inst: instance.id, port: wire.to.port } : wire.to,
  }));

  return {
    graph: next,
    library: {
      ...library,
      [plan.component.id]: { name: { ...plan.component.name }, def: plan.component },
    },
  };
}

