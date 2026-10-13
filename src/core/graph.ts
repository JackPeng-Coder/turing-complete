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

/**
 * Where a declared pin of a custom component reaches into its body.
 *
 * A `PinDef` says a component HAS a pin; it does not say which body pin that
 * pin is. Without this the surface would be a list of names with nothing behind
 * them, so every declared pin carries the body endpoint it stands for: an input
 * stands for the body pin it drives, an output for the body pin it reads.
 *
 * A `WireEnd` rather than a bare pin id because a body is a whole `Graph`: the
 * endpoint has to name the instance AND the pin, exactly as a wire does.
 */
export interface BlueprintBinds {
  /** Declared input pin id -> the body INPUT pin that pin drives. */
  readonly inputs: Readonly<Record<string, WireEnd>>;
  /** Declared output pin id -> the body OUTPUT pin that pin reads. */
  readonly outputs: Readonly<Record<string, WireEnd>>;
}

/**
 * A player-built component: a named body graph with a declared pin surface.
 *
 * THE ID IS A COMPONENT ID, NOT AN INSTANCE ID. An instance of this component
 * names it through `Instance.def`, the same way it names `nand`, so the palette,
 * `validateGraph` and `compile` all see one kind of thing. `BlueprintBinds` is
 * what the surface means; `body` is an ordinary editable graph, which is what
 * makes a component wrappable into another one.
 *
 * `level` is absent from a body on purpose: the field names the level an
 * ATTEMPT belongs to, and a component has no level.
 */
export interface CustomComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  readonly binds: BlueprintBinds;
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
  | 'feedback-loop'
  /**
   * A custom component whose body contains an instance of itself.
   *
   * Refused rather than expanded because expansion is what the simulator does:
   * a self-containing component would unfold for ever, and the cap that stopped
   * it would report a size problem where the defect is a cycle. The spec's
   * nesting limit is 8 levels; a cycle is not deep, it is ill-formed.
   */
  | 'recursive-blueprint';

/**
 * Largest `params.width` a document may set, in bits.
 *
 * A width multiplies every pin of an instance and is reserved for up front, so
 * the ceiling is what keeps a malformed document from asking the signal table
 * for an allocation it cannot serve -- see the check in `validateGraph`.
 */
export const MAX_PARAM_WIDTH = 4096;

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
      binds: {
        inputs: cloneWireEnds(c.binds.inputs),
        outputs: cloneWireEnds(c.binds.outputs),
      },
      body: cloneGraph(c.body),
    })),
  };
  if (g.level !== undefined) copy.level = g.level;
  return copy;
}

/** One level of a blueprint's binding table, copied so a clone shares nothing. */
function cloneWireEnds(
  ends: Readonly<Record<string, WireEnd>>,
): Record<string, WireEnd> {
  const copy: Record<string, WireEnd> = {};
  for (const [pin, end] of Object.entries(ends)) copy[pin] = { ...end };
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
  return validateAt(g, registry, new Map(), new Set(), '', new Set());
}

/**
 * The separator `compile` puts between an instance id and the body instance
 * inside it (`i3/i1`). It is what makes the address of a COMPONENT INSTANCE --
 * a blueprint instance's inner parts, whose ids repeat once per instance --
 * writable down, and it is why an id containing one is refused below.
 */
export const PATH_SEPARATOR = '/';

/** Longest chain of nested components `validateGraph` will walk. */
const MAX_BLUEPRINT_DEPTH = 8;

/**
 * `validateGraph` for one graph, with the document path above it.
 *
 * A custom component's body is a whole `Graph` and is validated here rather than
 * by the caller, because a body is only ever judged as part of the document that
 * carries it: an unknown def, a doubly-driven input or a bad binding inside a
 * component is a defect of the circuit the player is building.
 *
 * `path` is the path of the graph itself (empty at the root, `i3/` inside the
 * instance `i3`), so a reported `inst` is the PATH of the instance -- the same
 * spelling `compile` keys it by, and the only one that is unique once components
 * can be instanced twice. `seen` holds the component ids currently being walked: a
 * body that instances one of them is a cycle, refused rather than expanded.
 */
function validateAt(
  g: Graph,
  registry: Registry,
  components: Map<string, CustomComponentDef>,
  validated: Set<string>,
  path: string,
  seen: ReadonlySet<string>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Instance>();
  for (const inst of g.instances) byId.set(inst.id, inst);

  /** The full path of one instance of this graph, for an issue to name. */
  const at = (id: string): string => `${path}${id}`;

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
      inst: at(inst.id),
      message: { zh: `未知元件类型：${inst.def}`, en: `Unknown component type: ${inst.def}` },
    });
    return null;
  };

  const defs = new Map<string, ReturnType<Registry['get']> | null>();
  for (const inst of g.instances) defs.set(inst.id, defOf(inst));

  // THE SEPARATOR IS RESERVED. `compile` addresses a component instance as
  // `<outer>/<inner>`, so an id that already contains one would make two
  // different instances collide on the same key -- a silently shared machine
  // rather than a rejected document. Level data and the editor both mint ids
  // (`i1`, `IN_a`, `OUT`), so this is a malformed document, not a large circuit.
  for (const inst of g.instances) {
    if (!inst.id.includes(PATH_SEPARATOR)) continue;
    issues.push({
      severity: 'error',
      code: 'invalid-params',
      inst: at(inst.id),
      message: {
        zh: `元件 id ${inst.id} 含有保留字符 ${PATH_SEPARATOR}（它用于寻址自定义元件内部的实例）`,
        en: `Instance id ${inst.id} contains the reserved character ${PATH_SEPARATOR} (it addresses instances inside a custom component)`,
      },
    });
  }

  // A per-instance width override is resolved by `compile` and feeds straight
  // into slot allocation, so a value `alloc` cannot take has to be reported here
  // for the same reason an unknown def is: allowed through, it would reach
  // `table.alloc` and raise a bare `RangeError` out of the grading path instead
  // of surfacing as a `CircuitValidationError` the caller already handles.
  //
  // The bound is two-sided on purpose. `Number.isSafeInteger` alone accepts
  // `1e9`, and a width is not just a number of slots for one pin: `capacityFor`
  // reserves `slots * 1.25 + regions + 16` BYTES before `alloc` runs at all, so
  // a hand-authored 1e9 pin asks for a typed array of over a gigabyte and the
  // `RangeError` comes from that allocation -- escaping `compile` exactly as the
  // bare `alloc` error would have. 4096 is far above any pin the game ships (8
  // in this phase, 64 at most in phase 5) and keeps the whole table comfortably
  // small, so a width above it is a malformed document, not a large circuit.
  for (const inst of g.instances) {
    const width = inst.params.width;
    if (width === undefined) continue;
    if (Number.isSafeInteger(width) && width > 0 && width <= MAX_PARAM_WIDTH) continue;
    issues.push({
      severity: 'error',
      code: 'invalid-params',
      inst: at(inst.id),
      message: {
        zh: `元件 ${inst.id} 的参数 width 无效：${String(width)}（必须是 1 到 ${MAX_PARAM_WIDTH} 之间的整数）`,
        en: `Instance ${inst.id} has an invalid width parameter: ${String(width)} (must be a positive integer no greater than ${MAX_PARAM_WIDTH})`,
      },
    });
  }

  const drivenInputs = new Map<string, string[]>();
  /**
   * The port id behind each `drivenInputs` key.
   *
   * Kept beside the key rather than recovered from it after the fact: an
   * instance id is player-controlled and a pin id comes from a def, so
   * `"<inst>.<port>"` has no unambiguous split once ids are arbitrary. The
   * key is still a pair of ids joined by a dot, which is fine -- it is only a
   * key, and nothing ever takes it apart again.
   */
  const drivenPorts = new Map<string, string>();
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
    drivenPorts.set(key, wire.to.port);
    const outKey = `${fromInst.id}.${wire.from.port}`;
    driverCount.set(outKey, (driverCount.get(outKey) ?? 0) + 1);
  }

  for (const [key, wires] of drivenInputs) {
    if (wires.length > 1) {
      const instId = key.slice(0, key.length - (drivenPorts.get(key)!.length + 1));
      issues.push({
        severity: 'error',
        code: 'multiple-drivers',
        inst: at(instId),
        port: drivenPorts.get(key)!,
        message: {
          zh: `输入引脚 ${drivenPorts.get(key)!} 被 ${wires.length} 根导线同时驱动`,
          en: `Input pin ${drivenPorts.get(key)!} is driven by ${wires.length} wires`,
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
          inst: at(inst.id),
          port: pin.id,
          message: {
            zh: `${def.name.zh} 的输入引脚 ${pin.id} 未接线（默认读取 0）`,
            en: `Input pin ${pin.id} of ${def.name.en} is not wired (reads 0)`,
          },
        });
      }
    }
  }

  issues.push(...validateComponents(g, registry, components, validated, path, seen));
  return issues;
}

/**
 * The custom components this graph instantiates, judged as part of it.
 *
 * Every instance whose def carries a body gets: the body validated (recursively,
 * with `path` extended so a defect inside names the instance the player can
 * actually see), its own recursion refused, and its declared pin surface checked
 * against the body it claims to stand for.
 *
 * A BODY IS A GRAPH, SO IT GETS THE WHOLE TREATMENT -- an unknown def, a
 * doubly-driven input and a dangling pin inside a component are all reported by
 * `validateAt` exactly as they would be at the root. `validateGraph` is the only
 * place that judges a document, and a document with components in it is still
 * one document.
 */
function validateComponents(
  g: Graph,
  registry: Registry,
  components: Map<string, CustomComponentDef>,
  validated: Set<string>,
  path: string,
  seen: ReadonlySet<string>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const component of g.customComponents) {
    // The document's table is advisory: the caller built it from the graph's own
    // components, and a graph that carries one the caller did not pass is still
    // that graph's component. First write wins, so a caller with a better name
    // for it (`Progress.blueprints`) is not overwritten by a stale inline copy.
    if (!components.has(component.id)) components.set(component.id, component);
  }
  // THE INSTANCES DECIDE WHICH COMPONENTS GET WALKED, not the `customComponents`
  // array alone. A body that instances another component carries no definition of
  // its own -- the document's table is the one place a component lives -- so
  // walking an instance's def is the only way a nested component is ever reached.
  const named = new Set<string>();
  for (const inst of g.instances) {
    const component = components.get(inst.def);
    if (component) named.add(component.id);
  }
  for (const component of g.customComponents) named.add(component.id);

  for (const id of named) {
    const component = components.get(id);
    if (!component) continue;
    // A CYCLE IS CHECKED BEFORE THE MEMO, and the order is load-bearing. A
    // component is walked once, but "already walked" is not "cannot contain
    // itself": a body that instances its own component reaches that component
    // again with the chain in `seen`, and the memo would otherwise answer
    // "done" and hide the cycle that makes the document unexpandable.
    if (seen.has(id)) {
      // The cycle is refused at the component that closes it: the chain down to
      // here is the explanation, and every component on it is named.
      issues.push({
        severity: 'error',
        code: 'recursive-blueprint',
        message: {
          zh: `自定义元件 ${component.name.zh}（${id}）的电路里含它自己：${[...seen].join(' → ')} → ${id}`,
          en: `Custom component ${component.name.en} (${id}) contains itself: ${[...seen].join(' → ')} → ${id}`,
        },
      });
      continue;
    }
    // WALKED ONCE, however many instances name it -- and however many paths lead
    // to it. A component that two others contain is one component with one set of
    // defects; reporting them per path would multiply the same message by the
    // number of routes through the document.
    if (validated.has(id)) continue;
    if (seen.size >= MAX_BLUEPRINT_DEPTH) {
      issues.push({
        severity: 'error',
        code: 'recursive-blueprint',
        message: {
          zh: `自定义元件嵌套超过 ${MAX_BLUEPRINT_DEPTH} 层：${[...seen].join(' → ')} → ${id}`,
          en: `Custom components nest more than ${MAX_BLUEPRINT_DEPTH} deep: ${[...seen].join(' → ')} → ${id}`,
        },
      });
      continue;
    }
    const inner = new Set(seen);
    inner.add(id);
    validated.add(id);
    issues.push(
      ...validateAt(
        component.body,
        registry,
        components,
        validated,
        `${path}${id}${PATH_SEPARATOR}`,
        inner,
      ),
    );
    issues.push(...validateBinds(component, registry, path));
  }
  return issues;
}

/**
 * Whether a component's declared pins point at anything real.
 *
 * The surface and the body are two halves of one thing, and a half-written pair
 * fails in a way nothing else can see: `compile` reads the binding to resolve a
 * wire, so a binding naming a pin the body does not have, or an input bound to
 * an OUTPUT, would surface as a pin that silently reads 0 -- a component that
 * looks wired and computes nothing.
 */
function validateBinds(
  component: CustomComponentDef,
  registry: Registry,
  path: string,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const body = component.body;
  const inBody = new Map(body.instances.map((inst) => [inst.id, inst]));
  const label = `${path}${component.id}`;

  const check = (
    side: 'inputs' | 'outputs',
    pins: readonly PinDef[],
    binds: Readonly<Record<string, WireEnd>>,
  ): void => {
    for (const pin of pins) {
      const bind = binds[pin.id];
      const name = { zh: component.name.zh, en: component.name.en };
      if (!bind) {
        issues.push({
          severity: 'error',
          code: 'invalid-params',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的${side === 'inputs' ? '输入' : '输出'}引脚 ${pin.id} 没有绑定到电路里的引脚`,
            en: `Custom component ${name.en} has no body pin bound to its ${side === 'inputs' ? 'input' : 'output'} ${pin.id}`,
          },
        });
        continue;
      }
      const target = inBody.get(bind.inst);
      const def = target ? registry.get(target.def) : null;
      if (!target || !def) {
        issues.push({
          severity: 'error',
          code: 'unknown-instance',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的引脚 ${pin.id} 绑定到电路里不存在的元件 ${bind.inst}`,
            en: `Pin ${pin.id} of ${name.en} is bound to ${bind.inst}, which its circuit does not have`,
          },
        });
        continue;
      }
      const pool = side === 'inputs' ? def.inputs : def.outputs;
      if (!pinIds(pool).has(bind.port)) {
        issues.push({
          severity: 'error',
          code: 'unknown-port',
          inst: label,
          port: pin.id,
          message: {
            zh: `自定义元件 ${name.zh} 的引脚 ${pin.id} 绑定到 ${bind.inst}，但 ${def.name.zh} 没有${side === 'inputs' ? '输入' : '输出'}引脚 ${bind.port}`,
            en: `Pin ${pin.id} of ${name.en} is bound to ${bind.inst}, which has no ${side === 'inputs' ? 'input' : 'output'} ${bind.port}`,
          },
        });
      }
    }
  };

  check('inputs', component.inputs, component.binds.inputs);
  check('outputs', component.outputs, component.binds.outputs);
  return issues;
}
