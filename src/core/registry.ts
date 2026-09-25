import type { PortValue } from './signal';

export type ComponentCategory =
  | 'logic1'
  | 'memory1'
  | 'wide'
  | 'io'
  | 'display'
  | 'probe'
  | 'level';

export interface PinDef {
  readonly id: string;
  readonly width: number;
  readonly label?: { zh: string; en: string };
}

export interface EvalContext {
  readonly tick: number;
}

export interface ComponentDef {
  readonly id: string;
  readonly name: { zh: string; en: string };
  readonly category: ComponentCategory;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /**
   * DELAY cost: what one pass through this part costs the longest-path metric.
   * Sources and wires cost 0, every gate costs 1, and a wide part costs 1 as
   * well -- a `delayOf` node is a component, not a NAND (spec §3.2: 宽位组件
   * （如 8 位加法器）同样记为 1).
   *
   * This is NOT the gate metric. `cost` is read per node by `delayOf`
   * (`net.ts`) only; the gate metric counts NAND equivalents and reads
   * `gateCost` below.
   */
  readonly cost: number;
  /**
   * NAND-equivalent GATE cost: how many 2-input NAND gates this part expands to
   * once custom and wide components are flattened (spec §5.4). Read by
   * `gateCost()` in `levels/grader.ts` and by nothing else.
   *
   * The two metrics expand wide parts differently on purpose: an `add8` is one
   * unit of delay but 72 NAND equivalents, so this cannot share a field with
   * `cost`.
   *
   * Absent means "same as `cost`". That default is exactly right for the 1-bit
   * phase-0 family -- a NAND-based gate IS one NAND equivalent, and a source or
   * a level connector is zero -- so leaving it out keeps every existing level's
   * score byte-identical. Defs whose part is worth more than one NAND state it.
   */
  readonly gateCost?: number;
  /** Storage elements sample on the clock edge and do not add combinational delay. */
  readonly sequential: boolean;
  /**
   * Combinational transfer function: reads inputs, writes outputs, must be pure.
   *
   * Storage elements use it to PUBLISH the value they are holding: they read
   * `state` (the third parameter) and must never read `inputs`, otherwise a
   * delay line degrades into a wire. Combination components ignore `state` and
   * keep the two-argument `(i, o) => …` shape.
   *
   * `state` is typed `Uint8Array | undefined` rather than `Uint8Array` so that
   * a storage element cannot pretend it always has state. It is a required
   * parameter, not an optional one -- TypeScript rejects omitting it -- so
   * combinational call sites pass `undefined` explicitly.
   */
  readonly evaluate?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array | undefined,
    ctx: EvalContext,
  ) => void;
  /**
   * Storage update, applied at the clock edge from pre-edge inputs.
   * Samples into `state` only -- it must not write `outputs`, which are
   * published by `evaluate` (and by the kernel at reset/tick).
   */
  readonly clockEdge?: (
    inputs: readonly PortValue[],
    outputs: PortValue[],
    state: Uint8Array,
    ctx: EvalContext,
  ) => void;
  /** Bytes of private state per instance. 0 for pure combinational defs. */
  readonly stateBytes: number;
  /** Hidden from the palette (used by level plumbing). */
  readonly hidden?: boolean;
}

export interface Registry {
  readonly size: number;
  get(id: string): ComponentDef;
  has(id: string): boolean;
  all(): readonly ComponentDef[];
  byCategory(category: ComponentCategory): readonly ComponentDef[];
  register(def: ComponentDef): void;
}

export function createRegistry(defs: readonly ComponentDef[] = []): Registry {
  const map = new Map<string, ComponentDef>();
  const registry: Registry = {
    get size() {
      return map.size;
    },
    get(id: string): ComponentDef {
      const def = map.get(id);
      if (!def) throw new Error(`unknown component: ${id}`);
      return def;
    },
    has: (id: string) => map.has(id),
    all: () => [...map.values()],
    byCategory: (category) => [...map.values()].filter((d) => d.category === category),
    register(def: ComponentDef): void {
      if (map.has(def.id)) throw new Error(`duplicate component id: ${def.id}`);
      map.set(def.id, def);
    },
  };
  for (const def of defs) registry.register(def);
  return registry;
}
