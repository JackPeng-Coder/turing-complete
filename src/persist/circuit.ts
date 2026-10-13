import type { Graph, Instance, Wire } from '../core/graph';
import {
  libraryFrom,
  mergeLibrary,
  repointComponents,
  type BlueprintLibrary,
} from '../levels/blueprints';

/**
 * The circuit file: what "export" writes and "import" reads.
 *
 * THE FORMAT IS THE SPEC'S (`docs/superpowers/specs/2026-09-25-turing-complete-replica-design.md`
 * §8.1, `tc-circuit`): a document with a `format`, a `version`, the instances, the
 * wires and the components it uses. It is deliberately the same shape as a
 * `Graph` plus a header, so exporting is not a translation that can lose
 * something and importing is not a parser that has to guess.
 *
 * COMPONENTS TRAVEL INLINE. A file is how a circuit leaves the machine it was
 * built on, and a player's component is part of the circuit -- a file that
 * referenced `bp1` and hoped the reader had one would be a file that half the time
 * does not open. `Progress.blueprints` is the durable library and this is the
 * carrier; importing merges what the file brought into the library.
 *
 * NOTHING PARTIALLY LOADS. Every failure -- wrong format, unknown version, a
 * field of the wrong type -- returns a message instead of a circuit, because the
 * one outcome worth ruling out is a bad file silently replacing the board.
 */
export const CIRCUIT_FORMAT = 'tc-circuit';
export const CIRCUIT_VERSION = 1;

/** The file, as an object. `JSON.stringify` this to write one. */
export interface CircuitFile {
  readonly format: typeof CIRCUIT_FORMAT;
  readonly version: typeof CIRCUIT_VERSION;
  readonly level: string;
  readonly instances: readonly Instance[];
  readonly wires: readonly Wire[];
  /** The components the circuit uses, in dependency order. */
  readonly blueprints: readonly Graph[] | readonly unknown[];
}

/** What a file says: a circuit, and the components it brought with it. */
export interface ParsedCircuit {
  readonly graph: Graph;
  readonly blueprints: BlueprintLibrary;
}

/**
 * A file that could not be read, as a value at a key.
 *
 * A DISCRIMINATED ARM, not a bare message. The reader returns one of two shapes,
 * and 'error' in parsed is how a caller tells them apart -- an arm without a
 * property of its own would be indistinguishable from a successful read of a
 * circuit that happens to have a zh field, and the type would not narrow.
 */
export interface CircuitRefusal {
  readonly error: { readonly zh: string; readonly en: string };
}

/**
 * A document as a file.
 *
 * `blueprints` is the CLOSURE the caller computed (`libraryClosure`): the
 * components the instances name, plus whatever those components instance. The
 * graph's own `customComponents` is not consulted -- the library is where a
 * component lives, so that is what travels.
 */
export function serializeCircuit(graph: Graph, components: readonly unknown[]): string {
  const file = {
    format: CIRCUIT_FORMAT,
    version: CIRCUIT_VERSION,
    level: graph.level ?? 'sandbox',
    instances: graph.instances,
    wires: graph.wires,
    blueprints: components,
  };
  // Pretty-printed: an exported circuit is a text file a player may well open, and
  // a diffable one is worth the bytes.
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * A file as a document, or the reason it is not one.
 *
 * `existing` IS THE READER'S OWN LIBRARY, and it is what makes an import safe: the
 * components the file brings are merged into it with the clashing ids renamed
 * (`mergeLibrary`), and the circuit is repointed at the names it ended up with.
 * Leaving it out reads the file against an empty library, which is what a test
 * wants and what a caller with nothing to lose gets.
 *
 * The graph is returned WITH the components it needs (`customComponents`), so a
 * caller can hand it to `compile` through a registry composed from the returned
 * library and get the same circuit the writer had.
 */
export function parseCircuit(
  text: string,
  existing: BlueprintLibrary = {},
): ParsedCircuit | CircuitRefusal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      error: {
        zh: '这不是一个电路文件：内容不是 JSON。',
        en: 'This is not a circuit file: its contents are not JSON.',
      },
    };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { error: { zh: '这不是一个电路文件。', en: 'This is not a circuit file.' } };
  }
  const file = raw as Partial<{
    format: unknown;
    version: unknown;
    level: unknown;
    instances: unknown;
    wires: unknown;
    blueprints: unknown;
  }>;
  if (file.format !== CIRCUIT_FORMAT) {
    return {
      error: {
        zh: `这不是本作的电路文件（format 是 ${JSON.stringify(file.format)}，应为 ${CIRCUIT_FORMAT}）。`,
        en: `This is not one of this project's circuit files (format is ${JSON.stringify(file.format)}, expected ${CIRCUIT_FORMAT}).`,
      },
    };
  }
  if (file.version !== CIRCUIT_VERSION) {
    return {
      error: {
        zh: `电路文件版本 ${String(file.version)} 无法读取（本作支持 ${CIRCUIT_VERSION}）。`,
        en: `Circuit file version ${String(file.version)} cannot be read (this build writes ${CIRCUIT_VERSION}).`,
      },
    };
  }
  if (!Array.isArray(file.instances) || !Array.isArray(file.wires)) {
    return {
      error: {
        zh: '电路文件缺少元件或导线列表。',
        en: 'The circuit file has no instance or wire list.',
      },
    };
  }

  const incoming = libraryFrom(Array.isArray(file.blueprints) ? file.blueprints : []);
  const { library, renamed } = mergeLibrary(existing, incoming);
  const base: Graph = {
    instances: cloneInstances(file.instances),
    wires: cloneWires(file.wires),
    // Inline, so the document stands on its own even before the library merge:
    // `compile` reads the definition from either place (`core/net.ts`).
    customComponents: Object.values(incoming).map((entry) => entry.def),
  };
  if (typeof file.level === 'string' && file.level !== '') base.level = file.level;
  return { graph: repointComponents(base, renamed), blueprints: library };
}

/** Typechecks the instance list rather than trusting the file's word for it. */
function cloneInstances(raw: readonly unknown[]): Instance[] {
  const out: Instance[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const inst = entry as Partial<Instance>;
    if (typeof inst.id !== 'string' || typeof inst.def !== 'string') continue;
    out.push({
      id: inst.id,
      def: inst.def,
      x: typeof inst.x === 'number' ? inst.x : 0,
      y: typeof inst.y === 'number' ? inst.y : 0,
      rot: (inst.rot ?? 0) as Instance['rot'],
      params: typeof inst.params === 'object' && inst.params !== null ? { ...inst.params } : {},
    });
  }
  return out;
}

/** The same, for the wires. A wire with a nameless end is dropped. */
function cloneWires(raw: readonly unknown[]): Wire[] {
  const out: Wire[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const wire = entry as Partial<Wire>;
    if (typeof wire.id !== 'string') continue;
    const from = wire.from;
    const to = wire.to;
    if (typeof from?.inst !== 'string' || typeof from?.port !== 'string') continue;
    if (typeof to?.inst !== 'string' || typeof to?.port !== 'string') continue;
    out.push({
      id: wire.id,
      from: { inst: from.inst, port: from.port },
      to: { inst: to.inst, port: to.port },
    });
  }
  return out;
}
