/**
 * The workbench's own measurements: how wide each sidebar is, how tall the
 * bottom panel is, and which of the three docks are collapsed.
 *
 * A SEPARATE KEY FROM EVERYTHING ELSE. `tc.progress.v1` is the campaign,
 * `tc.sandbox.v1` is one circuit and `tc.agent.v1` is where the assistant lives;
 * a layout is none of those -- it is a preference about the instrument, not a fact
 * about the work -- and folding it into any of them would make every migration of
 * one carry the other.
 *
 * NOTHING HERE THROWS. `localStorage` is missing in the unit tests and can refuse
 * writes in a private window; a layout that failed to load has an obvious answer
 * (the defaults), so the failure mode is "the docks are back where they started",
 * never a broken screen. Values are clamped on the way in as well as on the way
 * out, because a number from storage is untrusted input: a `primaryW` of 4000
 * would leave the board with no width at all.
 */
export const LAYOUT_KEY = 'tc.layout.v1';

export interface Layout {
  /** Width of the primary sidebar, in CSS pixels. */
  readonly primaryW: number;
  /** Width of the secondary sidebar, in CSS pixels. */
  readonly secondaryW: number;
  /** Height of the bottom panel's view area, in CSS pixels. */
  readonly panelH: number;
  readonly primaryCollapsed: boolean;
  readonly secondaryCollapsed: boolean;
  readonly panelCollapsed: boolean;
}

/** Where a fresh launch puts the docks, and what a corrupt payload falls back to. */
export const LAYOUT_DEFAULT: Layout = {
  primaryW: 252,
  secondaryW: 348,
  panelH: 300,
  primaryCollapsed: false,
  // The assistant starts closed: the board is the document, and a first visit
  // should not pay for a feature that has not been set up.
  secondaryCollapsed: true,
  panelCollapsed: false,
};

/** What a drag is allowed to ask for, in CSS pixels. */
export const LAYOUT_LIMITS = {
  primaryW: { min: 180, max: 420 },
  secondaryW: { min: 260, max: 620 },
  panelH: { min: 140, max: 600 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Reads an untrusted payload back into a layout, filling in what is missing. */
export function normalizeLayout(raw: unknown): Layout {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return LAYOUT_DEFAULT;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return LAYOUT_DEFAULT;
  const number = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    primaryW: number(record.primaryW, LAYOUT_DEFAULT.primaryW, LAYOUT_LIMITS.primaryW.min, LAYOUT_LIMITS.primaryW.max),
    secondaryW: number(
      record.secondaryW,
      LAYOUT_DEFAULT.secondaryW,
      LAYOUT_LIMITS.secondaryW.min,
      LAYOUT_LIMITS.secondaryW.max,
    ),
    panelH: number(record.panelH, LAYOUT_DEFAULT.panelH, LAYOUT_LIMITS.panelH.min, LAYOUT_LIMITS.panelH.max),
    primaryCollapsed: flag(record.primaryCollapsed, LAYOUT_DEFAULT.primaryCollapsed),
    secondaryCollapsed: flag(record.secondaryCollapsed, LAYOUT_DEFAULT.secondaryCollapsed),
    panelCollapsed: flag(record.panelCollapsed, LAYOUT_DEFAULT.panelCollapsed),
  };
}

/** Best-effort load; absent, corrupt or unreadable all read as the defaults. */
export function loadLayout(): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return LAYOUT_DEFAULT;
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return LAYOUT_DEFAULT;
  }
}

/** Best-effort save; without a store the layout lives for this session only. */
export function saveLayout(layout: Layout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, ...layout }));
  } catch {
    /* storage unavailable (private mode, tests): the layout stays in memory */
  }
}
