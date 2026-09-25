/**
 * The board's viewport transform: camera position in world units (the pan
 * offset, screen pixels at zoom 1) plus the zoom factor.
 *
 * This module is the board's geometry: the world/screen conversions, grid
 * snapping, part rectangles, pin layout and hit testing. Everything in here is
 * a pure function of its arguments -- no DOM, no store -- which is why it is
 * the one board file with unit tests that run without a browser.
 */
import type { ComponentDef, Registry } from '../../core/registry';
import type { Graph, Instance } from '../../core/graph';
import { GRID, INSTANCE_HEIGHT, INSTANCE_WIDTH, PIN_RADIUS } from '../theme';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y };
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

export function instanceRect(inst: Instance): { x: number; y: number; w: number; h: number } {
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
  const y = inst.y + INSTANCE_HEIGHT / 2 + (index - (count - 1) / 2) * 14;
  const x = isInput ? inst.x : inst.x + INSTANCE_WIDTH;
  return { x, y };
}

export type Hit =
  | { kind: 'instance'; id: string }
  | { kind: 'pin'; inst: string; port: string; isInput: boolean }
  | { kind: 'wire'; id: string }
  | null;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInRect(p: Point, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function hitTest(graph: Graph, registry: Registry, world: Point): Hit {
  const tolerance = PIN_RADIUS + 3;
  // pins first, then wires, then bodies -- smallest target wins
  for (const inst of graph.instances) {
    if (!registry.has(inst.def)) continue;
    const def = registry.get(inst.def);
    for (const pin of def.inputs) {
      if (distance(pinPosition(inst, def, pin.id, true), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: true };
      }
    }
    for (const pin of def.outputs) {
      if (distance(pinPosition(inst, def, pin.id, false), world) <= tolerance) {
        return { kind: 'pin', inst: inst.id, port: pin.id, isInput: false };
      }
    }
  }

  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to) continue;
    const fromDef = registry.has(from.def) ? registry.get(from.def) : null;
    const toDef = registry.has(to.def) ? registry.get(to.def) : null;
    if (!fromDef || !toDef) continue;
    const a = pinPosition(from, fromDef, wire.from.port, false);
    const b = pinPosition(to, toDef, wire.to.port, true);
    if (distanceToSegment(world, a, b) <= 4) return { kind: 'wire', id: wire.id };
  }

  for (let i = graph.instances.length - 1; i >= 0; i -= 1) {
    const inst = graph.instances[i]!;
    if (pointInRect(world, instanceRect(inst))) return { kind: 'instance', id: inst.id };
  }
  return null;
}
