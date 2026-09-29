import { CircuitValidationError, UnstableCircuitError } from './errors';
import { validateGraph, type Graph, type GraphIssue, type Instance } from './graph';
import { assertWidth, createSignalTable, type PortValue, type SignalTable } from './signal';
import type { ComponentDef, PinDef, Registry } from './registry';

/** Iteration cap for the settle loop. A combinational loop exhausts it. */
export const SETTLE_LIMIT = 512;

/** Smallest table `compile` will ask for; tiny circuits still get a real buffer. */
const MIN_CAPACITY = 64;

/**
 * A flattened, evaluated circuit: one slot per bit of every pin, plus the
 * mapping from pins to slots, plus a read region for the pins that need one.
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
  /** Bits allocated: one slot per bit of every pin, plus every read region. */
  readonly slotCount: number;
  /**
   * `drive[slot]` is the slot `slot` reads its value from: the identity for
   * every slot except a wired input pin bit, which reads the output pin bit
   * driving it. Resolving wires up front keeps the settle loop branch-free.
   *
   * It covers the pin slots only. A bit no wire claimed keeps its own slot, so
   * such a bit reads 0 unless a caller writes that slot -- which is how an
   * unwired input is driven directly. A materialised read region is not
   * addressed through `drive`.
   */
  readonly drive: Int32Array;
  /** Expanded instance key -> origin instance id in the document. */
  readonly refs: Map<string, string>;
  /**
   * Slot base of a **contiguous** read region for the input pin
   * `"<instId>.<pinId>"`, so `read(inputBase(key), inputWidth(key))` is
   * coherent.
   *
   * Usually that is the driver's own base: an unwired pin reads its own slots
   * (which is why a level can still drive one directly), and a driver as wide as
   * the pin is one contiguous run of slots. A driver *narrower* than the pin is
   * neither, so `compile` materialises a region of the pin's own width and this
   * returns that instead. Returning the driver's base in that case would make
   * the caller read the slots that physically follow the driver -- other pins'
   * signals, silently.
   *
   * A region is republished from the settled table at the end of every `settle`,
   * so a caller reads it after settling without asking for anything extra. It is
   * a read alias only: writing into a region does not drive the pin. To drive a
   * level input, write the `level_input` output slot (`outputBase`), as before.
   */
  inputBase(key: string): number;
  /** Slot of the output pin `"<instId>.<pinId>"`. */
  outputBase(key: string): number;
  /**
   * Width of the input pin `"<instId>.<pinId>"`, in bits, as compiled.
   *
   * This is the width the pin's slots were allocated at and the width its read
   * region holds, which is `params.width` when the instance sets one and the
   * def's declared width otherwise -- see `effectiveWidth`. A caller that reads
   * a pin as a *range* has to use this rather than the def's width, or it reads
   * past a region that was sized from the instance.
   */
  inputWidth(key: string): number;
  /** Width of the output pin `"<instId>.<pinId>"`, in bits, as compiled. */
  outputWidth(key: string): number;
  /** Expanded instance ids, in evaluation order. */
  instanceIds(): readonly string[];
  /** Def ids of the expanded instances, in evaluation order. */
  instanceDefs(): readonly string[];
  /** `"<instId>.<pinId>"` keys of every output pin. */
  outputKeys(): readonly string[];
}

/**
 * Width of `pin` on `inst`: the instance's own override, else what the def says.
 *
 * `ComponentDef` declares exactly one width per `PinDef`, so a single
 * `params.width` covers every pin of that instance -- the wide output of a
 * `level_input`, both pins of a `level_output`, every input and output of a
 * gate. There is deliberately no per-pin-name syntax: nothing needs one yet, and
 * inventing one here would put a second, unenforced source of width in the
 * document.
 *
 * `validateGraph` has already rejected a `params.width` that is not a positive
 * integer, so `alloc`'s own width guard can never fire from a width resolved
 * here.
 */
function effectiveWidth(inst: Instance, pin: PinDef): number {
  return inst.params.width ?? pin.width;
}

interface CompiledInstance {
  readonly key: string;
  readonly origin: string;
  readonly def: ComponentDef;
  /** Slot base of each input pin, in `def.inputs` order. */
  readonly inputs: readonly number[];
  /** Width of each input pin, resolved per instance; parallel to `inputs`. */
  readonly inputWidths: readonly number[];
  /** Slot base of each output pin, in `def.outputs` order. */
  readonly outputs: readonly number[];
  /** Width of each output pin, resolved per instance; parallel to `outputs`. */
  readonly outputWidths: readonly number[];
  /** Index of each output pin in the netlist-wide output pin list. */
  readonly outPin: readonly number[];
}

interface OutputPin {
  readonly base: number;
  readonly width: number;
}

/** A contiguous slot range that `inputBase` can hand to a range-reading caller. */
interface ReadRegion {
  /** Base of the region: what `inputBase` reports for the pin. */
  readonly base: number;
  readonly width: number;
  /** Slot base of the input pin whose bits the region mirrors. */
  readonly src: number;
}

interface NetInternals {
  readonly table: SignalTable;
  readonly instances: readonly CompiledInstance[];
  readonly outputPins: readonly OutputPin[];
  readonly readRegions: readonly ReadRegion[];
}

/** Ties a netlist to the storage `compile` built for it, without a public field. */
const INTERNALS = new WeakMap<Netlist, NetInternals>();

/**
 * The single driver base every bit of `[base, base + width)` reads from, or -1
 * when those bits do not form one contiguous run.
 *
 * The identity answer (`base` itself) counts as a run on purpose: an unwired pin
 * reads its own slots, which is what lets a caller write an unwired input
 * directly. A run starting anywhere else is a driver covering the whole pin, so
 * reading `width` slots from there is exactly the pin's value. A narrower driver
 * leaves its tail pointing at the pin's own slots (see the identity default in
 * `compile`), which no single base can describe -- that pin needs a region.
 */
function contiguousRun(drive: Int32Array, base: number, width: number): number {
  const first = drive[base]!;
  for (let bit = 1; bit < width; bit += 1) {
    if (drive[base + bit] !== first + bit) return -1;
  }
  return first;
}

/**
 * Capacity for `graph`, derived from the circuit instead of the table default.
 *
 * `createSignalTable`'s 65,536-slot default cannot hold the spec's
 * 20,000-instance budget: 20,000 two-input gates occupy 60,000 slots and a
 * single three-input gate overruns it. The estimate is exact plus a quarter of
 * headroom, plus the most a read region could ever need (one per driven input
 * pin wider than 1 bit, which is the only kind that can require one), so the
 * requirement is not a knife edge; `alloc` still throws a named `RangeError`
 * rather than growing the buffer if it were ever wrong.
 *
 * Every width here is the *resolved* one (`effectiveWidth`), the same values
 * `compile` allocates from. Sizing this from the def widths would reserve less
 * than the allocation loop and the regions actually take, and the table would
 * overrun on a circuit that is perfectly legal.
 */
function capacityFor(graph: Graph, registry: Registry): number {
  const driven = new Set<string>();
  for (const wire of graph.wires) driven.add(`${wire.to.inst}.${wire.to.port}`);
  let slots = 0;
  let regions = 0;
  for (const inst of graph.instances) {
    // `validateGraph` has already rejected unknown def ids, so `get` cannot throw.
    const def = registry.get(inst.def);
    for (const pin of def.inputs) {
      const width = effectiveWidth(inst, pin);
      slots += width;
      if (width > 1 && driven.has(`${inst.id}.${pin.id}`)) regions += width;
    }
    for (const pin of def.outputs) slots += effectiveWidth(inst, pin);
  }
  return Math.max(MIN_CAPACITY, Math.ceil(slots * 1.25) + regions + 16);
}

/**
 * Flattens a document into a netlist.
 *
 * Error-severity issues are fatal (the circuit is meaningless); warnings are
 * accepted, because an unwired input legally reads 0 and only the simulator can
 * tell whether a feedback loop settles.
 *
 * A pin's width is `inst.params.width` when the instance sets one, otherwise the
 * width the def declares -- see `effectiveWidth`. Every width-dependent step
 * below (slot allocation, `drive`, the read regions, the per-bit reads, the
 * write-back and the capacity reservation) goes through those resolved values,
 * because a pin allocated at one width and read at another is exactly the silent
 * corruption this kernel exists to keep out.
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
  const outputBases = new Map<string, number>();
  const outputPins: OutputPin[] = [];
  const inputWidths = new Map<string, number>();
  const outputWidths = new Map<string, number>();

  for (const inst of graph.instances) {
    const def = registry.get(inst.def);
    // A storage element publishes what it holds through its own `evaluate` (see
    // `Simulation.#publishState`), so one without it could never put its state on
    // a pin. That is a defect in the DEF rather than in the circuit, and this is
    // the only place a graph and a catalog meet -- so it is refused here, loudly,
    // instead of holding zero in silence.
    //
    // Refused as a `CircuitValidationError` rather than a plain `Error`, because
    // the level checker re-throws anything that is neither that nor
    // `UnstableCircuitError` (`levels/checks.ts`): a bare `Error` from here would
    // escape the check pipeline instead of becoming a failed `'invalid'` check.
    // The issue taxonomy has no "the def itself is broken" code and the code list
    // lives in `graph.ts`, so the closest existing code is used -- and the ISSUE
    // names the def, so the diagnosis is in the error's own `issues`:
    // `CircuitValidationError`'s message is only the list of codes. That detail
    // survives wherever the throw is caught directly; the level checker collapses
    // it -- `createSim` maps it to a bare `{ error: 'invalid' }` and `runChecks`
    // pushes a failure with no issue attached (`levels/checks.ts`) -- so nothing
    // in that path names the def.
    if (def.sequential && def.stateBytes > 0 && !def.evaluate) {
      throw new CircuitValidationError([
        {
          severity: 'error',
          code: 'invalid-params',
          inst: inst.id,
          message: {
            zh: `${def.id}: 存储元件必须声明 evaluate() 才能发布其所存的值`,
            en: `${def.id}: a storage element must declare evaluate() to publish what it holds`,
          },
        },
      ]);
    }
    const inWidths = def.inputs.map((pin) => effectiveWidth(inst, pin));
    const outWidths = def.outputs.map((pin) => effectiveWidth(inst, pin));
    const inputs = inWidths.map((width) => table.alloc(width));
    def.inputs.forEach((pin, i) => inputWidths.set(`${inst.id}.${pin.id}`, inWidths[i]!));
    const outPin: number[] = [];
    const outputs = outWidths.map((width, i) => {
      const pin = def.outputs[i]!;
      const base = table.alloc(width);
      outputBases.set(`${inst.id}.${pin.id}`, base);
      outputWidths.set(`${inst.id}.${pin.id}`, width);
      outPin.push(outputPins.length);
      outputPins.push({ base, width });
      return base;
    });
    const compiled: CompiledInstance = {
      key: inst.id,
      origin: inst.id,
      def,
      inputs,
      inputWidths: inWidths,
      outputs,
      outputWidths: outWidths,
      outPin,
    };
    refs.set(inst.id, inst.id);
    byId.set(inst.id, compiled);
    instances.push(compiled);
  }

  // Start from the identity so an unwired input reads its own (zero) slot, then
  // point every wired input bit at the output pin bit that drives it. Giving each
  // unwired pin its own slot rather than sharing one zero slot is what lets a
  // caller write an unwired input directly -- and it is also what makes the bits
  // a narrow driver does not cover read 0: they keep pointing at their own slots,
  // which the kernel never writes.
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
    // Both sides resolved per instance: a driver and a pin may each be wider (or
    // narrower) than their def declares.
    const width = Math.min(from.outputWidths[fromPin]!, to.inputWidths[toPin]!);
    for (let bit = 0; bit < width; bit += 1) drive[toBase + bit] = fromBase + bit;
  }

  // `drive` answers "which single slot drives this bit", which is all a per-bit
  // read needs. A caller reads a *range* instead (`read(inputBase(key), width)`),
  // and there the driver is the wrong answer whenever it is narrower than the
  // pin: the read would run off the end of the driver into the slots that
  // physically follow it -- other pins' live signals -- rather than the pin's own
  // zero bits. So for every input pin whose bits are not already one contiguous
  // run of slots, materialise a region of that pin's width and report that. The
  // common cases (an unwired pin, a driver as wide as the pin) alias their slots
  // directly and allocate nothing.
  const readRegions: ReadRegion[] = [];
  const readBases = new Map<string, number>();
  for (const inst of instances) {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      const base = inst.inputs[p]!;
      const width = inst.inputWidths[p]!;
      const key = `${inst.key}.${inst.def.inputs[p]!.id}`;
      const run = contiguousRun(drive, base, width);
      if (run >= 0) {
        readBases.set(key, run);
        continue;
      }
      const regionBase = table.alloc(width);
      readRegions.push({ base: regionBase, width, src: base });
      readBases.set(key, regionBase);
    }
  }

  const instanceIds = instances.map((i) => i.key);
  const instanceDefs = instances.map((i) => i.def.id);
  const baseOf = (map: Map<string, number>, kind: string, key: string): number => {
    const base = map.get(key);
    if (base === undefined) throw new Error(`no such ${kind} pin: ${key}`);
    return base;
  };
  const widthOf = (map: Map<string, number>, kind: string, key: string): number => {
    const width = map.get(key);
    if (width === undefined) throw new Error(`no such ${kind} pin: ${key}`);
    return width;
  };
  const net: Netlist = {
    instanceCount: instances.length,
    expandedCount: instances.length,
    slotCount: table.size,
    drive,
    refs,
    inputBase: (key) => baseOf(readBases, 'input', key),
    outputBase: (key) => baseOf(outputBases, 'output', key),
    inputWidth: (key) => widthOf(inputWidths, 'input', key),
    outputWidth: (key) => widthOf(outputWidths, 'output', key),
    instanceIds: () => instanceIds,
    instanceDefs: () => instanceDefs,
    outputKeys: () => [...outputBases.keys()],
  };
  INTERNALS.set(net, { table, instances, outputPins, readRegions });
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
  readonly #readRegions: readonly ReadRegion[];
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
    this.#readRegions = internals.readRegions;
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
   * Publishes storage outputs from their private state: one pass, before the
   * settle that follows every `reset()` and `tick()`.
   *
   * THIS KERNEL KNOWS NO STATE LAYOUT OF ITS OWN. It used to: the previous
   * version wrote `state[p]` onto output pin `p`, one bit per pin, which is only
   * correct while each state byte is a 1-bit value. An 8-bit register keeping its
   * byte in one state byte got `0b00000001` written onto its pin -- invisible
   * only because the settle that follows republished through `evaluate`, and
   * fatal for the one case the pass was there to serve: a storage def with no
   * `evaluate`, which had nothing to correct it. Now the DEF publishes, through
   * the same `evaluate` the settle sweep calls, so the two paths cannot hold two
   * opinions about how a byte becomes a pin: `delay_line` and `mem1` publish the
   * bit they always did, `reg8` publishes all eight of its bits, and `ram8`
   * publishes the byte its `addr` selects, because selecting it is what its
   * `evaluate` reads `addr` for.
   *
   * The pass still earns its keep: it writes the table directly, so the first
   * sweep of the settle that follows already reads the held value rather than
   * the pre-edge one, and a caller reading right after `reset`/`tick` sees the
   * held value without waiting on the sweep. Running a def's `evaluate` a second
   * time per edge (here and in `settle`) is safe because `evaluate` must be pure
   * -- the registry says so, and the second call reaches the same value from the
   * same state.
   *
   * A storage def with no `evaluate` cannot be published at all, so `compile`
   * refuses one instead of letting it hold zero in silence.
   */
  #publishState(): void {
    const inputs: PortValue[] = [];
    const outputs: PortValue[] = [];
    for (let i = 0; i < this.#instances.length; i += 1) {
      const inst = this.#instances[i]!;
      const evaluate = inst.def.evaluate;
      if (!inst.def.sequential || !evaluate) continue;
      this.#readInputs(inst, inputs);
      outputs.length = 0;
      evaluate(inputs, outputs, this.#state[i], { tick: this.#tickCount });
      for (let p = 0; p < inst.outputs.length; p += 1) {
        const value = outputs[p];
        if (value === undefined) continue;
        this.#table.setPort(inst.outputs[p]!, inst.outputWidths[p]!, value);
      }
    }
  }

  /**
   * Assembles a pin's value one bit at a time, following `drive` per bit.
   *
   * Deliberately NOT `getPort(drive[base], width)`: that reads `width`
   * *consecutive* slots from wherever the driver happens to sit, so a driver
   * narrower than the pin pulls in the slots allocated after it -- other pins'
   * signals. Here a bit with no driver of its own falls back (through `drive`)
   * to the pin's own slot, which the kernel never writes, and so reads 0.
   *
   * The number/bytes split mirrors `SignalTable.getPort`, so a def sees the same
   * value form at every width.
   */
  #gather(base: number, width: number): PortValue {
    const slots = this.#table.slots;
    if (width <= 8) {
      let out = 0;
      for (let bit = 0; bit < width; bit += 1) {
        if (slots[this.#drive[base + bit]!] === 1) out |= 1 << bit;
      }
      return out;
    }
    const bytes = new Uint8Array(Math.ceil(width / 8));
    for (let bit = 0; bit < width; bit += 1) {
      if (slots[this.#drive[base + bit]!] === 1) bytes[bit >> 3]! |= 1 << (bit & 7);
    }
    return bytes;
  }

  /** Reads each input pin bit by bit through its pre-resolved driver slots. */
  #readInputs(inst: CompiledInstance, scratch: PortValue[]): void {
    for (let p = 0; p < inst.inputs.length; p += 1) {
      scratch[p] = this.#gather(inst.inputs[p]!, inst.inputWidths[p]!);
    }
    // Keep the scratch exactly as long as this instance's pin list, so a shorter
    // instance never sees values left behind by a longer one.
    scratch.length = inst.inputs.length;
  }

  /**
   * Republishes every materialised read region from the values just settled.
   *
   * `inputBase` hands out a slot range and the caller then reads it whenever it
   * likes, with nothing to tell it a fresh gather is needed -- so a region has to
   * be current by the time `settle` returns. One pass over the regions (not over
   * the instances) keeps this off the sweep's critical path.
   */
  #refreshReadRegions(): void {
    for (const region of this.#readRegions) {
      this.#table.setPort(region.base, region.width, this.#gather(region.src, region.width));
    }
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
   * delay line hold for a full tick. (`ram8` reads its `addr` input as well, to
   * select which held byte it publishes -- the one storage def for which that is
   * correct, argued at the def.) A def that produced no value for a pin
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
   *
   * On success the materialised read regions are refreshed last, so a caller that
   * reads through `inputBase` right after `settle` sees the settled values
   * without having to ask for anything extra.
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
      if (!changed) {
        this.#refreshReadRegions();
        return { iterations: iteration + 1, stable: true };
      }
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

  /**
   * Loads a byte image into an instance's private state, out of band.
   *
   * The path a program takes into a circuit. `ram_prog` has no write pin, so its
   * bytes cannot arrive through a clock edge the way `ram8`'s do; the level
   * checker assembles the source and calls this instead. It must be called
   * AFTER `reset()`: `reset` fills every state byte with zero, and `runChecks`
   * compiles once per check, before any check branch runs, so an image written
   * at compile time would be erased before the first step could read it. The
   * method does not publish anything itself -- the caller settles, and the def's
   * own `evaluate` publishes the new bytes through the same sweep every settled
   * value goes through.
   *
   * `instanceId` is the DOCUMENT id, which is what `CompiledInstance.key` holds
   * (`compile` sets both `key` and `origin` from `instance.id` today), so a
   * checker can resolve an instance from `graph.instances` and pass its id
   * straight through.
   *
   * The whole state is zeroed before the copy, not just the bytes being
   * written, so a shorter image after a longer one cannot leave a tail behind
   * and a second call is not order-dependent.
   *
   * Throws `RangeError` -- not a bare `Error` -- for an id this netlist does not
   * contain and for an image longer than the instance's state. `runChecks`
   * absorbs `RangeError` as an `invalid` failure, while anything else escapes
   * the check loop out of `grade()`, which runs on every board edit.
   */
  loadImage(instanceId: string, bytes: Uint8Array | readonly number[]): void {
    const index = this.#instances.findIndex((inst) => inst.key === instanceId);
    if (index < 0) throw new RangeError(`this netlist has no instance "${instanceId}"`);
    const state = this.#state[index]!;
    if (bytes.length > state.length) {
      throw new RangeError(
        `an image of ${bytes.length} bytes does not fit instance "${instanceId}" (${state.length} bytes of state)`,
      );
    }
    state.fill(0);
    state.set(bytes);
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
