/**
 * Wire routing: where a wire actually runs.
 *
 * The original game draws every wire as an orthogonal run with rounded corners,
 * never as a curve between two pins. That is a geometry decision, not a painting
 * one -- the same polyline has to answer three questions, so it is computed here
 * once and shared:
 *
 *   * what `render.ts` strokes,
 *   * what `view.ts` hit-tests, so clicking a wire clicks the line the player can
 *     see rather than the straight chord under it,
 *   * where a value label may sit, which is the longest segment.
 *
 * Pure geometry: no canvas, no store, no DOM. That is what makes it testable
 * without a browser, and it is why `Point` lives here rather than in `view.ts`
 * (`view.ts` re-exports it, so existing importers are unaffected).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How far a wire runs straight out of a pin before it is allowed to turn.
 *
 * A wire always leaves an output pin to the right and enters an input pin from
 * the left, so a pin never has a wire crossing its own edge at an angle. It is
 * also the clearance a backwards route needs: a wire that has to go behind its
 * own start turns after this much, not on the pin.
 */
export const WIRE_STUB = 16;

/** Rounding applied at a corner, clamped per corner by `cornerRadii`. */
export const CORNER_RADIUS = 8;

/**
 * The polyline from an output pin to an input pin, first point first.
 *
 * Two shapes, both orthogonal:
 *
 *   * Forwards (`to` far enough right of `from`): the wire turns once at the
 *     horizontal midpoint, the classic Z. The midpoint is what makes two wires
 *     between the same pair of columns run on top of each other instead of
 *     fanning out.
 *   * Backwards or cramped: the wire runs out to the right of BOTH pins and
 *     comes back into `to` from the left, so the incoming direction is still
 *     horizontal. Without this a feedback wire would have to enter the pin from
 *     the right, which reads as a wire arriving at a pin's back.
 *
 * A wire whose ends share a row is a single straight segment: no corner to
 * round, and no midpoint to invent.
 */
export function routeWire(from: Point, to: Point): Point[] {
  if (from.y === to.y) return [from, to];
  const forwards = to.x - from.x >= WIRE_STUB * 2;
  const turnX = forwards
    ? from.x + (to.x - from.x) / 2
    : Math.max(from.x, to.x) + WIRE_STUB;
  return [from, { x: turnX, y: from.y }, { x: turnX, y: to.y }, to];
}

/**
 * The rounding radius to use at each interior corner.
 *
 * `ctx.arcTo` does not clamp: a radius longer than the segment feeding it
 * produces a visible bulge instead of a corner. Two wires pinned close together
 * hit that constantly, so each corner gets half the shorter of its two adjacent
 * segments, capped at `CORNER_RADIUS`. End points get 0 -- nothing to round.
 */
export function cornerRadii(points: readonly Point[], max = CORNER_RADIUS): number[] {
  const radii = points.map(() => 0);
  for (let i = 1; i < points.length - 1; i += 1) {
    const before = segmentLength(points[i - 1]!, points[i]!);
    const after = segmentLength(points[i]!, points[i + 1]!);
    radii[i] = Math.max(0, Math.min(max, before / 2, after / 2));
  }
  return radii;
}

function segmentLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total length of the polyline. */
export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += segmentLength(points[i - 1]!, points[i]!);
  return total;
}

export interface Segment {
  readonly a: Point;
  readonly b: Point;
  readonly length: number;
  /** The segment's midpoint: where a value label goes. */
  readonly mid: Point;
}

/**
 * The longest segment of the polyline, or `null` for a path with no length.
 *
 * A label has to sit on a wire, and the only segment with room for one is the
 * longest -- a wire that goes straight from pin to pin turns this into the whole
 * wire, which is the case the player reads.
 */
export function longestSegment(points: readonly Point[]): Segment | null {
  let best: Segment | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = segmentLength(a, b);
    if (best && length <= best.length) continue;
    best = { a, b, length, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best;
}

/** Shortest distance from `p` to the segment `a`-`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from `p` to the polyline. */
export function distanceToPath(p: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!));
  }
  return best;
}
