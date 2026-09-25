/**
 * Canvas painting for the board.
 *
 * Drawing is a pure function of the store's current state: the caller decides
 * when to repaint (state change or resize), never a rAF loop -- a static board
 * must not repaint 60 times a second. Panning, zooming and dragging all go
 * through `store.set`, so every frame in which something actually moves still
 * repaints.
 *
 * Layers, bottom to top: background, grid, wires, parts, pins.
 */
import { GRID, PIN_RADIUS, THEME } from '../theme';
import type { AppState, Store } from '../../app/store';
import { instanceRect, pinPosition, worldToScreen, type Camera } from './view';
import type { Graph, Instance } from '../../core/graph';
import type { ComponentDef, Registry } from '../../core/registry';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  // `roundRect` is the fast path on every current browser; the rectangle
  // fallback keeps an older one from throwing once per frame.
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Draws the grid the parts snap to: a line every `GRID` world pixels, with
 * every fourth line drawn in the major colour.
 *
 * Both passes walk the *visible* world range, so the line count is bounded by
 * the viewport rather than by the camera position. The minor pass is skipped
 * once the spacing drops below 4 screen pixels, where it would read as a solid
 * fill instead of a grid.
 */
function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  const step = GRID * camera.zoom;
  const major = step * 4;
  const worldLeft = -camera.x;
  const worldTop = -camera.y;
  const worldRight = w / camera.zoom - camera.x;
  const worldBottom = h / camera.zoom - camera.y;

  const lines = (spacing: number, style: string): void => {
    // A zero or negative spacing would step forever; the camera clamps zoom to
    // 0.25..4, so this only guards against a corrupted camera.
    if (!(spacing > 0)) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstX = Math.floor(worldLeft / spacing) * spacing;
    for (let x = firstX; x <= worldRight; x += spacing) {
      const sx = Math.round((x + camera.x) * camera.zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    const firstY = Math.floor(worldTop / spacing) * spacing;
    for (let y = firstY; y <= worldBottom; y += spacing) {
      const sy = Math.round((y + camera.y) * camera.zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  };

  if (step >= 4) lines(step, THEME.grid);
  if (major >= 4) lines(major, THEME.gridMajor);
}

/**
 * Text painted on a part.
 *
 * Level IO parts show their instance id instead of their type name: the id
 * (`IN_a`, `OUT`, `OUT_out3`) is what binds the part to the level, and level 12
 * puts four visually identical outputs on the board.
 */
function labelOf(inst: Instance, def: ComponentDef): string {
  if (def.category === 'level' && /^(IN_|OUT)/.test(inst.id)) return inst.id;
  return def.name.zh;
}

function drawWires(
  ctx: CanvasRenderingContext2D,
  graph: Graph,
  camera: Camera,
  registry: Registry,
): void {
  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  ctx.strokeStyle = THEME.wireOff;
  ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
  ctx.lineCap = 'round';
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to || !registry.has(from.def) || !registry.has(to.def)) continue;
    const a = worldToScreen(camera, pinPosition(from, registry.get(from.def), wire.from.port, false));
    const b = worldToScreen(camera, pinPosition(to, registry.get(to.def), wire.to.port, true));
    const bend = 30 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + bend, a.y, b.x - bend, b.y, b.x, b.y);
    ctx.stroke();
  }
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  inst: Instance,
  camera: Camera,
): void {
  const { registry, selected, dragging } = state;
  if (!registry.has(inst.def)) return;
  const def = registry.get(inst.def);
  const rect = instanceRect(inst);
  const p = worldToScreen(camera, { x: rect.x, y: rect.y });
  const w = rect.w * camera.zoom;
  const h = rect.h * camera.zoom;
  const isSelected = selected.includes(inst.id);

  ctx.fillStyle = THEME.componentFill;
  ctx.strokeStyle = isSelected ? THEME.selection : THEME.componentStroke;
  ctx.lineWidth = isSelected ? 2 : 1;
  roundedRect(ctx, p.x, p.y, w, h, 4 * camera.zoom);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = THEME.componentText;
  ctx.font = `${Math.max(9, 11 * camera.zoom)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelOf(inst, def), p.x + w / 2, p.y + h / 2);

  const radius = PIN_RADIUS * camera.zoom;
  const wireArmed =
    dragging?.kind === 'wire' && dragging.fromInst === inst.id ? dragging.fromPort : null;

  for (const pin of def.inputs) {
    const pos = worldToScreen(camera, pinPosition(inst, def, pin.id, true));
    ctx.fillStyle = THEME.pinOff;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const pin of def.outputs) {
    const pos = worldToScreen(camera, pinPosition(inst, def, pin.id, false));
    const armed = pin.id === wireArmed;
    ctx.fillStyle = armed ? THEME.pinOn : THEME.pinOff;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, armed ? radius + 2 : radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderBoard(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  camera: Camera,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Backing store follows the CSS box times the device pixel ratio; reassigning
  // `width`/`height` reallocates the buffer and clears it, so only do it when
  // the size actually changed.
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, camera, w, h);

  const state = store.get();
  const { graph, registry } = state;
  // Wires under parts: a part body must stay readable where a wire runs into it.
  drawWires(ctx, graph, camera, registry);
  for (const inst of graph.instances) drawInstance(ctx, state, inst, camera);
}
