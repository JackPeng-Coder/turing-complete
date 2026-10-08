import { addInstance, connect, emptyGraph, type Graph } from '../core/graph';
import type { BoardInit } from './spec';

/**
 * Reads a level's starting circuit into an editable graph.
 *
 * The board is level data and a `Graph` is a document, so this is the seam
 * between them and the ONLY place a board's part indices mean anything. Two
 * details are decided here rather than in the data:
 *
 *  * AN UNNAMED PART IS NAMED BY THE KERNEL'S OWN RULE (`nextId`, through
 *    `addInstance`), so a board's parts come out as `i1`, `i2`, ... -- the ids
 *    the editor would have given them had the player placed them by hand. Level
 *    data cannot spell those ids because they do not exist until a graph does;
 *    the one exception is a part that already carries an `id`, which only the
 *    level's connectors need, since `levels/checks.ts` binds a level's pins as
 *    `IN_<pin>` / `OUT` by instance id.
 *  * A WIRE IS RESOLVED THROUGH THE PART LIST, not through the graph, so a board
 *    is wired entirely by index. A wire naming a part the board does not have is
 *    a malformed LEVEL, not a malformed circuit: it is refused here with the
 *    index in the message rather than allowed to become a wire to `undefined`,
 *    which `validateGraph` would report as a missing instance with no clue which
 *    part list was wrong.
 *
 * Nothing else is checked. Whether the defs and pins exist, whether an input is
 * driven twice and whether the result is a circuit at all is `validateGraph`'s
 * business, and it is the single place that judges that (`core/graph.ts`).
 */
export function graphFromBoard(level: string, board: BoardInit): Graph {
  const g = emptyGraph(level);
  for (const part of board.parts) {
    const inst = addInstance(g, part.def, part.x, part.y, part.id);
    // Written only when the board asks for a width: an absent `params.width` and
    // a `params.width` of `undefined` are different documents, and the second
    // one is not valid level data.
    if (part.width !== undefined) inst.params.width = part.width;
  }

  const idAt = (part: number): string => {
    const inst = g.instances[part];
    if (!inst) {
      throw new Error(`board wire names part ${part}, which the board does not have`);
    }
    return inst.id;
  };

  for (const wire of board.wires) {
    connect(
      g,
      { inst: idAt(wire.from.part), port: wire.from.port },
      { inst: idAt(wire.to.part), port: wire.to.port },
    );
  }
  return g;
}
