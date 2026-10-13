import { createRegistry, type ComponentDef, type PinDef, type Registry } from '../core/registry';
import type { CustomComponentDef, Graph, WireEnd } from '../core/graph';

/**
 * The player's own components, as the app holds them.
 *
 * A MAP RATHER THAN A GRAPH FIELD. `Graph.customComponents` is where a component
 * lives inside a DOCUMENT (a circuit file carries the components it needs); the
 * library is where the player's parts live between documents, and the two are
 * related by id, not by copy. `Persist.circuit` writes a file with the entries it
 * uses inline; `Progress.blueprints` is the durable record, and a circuit
 * references an entry rather than embedding it.
 *
 * Keyed by component id, which is also the `def` an instance carries, so an entry
 * whose key and `def.id` disagree is a malformed library: `blueprintDef` reads
 * the def, and `libraryDefs` would otherwise register a part under two names.
 */
export type BlueprintLibrary = Readonly<
  Record<string, { readonly name: { zh: string; en: string }; readonly def: CustomComponentDef }>
>;

/**
 * Turn one library entry into a `ComponentDef` the kernel can compile.
 *
 * The def carries the BODY and nothing else: no `evaluate`, no `stateBytes`, and
 * `cost`/`gateCost` of 0. That is not a placeholder -- `compile` expands a body
 * into its leaves and allocates storage per leaf, so the component itself is
 * never instantiated, and charging it a cost would charge the same gates twice
 * (once on the component and once on the gates inside it). See `ComponentDef.body`
 * and `flattenDocument`.
 *
 * The NAME comes from the library entry rather than from `def.name` because the
 * entry is what a rename edits; keeping the two in step is the library's job, and
 * `applyGrade` (which shares the library by reference) never rewrites either.
 */
export function blueprintDef(component: CustomComponentDef): ComponentDef {
  return {
    id: component.id,
    name: { ...component.name },
    category: 'custom',
    inputs: component.inputs.map((pin) => ({ ...pin })),
    outputs: component.outputs.map((pin) => ({ ...pin })),
    cost: 0,
    gateCost: 0,
    sequential: false,
    stateBytes: 0,
    body: component,
  };
}

/** Every registered part, in insertion order: the base catalog's first. */
function registryAll(registry: Registry): readonly ComponentDef[] {
  return registry.all();
}

/**
 * The registry a DOCUMENT compiles against: the base catalog plus the player's
 * components.
 *
 * BUILT PER DOCUMENT, NEVER MERGED INTO THE BASE. The base registry is the
 * application's singleton and answers "what parts does the game ship"; a
 * component is player data that changes under the editor's hands, and registering
 * one into the singleton would make the catalog depend on which library happened
 * to be loaded -- the same circuit would then compile differently in two screens.
 * Composing is a walk over a few hundred defs, and nothing in the hot path
 * (`settle`, `tick`) looks a def up by id, so the cost is paid once per compile
 * and is not worth a cache that could go stale.
 *
 * A component whose id collides with a real def is SKIPPED: the catalog wins, and
 * a library entry can never shadow `nand`.
 */
export function composeRegistry(base: Registry, library: BlueprintLibrary): Registry {
  const composed = createRegistry(registryAll(base));
  for (const entry of Object.values(library)) {
    if (composed.has(entry.def.id)) continue;
    composed.register(blueprintDef(entry.def));
  }
  return composed;
}

/**
 * The ids of every component the player owns, in library order.
 *
 * For the palette: the sandbox offers them after the base parts, and because the
 * `custom` category sorts last in `ui/palette.ts` they land under their own
 * heading without the palette having to know they are different.
 */
export function libraryIds(library: BlueprintLibrary): string[] {
  return Object.values(library).map((entry) => entry.def.id);
}

/** The next free component id, so a new component never overwrites an old one. */
export function nextBlueprintId(library: BlueprintLibrary): string {
  let max = 0;
  for (const id of Object.keys(library)) {
    const match = /^bp(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `bp${max + 1}`;
}

/**
 * The library entries a document needs, in dependency order (components before
 * the components that use them).
 *
 * Used by the circuit exporter: a file has to carry the components its instances
 * name, and a component that instances another one needs that one too. The walk
 * is depth-first with a `visiting` set, so a cycle (which `validateGraph` refuses
 * in a document, but which a hand-edited save could still contain) terminates and
 * simply contributes each entry once.
 */
export function libraryClosure(
  library: BlueprintLibrary,
  roots: readonly string[],
): CustomComponentDef[] {
  const out: CustomComponentDef[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return;
    const entry = library[id];
    if (!entry) return;
    visiting.add(id);
    for (const inst of entry.def.body.instances) visit(inst.def);
    visiting.delete(id);
    done.add(id);
    out.push(entry.def);
  };

  for (const id of roots) visit(id);
  return out;
}

/** Every component id a graph's instances name, at any depth. */
export function referencedComponents(graph: Graph): string[] {
  const ids = new Set<string>();
  const walk = (g: Graph): void => {
    for (const inst of g.instances) ids.add(inst.def);
    for (const component of g.customComponents) walk(component.body);
  };
  walk(graph);
  return [...ids];
}

/**
 * Reads a component out of untrusted data, or `null` if it is not one.
 *
 * THE ONE READER FOR PLAYER-BUILT PARTS. A library entry arrives from three
 * directions that are all untrusted: `localStorage`, an imported circuit file,
 * and a hand-edited save. Each of them is plain JSON, and the app must survive a
 * payload where `inputs` is a string or `binds` is missing -- the failure mode
 * otherwise is a `TypeError` thrown out of a render, which takes the board down
 * rather than dropping one bad part.
 *
 * A MISSING `binds` READS AS EMPTY rather than as invalid: a component with no
 * declared pins is degenerate but well-formed (its body simply cannot be reached
 * from outside), and reporting it as corrupt would make an older file -- written
 * before bindings existed -- unreadable instead of merely pinless.
 */
export function normalizeComponent(raw: unknown): CustomComponentDef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<CustomComponentDef>;
  if (typeof candidate.id !== 'string' || candidate.id === '') return null;
  if (!Array.isArray(candidate.inputs) || !Array.isArray(candidate.outputs)) return null;
  if (!isGraphLike(candidate.body)) return null;
  const pins = (list: readonly PinDef[]): PinDef[] =>
    list
      .filter((pin) => typeof pin?.id === 'string' && typeof pin?.width === 'number')
      .map((pin) => ({ ...pin }));
  const inputs = pins(candidate.inputs);
  const outputs = pins(candidate.outputs);
  const name = candidate.name;
  return {
    id: candidate.id,
    name:
      typeof name?.zh === 'string' && typeof name?.en === 'string'
        ? { zh: name.zh, en: name.en }
        : { zh: candidate.id, en: candidate.id },
    inputs,
    outputs,
    binds: {
      inputs: normalizeBinds(candidate.binds?.inputs),
      outputs: normalizeBinds(candidate.binds?.outputs),
    },
    body: candidate.body as Graph,
  };
}

/** Enough of a `Graph` to walk; the rest is validated against the registry. */
function isGraphLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Graph>;
  return Array.isArray(g.instances) && Array.isArray(g.wires);
}

/** One side of a binding table, keeping only entries that name an endpoint. */
function normalizeBinds(raw: unknown): Record<string, WireEnd> {
  const out: Record<string, WireEnd> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [pin, end] of Object.entries(raw as Record<string, unknown>)) {
    const candidate = end as Partial<WireEnd> | null;
    if (typeof candidate?.inst !== 'string' || typeof candidate?.port !== 'string') continue;
    out[pin] = { inst: candidate.inst, port: candidate.port };
  }
  return out;
}

/**
 * A whole library out of an array of components, keyed by id.
 *
 * BOTH SHAPES READ THROUGH HERE: `Progress.blueprints` keeps a map, and a circuit
 * file carries an array (`customComponents`, the shape spec 8.1 names), and an
 * entry that disagrees with its key is repaired rather than dropped -- the def is
 * the part, and the key is only how it is found.
 */
export function libraryFrom(entries: readonly unknown[]): BlueprintLibrary {
  const library: Record<string, { name: { zh: string; en: string }; def: CustomComponentDef }> = {};
  for (const raw of entries) {
    const def = normalizeComponent(raw);
    if (!def) continue;
    library[def.id] = { name: { ...def.name }, def };
  }
  return library;
}

/** A library out of a keyed record, for the same reasons `libraryFrom` exists. */
export function libraryFromRecord(raw: unknown): BlueprintLibrary {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries: unknown[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const holder = value as { def?: unknown } | null;
    entries.push(holder && typeof holder === 'object' && 'def' in holder ? holder.def : value);
  }
  return libraryFrom(entries);
}
