import { CircuitValidationError, UnstableCircuitError } from './errors';
import { validateGraph, type Graph, type GraphIssue } from './graph';
import { assertWidth, createSignalTable, type PortValue, type SignalTable } from './signal';
import type { ComponentDef, Registry } from './registry';

/** Iteration cap for the settle loop. A combinational loop exhausts it. */
export const SETTLE_LIMIT = 512;

/** Smallest table `compile` will ask for; tiny circuits still get a real buffer. */
const MIN_CAPACITY = 64;

/**
 * A flattened, evaluated circuit: one slot per bit of every pin, plus the
 * mapping from pins to slots.
 *
 * The netlist is a value object owned by `Simulation` (the two are tied together
 * by a private `WeakMap`); callers address slots, never names, so a hot loop
 * resolves `"i3.a"` once instead of per evaluation.
 */
export interface Netlist {
  /**
   * Expanded instances. Phase 0 does not expand custom components, so this is
   * `graph.instances.length` and `expandedCount` repeats it for the plan's
   * original spelling.
   */
  readonly instanceCount: number;
  readonly expandedCount: number;
  /** Bits allocated (one slot per bit of every pin). */
  readonly slotCount: number;
  /**
   * `drive[slot]` is the slot `slot` reads its value from: the identity for
   * every slot except a wired input pin, which reads the output pin driving it.
   * Resolving wires up front keeps the settle loop branch-free.
   */
  readonly drive: Int32Array;
  /** Expanded instance key -> origin instance id in the document. */
  readonly refs: Map<string, string>;
  /**
   * Slot the kernel reads (and a driver writes) for the input pin
   * `"<instId>.<pinId>"`: its driver slot. For an unwired pin that is the pin's
   * own slot, which is always zero unless the caller writes it -- so an unwired
   * input reads 0 and a level can still drive it directly.
   */
  inputBase(key: string): number;
  /** Slot of the output pin `"<instId>.<pinId>"`. */
  outputBase(key: string): number;
  /** Expanded instance ids, in evaluation order. */
  instanceIds(): readonly string[];
  /** Def ids of the expanded instances, in evaluation order. */
  instanceDefs(): readonly string[];
  /** `"<instId>.<pinId>"` keys of every output pin. */
  outputKeys(): readonly string[];
}

interface CompiledInstance {
  readonly key: string;
  readonly origin: string;
  readonly def: ComponentDef;
  /** Slot base of each input pin, in `def.inputs` order. */
  readonly inputs: readonly number[];
  /** Slot base of each output pin, in `def.outputs` order. */
  readonly outputs: readonly number[];
  /** Index of each output pin in the netlist-wide output pin list. */
  readonly outPin: readonly number[];
}

interface OutputPin {
  readonly base: number;
  readonly width: number;
}

interface NetInternals {
  readonly table: SignalTable;
  readonly instances: readonly CompiledInstance[];
  readonly outputPins: readonly OutputPin[];
}

/** Ties a netlist to the storage `compile` built for it, without a public field. */
const INTERNALS = new WeakMap<Netlist, NetInternals>();

/**
 * Capacity for `graph`, derived from the circuit instead of the table default.
 *
 * `createSignalTable`'s 65,536-slot default cannot hold the spec's
 * 20,000-instance budget: 20,000 two-input gates occupy 60,000 slots and a
 * single three-input gate overruns it. The estimate is exact plus a quarter of
 * headroom, so the requirement is not a knife edge; `alloc` still throws a named
 * `RangeError` rather than growing the buffer if it were ever wrong.
 */
function capacityFor(graph: Graph, registry: Registry): number {
  let slots = 0;
  for (const inst of graph.instances) {
    // `validateGraph` has already rejected unknown def ids, so `get` cannot throw.
    const def = registry.get(inst.def);
    for (const pin of def.inputs) slots += pin.width;
    for (const pin of def.outputs) slots += pin.width;
  }
  return Math.max(MIN_CAPACITY, Math.ceil(slots * 1.25) + 16);
}

/**
 * Flattens a document into a netlist.
 *
 * Error-severity issues are fatal (the circuit is meaningless); warnings are
 * accepted, because an unwired input legally reads 0 and only the simulator can
 * tell whether a feedback loop settles.
 */
export function compile(graph: Graph, registry: Registry): Netlist {
  const errors: GraphIssue[] = validateGraph(graph, registry).filter(
    (i) => i.severity === 'error',
  );
  if (errors.length > 0) throw new CircuitValidationError(errors);

  const table = createSignalTable(capacityFor(graph, registry));
  const instances: CompiledInstance[] = [];
  const refs = new Map<string, string>();
  const byId = new Map<string, CompiledInstance>();
  const inputBases = new Map<string, number>();
  const outputBases = new Map<string, number>();
  const outputPins: OutputPin[] = [];

  for (const inst of graph.instances) {
    const def = registry.get(inst.def);
    const inputs = def.inputs.map((pin) => {
      const base = table.alloc(pin.width);
      inputBases.set(`${inst.id}.${pin.id}`, base);
      return base;
    });
    const outPin: number[] = [];
    const outputs = def.outputs.map((pin) => {
      const base = table.alloc(pin.width);
      outputBases.set(`${inst.id}.${pin.id}`, base);
      outPin.push(outputPins.length);
      outputPins.push({ base, width: pin.width });
      return base;
    });
    const compiled: CompiledInstance = {
      key: inst.id,
      origin: inst.id,
      def,
      inputs,
      outputs,
      outPin,
    };
    refs.set(inst.id, inst.id);
    byId.set(inst.id, compiled);
    instances.push(compiled);
  }

  // Start from the identity so an unwired input reads its own (zero) slot, then
  // point every wired input at the output pin that drives it. Giving each
  // unwired pin its own slot rather than sharing one zero slot is what lets a
  // caller write an unwired input directly -- and it keeps `slotCount` equal to
  // the pin bits the circuit actually has.
  const drive = new Int32Array(table.size);
  for (let slot = 0; slot < drive.length; slot += 1) drive[slot] = slot;
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to) continue; // unknown endpoints are a fatal issue, already thrown
    const fromPin = from.def.outputs.findIndex((p) => p.id === wire.from.port);
    const toPin = to.def.inputs.findIndex((p) => p.id === wire.to.port);
    if (fromPin < 0 || toPin < 0) continue; // unknown ports are fatal too
    const fromBase = from.outputs[fromPin]!;
    const toBase = to.inputs[toPin]!;
    const width = Math.min(from.def.outputs[fromPin]!.width, to.def.inputs[toPin]!.width);
    for (let bit = 0; bit < width; bit += 1) drive[toBase + bit] = fromBase + bit;
  }

  const instanceIds = instances.map((i) => i.key);
  const instanceDefs = instances.map((i) => i.def.id);
  const baseOf = (map: Map<string, number>, kind: string, key: string): number => {
    const base = map.get(key);
    if (base === undefined) throw new Error(`no such ${kind} pin: ${key}`);
    return base;
  };
  const net: Netlist = {
    instanceCount: instances.length,
    expandedCount: instances.length,
    slotCount: table.size,
    drive,
    refs,
    inputBase: (key) => drive[baseOf(inputBases, 'input', key)]!,
    outputBase: (key) => baseOf(outputBases, 'output', key),
    instanceIds: () => instanceIds,
    instanceDefs: () => instanceDefs,
    outputKeys: () => [...outputBases.keys()],
  };
  INTERNALS.set(net, { table, instances, outputPins });
  return net;
}

export interface SettleReport {
  readonly iterations: number;
  readonly stable: boolean;
}

/**
 * Runs a compiled circuit, one clock edge at a time.
 *
 * Between edges the circuit is a combinatorial function of the level inputs and
 * the storage elements' held state; `settle` runs it to that fixed point and
 * `tick` applies one edge and settles again.
 */
export class Simulation {
  readonly net: Netlist;
  /** The catalog this netlist was compiled against, for callers that need defs. */
  readonly registry: Registry;
  readonly #table: SignalTable;
  readonly #drive: Int32Array;
  readonly #instances: readonly CompiledInstance[];
  readonly #outputPins: readonly OutputPin[];
  /** Private state of every instance, indexed like `#instances`. */
  readonly #state: Uint8Array[];
  /** Output values staged by the current settle sweep, indexed like `#outputPins`. */
  readonly #staged: Array<PortValue | undefined>;
  #tickCount = 0;

  constructor(net: Netlist, registry: Registry) {
    const internals = INTERNALS.get(net);
    if (!internals) throw new Error('netlist was not produced by compile()');
    this.net = net;
    this.registry = registry;
    this.#table = internals.table;
    this.#drive = net.drive;
    this.#instances = internals.instances;
    this.#outputPins = internals.outputPins;
    this.#state = internals.instances.map((i) => new Uint8Array(i.def.stateBytes));
    this.#staged = new Array<PortValue | undefined>(internals.outputPins.length).fill(undefined);
  }

  get tickCount(): number {
    return this.#tickCount;
  }

  /** Clears every signal and every storage element, then settles from scratch. */
  reset(): void {
    this.#table.clear();
    for (const state of this.#state) state.fill(0);
    this.#tickCount = 0;
    this.#publishState();
    this.settle();
  }

  /**
   * Publishes storage outputs from their private state.
   *
   * `evaluate` does this too (and `settle` calls it), so this only exists so
   * that a def with state but no `evaluate` still holds, and so that a caller
   * reading right after `reset`/`tick` sees the held value. It is only correct
   * while each state byte maps to one 1-bit output pin, which holds for
   * `delay_line` and `mem1`; wide registers in a later phase need a publish hook.
   */
  #publishState(): void {
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential) continue;
      const state = this.#state[i]!;
      for (let p = 0; p < inst.outputs.length; p += 1) {
        this.#table.setBit(inst.outputs[p]!, state[p] === 1 ? 1 : 0);
      }
    }
  }

  /** Reads each input pin through its pre-resolved driver slot. */
  #readInputs(inst: CompiledInstance, scratch: PortValue[]): void {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      const base = inst.inputs[p]!;
      scratch[p] = this.#table.getPort(this.#drive[base]!, inst.def.inputs[p]!.width);
    }
    // Keep the scratch exactly as long as this instance's pin list, so a shorter
    // instance never sees values left behind by a longer one.
    scratch.length = inst.inputs.length;
  }

  /**
   * True when the table already holds `value` at this pin.
   *
   * Compared bit by bit rather than as `PortValue`s on purpose: `valuesEqual`
   * cannot equate a number with the byte-array form of the same value (a 12-bit
   * pin reads back as `Uint8Array`), so a value-form comparison would report a
   * change on every sweep and misdiagnose a healthy circuit as unstable.
   * `assertWidth` still runs, so a malformed staged value throws loudly instead
   * of being silently truncated to the bits the comparison looks at.
   */
  #holds(base: number, width: number, value: PortValue): boolean {
    assertWidth(value, width);
    for (let bit = 0; bit < width; bit += 1) {
      const held =
        typeof value === 'number'
          ? bit < 32
            ? (value >>> bit) & 1
            : 0
          : ((value[bit >> 3] ?? 0) >> (bit & 7)) & 1;
      if (this.#table.slots[base + bit] !== held) return false;
    }
    return true;
  }

  /**
   * Runs the circuit to a fixed point and reports how many sweeps that took.
   *
   * Every def with an `evaluate` runs, storage elements included: they publish
   * the value they hold (`state`) and never their inputs, which is what makes a
   * delay line hold for a full tick. A def that produced no value for a pin
   * leaves that pin alone, so `level_input` -- driven from outside through its
   * output slot -- survives the sweep.
   *
   * The sweep is parallel (Jacobi): all instances are evaluated against the
   * values committed by the previous sweep, staged, and committed together.
   * Two properties follow, and the game needs both. The outcome cannot depend on
   * the order instances happen to sit in the document, and a genuine oscillator
   * cannot fake a fixed point -- with in-place (Gauss-Seidel) evaluation a ring
   * of two inverters "converges" to a self-consistent-looking 1/0 pair, which
   * would be reported as stable.
   */
  settle(): SettleReport {
    const inputs: PortValue[] = [];
    const outputs: PortValue[] = [];
    // Start from a clean stage: a def that produced nothing for a pin (`level_input`)
    // must not inherit a value staged by an earlier, failed sweep.
    this.#staged.fill(undefined);
    for (let iteration = 0; iteration < SETTLE_LIMIT; iteration += 1) {
      for (let i = 0; i < this.#instances.length; i += 1) {
        const inst = this.#instances[i]!;
        const evaluate = inst.def.evaluate;
        if (!evaluate) continue;
        this.#readInputs(inst, inputs);
        outputs.length = 0;
        evaluate(inputs, outputs, inst.def.sequential ? this.#state[i] : undefined, {
          tick: this.#tickCount,
        });
        for (let p = 0; p < inst.outputs.length; p += 1) {
          const value = outputs[p];
          if (value === undefined) continue;
          this.#staged[inst.outPin[p]!] = value;
        }
      }

      let changed = false;
      for (let k = 0; k < this.#outputPins.length; k += 1) {
        const value = this.#staged[k];
        if (value === undefined) continue;
        this.#staged[k] = undefined;
        const pin = this.#outputPins[k]!;
        if (this.#holds(pin.base, pin.width, value)) continue;
        this.#table.setPort(pin.base, pin.width, value);
        changed = true;
      }
      if (!changed) return { iterations: iteration + 1, stable: true };
    }
    throw new UnstableCircuitError(
      SETTLE_LIMIT,
      this.#instances.map((i) => i.origin),
    );
  }

  /**
   * Applies one clock edge: every storage element samples, then the circuit
   * settles.
   *
   * Inputs are snapshotted for all storage elements before any of them updates,
   * so two of them in series shift a value along by one stage per tick rather
   * than racing through both in a single tick.
   */
  tick(): SettleReport {
    this.#tickCount += 1;
    const pending: Array<{ index: number; inputs: PortValue[] }> = [];
    const inputs: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      if (!inst.def.sequential || !inst.def.clockEdge) continue;
      this.#readInputs(inst, inputs);
      pending.push({ index: i, inputs: [...inputs] });
    }
    const outputs: PortValue[] = [];
    for (const { index, inputs: sampled } of pending) {
      const inst = this.#instances[index]!;
      outputs.length = 0;
      inst.def.clockEdge!(sampled, outputs, this.#state[index]!, { tick: this.#tickCount });
    }
    this.#publishState();
    return this.settle();
  }

  read(base: number, width: number): PortValue {
    return this.#table.getPort(base, width);
  }

  write(base: number, width: number, v: PortValue): void {
    this.#table.setPort(base, width, v);
  }
}

/**
 * Longest combinational path, counted in base-gate delays.
 *
 * Linear-time DAG longest path: Kahn's algorithm for a topological order, then a
 * single relaxation pass. Walking paths instead would be exponential on diamond
 * shaped circuits (2^n paths), and real CPU circuits are full of them.
 *
 * Only combinational edges are considered. A storage element's input is sampled
 * rather than read (nothing propagates into it) and its output is a fresh source
 * (nothing propagates through it), so storage contributes no delay: its cost
 * shows up in the tick metric instead.
 */
export function delayOf(graph: Graph, registry: Registry): number {
  const count = graph.instances.length;
  if (count === 0) return 0;

  const index = new Map<string, number>();
  graph.instances.forEach((inst, i) => index.set(inst.id, i));

  const cost = new Int32Array(count);
  const sequential = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    // Unknown defs cannot reach here on a validated graph; skipping them keeps a
    // half-built document from throwing out of a metrics function.
    const def = registry.has(graph.instances[i]!.def)
      ? registry.get(graph.instances[i]!.def)
      : null;
    cost[i] = def?.cost ?? 0;
    sequential[i] = def?.sequential ? 1 : 0;
  }

  const outgoing: number[][] = Array.from({ length: count }, () => []);
  const inDegree = new Int32Array(count);
  for (const wire of graph.wires) {
    const from = index.get(wire.from.inst);
    const to = index.get(wire.to.inst);
    if (from === undefined || to === undefined) continue;
    if (sequential[from] === 1 || sequential[to] === 1) continue;
    outgoing[from]!.push(to);
    inDegree[to] = inDegree[to]! + 1;
  }

  // `delay[i]` is the longest combinational delay arriving at instance i's
  // output. A source has no predecessors, so it is worth its own cost (a gate
  // with unwired inputs still takes one gate delay; a source or a storage
  // element costs nothing).
  const delay = new Int32Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (inDegree[i] !== 0) continue;
    delay[i] = sequential[i] === 1 ? 0 : cost[i]!;
    queue.push(i);
  }

  let longest = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]!;
    if (delay[i]! > longest) longest = delay[i]!;
    for (const next of outgoing[i]!) {
      const candidate = delay[i]! + cost[next]!;
      if (candidate > delay[next]!) delay[next] = candidate;
      inDegree[next] = inDegree[next]! - 1;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  // Instances inside a combinational loop are never queued (their in-degree
  // never reaches 0), so a loop contributes no depth and the walk still
  // terminates. `validateGraph` reports the loop as a warning; whether it
  // settles is the simulator's question, not this metric's.
  return longest;
}
