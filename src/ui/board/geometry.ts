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
export function instanceRect(inst: Instance): Rect {
  return { x: inst.x, y: inst.y, w: INSTANCE_WIDTH, h: INSTANCE_HEIGHT };
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
  const y = inst.y + INSTANCE_HEIGHT / 2 + (index - (count - 1) / 2) * PIN_SPACING;
  const x = isInput ? inst.x : inst.x + INSTANCE_WIDTH;
  return { x, y };
}

/** Every part on the board, as rectangles, for anything that has to avoid them. */
export function partRects(graph: Graph, registry: Registry): Rect[] {
  const rects: Rect[] = [];
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    rects.push(instanceRect(inst));
  }
  return rects;
}
