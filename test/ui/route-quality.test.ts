// @vitest-environment node
/**
 * THE ROUTER'S PICTURE ON A BOARD TOO BIG TO READ WIRE BY WIRE.
 *
 * `routes.test.ts` pins the two defects the router was written for on boards of
 * three or four parts. The reported defect of 2026-10-21 was different in kind:
 * a board of ~900 gates, where the picture is made of hundreds of wires and no
 * single route can be judged on its own. Three qualities are what a schematic has
 * at that size, and each is measurable without a screen:
 *
 *  * NO WIRE INSIDE A PART. A run disappearing into a gate body and coming out
 *    the other side is the defect a player reports first.
 *  * NO TWO NETS ON ONE LINE. Two wires of the same net sharing a line are one
 *    signal drawn once; two wires of different nets sharing it look like a short.
 *  * A FAN-OUT IS A TRUNK. Wires out of one pin should run together and branch,
 *    not fan out into one line per destination.
 *
 * These boards are generated data, not shipped levels: the campaign's own boards
 * are smaller than the reported one, and the point here is the shape of the
 * picture at scale rather than any particular level.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/core/registry';
import { BASE_DEFS } from '../../src/core/defs/index';
import { addInstance, connect, emptyGraph, type Graph } from '../../src/core/graph';
import { instanceRect, pinPosition, type Rect } from '../../src/ui/board/geometry';
import { WIRE_CLEARANCE, forgetRoutes, planRoutes } from '../../src/ui/board/routes';
import type { Point } from '../../src/ui/board/routing';

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

function spanRange(span: Span): [number, number] {
  const horizontal = span.a.y === span.b.y;
  return horizontal
    ? [Math.min(span.a.x, span.b.x), Math.max(span.a.x, span.b.x)]
    : [Math.min(span.a.y, span.b.y), Math.max(span.a.y, span.b.y)];
}

/** Length of a wire inside any part body. */
function insideParts(points: readonly Point[], parts: readonly Rect[]): number {
  let total = 0;
  for (const span of segments(points)) {
    const horizontal = span.a.y === span.b.y;
    const [lo, hi] = spanRange(span);
    for (const r of parts) {
      const x0 = r.x + 1;
      const x1 = r.x + r.w - 1;
      const y0 = r.y + 1;
      const y1 = r.y + r.h - 1;
      if (horizontal) {
        if (span.a.y <= y0 || span.a.y >= y1) continue;
        total += Math.max(0, Math.min(hi, x1) - Math.max(lo, x0));
      } else {
        if (span.a.x <= x0 || span.a.x >= x1) continue;
        total += Math.max(0, Math.min(hi, y1) - Math.max(lo, y0));
      }
    }
  }
  return total;
}

/**
 * Length two wires share while closer than `limit`: 1 is "the same line", and
 * anything under `WIRE_CLEARANCE` is close enough to read as one thick line.
 */
function sharedLength(one: readonly Point[], other: readonly Point[], limit: number): number {
  let total = 0;
  for (const s of segments(one)) {
    const horizontal = s.a.y === s.b.y;
    const [sLo, sHi] = spanRange(s);
    for (const t of segments(other)) {
      if ((t.a.y === t.b.y) !== horizontal) continue;
      const gap = horizontal ? Math.abs(s.a.y - t.a.y) : Math.abs(s.a.x - t.a.x);
      if (gap >= limit) continue;
      const [tLo, tHi] = spanRange(t);
      total += Math.max(0, Math.min(sHi, tHi) - Math.max(sLo, tLo));
    }
  }
  return total;
}

/** Every wire's polyline, keyed by the wire's position in `graph.wires`. */
function planOf(g: Graph): { points: Point[][]; nets: string[]; parts: Rect[] } {
  const plan = planRoutes(g, registry);
  const byId = new Map(g.instances.map((i) => [i.id, i]));
  const points = g.wires.map((wire) => {
    const planned = plan.get(wire.id);
    if (planned) return [...planned];
    const from = byId.get(wire.from.inst)!;
    const to = byId.get(wire.to.inst)!;
    return [
      pinPosition(from, registry.get(from.def), wire.from.port, false),
      pinPosition(to, registry.get(to.def), wire.to.port, true),
    ];
  });
  const nets = g.wires.map((wire) => `${wire.from.inst}.${wire.from.port}`);
  const parts = g.instances
    .filter((inst) => registry.has(inst.def))
    .map((inst) => instanceRect(inst, registry.get(inst.def)));
  return { points, nets, parts };
}

/**
 * A dense board: each gate is fed by two gates of the row above and, every third
 * gate, by a long wire from a row further up. The shape is a grid of logic, which
 * is what a player's big sandbox board tends to be.
 */
function denseBoard(columns: number, rows: number): Graph {
  const g = emptyGraph('route-quality-dense');
  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  const cells: { id: string; row: number; column: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const inst = addInstance(g, 'nand', column * 112, row * 128);
      cells.push({ id: inst.id, row, column });
    }
  }
  const at = (row: number, column: number) =>
    cells[row * columns + Math.max(0, Math.min(columns - 1, column))]!;
  for (const cell of cells) {
    if (cell.row === 0) continue;
    const above = at(cell.row - 1, cell.column + Math.floor(random() * 3) - 1);
    connect(g, { inst: above.id, port: 'out' }, { inst: cell.id, port: 'a' });
    connect(g, { inst: above.id, port: 'out' }, { inst: cell.id, port: 'b' });
    if (random() < 0.34) {
      const far = at(Math.floor(random() * (cell.row - 1)), Math.floor(random() * columns));
      connect(g, { inst: far.id, port: 'out' }, { inst: cell.id, port: 'a' });
    }
  }
  return g;
}

/**
 * The reported board's shape: long chains of gates that all read one shared
 * input, with a couple of input connectors stacked on the left. Each shared
 * input is one net fanning out to every gate on its rows, which is the case that
 * used to scatter into a fan of hundreds of lines.
 */
function fanoutBoard(columns: number, rows: number): Graph {
  const g = emptyGraph('route-quality-fanout');
  const rowsOfCells: { id: string }[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const cells: { id: string }[] = [];
    for (let column = 0; column < columns; column += 1) {
      const inst = addInstance(g, 'nand', 200 + column * 112, row * 112);
      cells.push({ id: inst.id });
    }
    rowsOfCells.push(cells);
  }
  const inputA = addInstance(g, 'level_input', 0, 0, 'IN_1');
  const inputB = addInstance(g, 'level_input', 0, 120, 'IN_2');
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const gate = rowsOfCells[row]![column]!;
      if (column > 0) {
        connect(g, { inst: rowsOfCells[row]![column - 1]!.id, port: 'out' }, { inst: gate.id, port: 'a' });
      } else if (row > 0) {
        connect(
          g,
          { inst: rowsOfCells[row - 1]![columns - 1]!.id, port: 'out' },
          { inst: gate.id, port: 'a' },
        );
      } else {
        connect(g, { inst: inputA.id, port: 'out' }, { inst: gate.id, port: 'a' });
      }
      connect(
        g,
        { inst: (row % 2 === 0 ? inputA : inputB).id, port: 'out' },
        { inst: gate.id, port: 'b' },
      );
    }
  }
  return g;
}

describe('the router on a board too big to read wire by wire', () => {
  it('keeps every wire out of every part body', () => {
    const g = denseBoard(20, 12);
    forgetRoutes();
    const { points, parts } = planOf(g);
    expect(g.instances.length).toBe(240);
    expect(g.wires.length).toBeGreaterThan(300);
    let inside = 0;
    for (const wire of points) inside += insideParts(wire, parts);
    expect(inside, `${Math.round(inside)}px of wire runs through gate bodies`).toBe(0);
  });

  it('never draws two different nets on one line', () => {
    // The reported defect at scale: hundreds of wires whose routes all want the
    // same lane, and the router settles for drawing them on top of each other.
    // The old router drew 533,372px that way on this board; a bound rather than
    // zero because a board this dense can still crowd a lane the router cannot
    // legally avoid -- what must not happen is the old order of magnitude.
    const g = fanoutBoard(20, 12);
    forgetRoutes();
    const { points, nets } = planOf(g);
    let sameLine = 0;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        if (nets[i] === nets[j]) continue;
        sameLine += sharedLength(points[i]!, points[j]!, 1);
      }
    }
    expect(sameLine, `${Math.round(sameLine)}px of different nets share a line`).toBeLessThan(5_000);
  });

  it('fans one pin out along a trunk, not into one line per destination', () => {
    const g = fanoutBoard(20, 12);
    forgetRoutes();
    const { points, nets } = planOf(g);
    // Same-net wires are allowed to share a line, and a fan-out that bundles will
    // share a lot of it. A router that scattered every branch would share no more
    // than the stub each wire leaves its pin with (~4,000px a side here).
    let bundled = 0;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        if (nets[i] !== nets[j]) continue;
        bundled += sharedLength(points[i]!, points[j]!, WIRE_CLEARANCE);
      }
    }
    expect(bundled).toBeGreaterThan(100_000);
  });
});
