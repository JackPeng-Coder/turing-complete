/**
 * The board's viewport transform: camera position in world units (the pan
 * offset, screen pixels at zoom 1) plus the zoom factor.
 *
 * This module is the board's viewport and its hit testing. The geometry that hit
 * testing shares with the wire router -- part rectangles, pin layout, grid
 * snapping -- lives in `geometry.ts` and is re-exported here, so the board's
 * public geometry still arrives from one module. Everything in here is a pure
 * function of its arguments -- no DOM, no store -- which is why it is the one
 * board file with unit tests that run without a browser.
 */
import type { Registry } from '../../core/registry';
import type { Graph } from '../../core/graph';
import { PIN_RADIUS } from '../theme';
import { distanceToPath, type Point } from './routing';
import { instanceRect, pinPosition, snap } from './geometry';
import { planRoutes } from './routes';

// `Point` is defined next to the routing it is used by, and `instanceRect` /
// `pinPosition` / `snap` now live in `geometry.ts`. All four are re-exported
// here, so the board's public geometry still arrives from one module.
export type { Point };
export { instanceRect, pinPosition, snap };

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y };
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

  // The polyline the board DRAWS, from the same planner the painter uses: the
  // router moves a wire around the parts in its way, so a hit test against the
  // shortest path instead would leave a player clicking a line that is not there
  // and missing the line that is.
  const plan = planRoutes(graph, registry);
  for (const wire of graph.wires) {
    const points = plan.get(wire.id);
    if (points && distanceToPath(world, points) <= 4) return { kind: 'wire', id: wire.id };
  }

  for (let i = graph.instances.length - 1; i >= 0; i -= 1) {
    const inst = graph.instances[i]!;
    if (pointInRect(world, instanceRect(inst))) return { kind: 'instance', id: inst.id };
  }
  return null;
}
