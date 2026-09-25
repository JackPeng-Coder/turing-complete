import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { BASE_DEFS } from '../../src/core/defs/index';
import { createRegistry } from '../../src/core/registry';

export const registry = createRegistry(BASE_DEFS);

export type Node =
  | { readonly kind: 'input'; readonly name: string }
  | { readonly kind: 'part'; readonly def: string; readonly id: string; readonly from: readonly string[] }
  | { readonly kind: 'output'; readonly name?: string; readonly from: string };

/**
 * Builds a circuit from a flat declaration list.
 *
 * `from` entries resolve as: a level input name (`IN_<name>.out`), a part id
 * (`.out`), or an explicit `"partId.pin"`. When a part has more inputs than
 * `from` entries, the last entry is reused -- that is how a NOT gets wired
 * from a single source.
 *
 * Level inputs are instances named `IN_<name>`; level outputs are instances
 * named `OUT` (single output) or `OUT_<name>` (multi-output).
 */
export function build(nodes: readonly Node[]): Graph {
  const g = emptyGraph();
  const inputIds = new Map<string, string>();
  const partIds = new Map<string, string>();
  const outputIds = new Map<string, string>();

  for (const node of nodes) {
    if (node.kind === 'input') {
      inputIds.set(node.name, addInstance(g, 'level_input', 0, 0, `IN_${node.name}`).id);
    } else if (node.kind === 'part') {
      partIds.set(node.id, addInstance(g, node.def, 120, 0).id);
    } else {
      const name = node.name ?? 'OUT';
      outputIds.set(name, addInstance(g, 'level_output', 240, 0, name).id);
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
