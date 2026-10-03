/**
 * The board's palette and shape metrics.
 *
 * Every colour here was sampled out of reference screenshots of the original
 * game rather than invented: `#2e2b3c` is the chrome of its top bar and test
 * panel, `#353245` its floating cards, `#182432` the navy its board floats on,
 * `#364765` the board paper itself, `#ef9a23` a live wire, `#006196` a primitive
 * gate, `#d04349` a level pin and `#f82256`/`#04a02c` its 0 and 1 bit cells.
 *
 * This module used to say "no colours are taken from the original game". That
 * was the right call while the replica was inventing its own look; the brief is
 * now to look like the original, so the colours are copied deliberately and this
 * comment is the record of it.
 *
 * The shape metrics below are NOT part of the restyle. `INSTANCE_WIDTH`,
 * `INSTANCE_HEIGHT`, the 14 unit pin spacing and `GRID` are the board's
 * geometry: `view.ts` derives every pin position from them and the end-to-end
 * tests drag wires at coordinates those numbers produce. The look of a part is
 * painted from the colours; where it sits is not.
 */
export const THEME = {
  /** The navy the board floats on, behind the floating panels. */
  backdrop: '#182432',
  /** Board paper: the slate blue a circuit is drawn on. */
  board: '#364765',
  /** The fine diagonal weave over the paper, a shade lighter than it. */
  boardHatch: '#364b6a',
  /** The snap grid's major line, drawn over the weave: a hint, not a fence. */
  boardGrid: '#3b4e6c',
  /** Top bar and the bottom test panel. */
  chrome: '#2e2b3c',
  /** Floating cards and tool buttons. */
  panel: '#353245',
  panelHover: '#413c58',
  panelEdge: '#4a4560',
  /** The level name in the top bar. */
  title: '#d1425e',
  /** Pin labels down the left of the test panel. */
  label: '#e8a33d',
  text: '#ffffff',
  textMuted: '#a49fbb',
  /** A 1-bit wire carrying 0: dark, so a lit circuit reads at a glance. */
  wireOff: '#25313f',
  /** A 1-bit wire carrying 1. */
  wireOn: '#ef9a23',
  /** A multi-bit wire: the dark body of the bus. */
  bus: '#1f8fc4',
  /** The bus's bright core, one line per bit inside the body. */
  busCore: '#5fc8ea',
  /** A primitive boolean gate's body. */
  gateBoolean: '#006196',
  /** A gate that is arithmetic or whole-word: green in the original. */
  gateInteger: '#00965f',
  /** Storage: registers, memories, counters, delay lines. */
  gateStorage: '#7d4bb0',
  /** A level input or output part. */
  levelIo: '#d04349',
  /** The arrow a level input is drawn as: brighter, so it reads as an arrow. */
  levelIoHighlight: '#e2555b',
  /** A level pin's number badge. */
  levelIoBadge: '#ffffff',
  selection: '#ffffff',
  /** Wire and part hover/armed highlight. */
  armed: '#ffd24a',
  /** The 0 bit cell, and every error message. */
  error: '#f82256',
  /** The 1 bit cell, and every success message. */
  success: '#04a02c',
  /** A bit whose value is not known yet: olive, as in the original's panel. */
  unknown: '#82816f',
  warning: '#ef9a23',
  accent: '#ef9a23',
} as const;

/** World pixels a part snaps to. */
export const GRID = 8;
/**
 * Radius of a hit-testable pin, in world pixels.
 *
 * Generous on purpose: the pins are what a player aims at, and the board's own
 * end-to-end tests drag wires with a mouse. `view.ts` adds three more pixels of
 * tolerance on top.
 */
export const PIN_RADIUS = 6;
/**
 * A part's body, in world pixels.
 *
 * Measured off the original at 1080p, where a gate is about 74 by 75. The
 * geometry is not decoration -- `view.ts` derives every pin position from these
 * two numbers and the end-to-end tests drag wires at the coordinates they
 * produce -- so they are stated here once and nowhere else.
 */
export const INSTANCE_WIDTH = 72;
export const INSTANCE_HEIGHT = 72;

/** Vertical distance between two pins on the same edge, in world pixels. */
export const PIN_SPACING = 24;

/** Corner radius of a part body, in world pixels. */
export const PART_RADIUS = 14;

/** Thickness of a 1-bit wire, in world pixels. */
export const WIRE_WIDTH = 8;

/** Thickness of a multi-bit bus, in world pixels. */
export const BUS_WIDTH = 14;
