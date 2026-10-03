import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { instanceRect, pinPosition, type Rect } from '../../src/ui/board/geometry';
import { WIRE_CLEARANCE, forgetRoutes, planRoutes } from '../../src/ui/board/routes';
import type { Point } from '../../src/ui/board/routing';

/**
 * The wire router, and the two defects it was written for.
 *
 * Both were reported from a real board: a wire that ran straight through a gate
 * body and came out the other side, and two nets that settled five pixels apart
 * on the same grid line and read as one thick wire. Neither is visible in a unit
 * test of the OLD router, because the old router had no opinion about the board
 * it was drawing on -- so these tests build boards, not geometries.
 */
const registry = createRegistry(BASE_DEFS);

interface Span {
  readonly a: Point;
  readonly b: Point;
}

function segments(points: readonly Point[]): Span[] {
  const out: Span[] = [];
  for (let i = 1; i < points.length; i += 1) out.push({ a: points[i - 1]!, b: points[i]! });
  return out;
}

/**
 * How much of one segment lies strictly inside a rectangle.
 *
 * The rectangle is shrunk first, because a wire has to touch the body of the
 * part it is wired to: its last pixels run from the stub to the pin on the
 * body's edge, and counting that would fail every wire on the board.
 */
function insideRect(span: Span, r: Rect): number {
  const shrink = 1;
  const x0 = r.x + shrink;
  const x1 = r.x + r.w - shrink;
  const y0 = r.y + shrink;
  const y1 = r.y + r.h - shrink;
  if (span.a.y === span.b.y) {
    if (span.a.y <= y0 || span.a.y >= y1) return 0;
    return Math.max(
      0,
      Math.min(Math.max(span.a.x, span.b.x), x1) - Math.max(Math.min(span.a.x, span.b.x), x0),
    );
  }
  if (span.a.x === span.b.x) {
    if (span.a.x <= x0 || span.a.x >= x1) return 0;
    return Math.max(
      0,
      Math.min(Math.max(span.a.y, span.b.y), y1) - Math.max(Math.min(span.a.y, span.b.y), y0),
    );
  }
  return 0;
}

/** Total length two parallel runs share while closer than the clearance. */
function parallelOverlap(one: readonly Point[], other: readonly Point[]): number {
  let worst = 0;
  for (const s of segments(one)) {
    const horizontal = s.a.y === s.b.y;
    for (const t of segments(other)) {
      if ((t.a.y === t.b.y) !== horizontal) continue;
      const gap = horizontal ? Math.abs(s.a.y - t.a.y) : Math.abs(s.a.x - t.a.x);
      if (gap >= WIRE_CLEARANCE) continue;
      const [lo, hi] = horizontal
        ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]
        : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
      const [pLo, pHi] = horizontal
        ? [Math.min(t.a.x, t.b.x), Math.max(t.a.x, t.b.x)]
        : [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)];
      worst = Math.max(worst, Math.min(hi, pHi) - Math.max(lo, pLo));
    }
  }
  return worst;
}

/** Every part on the board, as rectangles. */
function partsOf(g: Graph): Rect[] {
  return g.instances
    .filter((i) => registry.has(i.def))
    .map((i) => instanceRect(i, registry.get(i.def)));
}

/** Wires `def`'s `port` from every source to every named target pin. */
function wire(
  g: Graph,
  from: { inst: string; port: string },
  to: { inst: string; port: string },
): void {
  connect(g, from, to);
}

describe('the router goes around parts, not through them', () => {
  /**
   * The reported defect, rebuilt: the source is to the RIGHT of the target and
   * one row down, so the shortest path hooks out to the right of both pins and
   * comes back left -- straight through a gate placed in that run. The old
   * router drew exactly that; the new one has to find its way around.
   */
  function blockedFeedback() {
    const g = emptyGraph('test-routes-blocked');
    const source = addInstance(g, 'const_on', 400, 0);
    const sink = addInstance(g, 'level_output', 100, 200, 'OUT');
    const blocker = addInstance(g, 'and', 250, 200);
    wire(g, { inst: source.id, port: 'out' }, { inst: sink.id, port: 'in' });
    return { g, blocker };
  }

  it('leaves no segment inside any part body', () => {
    const { g } = blockedFeedback();
    const plan = planRoutes(g, registry);
    const points = plan.get('w1')!;
    expect(points.length).toBeGreaterThan(2);
    for (const part of partsOf(g)) {
      for (const s of segments(points)) {
        expect(insideRect(s, part), `segment ${s.a.x},${s.a.y} runs through a part`).toBe(0);
      }
    }
  });

  it('still starts at the source pin and ends at the target pin', () => {
    // The detour must not cost the wire its endpoints: a route that misses a pin
    // is not a route, however pretty it looks.
    const { g } = blockedFeedback();
    const source = g.instances.find((i) => i.def === 'const_on')!;
    const sink = g.instances.find((i) => i.def === 'level_output')!;
    const points = planRoutes(g, registry).get('w1')!;
    expect(points[0]).toEqual(pinPosition(source, registry.get('const_on'), 'out', false));
    expect(points[points.length - 1]).toEqual(
      pinPosition(sink, registry.get('level_output'), 'in', true),
    );
  });

  it('plans a route for every wire, and only for wires', () => {
    const { g } = blockedFeedback();
    const plan = planRoutes(g, registry);
    expect([...plan.keys()]).toEqual(g.wires.map((w) => w.id));
  });
});

describe('the router keeps two nets apart', () => {
  /**
   * The other reported defect: two wires whose midpoint turns land on the same
   * grid line. Both sources are on the left, both targets on the right and lower,
   * so the two Z routes want the same vertical corridor, hundreds of pixels of it.
   */
  function sharedCorridor() {
    const g = emptyGraph('test-routes-corridor');
    const top = addInstance(g, 'const_on', 0, 0);
    const bottom = addInstance(g, 'const_on', 0, 96);
    const sink = addInstance(g, 'and', 400, 364);
    wire(g, { inst: top.id, port: 'out' }, { inst: sink.id, port: 'a' });
    wire(g, { inst: bottom.id, port: 'out' }, { inst: sink.id, port: 'b' });
    return g;
  }

  it('never leaves two runs within the clearance of each other', () => {
    const g = sharedCorridor();
    const plan = planRoutes(g, registry);
    const [one, two] = [plan.get('w1')!, plan.get('w2')!];
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(parallelOverlap(one, two)).toBe(0);
  });

  it('would have collided without the penalty, so the test proves something', () => {
    // The premise: the naive midpoint route really does share this corridor. If
    // the parts or the pin spacing ever move so that it no longer does, this
    // fails rather than letting the test above pass for free.
    const g = sharedCorridor();
    const [w1, w2] = g.wires;
    const pin = (instId: string, def: string, port: string, isInput: boolean): Point => {
      const inst = g.instances.find((i) => i.id === instId)!;
      return pinPosition(inst, registry.get(def), port, isInput);
    };
    const a1 = pin(w1!.from.inst, 'const_on', 'out', false);
    const b1 = pin(w1!.to.inst, 'and', 'a', true);
    const a2 = pin(w2!.from.inst, 'const_on', 'out', false);
    const b2 = pin(w2!.to.inst, 'and', 'b', true);
    const naive = (a: Point, b: Point): Point[] => {
      const x = (a.x + b.x) / 2;
      return [a, { x, y: a.y }, { x, y: b.y }, b];
    };
    expect(parallelOverlap(naive(a1, b1), naive(a2, b2))).toBeGreaterThan(100);
  });

  it('does not move a wire that is already on the board', () => {
    // Stability is the reason wires are planned in the order they were drawn: a
    // player who adds a wire must not watch the rest of the board rearrange.
    const g = emptyGraph('test-routes-stable');
    const top = addInstance(g, 'const_on', 0, 0);
    const sink = addInstance(g, 'and', 400, 364);
    wire(g, { inst: top.id, port: 'out' }, { inst: sink.id, port: 'a' });
    forgetRoutes();
    const before = planRoutes(g, registry).get('w1')!;

    const bottom = addInstance(g, 'const_on', 0, 96);
    wire(g, { inst: bottom.id, port: 'out' }, { inst: sink.id, port: 'b' });
    const after = planRoutes(g, registry).get('w1')!;
    expect(after).toEqual(before);
  });
});

/**
 * The router runs on every edit, and it is quadratic by nature: each wire is
 * scored against the parts near it and the wires already placed. The late-game
 * boards -- the CPU, the machine around it -- carry a couple of hundred parts and
 * as many wires, and a full replan there has to stay well inside a frame or
 * dragging a part around stops feeling like dragging.
 *
 * This is a budget, not a benchmark: it is set to catch the shape of a blowup
 * (a scan over every part for every candidate of every wire) rather than to
 * measure this machine.
 */
describe('the router stays inside its budget', () => {
  it('plans a board of two hundred parts and two hundred wires in one frame', () => {
    const g = emptyGraph('test-routes-big');
    const columns = 20;
    const rows = 10;
    let previous: string | null = null;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const inst = addInstance(g, 'nand', column * 120, row * 120);
        if (previous !== null) {
          wire(g, { inst: previous, port: 'out' }, { inst: inst.id, port: 'a' });
          wire(g, { inst: previous, port: 'out' }, { inst: inst.id, port: 'b' });
        }
        previous = inst.id;
      }
    }
    expect(g.instances).toHaveLength(columns * rows);
    expect(g.wires.length).toBeGreaterThan(300);

    forgetRoutes();
    const started = performance.now();
    const plan = planRoutes(g, registry);
    const elapsed = performance.now() - started;
    expect(plan.size).toBe(g.wires.length);
    expect(elapsed, `routing took ${Math.round(elapsed)}ms`).toBeLessThan(250);
  });
});
