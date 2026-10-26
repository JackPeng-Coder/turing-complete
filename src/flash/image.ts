import type { Graph } from '../core/graph';

/**
 * The program an Arduino runs: one circuit, flattened to a table-driven image.
 *
 * THIS IS NOT A SECOND SIMULATOR. Every table in here was produced by calling
 * the component's own `evaluate`/`clockEdge` at build time (`extract.ts`), so the
 * image and the in-page `Simulation` cannot disagree about what a NAND is: there
 * is one implementation of each part, in JavaScript, and the board reads the
 * answers it was given rather than a hand-written C++ copy of it. That is the
 * whole reason the first version can support a part set without porting each
 * part to C++.
 *
 * The image is deliberately BOARD-FACING and not a `Graph`: slot numbers, table
 * offsets and node order are what the firmware indexes directly. The generator
 * (`build.ts`) is the only thing that may construct one.
 */

/** Which settle strategy the firmware must run. */
export type ImageMode = 'dag' | 'jacobi';

/** One connector of the sandbox board, as the serial protocol numbers it. */
export interface ConnectorPin {
  /** The connector instance id (`IN_1`, `OUT_1`), which is the sandbox's pin id. */
  readonly id: string;
  /** The index the protocol's `I <index>` and `F` columns use. */
  readonly index: number;
  readonly width: number;
  /**
   * The compiled output slot the connector publishes at.
   *
   * For an input pin that is the `level_input` output the sources write; for an
   * output pin it is the `level_output` mirror the copies write and the frame
   * packs. Kept here so the emitter and the host model never re-derive a base
   * from a key.
   */
  readonly base: number;
}

/**
 * `tab` computes one output pin from a truth table, `copy` moves one slot, `pub`
 * publishes a storage element's held state. External connector values are not
 * nodes: `ImageSource` names the slots `tcApplySrc` writes, because they are
 * inputs the sweep must not overwrite by reading last sweep's buffer.
 */
export type ImageNodeKind = 'tab' | 'copy' | 'pub';

/**
 * One computed slot.
 *
 * `state` is the index of the storage instance a `pub` node publishes, and `-1`
 * for the other kinds. A number rather than an optional field because the
 * emitter indexes an array with it and `exactOptionalPropertyTypes` would make
 * every construction site spell the absence differently.
 */
export interface ImageNode {
  readonly kind: ImageNodeKind;
  readonly out: number;
  /** Source slots, in truth-table index order. At most three. */
  readonly inputs: readonly number[];
  /** Index into `tables`; meaningless for `copy`. */
  readonly table: number;
  readonly state: number;
}

/** An input connector bit: connector `ext`, bit `bit`, written to slot `out`. */
export interface ImageSource {
  readonly out: number;
  readonly ext: number;
  readonly bit: number;
}

/**
 * One storage element's clock edge.
 *
 * `inputs` are the source slots of every input pin bit, and the transition table
 * is indexed `state * 2 ** inputs.length + vector`, exactly as the firmware
 * computes it. Every edge samples before any of them commits (`tcTick`), which
 * is the kernel's own rule: two memories in series shift one stage per tick.
 */
export interface ImageEdge {
  readonly state: number;
  readonly inputs: readonly number[];
  readonly table: number;
}

/** The numbers the panel shows and `buildImage` uses to refuse a board. */
export interface ImageReport {
  readonly level: string;
  /** Document instances, before custom components are expanded. */
  readonly instances: number;
  /** Compiled leaves, one entry per emitted part (connectors included). */
  readonly expanded: number;
  readonly nodes: number;
  readonly sources: number;
  readonly edges: number;
  readonly stateCount: number;
  /** Bit slots the board must hold. */
  readonly slots: number;
  readonly tables: number;
  readonly tableBytes: number;
  /** Estimated RAM: settle buffer(s), storage state and a serial/stack reserve. */
  readonly ramBytes: number;
  /** Estimated flash: node/edge arrays, tables and the runtime template. */
  readonly flashBytes: number;
  readonly mode: ImageMode;
}

/**
 * Bytes each firmware PROGMEM entry takes, written down once.
 *
 * `build.ts` estimates the sketch's flash with these numbers and `emit.ts`
 * asserts them against `sizeof` in the generated sketch, so a descriptor that
 * grows makes `arduino-cli` (or the host test) fail rather than silently
 * invalidating the estimate the panel showed the player. The structs are
 * `__attribute__((packed))` because AVR aligns `uint16_t` to one byte and a PC
 * compiler aligns it to two: without packing the same sketch would cost
 * different bytes on the two sides of the host test.
 *
 * `TcNode` is 14 bytes after its state index was widened to `uint16_t`: the byte
 * it used to occupy was padding, so a circuit with more storage than one byte
 * can index costs no extra flash per node. `TcEdge` grew by one.
 */
export const NODE_BYTES = 14;
export const EDGE_BYTES = 11;
/** `TcSrc`: a slot (`uint16_t`), a connector index (`uint16_t`) and a bit. */
export const SOURCE_BYTES = 5;
/** `TC_OUT_BASE`'s `uint16_t` plus `TC_OUT_WIDTH`'s `uint8_t`, per output. */
export const OUTPUT_BYTES = 3;

/** Everything the firmware and its host side need to agree about. */
export interface ProgramImage {
  readonly level: string;
  readonly mode: ImageMode;
  /** FNV-1a of the canonical image text; the banner carries it back. */
  readonly hash: number;
  readonly slots: number;
  readonly nodes: readonly ImageNode[];
  readonly sources: readonly ImageSource[];
  readonly edges: readonly ImageEdge[];
  /** Table bytes, indexed by `ImageNode.table` / `ImageEdge.table`. */
  readonly tables: readonly Uint8Array[];
  readonly stateCount: number;
  readonly inputs: readonly ConnectorPin[];
  readonly outputs: readonly ConnectorPin[];
  readonly report: ImageReport;
}

export type RefusalCode =
  | 'sandbox-only'
  | 'compile'
  | 'no-connectors'
  | 'unsupported'
  | 'unstable'
  | 'too-big';

/** Why a circuit cannot become firmware, in the app's two languages. */
export interface ImageRefusal {
  readonly code: RefusalCode;
  readonly zh: string;
  readonly en: string;
  /** Compiled paths (or document ids) the refusal is about; empty when global. */
  readonly instances: readonly string[];
}

export type BuildResult =
  | { readonly image: ProgramImage }
  | { readonly refusal: ImageRefusal };

/** True when a result carries firmware rather than a reason it does not. */
export function isImage(result: BuildResult): result is { readonly image: ProgramImage } {
  return 'image' in result;
}

/** A refusal as the app's status line shape, so a caller can show it directly. */
export function refusalStatus(refusal: ImageRefusal): { zh: string; en: string } {
  return { zh: refusal.zh, en: refusal.en };
}

/**
 * FNV-1a, 32 bit, over the image's canonical spelling.
 *
 * Deterministic on purpose: the panel remembers the hash of what it flashed and
 * the firmware prints the same number in its banner, so "the board is running
 * the circuit on screen" is one comparison rather than a guess. A cryptographic
 * hash would be overkill for detecting an edit in one tab.
 */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The canonical spelling the hash is taken over. */
export function imageSignature(image: {
  readonly level: string;
  readonly mode: ImageMode;
  readonly slots: number;
  readonly nodes: readonly ImageNode[];
  readonly sources: readonly ImageSource[];
  readonly edges: readonly ImageEdge[];
  readonly tables: readonly Uint8Array[];
  readonly inputs: readonly ConnectorPin[];
  readonly outputs: readonly ConnectorPin[];
}): string {
  const parts: string[] = [image.level, image.mode, String(image.slots)];
  for (const input of image.inputs) parts.push(`i:${input.id}:${input.index}:${input.width}:${input.base}`);
  for (const output of image.outputs)
    parts.push(`o:${output.id}:${output.index}:${output.width}:${output.base}`);
  for (const source of image.sources) parts.push(`s:${source.out}:${source.ext}:${source.bit}`);
  for (const node of image.nodes) {
    parts.push(`n:${node.kind}:${node.out}:${node.inputs.join('/')}:${node.table}:${node.state}`);
  }
  for (const edge of image.edges) parts.push(`e:${edge.state}:${edge.inputs.join('/')}:${edge.table}`);
  for (const table of image.tables) parts.push(`t:${Array.from(table).join(',')}`);
  return parts.join('|');
}

/** A graph this module cannot use is a refusal, not a thrown `Error`. */
export function refusal(
  code: RefusalCode,
  zh: string,
  en: string,
  instances: readonly string[] = [],
): { readonly refusal: ImageRefusal } {
  return { refusal: { code, zh, en, instances } };
}

/** The document the image came from, re-exported so callers need one import. */
export type SourceGraph = Graph;
