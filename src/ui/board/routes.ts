/**
 * Where every wire on the board actually runs.
 *
 * `routing.ts` answers "what is the shortest orthogonal path between these two
 * pins", which is all a wire needs when it is the only thing on the board. It is
 * not enough for a board with parts and other wires on it, and the two ways it
 * falls short are both visible:
 *
 *   * A wire whose target is to the LEFT of its source took the router's
 *     backwards path -- out to the right of both pins, then a long straight run
 *     back left -- and that run went straight THROUGH whatever parts stood in the
 *     way. The player saw a wire disappear into a gate's body and reappear on the
 *     other side, with no way to tell it was the same wire.
 *   * Two wires between neighbouring rows both took the midpoint turn and landed
 *     five pixels apart on the same grid line. At eight pixels wide plus a halo,
 *     two wires that close are one thick wire, and a board where two nets look
 *     like one net is a board that reads as shorted.
 *
 * So routing is a CHOICE, and this module makes it: a handful of orthogonal
 * candidates per wire, scored against every part and every wire already placed,
 * cheapest wins. The weights are the whole policy --
 *
 *   * crossing a part body is priced to be avoided at any detour,
 *   * running alongside another wire within `WIRE_CLEARANCE` is priced next,
 *   * length and corners are the tie-breakers, so a wire still goes roughly where
 *     a player would have drawn it.
 *
 * CROSSINGS ARE NOT PRICED, deliberately. Two wires meeting at right angles are
 * two wires, and every schematic is full of them; charging for it buys nothing
 * and the router cannot afford to look everywhere it would have to look to count
 * them (see the lane index below).
 *
 * ONE SIGNAL, ONE LINE -- THE EXPERIMENT OF 2026-10-21. On a board built from
 * hundreds of gates, the reported defect was not one wrong wire but a picture:
 * long wires wandered across the board through gate bodies, and fan-out trunks
 * from the same pin were scattered into dozens of parallel lines. Two changes
 * address it, and both are stated in the weights below:
 *
 *   * A run of a net counts ONCE against a new route, not once per wire: a fan-out
 *     trunk is one drawn line, and pricing it as fifty lines pushed the next wire
 *     through a gate rather than beside it (`LaneIndex` merges per net as it
 *     adds).
 *   * A run of the SAME net costs nothing to follow and counts as nothing to
 *     cross, because two wires out of one pin are one signal. That is what turns
 *     a fan-out into a trunk instead of a fan.
 *
 * The measured effect on a synthetic 900-gate board is in the phase record
 * (`.superpowers/sdd/2026-10-21-routing/`): routes through part bodies went from
 * hundreds of wires to none, and different-net wires drawn on top of each other
 * almost disappeared.
 *
 * IT IS THE SAME POLYLINE THE HIT TEST USES. `view.ts` calls this, `render.ts`
 * calls this, and the memo is keyed on the graph, so the wire you click is the
 * wire you can see even after it has been routed around a gate.
 *
 * Order matters and is not incidental: wires are planned in the order the player
 * made them, so an existing wire keeps the lane it has and a new one goes around
 * it. Drawing a new wire never moves the ones already on the board.
 */
import type { Graph } from '../../core/graph';
import type { Registry } from '../../core/registry';
import { GRID } from '../theme';
import { partRects, pinPosition, snap, type Rect } from './geometry';
import { WIRE_STUB, type Point } from './routing';

/**
 * How far apart two parallel wires have to be to read as two wires.
 *
 * A 1-bit wire is 8 world pixels wide and is drawn over a wider translucent
 * stroke; 16 is the first grid multiple at which neither the cores nor their
 * halos touch. Closer than that, two runs are priced as one.
 */
export const WIRE_CLEARANCE = 16;

/** What the router is willing to pay, in world pixels, and for what. */
export const ROUTE_COST = {
  /** One more corner, worth this much detour. */
  bend: 26,
  /**
   * Per pixel of a run that crosses a part body.
   *
   * Four hundred is deliberately high: on a dense board a route that cuts through
   * one gate saves at most a couple of hundred pixels, so any lane that is merely
   * crowded is still cheaper than a hole in the schematic.
   */
  part: 400,
  /**
   * Per pixel of a run that lies within `WIRE_CLEARANCE` of a parallel run of a
   * DIFFERENT net.
   *
   * A run of the SAME net is free: wires out of one pin are one signal, and a
   * fan-out is many wires that should run together -- two of them lying on top of
   * each other is correct drawing rather than a short (`costOf`).
   *
   * TWENTY-FOUR, DOWN FROM A HUNDRED AND TWENTY. The old price made a crowded lane
   * cost more than cutting through a gate body, so on a board where every useful
   * lane is crowded the router chose the hole. With nets counted once
   * (`LaneIndex`) the price can be low enough to make "run beside it" the answer
   * without letting two nets sit close enough to read as one thick wire.
   */
  parallel: 24,
  /**
   * How far outside a body edge a lane candidate is offered, and how far the
   * body is grown before a run counts as crossing it.
   *
   * Both are about the HALO, not the wire: a run is eight pixels of core under
   * sixteen of glow, so a lane that clears the body by four pixels still looks
   * like it is touching it. Twelve out and eight grown leaves the glow clear.
   */
  lane: 12,
  body: 8,
} as const;

/**
 * How many lanes one direction may offer before scoring.
 *
 * Fourteen, because the lanes that matter are often NOT the ones nearest the
 * midpoint: a wire that has to get past a part standing in its corridor needs
 * the lane just outside that part, and that lane can be a hundred pixels from
 * the middle. Cap this too low and the router never sees the way around and
 * settles for ploughing through -- which is the defect this module exists to fix.
 *
 * The cap is also the router's performance knob: candidates are scored against
 * every nearby part, so the cost is linear in this number, and it shows up
 * directly in how a part drag feels on the biggest boards (see the budget test).
 * Fourteen was the knee on the reported board: sixteen bought almost nothing and
 * ten lost lanes the router needed.
 */
const MAX_LANES = 14;

/** How far outside the pins' own box a part can still matter to a route. */
const NEARBY = 128 + WIRE_STUB;

/** Interior points of one candidate path, as offsets between the two stubs. */
function path(a: Point, b: Point, middle: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of [a, ...middle, b]) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** True when `[lo, hi]` overlaps `[rLo, rHi]`. */
function spans(lo: number, hi: number, rLo: number, rHi: number): boolean {
  return Math.max(lo, hi) >= rLo && Math.min(lo, hi) <= rHi;
}

/**
 * The lanes worth trying in one direction, nearest the midpoint first.
 *
 * The candidates the old router would have produced anyway (both stub
 * coordinates, the midpoint and the quarters) plus, for every part standing in
 * the corridor, the two lanes just outside it. That last group is what lets a
 * wire thread a gap between two gates instead of ploughing through one.
 *
 * Sorted by distance from the midpoint before the cap, so the shapes a player
 * would draw survive the cut and the exotic ones do not.
 */
function lanes(values: readonly number[], centre: number): number[] {
  const unique = [...new Set(values.map((v) => snap(v)))];
  unique.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
  return unique.slice(0, MAX_LANES);
}

/**
 * Every orthogonal route between two pins that is worth scoring, stubs
 * included, first point at `from` and last at `to`.
 *
 * Two families, because which one is right depends on what is in the way: a run
 * that turns on a vertical lane (`x`), and one that turns on a horizontal lane
 * (`y`). The plain L-shapes fall out of both for free -- a lane drawn at the far
 * stub's own coordinate collapses one of the two bends.
 *
 * TRACKS, NOT LANES. A gap between two bodies is 2 x `lane` wide on a compact
 * board, which is exactly one `WIRE_CLEARANCE`, so each part edge offers TWO
 * candidates a clearance apart: the lane just outside the body and the track
 * beside it. Without the second, two nets whose natural lanes coincide have no
 * legal side-by-side position and the cheaper answer is one drawn on top of the
 * other -- which reads as a short.
 *
 * The vertical family has two more shapes for the same reason: its vertical
 * column used to be the source stub's own x, a single line every wire from that
 * pin column wanted. One variant moves the trunk beside it
 * (`start.x + WIRE_CLEARANCE`), which keeps two stacked input connectors apart;
 * the other moves the DESCENT, the last vertical into the target pin, one track
 * left (`end.x - WIRE_CLEARANCE`), which keeps two wires that arrive at the same
 * gate column from sharing the last run into their pins. Each costs a couple of
 * pixels of length and nothing else.
 */
export function candidateRoutes(from: Point, to: Point, parts: readonly Rect[]): Point[][] {
  const start = { x: from.x + WIRE_STUB, y: from.y };
  const end = { x: to.x - WIRE_STUB, y: to.y };
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const lane = ROUTE_COST.lane;
  // Two tracks per gap, one WIRE_CLEARANCE apart: a candidate that has one other
  // net on the near track can move to the far one and still be a separate line
  // rather than a thicker one (`near` counts nets, not wires, so the two tracks
  // are what spatial separation comes from).
  const track = lane + WIRE_CLEARANCE;

  const xs = lanes(
    [
      start.x,
      start.x + WIRE_CLEARANCE,
      end.x,
      end.x - WIRE_CLEARANCE,
      midX,
      (start.x * 3 + end.x) / 4,
      (start.x + end.x * 3) / 4,
      Math.max(start.x, end.x) + WIRE_STUB,
      Math.min(start.x, end.x) - WIRE_STUB,
      ...parts
        .filter((r) => spans(start.y, end.y, r.y, r.y + r.h))
        .flatMap((r) => [r.x - lane, r.x + r.w + lane, r.x - track, r.x + r.w + track]),
    ],
    midX,
  );
  const ys = lanes(
    [
      start.y,
      start.y + WIRE_CLEARANCE,
      start.y - WIRE_CLEARANCE,
      end.y,
      end.y + WIRE_CLEARANCE,
      end.y - WIRE_CLEARANCE,
      midY,
      (start.y * 3 + end.y) / 4,
      (start.y + end.y * 3) / 4,
      Math.max(start.y, end.y) + WIRE_STUB,
      Math.min(start.y, end.y) - WIRE_STUB,
      ...parts
        .filter((r) => spans(start.x, end.x, r.x, r.x + r.w))
        .flatMap((r) => [r.y - lane, r.y + r.h + lane, r.y - track, r.y + r.h + track]),
    ],
    midY,
  );

  return [
    ...xs.map((x) => path(from, to, [start, { x, y: start.y }, { x, y: end.y }, end])),
    // The vertical family's two columns are tracks too, not fixed lines: two
    // nets whose sources share a pin column (a row of connectors, a gate row) both
    // want the vertical just right of that column, and without a track beside it
    // the second wire is drawn exactly on top of the first -- one visible line
    // carrying two signals. The horizontal room is unchanged; only the vertical
    // column moves, so the cost is two extra pixels of length and nothing else.
    ...ys.flatMap((y) => [
      path(from, to, [start, { x: start.x, y }, { x: end.x, y }, end]),
      path(from, to, [
        start,
        { x: start.x + WIRE_CLEARANCE, y: start.y },
        { x: start.x + WIRE_CLEARANCE, y },
        { x: end.x, y },
        end,
      ]),
      path(from, to, [
        start,
        { x: start.x, y },
        { x: end.x - WIRE_CLEARANCE, y },
        { x: end.x - WIRE_CLEARANCE, y: end.y },
        end,
      ]),
    ]),
  ];
}

/**
 * How much of an axis-aligned segment lies inside a rectangle.
 *
 * The rectangle is grown by `ROUTE_COST.body` first. A wire genuinely has to
 * touch the body of the part it is wired to -- its last sixteen pixels run from
 * the stub to the pin on the body's edge -- and charging for that would charge
 * every candidate equally. Charging for running ALONG an edge, or for squeezing
 * past one with the halo overlapping it, is the point.
 */
function insideRect(a: Point, b: Point, r: Rect): number {
  const inflate = ROUTE_COST.body;
  const x0 = r.x - inflate;
  const x1 = r.x + r.w + inflate;
  const y0 = r.y - inflate;
  const y1 = r.y + r.h + inflate;
  if (a.y === b.y) {
    if (a.y <= y0 || a.y >= y1) return 0;
    return Math.max(0, Math.min(Math.max(a.x, b.x), x1) - Math.max(Math.min(a.x, b.x), x0));
  }
  if (a.x === b.x) {
    if (a.x <= x0 || a.x >= x1) return 0;
    return Math.max(0, Math.min(Math.max(a.y, b.y), y1) - Math.max(Math.min(a.y, b.y), y0));
  }
  return 0;
}

/** One placed run of wire: what a later candidate is scored against. */
interface Placed {
  readonly coord: number;
  readonly lo: number;
  readonly hi: number;
  readonly horizontal: boolean;
  /** The output pin this run carries, so fan-out wires can share a trunk. */
  readonly net: string;
}

/**
 * Placed runs indexed by the lane they occupy, so scoring stays local.
 *
 * A candidate segment can only conflict with a parallel run whose perpendicular
 * coordinate is within `WIRE_CLEARANCE`, so bucketing by that coordinate -- one
 * grid step per bucket, three buckets either way -- turns a whole-board scan into
 * a handful of lookups. It has to be local: the late-game boards carry thousands
 * of segments, and this runs once per wire per edit.
 *
 * ONE ENTRY PER NET PER BUCKET, merged as it is added -- not one per wire. A
 * fan-out trunk is hundreds of wires on the same lane and the same net, drawn as
 * ONE line; storing them wire by wire makes every later candidate scan the whole
 * trunk and would price a lane as hundreds of lines deep, which is the defect
 * this tap exists to fix. Merging on the way in also keeps the index small, which
 * is what lets the scoring afford more candidate lanes.
 */
export class LaneIndex {
  private readonly buckets = new Map<string, Map<string, Run>>();

  add(segments: readonly Placed[]): void {
    for (const segment of segments) {
      const key = bucketKey(segment.horizontal, bucketOf(segment.coord));
      let byNet = this.buckets.get(key);
      if (byNet === undefined) {
        byNet = new Map();
        this.buckets.set(key, byNet);
      }
      const merged = byNet.get(segment.net);
      if (merged === undefined) {
        byNet.set(segment.net, { coord: segment.coord, lo: segment.lo, hi: segment.hi });
      } else {
        merged.lo = Math.min(merged.lo, segment.lo);
        merged.hi = Math.max(merged.hi, segment.hi);
      }
    }
  }

  /**
   * The parallel runs close enough to merge with a segment on this lane.
   *
   * One reading per net and span: `costOf` asks "how many distinct lines would
   * this run sit beside", which is what the player sees.
   */
  near(horizontal: boolean, coord: number, lo: number, hi: number): Placed[] {
    const bucket = bucketOf(coord);
    let byNet: Map<string, Run> | null = null;
    for (let offset = -3; offset <= 3; offset += 1) {
      const runs = this.buckets.get(bucketKey(horizontal, bucket + offset));
      if (runs === undefined) continue;
      for (const [net, run] of runs) {
        if (Math.abs(run.coord - coord) >= WIRE_CLEARANCE) continue;
        if (Math.min(hi, run.hi) - Math.max(lo, run.lo) <= 0) continue;
        if (byNet === null) byNet = new Map();
        const merged = byNet.get(net);
        if (merged === undefined) byNet.set(net, { ...run });
        else {
          merged.lo = Math.min(merged.lo, run.lo);
          merged.hi = Math.max(merged.hi, run.hi);
        }
      }
    }
    if (byNet === null) return [];
    const found: Placed[] = [];
    for (const [net, run] of byNet) {
      found.push({ horizontal, coord: run.coord, lo: run.lo, hi: run.hi, net });
    }
    return found;
  }
}

interface Run {
  coord: number;
  lo: number;
  hi: number;
}

function bucketOf(coord: number): number {
  return Math.round(coord / GRID);
}

function bucketKey(horizontal: boolean, bucket: number): string {
  return `${horizontal ? 'h' : 'v'}${bucket}`;
}

function segmentsOf(points: readonly Point[], net: string): Placed[] {
  const out: Placed[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x === b.x && a.y === b.y) continue;
    const horizontal = a.y === b.y;
    out.push({
      horizontal,
      coord: horizontal ? a.y : a.x,
      lo: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      hi: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      net,
    });
  }
  return out;
}

/** True corners: direction changes, not raw point count (a collinear point is not a bend). */
function cornersOf(points: readonly Point[]): number {
  let corners = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const abHorizontal = a.y === b.y;
    const bcHorizontal = b.y === c.y;
    if (abHorizontal !== bcHorizontal) corners += 1;
  }
  return corners;
}

/** What a candidate costs: its length, its corners, and everything it hits. */
function costOf(
  points: readonly Point[],
  parts: readonly Rect[],
  lanes: LaneIndex,
  net: string,
): number {
  let cost = ROUTE_COST.bend * cornersOf(points);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const horizontal = a.y === b.y;
    const lo = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const hi = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const coord = horizontal ? a.y : a.x;
    cost += hi - lo;

    // Cheap rejects first: a segment can only touch what its own box reaches.
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    for (const r of parts) {
      if (r.x > x1 || r.x + r.w < x0 || r.y > y1 || r.y + r.h < y0) continue;
      cost += ROUTE_COST.part * insideRect(a, b, r);
    }

    for (const p of lanes.near(horizontal, coord, lo, hi)) {
      // ONE SIGNAL, ONE LINE. A fan-out wire beside a run of its own net is
      // drawing the signal it already is -- one line, correctly -- so it costs
      // nothing. Any other net at that distance is the two-thick-wires defect.
      if (p.net === net) continue;
      cost += ROUTE_COST.parallel * (Math.min(hi, p.hi) - Math.max(lo, p.lo));
    }
  }
  return cost;
}

/** The cheapest of a wire's candidates. */
export function chooseRoute(
  from: Point,
  to: Point,
  parts: readonly Rect[],
  lanes: LaneIndex,
  net: string,
): Point[] {
  let best: Point[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const points of candidateRoutes(from, to, parts)) {
    const cost = costOf(points, parts, lanes, net);
    if (cost >= bestCost) continue;
    best = points;
    bestCost = cost;
  }
  // `candidateRoutes` always offers at least the two stub coordinates, so there
  // is a candidate; the fallback is for the type, not for the case.
  return best ?? [from, to];
}

/** Every wire's polyline, keyed by wire id. */
export type RoutePlan = ReadonlyMap<string, readonly Point[]>;

/**
 * The plan for one board.
 *
 * Memoised on a hash of everything routing depends on -- every part's id,
 * definition and position, and every wire's endpoints -- because this is called
 * both by the painter, which runs on every store change including each frame of a
 * pan, and by the hit test. A pan must not re-route the board.
 */
let cache: { registry: Registry; key: number; plan: RoutePlan } | null = null;

export function planRoutes(graph: Graph, registry: Registry): RoutePlan {
  const key = fingerprint(graph);
  if (cache && cache.registry === registry && cache.key === key) return cache.plan;
  const plan = compute(graph, registry);
  cache = { registry, key, plan };
  return plan;
}

/** Drops the memo. For tests that want to watch the router think. */
export function forgetRoutes(): void {
  cache = null;
}

function compute(graph: Graph, registry: Registry): RoutePlan {
  const all = partRects(graph, registry);
  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  const lanes = new LaneIndex();
  const plan = new Map<string, readonly Point[]>();

  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to) continue;
    if (!registry.has(from.def) || !registry.has(to.def)) continue;
    const fromDef = registry.get(from.def);
    const toDef = registry.get(to.def);
    if (!fromDef.outputs.some((pin) => pin.id === wire.from.port)) continue;
    if (!toDef.inputs.some((pin) => pin.id === wire.to.port)) continue;

    const a = pinPosition(from, fromDef, wire.from.port, false);
    const b = pinPosition(to, toDef, wire.to.port, true);
    const nearby = all.filter(
      (r) =>
        r.x - NEARBY <= Math.max(a.x, b.x) &&
        r.x + r.w + NEARBY >= Math.min(a.x, b.x) &&
        r.y - NEARBY <= Math.max(a.y, b.y) &&
        r.y + r.h + NEARBY >= Math.min(a.y, b.y),
    );
    const points = chooseRoute(a, b, nearby, lanes, netOf(wire));
    plan.set(wire.id, points);
    lanes.add(segmentsOf(points, netOf(wire)));
  }
  return plan;
}

/**
 * The net a wire carries: the output pin it comes from.
 *
 * Two wires out of one pin are the SAME SIGNAL, so they are allowed -- and
 * encouraged -- to share a trunk (`ROUTE_COST.reuse`). Any other pair of wires is
 * two signals, and has to stay apart.
 */
function netOf(wire: Graph['wires'][number]): string {
  return `${wire.from.inst}.${wire.from.port}`;
}

/**
 * A hash of everything that decides a route.
 *
 * A hash rather than the key string it stands for: this runs on every paint, and
 * building a few kilobytes of text per frame to throw it away is work the board
 * does not need. A collision would only ever put a wire in the wrong lane.
 */
function fingerprint(graph: Graph): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 0x01000193) >>> 0;
  };
  const text = (value: string): void => {
    for (let i = 0; i < value.length; i += 1) mix(value.charCodeAt(i));
    mix(0);
  };
  for (const inst of graph.instances) {
    text(inst.id);
    text(inst.def);
    mix(inst.x);
    mix(inst.y);
  }
  mix(graph.instances.length);
  for (const wire of graph.wires) {
    text(wire.from.inst);
    text(wire.from.port);
    text(wire.to.inst);
    text(wire.to.port);
  }
  mix(graph.wires.length);
  return hash;
}