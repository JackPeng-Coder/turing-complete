import type { PinDef, Registry } from './registry';

/**
 * The editable circuit document.
 *
 * A `Graph` is what the canvas mutates and what gets written to disk. It is a
 * *document*, not a netlist: it may be half-built, may reference components the
 * player has not unlocked, and may contain feedback the simulator cannot settle.
 * Everything in here is therefore checked by `validateGraph` (which reports, and
 * never throws) rather than assumed correct.
 */

export interface Instance {
  readonly id: string;
  /** Component def id, resolved through a `Registry`. */
  readonly def: string;
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
  /** Per-instance tuning knobs (bit widths and the like); empty for base gates. */
  readonly params: Record<string, number>;
}

/** One end of a wire: an instance id plus a pin id on that instance. */
export interface WireEnd {
  readonly inst: string;
  readonly port: string;
}

/** Signal flows `from` an output pin `to` an input pin. */
export interface Wire {
  readonly id: string;
  readonly from: WireEnd;
  readonly to: WireEnd;
}

/** A player-built component: a named body graph with a declared pin surface. */
export interface CustomComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  readonly body: Graph;
}

export interface Graph {
  /** Level id this circuit is an attempt at; absent for scratch circuits. */
  level?: string;
  instances: Instance[];
  wires: Wire[];
  customComponents: CustomComponentDef[];
}

export type IssueCode =
  | 'unknown-def'
  | 'unknown-instance'
  | 'unknown-port'
  | 'multiple-drivers'
  | 'invalid-params'
  | 'dangling-input'
  | 'feedback-loop';

/**
 * A defect found in a graph.
 *
 * `error` means the circuit is meaningless and the simulator would either crash
 * or compute nonsense, so `compile` refuses it. `warning` means the player is
 * probably still working: an unwired input reads 0, and a feedback loop is legal
 * as long as a storage element makes it settle -- only the simulator can tell.
 */
export interface GraphIssue {
  readonly severity: 'error' | 'warning';
  readonly code: IssueCode;
  readonly message: { zh: string; en: string };
  readonly inst?: string;
  readonly port?: string;
}

export function emptyGraph(level?: string): Graph {
  const g: Graph = { instances: [], wires: [], customComponents: [] };
  if (level !== undefined) g.level = level;
  return g;
}

/**
 * Next free `<prefix><n>` id: the highest numeric suffix already in use plus one.
 * Deleting `i2` from `[i1, i2, i3]` therefore reuses `i2` later, which is fine --
 * ids only have to be unique among the items that exist at one moment.
 */
export function nextId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  for (const item of existing) {
    const m = /^(\d+)$/.exec(item.id.slice(prefix.length));
    if (item.id.startsWith(prefix) && m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function addInstance(g: Graph, def: string, x: number, y: number, id?: string): Instance {
  const inst: Instance = {
    id: id ?? nextId('i', g.instances),
    def,
    x,
    y,
    rot: 0,
    params: {},
  };
  g.instances.push(inst);
  return inst;
}

/** Removing a component removes every wire touching it, in either direction. */
export function removeInstance(g: Graph, id: string): void {
  g.instances = g.instances.filter((i) => i.id !== id);
  g.wires = g.wires.filter((w) => w.from.inst !== id && w.to.inst !== id);
}

/**
 * Adds a wire without checking its endpoints: the caller may be mid-edit, and
 * `validateGraph` is the single place that judges the result.
 */
export function connect(g: Graph, from: WireEnd, to: WireEnd, id?: string): Wire {
  const wire: Wire = { id: id ?? nextId('w', g.wires), from, to };
  g.wires.push(wire);
  return wire;
}

export function disconnect(g: Graph, wireId: string): void {
  g.wires = g.wires.filter((w) => w.id !== wireId);
}

/**
 * Deep copy, for editor undo snapshots. Every nested object is rebuilt --
 * instances, both wire ends, and the bodies of custom components, recursively --
 * so mutating the copy can never write through into the live graph.
 */
export function cloneGraph(g: Graph): Graph {
  const copy: Graph = {
    instances: g.instances.map((i) => ({ ...i, params: { ...i.params } })),
    wires: g.wires.map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
    customComponents: g.customComponents.map((c) => ({
      id: c.id,
      name: { ...c.name },
      inputs: c.inputs.map((p) => ({ ...p })),
      outputs: c.outputs.map((p) => ({ ...p })),
      body: cloneGraph(c.body),
    })),
  };
  if (g.level !== undefined) copy.level = g.level;
  return copy;
}

function pinIds(pins: readonly PinDef[]): Set<string> {
  return new Set(pins.map((p) => p.id));
}

/**
 * Reports every structural defect in `g`, in a fixed order: unknown defs, then
 * malformed instance parameters, then bad wire endpoints, then multi-driven
 * inputs, then the graph-wide feedback scan, then unwired inputs.
 *
 * Never throws and never mutates: an unknown def is reported as an issue rather
 * than allowed to reach `registry.get`, which throws, and a malformed
 * `params.width` likewise rather than allowed to reach the signal table's
 * `alloc`, which throws.
 */
export function validateGraph(g: Graph, registry: Registry): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Instance>();
  for (const inst of g.instances) byId.set(inst.id, inst);

  /**
   * How many wires leave each output pin. Nothing reads it yet -- multi-driving
   * is caught from the input side (`drivenInputs` below) -- but it records the
   * one legal direction of fan-out explicitly, so a future fan-out limit has the
   * bookkeeping already in place.
   */
  const driverCount = new Map<string, number>();

  const defOf = (inst: Instance) => {
    if (registry.has(inst.def)) return registry.get(inst.def);
    issues.push({
      severity: 'error',
      code: 'unknown-def',
      inst: inst.id,
      message: { zh: `未知元件类型：${inst.def}`, en: `Unknown component type: ${inst.def}` },
    });
    return null;
  };

  const defs = new Map<string, ReturnType<Registry['get']> | null>();
  for (const inst of g.instances) defs.set(inst.id, defOf(inst));

  // A per-instance width override is resolved by `compile` and feeds straight
  // into slot allocation, so a value `alloc` cannot take has to be reported here
  // for the same reason an unknown def is: allowed through, it would reach
  // `table.alloc` and raise a bare `RangeError` out of the grading path instead
  // of surfacing as a `CircuitValidationError` the caller already handles.
  // Nothing else in `params` is read by the kernel yet, so nothing else is
  // judged here.
  for (const inst of g.instances) {
    const width = inst.params.width;
    if (width === undefined || (Number.isSafeInteger(width) && width > 0)) continue;
    issues.push({
      severity: 'error',
      code: 'invalid-params',
      inst: inst.id,
      message: {
        zh: `元件 ${inst.id} 的参数 width 无效：${String(width)}（必须是正整数）`,
        en: `Instance ${inst.id} has an invalid width parameter: ${String(width)} (must be a positive integer)`,
      },
    });
  }

  const drivenInputs = new Map<string, string[]>();
  for (const wire of g.wires) {
    const fromInst = byId.get(wire.from.inst);
    const toInst = byId.get(wire.to.inst);
    if (!fromInst || !toInst) {
      issues.push({
        severity: 'error',
        code: 'unknown-instance',
        message: {
          zh: `导线 ${wire.id} 指向不存在的元件`,
          en: `Wire ${wire.id} points at a missing instance`,
        },
      });
      continue;
    }
    const fromDef = defs.get(fromInst.id);
    const toDef = defs.get(toInst.id);
    if (fromDef && !pinIds(fromDef.outputs).has(wire.from.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: fromInst.id,
        port: wire.from.port,
        message: {
          zh: `${fromDef.name.zh} 没有输出引脚 ${wire.from.port}`,
          en: `${fromDef.name.en} has no output pin ${wire.from.port}`,
        },
      });
      continue;
    }
    if (toDef && !pinIds(toDef.inputs).has(wire.to.port)) {
      issues.push({
        severity: 'error',
        code: 'unknown-port',
        inst: toInst.id,
        port: wire.to.port,
        message: {
          zh: `${toDef.name.zh} 没有输入引脚 ${wire.to.port}`,
          en: `${toDef.name.en} has no input pin ${wire.to.port}`,
        },
      });
      continue;
    }
    const key = `${toInst.id}.${wire.to.port}`;
    const list = drivenInputs.get(key) ?? [];
    list.push(wire.id);
    drivenInputs.set(key, list);
    const outKey = `${fromInst.id}.${wire.from.port}`;
    driverCount.set(outKey, (driverCount.get(outKey) ?? 0) + 1);
  }

  for (const [key, wires] of drivenInputs) {
    if (wires.length > 1) {
      const [instId, port] = key.split('.') as [string, string];
      issues.push({
        severity: 'error',
        code: 'multiple-drivers',
        inst: instId,
        port,
        message: {
          zh: `输入引脚 ${port} 被 ${wires.length} 根导线同时驱动`,
          en: `Input pin ${port} is driven by ${wires.length} wires`,
        },
      });
    }
  }

  // dangling inputs + feedback loops (iterative DFS over instance graph)
  const adjacency = new Map<string, string[]>();
  for (const inst of g.instances) adjacency.set(inst.id, []);
  for (const wire of g.wires) {
    if (byId.has(wire.from.inst) && byId.has(wire.to.inst)) {
      adjacency.get(wire.from.inst)!.push(wire.to.inst);
    }
  }
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const inst of g.instances) color.set(inst.id, WHITE);
  // Nodes found on a back edge. Only emptiness is used today (one aggregated
  // warning, per the plan); the ids are kept so the editor can highlight the loop
  // later without re-running the scan.
  const loopNodes = new Set<string>();
  // Explicit stack, not recursion: a deep circuit must not blow the JS stack.
  for (const root of g.instances) {
    if (color.get(root.id) !== WHITE) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    color.set(root.id, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.id)!;
      if (frame.next < neighbours.length) {
        const nb = neighbours[frame.next]!;
        frame.next += 1;
        const c = color.get(nb);
        if (c === WHITE) {
          color.set(nb, GREY);
          stack.push({ id: nb, next: 0 });
        } else if (c === GREY) {
          loopNodes.add(nb);
          loopNodes.add(frame.id);
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }
  if (loopNodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'feedback-loop',
      message: {
        zh: '电路中存在反馈回路；若其中没有存储元件，仿真将无法稳定',
        en: 'The circuit has a feedback loop; without a storage element in it the simulation cannot settle',
      },
    });
  }

  for (const inst of g.instances) {
    const def = defs.get(inst.id);
    if (!def) continue;
    for (const pin of def.inputs) {
      if (!drivenInputs.has(`${inst.id}.${pin.id}`)) {
        issues.push({
          severity: 'warning',
          code: 'dangling-input',
          inst: inst.id,
          port: pin.id,
          message: {
            zh: `${def.name.zh} 的输入引脚 ${pin.id} 未接线（默认读取 0）`,
            en: `Input pin ${pin.id} of ${def.name.en} is not wired (reads 0)`,
          },
        });
      }
    }
  }

  return issues;
}
