/**
 * Where a part and its pins actually are.
 *
 * Split out of `view.ts` when the wire router needed the same two functions:
 * the router has to know a part's rectangle to route around it, and `view.ts`
 * has to know the router to hit-test the polyline it produced. Leaving both in
 * `view.ts` would have made the two modules import each other -- a cycle that
 * works in ESM and is a trap for the next reader -- so the geometry everything
 * agrees on lives down here instead, and `view.ts` re-exports it so the board's
 * public geometry still arrives from one module.
 *
 * Pure: no DOM, no store, no canvas.
 */
import type { ComponentDef, Registry } from '../../core/registry';
import type { Graph, Instance } from '../../core/graph';
import { GRID, INSTANCE_HEIGHT, INSTANCE_WIDTH, PIN_SPACING } from '../theme';
import type { Point } from './routing';

/**
 * Blank paper above and below a part's outermost pin.
 *
 * Twelve, which is what makes three pins exactly 72: the registered height was
 * chosen when every part had three pins at most, and this is the same number
 * expressed as what it is FOR rather than as a total.
 */
const PIN_MARGIN = 12;

/** An axis-aligned rectangle in world units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Rounds to the 8 pixel grid.
 *
 * The `=== 0` branch normalises `-0` to `0`. `Math.round(-0.375)` is `-0` and
 * `-0 * 8` stays `-0`, so without it a part dropped just left of the origin
 * would store `-0` as its coordinate: `Object.is(-0, 0)` is false, which makes
 * every position comparison in the editor (and in tests) disagree about two
 * coordinates that are the same grid cell.
 */
export function snap(v: number): number {
  const snapped = Math.round(v / GRID) * GRID;
  return snapped === 0 ? 0 : snapped;
}

/** A part's body: the box every pin is laid out against. */
export function instanceRect(inst: Instance, def: ComponentDef): Rect {
  return { x: inst.x, y: inst.y, w: INSTANCE_WIDTH, h: instanceHeight(def) };
}

/**
 * How tall a part's body has to be to hold its own pins.
 *
 * A pin is a thing you aim at, so the pins keep their spacing and the BODY grows
 * to fit them: an eight-output splitter is a tall part, not a short part with six
 * pins hanging in space below it. That is what the board used to draw -- the
 * registered height was fixed at 72 and `pinPosition` spread the pins evenly
 * about the centre whatever the count, so anything with more than three pins on
 * an edge trailed a column of loose squares down the paper.
 *
 * Three pins is exactly 72, so every part that already fitted is unchanged: the
 * level connectors, every one-bit gate, and every wide operator, which has three
 * pins at most. What grows is what should have been tall all along -- the
 * splitter and the maker, the full adder, the wide storage and the machine.
 */
export function instanceHeight(def: ComponentDef): number {
  const pins = Math.max(def.inputs.length, def.outputs.length);
  return Math.max(INSTANCE_HEIGHT, (pins - 1) * PIN_SPACING + PIN_MARGIN * 2);
}

/** Pin layout: inputs along the left edge, outputs along the right edge. */
export function pinPosition(
  inst: Instance,
  def: ComponentDef,
  pinId: string,
  isInput: boolean,
): Point {
  const pins = isInput ? def.inputs : def.outputs;
  const index = pins.findIndex((p) => p.id === pinId);
  const count = Math.max(1, pins.length);
  const y = inst.y + instanceHeight(def) / 2 + (index - (count - 1) / 2) * PIN_SPACING;
  const x = isInput ? inst.x : inst.x + INSTANCE_WIDTH;
  return { x, y };
}

/** Every part on the board, as rectangles, for anything that has to avoid them. */
export function partRects(graph: Graph, registry: Registry): Rect[] {
  const rects: Rect[] = [];
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    rects.push(instanceRect(inst, registry.get(inst.def)));
  }
  return rects;
}

/**
 * Where a part dropped at `world` lands.
 *
 * The cursor becomes the part's left edge at its vertical centre -- the row of
 * its first output pin -- so the hand is already on the wire the player is about
 * to pull. Stated once because two things need it: the drop itself, and the
 * translucent ghost that shows where the drop will be. A ghost that previewed a
 * different position from the one the part took would be worse than no ghost.
 */
export function placementAt(world: Point, def: ComponentDef): Point {
  return { x: snap(world.x), y: snap(world.y - instanceHeight(def) / 2) };
}
