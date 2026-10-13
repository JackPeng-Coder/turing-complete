import { emptyGraph, type Graph } from '../core/graph';

/**
 * The sandbox circuit, kept between sessions.
 *
 * A SEPARATE KEY FROM THE SAVE, because it is a different kind of thing.
 * `tc.progress.v1` is the record of how the campaign went and is versioned,
 * migrated and reported on; the sandbox is one free circuit that the player
 * leaves lying around. Putting it in the save would mean every progress migration
 * has to carry it, and a corrupt scratch circuit would take the stars with it.
 *
 * NOTHING HERE THROWS. `localStorage` is missing in the unit tests and can refuse
 * writes in a private window, and a sandbox that failed to load has an obvious
 * answer -- an empty board -- so the failure mode is "you start again", never a
 * broken screen. The same reasoning lets a corrupt payload read as `null` rather
 * than as an error to report: there is no migration to run on it, because there is
 * no earlier version of it.
 */
export const SANDBOX_KEY = 'tc.sandbox.v1';

interface SandboxPayload {
  readonly version: 1;
  readonly graph: Graph;
}

/** Whether a value has the shape `compile` would be asked to accept. */
function isGraph(value: unknown): value is Graph {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Graph>;
  return (
    Array.isArray(g.instances) &&
    Array.isArray(g.wires) &&
    (g.customComponents === undefined || Array.isArray(g.customComponents))
  );
}

/**
 * The sandbox circuit as it was left, or `null` for "start empty".
 *
 * The graph is returned as stored rather than repaired: `validateGraph` judges a
 * circuit and the board paints what it finds, so a half-built document is a
 * normal thing to come back to -- it is only a payload that is not a graph at all
 * that has no answer.
 */
export function loadSandbox(): Graph | null {
  try {
    const raw = globalThis.localStorage?.getItem(SANDBOX_KEY);
    if (!raw) return null;
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== 'object' || payload === null) return null;
    const { version, graph } = payload as Partial<SandboxPayload>;
    if (version !== 1 || !isGraph(graph)) return null;
    return {
      instances: graph.instances.map((inst) => ({ ...inst, params: { ...inst.params } })),
      wires: graph.wires.map((wire) => ({ ...wire, from: { ...wire.from }, to: { ...wire.to } })),
      customComponents: (graph.customComponents ?? []).map((component) => ({ ...component })),
    };
  } catch {
    return null;
  }
}

/** Best-effort save; without a store the circuit simply stays in memory. */
export function saveSandbox(graph: Graph): void {
  try {
    const payload: SandboxPayload = { version: 1, graph };
    globalThis.localStorage?.setItem(SANDBOX_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable (private mode, tests): the circuit stays in memory */
  }
}

/**
 * A cheap "has this circuit changed" signature, so the save is not per frame.
 *
 * The store notifies on every change, including each frame of a pan and every
 * keystroke of a selection, and none of those touch the circuit. Comparing a
 * string of the instances and wires against the last written one costs a walk over
 * the document and saves a `localStorage` write per frame, which is the difference
 * between a smooth pan and a stutter on a large board.
 */
export function circuitSignature(graph: Graph): string {
  const parts = graph.instances.map(
    (inst) => `${inst.id}:${inst.def}:${inst.x}:${inst.y}:${JSON.stringify(inst.params)}`,
  );
  const wires = graph.wires.map(
    (wire) => `${wire.from.inst}.${wire.from.port}>${wire.to.inst}.${wire.to.port}`,
  );
  return `${parts.join('|')}#${wires.join('|')}`;
}

/** An empty sandbox board, for a caller that has no saved circuit. */
export function emptySandbox(): Graph {
  return emptyGraph('sandbox');
}
