import { CircuitValidationError, UnstableCircuitError } from '../core/errors';
import type { Graph } from '../core/graph';
import type { Registry } from '../core/registry';
import { Simulation, compile, type Netlist } from '../core/net';
import { boardPins, isSandbox } from '../levels/sandbox';
import type { LevelSpec } from '../levels/spec';
import { DEFAULT_BOARD, boardProfile, type BoardId } from './boards';
import { ExtractionError, MAX_STATES, extractCombination, extractStorage } from './extract';
import {
  hashText,
  imageSignature,
  refusal,
  type BuildResult,
  type ConnectorPin,
  type ImageEdge,
  type ImageMode,
  type ImageNode,
  type ImageRefusal,
  type ImageSource,
} from './image';

/**
 * Building the board program from a sandbox circuit.
 *
 * THE SUPPORTED SET IS A DELIBERATE, NARROW CONTRACT. The first version knows
 * the ten one-bit gates, `full_adder`, the two one-bit memories and the two
 * connectors. A wide part (`and8`, `add8`), a decoder, a CPU part or a player's
 * component built from one of those is REFUSED with the instance named, not
 * quietly left out: a board that runs most of a circuit is worse than a board
 * that says which part it cannot run.
 *
 * WHAT MAKES A CIRCUIT RUN THE SAME ON THE BOARD AS IN THE PAGE: every table is
 * extracted from the part's own JavaScript (`extract.ts`), the slot edges come
 * straight from the compiled netlist (`inputSlot` + `drive`), and a combinational
 * dependency cycle falls back to the kernel's own Jacobi settle rule instead of
 * pretending a topological order exists.
 *
 * THE RAM BUDGET IS A REFUSAL, NOT A WARNING. An Uno has 2 KiB of SRAM, and the
 * failure mode of overrunning it is a board that resets or garbles the serial
 * link -- which is much harder to diagnose than a message in the panel. The
 * estimate is deliberately conservative, and it is checked against the board the
 * player picked (`boards.ts`): a circuit too large for an Uno may still fit a
 * Mega, and the refusal says which board refused it. The real size comes back
 * from `arduino-cli compile` after the choice, and the panel shows both.
 */

/** The one-bit gates the first version can extract tables for. */
const COMBINATIONAL = new Set([
  'const_on',
  'const_off',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'and3',
  'or3',
  'full_adder',
]);

/** The two storage parts: one state byte each, publish-from-state and sample. */
const SEQUENTIAL = new Set(['delay_line', 'mem1']);

const SUPPORTED = new Set([...COMBINATIONAL, ...SEQUENTIAL]);

/** Widest connector the line protocol can carry in one number. */
const MAX_SERIAL_BITS = 32;

/**
 * SRAM the estimate leaves for the serial buffers and the call stack, on top of
 * the circuit's own bytes. Deliberately not "almost all of the chip": the
 * firmware's own tables, `Serial`'s ring buffers and every nested call in a
 * Jacobi sweep share the board's SRAM with the slot array.
 */
const RAM_RESERVE = 400;

/** Estimated bytes per node descriptor, per edge descriptor, and the runtime. */
const NODE_BYTES = 14;
const EDGE_BYTES = 10;
const FLASH_RUNTIME = 8_192;

/**
 * A document to a board program, or the reason it is not one.
 *
 * `board` decides only the budget the estimate is checked against; the image is
 * the same bytes on every AVR, which is why the board is not part of its hash.
 * The default is the Uno the first version was built and measured around.
 *
 * The order of refusals is the order a player can act on them: wrong screen,
 * doesn't compile, no connectors, unsupported parts, never settles, doesn't fit.
 * A circuit with two defects reports the first one, which is the one to fix
 * first anyway.
 */
export function buildImage(
  graph: Graph,
  registry: Registry,
  level: LevelSpec,
  board: BoardId = DEFAULT_BOARD,
): BuildResult {
  if (!isSandbox(level)) {
    return refusal(
      'sandbox-only',
      '写入开发板只在沙盒里可用：关卡板上的引脚是题目的契约，不能改写成别的电路。',
      'Writing to a board is a sandbox feature: a level board’s pins are the puzzle’s contract.',
    );
  }

  const compiled = compileOrRefuse(graph, registry);
  if ('refusal' in compiled) return compiled;
  const net = compiled.net;

  const pins = boardPins(level, graph, registry);
  if (pins.inputs.length === 0 && pins.outputs.length === 0) {
    return refusal(
      'no-connectors',
      '沙盒里还没有连接器：放一个「关卡输入」和「关卡输出」再烧录，否则板上没有可接的引脚。',
      'The sandbox has no connectors yet: place a Level Input and a Level Output so the board has pins.',
    );
  }

  const nodes: ImageNode[] = [];
  const sources: ImageSource[] = [];
  const edges: ImageEdge[] = [];
  const tables: Uint8Array[] = [];
  const tableIndex = new Map<string, number>();
  const addTable = (bytes: Uint8Array): number => {
    const key = Array.from(bytes).join(',');
    const existing = tableIndex.get(key);
    if (existing !== undefined) return existing;
    const index = tables.length;
    tables.push(bytes);
    tableIndex.set(key, index);
    return index;
  };

  const inputs: ConnectorPin[] = [];
  for (const [index, pin] of pins.inputs.entries()) {
    const key = `${pin.id}.out`;
    const base = net.outputBase(key);
    const width = net.outputWidth(key);
    if (width > MAX_SERIAL_BITS) {
      return refusal(
        'too-big',
        `输入连接器 ${pin.id} 是 ${width} 位；串口协议最多传 32 位。`,
        `Input connector ${pin.id} is ${width} bits wide; the serial protocol carries at most 32.`,
        [pin.id],
      );
    }
    for (let bit = 0; bit < width; bit += 1) sources.push({ out: base + bit, ext: index, bit });
    inputs.push({ id: pin.id, index, width, base });
  }

  const outputs: ConnectorPin[] = [];
  for (const [index, pin] of pins.outputs.entries()) {
    const key = `${pin.id}.mirror`;
    const base = net.outputBase(key);
    const width = net.outputWidth(key);
    if (width > MAX_SERIAL_BITS) {
      return refusal(
        'too-big',
        `输出连接器 ${pin.id} 是 ${width} 位；串口协议最多传 32 位。`,
        `Output connector ${pin.id} is ${width} bits wide; the serial protocol carries at most 32.`,
        [pin.id],
      );
    }
    outputs.push({ id: pin.id, index, width, base });
  }

  const paths = net.instanceIds();
  const defIds = net.instanceDefs();
  const unsupported: string[] = [];
  let stateCount = 0;

  for (let at = 0; at < paths.length; at += 1) {
    const path = paths[at]!;
    const defId = defIds[at]!;
    const def = registry.get(defId);
    const origin = net.refs.get(path) ?? path;
    const label = origin === path ? `${path} (${defId})` : `${origin} → ${path} (${defId})`;

    // A level input is driven from outside: its slot is a `ImageSource`, not a
    // node. A nested one is never driven (the checker only writes a top-level
    // pin), so skipping it is exactly what the page does.
    if (defId === 'level_input') continue;

    // A level output is a mirror: every bit is a copy of the slot its `in` bit
    // reads. Doing this for EVERY compiled connector, not only the board's own
    // pins, is what keeps the `mirror` output correct when a player wires it
    // somewhere else as well.
    if (defId === 'level_output') {
      const inputPin = def.inputs[0];
      if (inputPin === undefined) {
        unsupported.push(label);
        continue;
      }
      let inBase: number;
      try {
        inBase = net.inputSlot(`${path}.${inputPin.id}`);
      } catch {
        unsupported.push(label);
        continue;
      }
      for (const outPin of def.outputs) {
        const outBase = net.outputBase(`${path}.${outPin.id}`);
        const width = net.outputWidth(`${path}.${outPin.id}`);
        if (width > MAX_SERIAL_BITS) {
          unsupported.push(`${label} — ${width} bits`);
          continue;
        }
        for (let bit = 0; bit < width; bit += 1) {
          nodes.push({
            kind: 'copy',
            out: outBase + bit,
            inputs: [net.drive[inBase + bit]!],
            table: -1,
            state: -1,
          });
        }
      }
      continue;
    }

    if (!SUPPORTED.has(defId)) {
      unsupported.push(label);
      continue;
    }

    const inWidths = def.inputs.map((pin) => net.inputWidth(`${path}.${pin.id}`));
    const outWidths = def.outputs.map((pin) => net.outputWidth(`${path}.${pin.id}`));
    if (inWidths.some((width) => width !== 1) || outWidths.some((width) => width !== 1)) {
      unsupported.push(`${label} — the first version only takes one-bit pins`);
      continue;
    }

    const slots: number[] = [];
    for (let pinAt = 0; pinAt < def.inputs.length; pinAt += 1) {
      const pin = def.inputs[pinAt]!;
      const base = net.inputSlot(`${path}.${pin.id}`);
      for (let bit = 0; bit < inWidths[pinAt]!; bit += 1) {
        slots.push(net.drive[base + bit]!);
      }
    }

    try {
      if (SEQUENTIAL.has(defId)) {
        const extracted = extractStorage(
          def,
          inWidths,
          def.outputs.map((pin) => pin.id),
        );
        if (extracted.stateCount > MAX_STATES) {
          unsupported.push(`${label} — ${extracted.stateCount} states`);
          continue;
        }
        const state = stateCount;
        stateCount += 1;
        for (let pinAt = 0; pinAt < def.outputs.length; pinAt += 1) {
          const outPin = def.outputs[pinAt]!;
          nodes.push({
            kind: 'pub',
            out: net.outputBase(`${path}.${outPin.id}`),
            inputs: [],
            table: addTable(extracted.publish[pinAt]!),
            state,
          });
        }
        edges.push({ state, inputs: slots, table: addTable(extracted.transitions) });
      } else {
        const extracted = extractCombination(
          def,
          inWidths,
          def.outputs.map((pin) => pin.id),
        );
        for (let pinAt = 0; pinAt < def.outputs.length; pinAt += 1) {
          const outPin = def.outputs[pinAt]!;
          nodes.push({
            kind: 'tab',
            out: net.outputBase(`${path}.${outPin.id}`),
            inputs: slots,
            table: addTable(extracted.tables[pinAt]!),
            state: -1,
          });
        }
      }
    } catch (error) {
      if (error instanceof ExtractionError) {
        unsupported.push(`${label} — ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  if (unsupported.length > 0) {
    const shown = unsupported.slice(0, 10);
    const more = unsupported.length > shown.length ? ` 等 ${unsupported.length} 个` : '';
    return refusal(
      'unsupported',
      `这些元件还不能写到开发板：${shown.join('、')}${more}。第一版只支持 1 位门、延迟线、1 位存储和连接器；宽位/CPU 元件请先不要放进这块电路。`,
      `These parts cannot be written to the board yet: ${shown.join(', ')}${more}. The first version supports one-bit gates, the delay line, one-bit memory and the connectors.`,
      unsupported,
    );
  }

  // THE KERNEL'S OWN VERDICT, before the board's. A circuit the page cannot
  // settle has no fixed point for the firmware to reproduce, and letting an
  // oscillator onto the board would look like a firmware bug.
  try {
    new Simulation(net, registry).settle();
  } catch (error) {
    if (error instanceof UnstableCircuitError) {
      return refusal(
        'unstable',
        '电路在输入为 0 时不收敛（组合反馈环），板上无法给出可重复的结果。先让它在页面里稳定下来。',
        'The circuit does not settle with zero inputs (a combinational feedback loop); the board could not reproduce it.',
        error.blame,
      );
    }
    throw error;
  }

  const ordered = orderNodes(nodes);
  const slots = net.slotCount;
  if (slots > 65_535) {
    return refusal(
      'too-big',
      `电路有 ${slots} 个信号槽，超过固件能寻址的 65535 个。`,
      `The circuit has ${slots} signal slots; the firmware addresses at most 65535.`,
    );
  }

  const slotBytes = Math.ceil(slots / 8);
  const buffered = ordered.mode === 'dag' ? slotBytes : slotBytes * 2;
  const ramBytes = buffered + stateCount + RAM_RESERVE;
  const tableBytes = tables.reduce((sum, table) => sum + table.length, 0);
  const flashBytes =
    ordered.nodes.length * NODE_BYTES + edges.length * EDGE_BYTES + tableBytes + FLASH_RUNTIME;

  const limits = boardProfile(board);
  if (ramBytes > limits.maxRam || flashBytes > limits.maxFlash) {
    // The way out depends on the board: a Mega is the answer for a circuit too
    // big for an Uno, and there is nothing bigger to offer once the player is
    // already on one.
    const hint =
      board === 'arduino:avr:mega'
        ? ''
        : '减少存储元件、缩小连接器位宽，或换 Mega（256 KB flash / 8 KB RAM）。';
    const hintEn =
      board === 'arduino:avr:mega'
        ? ''
        : ' Reduce memory parts or connector widths, or use a Mega (256 KB flash / 8 KB RAM).';
    return refusal(
      'too-big',
      `这块 ${limits.name} 放不下：RAM 估计 ${ramBytes} B（上限 ${limits.maxRam}），flash 估计 ${flashBytes} B（上限 ${limits.maxFlash}）。${hint}`,
      `This ${limits.name} is too small: estimated ${ramBytes} B RAM (limit ${limits.maxRam}) and ${flashBytes} B flash (limit ${limits.maxFlash}).${hintEn}`,
    );
  }

  const built = {
    level: level.id,
    mode: ordered.mode,
    slots,
    nodes: ordered.nodes,
    sources,
    edges,
    tables,
    inputs,
    outputs,
  } as const;
  const report = {
    level: level.id,
    instances: graph.instances.length,
    expanded: net.instanceCount,
    nodes: ordered.nodes.length,
    sources: sources.length,
    edges: edges.length,
    stateCount,
    slots,
    tables: tables.length,
    tableBytes,
    ramBytes,
    flashBytes,
    mode: ordered.mode,
  } as const;

  return { image: { ...built, hash: hashText(imageSignature(built)), stateCount, report } };
}

/**
 * `compile`, with the kernel's validation refusal turned into a value.
 *
 * The guard exists only because `compile` throws and this builder's contract is
 * a discriminated result; a non-validation throw is a defect in the kernel or in
 * this file and is re-thrown rather than dressed up as the player's fault.
 */
function compileOrRefuse(
  graph: Graph,
  registry: Registry,
): { readonly net: Netlist } | { readonly refusal: ImageRefusal } {
  try {
    return { net: compile(graph, registry) };
  } catch (error) {
    if (error instanceof CircuitValidationError) {
      return refusal(
        'compile',
        `电路无法编译：${error.issues.map((issue) => issue.message.zh).join('；')}`,
        `The circuit does not compile: ${error.issues.map((issue) => issue.message.en).join('; ')}`,
        [...new Set(error.issues.map((issue) => issue.inst ?? '').filter((id) => id !== ''))],
      );
    }
    throw error;
  }
}

/**
 * Nodes in a settle order, or `jacobi` when no such order exists.
 *
 * A combinational cycle is not an error here: the kernel settles one with Jacobi
 * sweeps, and the board must do the same rather than refuse a NAND latch. The
 * order is a permutation of the node list when it succeeds; when it does not,
 * the list is left in emission order and the firmware runs the double-buffered
 * loop, which is order-independent by construction.
 */
function orderNodes(nodes: readonly ImageNode[]): {
  readonly nodes: readonly ImageNode[];
  readonly mode: ImageMode;
} {
  const producer = new Map<number, number>();
  for (let index = 0; index < nodes.length; index += 1) {
    producer.set(nodes[index]!.out, index);
  }
  const dependents: number[][] = nodes.map(() => []);
  const indegree: number[] = nodes.map(() => 0);
  for (let index = 0; index < nodes.length; index += 1) {
    const seen = new Set<number>();
    for (const slot of nodes[index]!.inputs) {
      const from = producer.get(slot);
      if (from === undefined || seen.has(from)) continue;
      seen.add(from);
      dependents[from]!.push(index);
      indegree[index]! += 1;
    }
  }
  const queue: number[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  const ordered: number[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    ordered.push(index);
    for (const next of dependents[index]!) {
      indegree[next]! -= 1;
      if (indegree[next] === 0) queue.push(next);
    }
  }
  if (ordered.length < nodes.length) return { nodes, mode: 'jacobi' };
  return { nodes: ordered.map((index) => nodes[index]!), mode: 'dag' };
}
