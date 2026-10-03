/**
 * Canvas painting for the board.
 *
 * Drawing is a pure function of the store's current state: the caller decides
 * when to repaint (state change, clock edge or resize), never a rAF loop -- a
 * static board must not repaint 60 times a second. Panning, zooming and dragging
 * all go through `store.set`, so every frame in which something actually moves
 * still repaints.
 *
 * Layers, bottom to top: paper, snap grid, wires, part bodies, pins, badges.
 *
 * THE LOOK IS THE ORIGINAL'S. Slate blue paper with a woven texture, orange
 * 1-bit wires and teal buses routed at right angles with rounded corners, blue
 * bodies for primitive gates and green for the wide machine parts, crimson pills
 * and circles for a level's own pins -- all sampled from reference screenshots
 * and named in `theme.ts`. What is NOT taken from the original is the geometry:
 * `view.ts` owns where a part and its pins sit, and the end-to-end tests drag
 * wires at the coordinates that geometry produces.
 */
import {
  BUS_WIDTH,
  GRID,
  PART_RADIUS,
  PIN_RADIUS,
  THEME,
  WIRE_WIDTH,
  bodyColourOf,
  glowColourOf,
  partStateOf,
  type PartState,
} from '../theme';
import type { AppState, Store } from '../../app/store';
import { instanceRect, pinPosition, worldToScreen, type Camera, type Point } from './view';
import { CORNER_RADIUS, cornerRadii, longestSegment, routeWire } from './routing';
import type { Graph, Instance } from '../../core/graph';
import type { ComponentDef, PinDef, Registry } from '../../core/registry';

/**
 * Everything the board paints that the store does not hold.
 *
 * Produced by `signals.ts` (the values) and by `main.ts` (the view flags), and
 * passed in rather than read from the store: the board is also painted by tests
 * and by the resize handler, and neither of those has a simulation to hand.
 */
export interface BoardView {
  /** Value at an output pin, keyed `${instanceId}.${portId}`. */
  readonly outputs: ReadonlyMap<string, number>;
  /** False when the circuit never reached a fixed point: no value is trustworthy. */
  readonly stable: boolean;
  /** Whether the snap grid is drawn. */
  readonly grid: boolean;
}

/**
 * A pin's width: `params.width` when the instance sets one, the pin's own
 * otherwise.
 *
 * Deliberately the same rule as `core/net.ts`'s own `effectiveWidth`, because a
 * renderer that disagreed with the compiler would draw a wire as one bit wide
 * and route a byte through it.
 */
function effectiveWidth(inst: Instance, pin: PinDef): number {
  return inst.params.width ?? pin.width;
}

/**
 * A part's body is its own state, not its family.
 *
 * It used to be keyed on `def.category` -- blue for the primitive gates, green
 * for the wide ones -- which said what a part IS. The board now says what a part
 * is DOING: green while it produces a 1, red while it produces a 0, blue for a
 * word, slate until something has run. The family is still legible from the
 * silhouette (`bodyShape`), so nothing was lost by spending the colour on state.
 */
function partAppearance(
  def: ComponentDef,
  inst: Instance,
  view: BoardView | null | undefined,
  driven: ReadonlyMap<string, number>,
): { state: PartState; colour: string; glow: string | null } {
  // A sink has no output to report, so it reports what it is being fed.
  const out = def.outputs[0];
  const sink = def.inputs[0];
  const width = out
    ? effectiveWidth(inst, out)
    : sink
      ? effectiveWidth(inst, sink)
      : 1;
  const value = out
    ? outputValue(view, inst.id, out.id)
    : sink
      ? driven.get(`${inst.id}.${sink.id}`)
      : undefined;
  const state = partStateOf(width, value);
  return { state, colour: bodyColourOf(state), glow: glowColourOf(state) };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | readonly number[],
): void {
  ctx.beginPath();
  // `roundRect` is the fast path on every current browser; the rectangle
  // fallback keeps an older one from throwing once per frame.
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r as number);
  else ctx.rect(x, y, w, h);
}

/**
 * The outline of a part's body.
 *
 * A primitive boolean gate gets the original's own silhouette -- a flat left
 * edge where its inputs arrive and a semicircular right one with the output at
 * its tip -- while everything else is a rounded rectangle. The distinction is
 * the original's, and it is worth keeping: a board of identical boxes gives no
 * clue which parts are the tiny gates and which are the machine.
 *
 * `roundRect` takes one radius per corner, so the D is a corner list and not a
 * hand-built arc.
 */
function bodyShape(
  def: ComponentDef,
  w: number,
  h: number,
  zoom: number,
): number | readonly number[] {
  if (def.category === 'logic1') return [0, h / 2, h / 2, 0];
  if (def.category === 'level') return h / 2;
  return PART_RADIUS * zoom;
}

/**
 * The paper: a flat slate blue with a soft diagonal weave over it.
 *
 * The weave is a pattern rather than a run of `stroke()` calls because the
 * original's is not a hairline. Sampling its board along one row shows the paper
 * ramping from `#364765` up to about `#354c6b` and back over NINE pixels of a
 * twenty-four pixel period, with the pale plateau covering roughly a quarter of
 * the area. A single 1px line per period renders as a sparse scratch, and five
 * overlapping strokes peaked two levels above the paper -- both measured, both
 * wrong.
 *
 * So the band is filled: one 24 unit tile holds the region `3 ≤ x + y ≤ 13`
 * (a band 7 units wide across, at 45 degrees) painted with a gradient that fades
 * in and out along its normal. Repeating the tile reproduces `x + y ≡ c (mod 24)`
 * seamlessly -- the band continues across tile edges, which is why it is a
 * polygon and not a stroked line. It is drawn through the camera transform, so
 * the weave is part of the board's material: panning carries it with the circuit
 * instead of sliding a texture underneath it.
 */
let weaveTile: HTMLCanvasElement | null = null;
const weavePatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

const WEAVE_TILE = 24;
const WEAVE_INNER = 3;
const WEAVE_OUTER = 13;

/** `#rrggbb` as `r, g, b`, for the stops that fade a band out to nothing. */
function rgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
}

function weaveFor(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const cached = weavePatterns.get(ctx);
  if (cached) return cached;
  if (!weaveTile) {
    const tile = document.createElement('canvas');
    tile.width = WEAVE_TILE;
    tile.height = WEAVE_TILE;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    // The gradient runs along the band's normal, `(1, 1)`, from one edge of the
    // band to the other; its midpoint is the band's centre line.
    const ramp = tctx.createLinearGradient(
      WEAVE_INNER / 2,
      WEAVE_INNER / 2,
      WEAVE_OUTER / 2,
      WEAVE_OUTER / 2,
    );
    const rgb = rgbTriplet(THEME.boardHatch);
    ramp.addColorStop(0, `rgba(${rgb}, 0)`);
    ramp.addColorStop(0.5, THEME.boardHatch);
    ramp.addColorStop(1, `rgba(${rgb}, 0)`);
    tctx.fillStyle = ramp;
    tctx.beginPath();
    tctx.moveTo(WEAVE_INNER, 0);
    tctx.lineTo(WEAVE_OUTER, 0);
    tctx.lineTo(0, WEAVE_OUTER);
    tctx.lineTo(0, WEAVE_INNER);
    tctx.closePath();
    tctx.fill();
    weaveTile = tile;
  }
  const pattern = ctx.createPattern(weaveTile, 'repeat');
  if (pattern) weavePatterns.set(ctx, pattern);
  return pattern;
}

function drawPaper(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  ctx.fillStyle = THEME.board;
  ctx.fillRect(0, 0, w, h);

  const pattern = weaveFor(ctx);
  if (!pattern) return;
  ctx.save();
  // The world-to-screen transform, so the pattern is measured in world units.
  ctx.translate(camera.x * camera.zoom, camera.y * camera.zoom);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.fillStyle = pattern;
  ctx.fillRect(-camera.x, -camera.y, w / camera.zoom, h / camera.zoom);
  ctx.restore();
}

/**
 * The snap grid: one line every eight world cells, which is the lattice a part
 * lands on. The minor lines are gone on purpose -- the weave is the texture, and
 * two competing grids made the board read as graph paper rather than a board.
 */
function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number): void {
  const step = GRID * 8 * camera.zoom;
  if (step < 8) return;
  const worldLeft = -camera.x;
  const worldTop = -camera.y;
  const worldRight = w / camera.zoom - camera.x;
  const worldBottom = h / camera.zoom - camera.y;

  ctx.strokeStyle = THEME.boardGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstX = Math.floor(worldLeft / (GRID * 8)) * GRID * 8;
  for (let x = firstX; x <= worldRight; x += GRID * 8) {
    const sx = Math.round((x + camera.x) * camera.zoom) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  const firstY = Math.floor(worldTop / (GRID * 8)) * GRID * 8;
  for (let y = firstY; y <= worldBottom; y += GRID * 8) {
    const sy = Math.round((y + camera.y) * camera.zoom) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();
}

/** Screen-space polyline with rounded corners, ready to be filled or stroked. */
function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[], camera: Camera): void {
  const screen = points.map((p) => worldToScreen(camera, p));
  const radii = cornerRadii(points, CORNER_RADIUS * camera.zoom);
  ctx.beginPath();
  ctx.moveTo(screen[0]!.x, screen[0]!.y);
  for (let i = 1; i < screen.length - 1; i += 1) {
    const next = screen[i + 1]!;
    ctx.arcTo(screen[i]!.x, screen[i]!.y, next.x, next.y, radii[i]!);
  }
  const last = screen[screen.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

/** The value at an output pin, or `undefined` when nothing is known about it. */
function outputValue(
  view: BoardView | null | undefined,
  instId: string,
  port: string,
): number | undefined {
  if (!view?.stable) return undefined;
  return view.outputs.get(`${instId}.${port}`);
}

/**
 * Paints one wire in the board's value colours: green for a live bit, a dark red
 * trace for a bit at 0, a blue cable with a bright core for a word.
 *
 * LIT WIRES GLOW, and the glow is a second wide stroke under the solid one
 * rather than a canvas shadow: `shadowBlur` re-renders the path through a blur
 * pass per stroke, and a board is hundreds of strokes. Two passes at one alpha
 * cost a stroke each and read the same.
 *
 * `value === undefined` is the neutral colour, not red: a value the app has not
 * simulated must not be painted as a confident 0.
 */
function drawWire(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
  value: number | undefined,
  camera: Camera,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const zoom = camera.zoom;

  if (width > 1) {
    const body = BUS_WIDTH * zoom;
    tracePath(ctx, points, camera);
    ctx.strokeStyle = THEME.bus;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = body * 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = body;
    ctx.stroke();
    ctx.strokeStyle = THEME.busCore;
    ctx.lineWidth = Math.max(1, body * 0.34);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const body = WIRE_WIDTH * zoom;
  tracePath(ctx, points, camera);
  if (value === 1) {
    ctx.strokeStyle = THEME.on;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = body * 2.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = body;
    ctx.stroke();
  } else {
    ctx.strokeStyle = value === 0 ? THEME.offWire : THEME.idle;
    ctx.lineWidth = body;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A bus's value, written on its longest segment.
 *
 * Room is the constraint, not the number: a label longer than the wire it sits
 * on is unreadable, so the leading digits are dropped until it fits -- which is
 * why the original shows `5` and `25` where a wider wire shows `255`. The label
 * is stroked first in the paper's own dark and then filled, so it stays legible
 * over both the dark bus body and the bright core.
 */
function drawValueLabel(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  value: number,
  zoom: number,
): void {
  const segment = longestSegment(points);
  if (!segment) return;
  const length = segment.length * zoom;
  if (length < 24) return;

  const size = Math.max(9, Math.min(15, 13 * zoom));
  ctx.font = `bold ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let text = String(value);
  while (text.length > 1 && ctx.measureText(text).width > length - 6 * zoom) {
    text = text.slice(1);
  }
  if (ctx.measureText(text).width > length) return;

  const at = worldToScreen({ x: 0, y: 0, zoom }, segment.mid);
  ctx.lineWidth = Math.max(2, 3 * zoom);
  ctx.strokeStyle = THEME.board;
  ctx.strokeText(text, at.x, at.y);
  ctx.fillStyle = THEME.text;
  ctx.fillText(text, at.x, at.y);
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

/**
 * Bold white text with a dark outline: readable on every body colour.
 *
 * `maxWidth` shrinks the type until the label fits the body it sits on. Canvas
 * would squash a too-long string into the width instead, and a horizontally
 * compressed `8 位非门` is harder to read than a smaller one.
 */
function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  zoom: number,
  maxWidth: number,
  fill = THEME.text,
): void {
  const family = '"Segoe UI", system-ui, "Microsoft YaHei", sans-serif';
  let px = size;
  ctx.font = `600 ${px}px ${family}`;
  while (px > 8 && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = `600 ${px}px ${family}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1.5, 3 * zoom);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * The bit width of a part's pins, printed in a corner badge.
 *
 * Cyan rather than one of the three value colours: a width is not a value, and a
 * green or red badge on a part would be read as one.
 */
function drawWidthBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  zoom: number,
): void {
  const size = Math.max(7, 9 * zoom);
  ctx.font = `600 ${size}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = String(width);
  const padX = 3 * zoom;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = size + 3 * zoom;
  ctx.fillStyle = THEME.accent;
  roundedRect(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 2 * zoom);
  ctx.fill();
  ctx.fillStyle = THEME.backdrop;
  ctx.fillText(text, x, y + 0.5 * zoom);
}

function drawWires(
  ctx: CanvasRenderingContext2D,
  graph: Graph,
  camera: Camera,
  registry: Registry,
  view: BoardView | null | undefined,
): void {
  const byId = new Map(graph.instances.map((i) => [i.id, i]));
  for (const wire of graph.wires) {
    const from = byId.get(wire.from.inst);
    const to = byId.get(wire.to.inst);
    if (!from || !to || !registry.has(from.def) || !registry.has(to.def)) continue;
    const fromDef = registry.get(from.def);
    const toDef = registry.get(to.def);
    const outPin = fromDef.outputs.find((p) => p.id === wire.from.port);
    if (!outPin) continue;
    const a = pinPosition(from, fromDef, wire.from.port, false);
    const b = pinPosition(to, toDef, wire.to.port, true);
    const points = routeWire(a, b);
    const width = effectiveWidth(from, outPin);
    const value = outputValue(view, from.id, wire.from.port);
    drawWire(ctx, points, width, value, camera);
    if (width > 1 && value !== undefined && value !== 0) {
      drawValueLabel(ctx, points, value, camera.zoom);
    }
  }
}

/**
 * One pin's marker.
 *
 * Shape carries the width: a square for a single bit, a ringed circle for a bus
 * -- which is the original's own split, and the reason a wide pin is legible at
 * a glance in a circuit full of thin ones.
 *
 * Colour carries the value, in the board's own three: green a live bit, red a
 * bit at 0, blue a word, slate a pin nothing is driving. A lit pin also gets the
 * same halo a lit wire does, so a signal reads as one continuous thing from the
 * part that produced it to the pin that received it.
 */
function drawPin(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  width: number,
  value: number | undefined,
  armed: boolean,
  zoom: number,
): void {
  const r = Math.max(2, PIN_RADIUS * zoom);
  const wide = width > 1;
  const fill =
    value === undefined
      ? THEME.idle
      : wide
        ? THEME.bus
        : value === 1
          ? THEME.on
          : THEME.off;
  const lit = value === 1 || wide;

  const shape = (radius: number): void => {
    ctx.beginPath();
    if (wide) ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    else ctx.rect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);
  };

  if (lit) {
    shape(r + 4 * zoom);
    ctx.fillStyle = wide ? THEME.bus : THEME.on;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  shape(r + 1 * zoom);
  ctx.fillStyle = wide ? THEME.text : THEME.backdrop;
  ctx.fill();

  shape(r - 0.5 * zoom);
  ctx.fillStyle = fill;
  ctx.fill();

  if (armed) {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r + 5 * zoom, 0, Math.PI * 2);
    ctx.strokeStyle = THEME.armed;
    ctx.lineWidth = 2 * zoom;
    ctx.stroke();
  }
}

/**
 * Every input pin's value, keyed `${instanceId}.${portId}`.
 *
 * An input pin's value is its driver's -- the netlist gathers it bit by bit from
 * `drive`, and `drive` points at the driving output -- so the board reads it the
 * same way instead of re-deriving it: walk the wires, look up the source output.
 * Without this every input pin would be olive, and the original's lit green pins
 * at the far end of a wire are half of what makes a working circuit legible.
 */
function drivenInputs(
  graph: Graph,
  view: BoardView | null | undefined,
): ReadonlyMap<string, number> {
  const driven = new Map<string, number>();
  for (const wire of graph.wires) {
    const value = view?.outputs.get(`${wire.from.inst}.${wire.from.port}`);
    if (value !== undefined) driven.set(`${wire.to.inst}.${wire.to.port}`, value);
  }
  return driven;
}

/**
 * A level input, drawn as the original's arrow: a bar the signal arrives at, and
 * a triangle whose apex sits exactly on the output pins -- so the wires leave the
 * point of the arrow instead of the middle of a box.
 *
 * It has no body of its own. Drawing the usual rounded rect underneath left a
 * disc with a faint triangle inside it, which reads as a button rather than as a
 * connector. The arrow takes the part's state colour like every other body.
 */
function drawLevelInput(
  ctx: CanvasRenderingContext2D,
  p: Point,
  w: number,
  h: number,
  zoom: number,
  fill: string,
): void {
  const bar = 12 * zoom;
  const inset = 10 * zoom;
  const base = p.x + bar;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(base, p.y + inset);
  ctx.lineTo(p.x + w, p.y + h / 2);
  ctx.lineTo(base, p.y + h - inset);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect?.(p.x, p.y + inset, bar, h - inset * 2, 4 * zoom);
  if (!ctx.roundRect) ctx.rect(p.x, p.y + inset, bar, h - inset * 2);
  ctx.fill();
}

/**
 * The wire being pulled out of a pin, from that pin to the pointer.
 *
 * Dashed and in the armed colour, so it reads as a proposal rather than as a
 * connection: nothing exists in the graph until the pointer is released on an
 * input pin.
 */
function drawDragPreview(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  camera: Camera,
): void {
  const drag = state.dragging;
  if (drag?.kind !== 'wire' || !drag.to) return;
  const from = state.graph.instances.find((inst) => inst.id === drag.fromInst);
  if (!from || !state.registry.has(from.def)) return;
  const a = pinPosition(from, state.registry.get(from.def), drag.fromPort, false);
  ctx.save();
  ctx.setLineDash([6 * camera.zoom, 5 * camera.zoom]);
  ctx.lineCap = 'round';
  tracePath(ctx, routeWire(a, drag.to), camera);
  ctx.strokeStyle = THEME.armed;
  ctx.lineWidth = WIRE_WIDTH * camera.zoom * 0.8;
  ctx.stroke();
  ctx.restore();
}

function drawInstance(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  inst: Instance,
  camera: Camera,
  view: BoardView | null | undefined,
  driven: ReadonlyMap<string, number>,
): void {
  const { registry, selected, dragging } = state;
  if (!registry.has(inst.def)) return;
  const def = registry.get(inst.def);
  const rect = instanceRect(inst);
  const p = worldToScreen(camera, { x: rect.x, y: rect.y });
  const w = rect.w * camera.zoom;
  const h = rect.h * camera.zoom;
  const isSelected = selected.includes(inst.id);
  const isLevelInput = def.category === 'level' && inst.id.startsWith('IN_');
  const radius = bodyShape(def, w, h, camera.zoom);
  const look = partAppearance(def, inst, view, driven);

  if (isLevelInput) {
    drawLevelInput(ctx, p, w, h, camera.zoom, look.colour);
  } else {
    // A lit part is haloed by a wide translucent stroke of its own body path,
    // the same two-pass glow a lit wire gets: one reading, everywhere.
    if (look.glow) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = look.glow;
      ctx.lineWidth = 7 * camera.zoom;
      roundedRect(ctx, p.x, p.y, w, h, radius);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = look.colour;
    ctx.strokeStyle = isSelected ? THEME.selection : THEME.idleEdge;
    ctx.lineWidth = isSelected ? 3 : 1.5 * camera.zoom;
    roundedRect(ctx, p.x, p.y, w, h, radius);
    ctx.fill();
    ctx.stroke();
    // A light bevel along the top: the original's parts are lit from above, and
    // it is what keeps a flat fill from reading as a placeholder.
    ctx.save();
    roundedRect(ctx, p.x, p.y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(p.x, p.y, w, h * 0.45);
    ctx.restore();
  }

  const outputWidth = def.outputs[0] ? effectiveWidth(inst, def.outputs[0]) : 1;
  const value = def.outputs[0] ? outputValue(view, inst.id, def.outputs[0].id) : undefined;

  if (isLevelInput) {
    if (isSelected) {
      ctx.strokeStyle = THEME.selection;
      ctx.lineWidth = 3;
      roundedRect(ctx, p.x, p.y, w, h, 6 * camera.zoom);
      ctx.stroke();
    }
  } else if (def.category === 'level' && value !== undefined) {
    outlinedText(
      ctx,
      String(value),
      p.x + w / 2,
      p.y + h / 2,
      Math.max(12, 20 * camera.zoom),
      camera.zoom,
      w - 10 * camera.zoom,
    );
  } else {
    const label = labelOf(inst, def);
    const size = Math.max(10, Math.min(16, 15 * camera.zoom));
    // A D-shaped gate's right half is its arc, so its text sits left of centre
    // to stay on the flat part of the body.
    const shift = def.category === 'logic1' ? h * 0.12 : 0;
    outlinedText(
      ctx,
      label,
      p.x + w / 2 - shift,
      p.y + h / 2,
      size,
      camera.zoom,
      w - 12 * camera.zoom,
    );
  }

  if (outputWidth > 1) {
    drawWidthBadge(ctx, p.x + w - 8 * camera.zoom, p.y + 3 * camera.zoom, outputWidth, camera.zoom);
  }

  const armed =
    dragging?.kind === 'wire' && dragging.fromInst === inst.id ? dragging.fromPort : null;

  for (const pin of def.inputs) {
    drawPin(
      ctx,
      worldToScreen(camera, pinPosition(inst, def, pin.id, true)),
      effectiveWidth(inst, pin),
      driven.get(`${inst.id}.${pin.id}`),
      armed === pin.id,
      camera.zoom,
    );
  }
  for (const pin of def.outputs) {
    drawPin(
      ctx,
      worldToScreen(camera, pinPosition(inst, def, pin.id, false)),
      effectiveWidth(inst, pin),
      outputValue(view, inst.id, pin.id),
      armed === pin.id,
      camera.zoom,
    );
  }
}

export function renderBoard(
  canvas: HTMLCanvasElement,
  store: Store<AppState>,
  camera: Camera,
  view?: BoardView | null,
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
  drawPaper(ctx, camera, w, h);
  if (view?.grid ?? true) drawGrid(ctx, camera, w, h);

  const state = store.get();
  const { graph, registry } = state;
  const driven = drivenInputs(graph, view);
  // Wires under parts: a part body must stay readable where a wire runs into it.
  drawWires(ctx, graph, camera, registry, view);
  drawDragPreview(ctx, state, camera);
  for (const inst of graph.instances) drawInstance(ctx, state, inst, camera, view, driven);
}
