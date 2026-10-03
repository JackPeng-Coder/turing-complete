import { describe, expect, it } from 'vitest';
import {
  CORNER_RADIUS,
  WIRE_STUB,
  cornerRadii,
  distanceToPath,
  longestSegment,
  pathLength,
  routeWire,
  type Point,
} from '../../src/ui/board/routing';
import { hitTest, pinPosition } from '../../src/ui/board/view';
import { planRoutes } from '../../src/ui/board/routes';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph } from '../../src/core/graph';

const registry = createRegistry(BASE_DEFS);

describe('routeWire', () => {
  it('is a single straight segment when both pins share a row', () => {
    expect(routeWire({ x: 0, y: 40 }, { x: 200, y: 40 })).toEqual([
      { x: 0, y: 40 },
      { x: 200, y: 40 },
    ]);
  });

  it('turns at the horizontal midpoint when the target is far enough right', () => {
    // Two corners, both at x = 100: the wire leaves the first pin to the right
    // and enters the second from the left, so neither pin is approached at an
    // angle.
    expect(routeWire({ x: 0, y: 0 }, { x: 200, y: 80 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 200, y: 80 },
    ]);
  });

  it('hooks around to the right when the target is behind the source', () => {
    // A feedback wire: `to` is LEFT of `from`, so a midpoint turn would make the
    // wire enter the input pin from its right-hand side. It runs out past both
    // pins instead and comes back.
    const route = routeWire({ x: 400, y: 0 }, { x: 100, y: 80 });
    expect(route).toEqual([
      { x: 400, y: 0 },
      { x: 416, y: 0 },
      { x: 416, y: 80 },
      { x: 100, y: 80 },
    ]);
    expect(route[1]!.x).toBe(Math.max(400, 100) + WIRE_STUB);
  });

  it('leaves a stub rather than turning on the pin when the gap is too small', () => {
    // 20 units of gap is less than two stubs, so a midpoint turn would put a
    // corner 10 units from each pin: a zigzag, not a route.
    const route = routeWire({ x: 0, y: 0 }, { x: 20, y: 40 });
    expect(route[1]!.x).toBe(20 + WIRE_STUB);
  });

  it('only ever turns at right angles', () => {
    const route = routeWire({ x: 0, y: 0 }, { x: 200, y: 80 });
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1]!;
      const b = route[i]!;
      expect(a.x === b.x || a.y === b.y, `segment ${i} is diagonal`).toBe(true);
    }
  });
});

describe('cornerRadii', () => {
  it('rounds interior corners by the constant and squares the ends', () => {
    const radii = cornerRadii(routeWire({ x: 0, y: 0 }, { x: 200, y: 80 }));
    expect(radii).toEqual([0, CORNER_RADIUS, CORNER_RADIUS, 0]);
  });

  it('clamps to half the shorter adjacent segment', () => {
    // An 8 unit first segment cannot host a radius of 8: `arcTo` would bulge
    // past the corner instead of rounding it.
    const radii = cornerRadii([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 200 },
      { x: 100, y: 200 },
    ]);
    expect(radii[1]).toBe(4);
    expect(radii[2]).toBe(CORNER_RADIUS);
  });

  it('never returns a negative radius, which `arcTo` rejects outright', () => {
    for (const r of cornerRadii([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])) {
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('longestSegment', () => {
  it('finds the run a value label can sit on', () => {
    const segment = longestSegment([
      { x: 400, y: 0 },
      { x: 416, y: 0 },
      { x: 416, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(segment?.length).toBe(316);
    expect(segment?.mid).toEqual({ x: 258, y: 100 });
  });

  it('is null for a path with no length', () => {
    expect(longestSegment([{ x: 5, y: 5 }])).toBeNull();
  });
});

describe('distanceToPath', () => {
  const route: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ];

  it('is zero on the path and grows off it', () => {
    expect(distanceToPath({ x: 50, y: 0 }, route)).toBe(0);
    expect(distanceToPath({ x: 100, y: 50 }, route)).toBe(0);
    expect(distanceToPath({ x: 50, y: 30 }, route)).toBe(30);
  });

  it('measures to the nearest segment, not to the ends', () => {
    expect(distanceToPath({ x: 150, y: 120 }, route)).toBe(20);
  });

  it('is the whole path length from one end to the other', () => {
    // 100 + 100 + 100: the path is three equal legs, not a 200 unit diagonal.
    expect(pathLength(route)).toBe(300);
  });
});

/**
 * The contract that ties routing to editing: what the board hit-tests has to be
 * what it draws. `view.ts` used to measure the straight chord under a wire, so a
 * player could click 50 units of empty paper and delete a wire -- or click the
 * wire they could see and select nothing.
 *
 * THE PROBES COME FROM THE PLAN, not from numbers and not from `routeWire`. The
 * router CHOOSES a shape now, and it may legitimately pick the straight-ish one:
 * an earlier version of this file probed the chord midpoint and passed only
 * because the old router hooked wide around the source. What the contract
 * actually says is "the hit test follows whatever the painter was given", so
 * that is what is tested -- and if the plan ever does run along the chord, the
 * test says so instead of quietly passing.
 */
describe('hit testing follows the routed wire', () => {
  function boardWithFeedbackWire() {
    const g = emptyGraph('test-routing');
    const source = addInstance(g, 'const_on', 400, 0);
    const sink = addInstance(g, 'level_output', 300, 100, 'OUT');
    connect(g, { inst: source.id, port: 'out' }, { inst: sink.id, port: 'in' });
    const a = pinPosition(source, registry.get('const_on'), 'out', false);
    const b = pinPosition(sink, registry.get('level_output'), 'in', true);
    return { g, a, b };
  }

  it('hits the wire on every corner the plan runs through', () => {
    const { g } = boardWithFeedbackWire();
    const plan = planRoutes(g, registry);
    const points = plan.get('w1')!;
    expect(points.length).toBeGreaterThan(2);
    // Interior vertices only: the two ends are the pins themselves, and a pin is
    // a smaller target than the wire that reaches it.
    for (const p of points.slice(1, -1)) {
      expect(hitTest(g, registry, p), `corner ${p.x},${p.y}`).toEqual({
        kind: 'wire',
        id: 'w1',
      });
    }
  });

  it('does not hit the wire where only the straight chord passes', () => {
    const { g, a, b } = boardWithFeedbackWire();
    const points = planRoutes(g, registry).get('w1')!;
    // A point ON the chord that is well off the route, found rather than
    // assumed: if the router ever draws the chord itself there is no such point,
    // and this fails rather than testing nothing.
    let probe: Point | null = null;
    for (let t = 0; t <= 1; t += 0.01) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (distanceToPath(p, points) > 12) {
        probe = p;
        break;
      }
    }
    expect(probe, 'the route never leaves the chord: nothing to test').not.toBeNull();
    // Not the wire. It may be a part -- the chord spends most of its length
    // inside the source's own body -- but it must not be the wire.
    expect(hitTest(g, registry, probe!)).not.toEqual({ kind: 'wire', id: 'w1' });
  });
});
