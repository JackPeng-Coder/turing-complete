/**
 * The board's palette and shape metrics.
 *
 * THE PALETTE IS NO LONGER THE ORIGINAL'S. It was sampled from reference
 * screenshots -- `#2e2b3c` chrome, `#353245` cards, `#364765` paper, `#ef9a23`
 * wires -- and the repository owner has since asked for a brighter, cyberpunk
 * red/green/blue scheme instead. The LAYOUT is still the original's: the same
 * full-bleed board, the same floating cards, the same pin-major test panel.
 *
 * EVERY COLOUR HERE OBEYS ONE RULE:
 *
 *   GREEN is 1. RED is 0. BLUE is wider than one bit.
 *
 * A wire, a pin, a part's body and a bit cell all say the same thing in the same
 * three colours, so a board is read with one skill instead of four. A part of
 * the rule that matters most: a value nothing has driven yet is NEUTRAL SLATE,
 * never red -- a half-built circuit must not read as a board full of zeroes,
 * which is a claim the app cannot make before it has run anything.
 */
export const THEME = {
  /** The near-black the board floats on, behind the floating panels. */
  backdrop: '#04070d',
  /**
   * Board paper: a deep navy, dark enough for a lit wire to glow against.
   *
   * Darkened with the chrome when the interface was rebuilt as an instrument:
   * the panels are near-black slabs now, and a mid-navy board between two of
   * them read as a different material rather than as the bench they sit on.
   */
  board: '#070d18',
  /**
   * The fine diagonal weave over the paper -- a circuit board's grain.
   *
   * Deliberately only three to five levels above the paper. The original's
   * weave is the same ratio (+4/+5) and it is calibrated that way on purpose:
   * the first pass at this palette used +8/+21/+30, which on a board this dark
   * is a sixty per cent brightness swing and read as noise competing with the
   * wires rather than as paper.
   */
  boardHatch: '#0a1220',
  /** The snap grid's major line, drawn over the weave: a hint, not a fence. */
  boardGrid: '#14304c',

  /** Top bar and the bottom test panel. Mirrors `--slab` in `style.css`. */
  chrome: '#080e18',
  /** Floating cards and tool buttons. Mirrors `--slab-lit`. */
  panel: '#0f1a28',
  panelHover: '#16273a',
  /** The hairline every panel is bounded by. Mirrors `--hair`. */
  panelEdge: '#17334a',

  /** The level name in the top bar; the instrument's own voice. */
  title: '#22e0ff',
  /** Pin labels down the left of the test panel. */
  label: '#7fd8ee',
  text: '#d7e6f5',
  textMuted: '#6b8aa8',

  // -- green: a single bit carrying 1, and a part producing one -------------
  /** A live 1-bit wire, a lit bit cell, a pin at 1. */
  on: '#00ff9c',
  /** A part body that is producing a 1: readable white-on-green, not a glare. */
  onBody: '#00b86b',

  // -- red: a single bit carrying 0 ----------------------------------------
  /** A lit-off bit cell, a pin at 0. */
  off: '#ff2b4e',
  /** A part body that is producing a 0. */
  offBody: '#c81e46',
  /** A 1-bit wire carrying 0: red, but not glowing, so it reads as quiet. */
  offWire: '#7d1730',

  // -- blue: anything wider than one bit -----------------------------------
  /** A bus's body, a wide pin, a part carrying a word. */
  bus: '#0a84ff',
  /** The bus's bright core: one line down the middle of the body. */
  busCore: '#5fd8ff',
  /** A part body carrying a word. */
  busBody: '#1250a8',

  // -- neutral: nothing has been simulated ---------------------------------
  /** An undriven pin, an unknown bit, a wire with no value. */
  idle: '#16233a',
  /** A part body with no value to report. */
  idleBody: '#101b2c',
  idleEdge: '#1d3450',
  /** The olive-grey the original used for an unknown bit, kept as the third cell. */
  unknown: '#3d4d66',

  /**
   * THE OPERATOR'S COLOUR, and the one colour that is never a value.
   *
   * Selection, the rubber band and the armed pin are all things the PLAYER is
   * doing, so they wear the same magenta the chrome uses for its controls --
   * the interface's rule, stated once in `style.css`: cyan is the instrument's
   * voice, magenta is the operator's hand. It cannot be confused with the red of
   * a 0 because a selection is a 2px ring AROUND a part and a 0 is a fill.
   */
  selection: '#ff2d78',
  /** The rubber band and the armed pin. */
  armed: '#ff2d78',
  error: '#ff2b4e',
  success: '#00ff9c',
  warning: '#ffb020',
  accent: '#22e0ff',
} as const;

/**
 * What a part's body is saying about itself.
 *
 * `bus` wins over `on`/`off` because a wide part has no single bit to report:
 * painting a byte-wide adder red because its low bit is 0 would be a lie about
 * the part, where painting it blue is a statement about its width.
 */
export type PartState = 'on' | 'off' | 'bus' | 'idle';

/** The state a part is in, from the width and the value it is carrying. */
export function partStateOf(width: number, value: number | undefined): PartState {
  if (value === undefined) return 'idle';
  if (width > 1) return 'bus';
  return value === 1 ? 'on' : 'off';
}

/** The body colour a state is painted in. */
export function bodyColourOf(state: PartState): string {
  switch (state) {
    case 'on':
      return THEME.onBody;
    case 'off':
      return THEME.offBody;
    case 'bus':
      return THEME.busBody;
    default:
      return THEME.idleBody;
  }
}

/** The glow colour a state is haloed in, or `null` when it is not lit. */
export function glowColourOf(state: PartState): string | null {
  switch (state) {
    case 'on':
      return THEME.on;
    case 'bus':
      return THEME.bus;
    default:
      return null;
  }
}

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

/**
 * Corner radius of a part body, in world pixels.
 *
 * Six, not fourteen. The rest of the interface is built from hard edges -- see
 * the note at the top of `style.css` -- and a pill-shaped gate was the last soft
 * thing on the board. A part is a chip on a bench, so its corners are cut, not
 * rounded off; the shapes that are CURVED (the D of an AND, the shield of an OR,
 * a level connector's disc) are curved because that curve is the symbol.
 */
export const PART_RADIUS = 6;

/** Thickness of a 1-bit wire, in world pixels. */
export const WIRE_WIDTH = 8;

/** Thickness of a multi-bit bus, in world pixels. */
export const BUS_WIDTH = 14;
