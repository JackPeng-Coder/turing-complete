import { addInstance, connect, emptyGraph, type Graph, type Instance } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';

export const registry = createRegistry(BASE_DEFS);

export type Node =
  | { readonly kind: 'input'; readonly name: string; readonly width?: number }
  | { readonly kind: 'part'; readonly def: string; readonly id: string; readonly from: readonly string[] }
  | { readonly kind: 'output'; readonly name?: string; readonly from: string; readonly width?: number };

/**
 * Carries a declared level-pin width onto its instance.
 *
 * `level_input` / `level_output` declare 1-bit pins, so the width a level's pin
 * actually has exists only on the instance (`params.width`) -- these are exactly
 * the values the palette's drop path writes (`ui/board/interact.ts`). Leaving
 * `width` out means the def's 1 bit, which is what every Phase-0 circuit built
 * by this fixture relies on. Wide *components* need nothing here: Task 3's wide
 * defs declare their own pin widths.
 */
function setWidth(inst: Instance, width: number | undefined): void {
  if (width !== undefined) inst.params.width = width;
}

/**
 * Builds a circuit from a flat declaration list.
 *
 * `from` entries resolve as: a level input name (`IN_<name>.out`), a part id
 * (`.out`), or an explicit `"partId.pin"`. When a part has more inputs than
 * `from` entries, the last entry is reused -- that is how a NOT gets wired
 * from a single source.
 *
 * Level inputs are instances named `IN_<name>`; level outputs are instances
 * named `OUT` (single output) or `OUT_<name>` (multi-output). Either may declare
 * the width of its level pin, and it is written to the instance as
 * `params.width` so `levels/checks.ts` can bind it at the width the level asks
 * for.
 */
export function build(nodes: readonly Node[]): Graph {
  const g = emptyGraph();
  const inputIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const outputIds = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind === 'input') {
      const inst = addInstance(g, 'level_input', 0, 0, `IN_${node.name}`);
      setWidth(inst, node.width);
      inputIds.set(node.name, inst.id);
    } else if (node.kind === 'part') {
      partIds.set(node.id, addInstance(g, node.def, 120, 0).id);
    } else {
      const name = node.name ?? 'OUT';
      const inst = addInstance(g, 'level_output', 240, 0, name);
      setWidth(inst, node.width);
      outputIds.set(name, inst.id);
    }
  }

  const resolve = (ref: string): { inst: string; port: string } => {
    const [head, pin] = ref.split('.') as [string, string?];
    const inputId = inputIds.get(head!);
    if (inputId) return { inst: inputId, port: 'out' };
    const partId = partIds.get(head!);
    if (!partId) throw new Error(`build: unknown reference "${ref}"`);
    return { inst: partId, port: pin ?? 'out' };
  };

  for (const node of nodes) {
    if (node.kind !== 'part') continue;
    const inst = partIds.get(node.id)!;
    const def = registry.get(node.def);
    def.inputs.forEach((pin, index) => {
      const ref = node.from[Math.min(index, node.from.length - 1)];
      if (ref === undefined) return;
      connect(g, resolve(ref), { inst, port: pin.id });
    });
  }

  for (const node of nodes) {
    if (node.kind !== 'output') continue;
    const inst = outputIds.get(node.name ?? 'OUT')!;
    connect(g, resolve(node.from), { inst, port: 'in' });
  }

  return g;
}
