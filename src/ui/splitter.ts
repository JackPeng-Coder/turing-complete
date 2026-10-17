/**
 * A draggable edge between two docks.
 *
 * THE SPLITTER OWNS NO MEASUREMENT. It reports where the pointer is and the
 * caller decides what that means: the primary sidebar grows when the pointer
 * moves right, the secondary sidebar grows when it moves left (its edge is its
 * left border), and the bottom panel grows when its top border moves up. That is
 * one `sign` rather than three implementations.
 *
 * IT IS ALSO A KEYBOARD CONTROL. The handle is a focusable `separator`, and the
 * arrow keys nudge the pane; without that, a control that exists only under a
 * drag is a control half the players cannot use. Shift makes the nudge larger.
 */
export interface SplitterOptions {
  /** `x` for a vertical edge (a width), `y` for a horizontal one (a height). */
  readonly axis: 'x' | 'y';
  /** `+1` when dragging right/down grows the pane, `-1` when it shrinks it. */
  readonly sign: 1 | -1;
  /** The pane's current measurement, in CSS pixels. */
  readonly value: () => number;
  readonly min: () => number;
  readonly max: () => number;
  /** Called while the pointer moves (and on each key nudge). */
  readonly onChange: (value: number) => void;
  /** Called when a drag ends or a key nudge settles, for persistence. */
  readonly onCommit?: () => void;
}

/** How far one arrow-key press moves a pane, and one shift-arrow. */
const NUDGE = 12;
const NUDGE_LARGE = 48;

export function mountSplitter(element: HTMLElement, options: SplitterOptions): void {
  element.classList.add('splitter', options.axis === 'x' ? 'splitter-x' : 'splitter-y');
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', options.axis === 'x' ? 'vertical' : 'horizontal');
  element.tabIndex = 0;

  let dragging = false;
  let start = 0;
  let from = 0;

  const apply = (next: number): void => {
    const value = Math.min(options.max(), Math.max(options.min(), Math.round(next)));
    options.onChange(value);
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    start = options.axis === 'x' ? event.clientX : event.clientY;
    from = options.value();
    element.classList.add('dragging');
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  element.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const now = options.axis === 'x' ? event.clientX : event.clientY;
    apply(from + (now - start) * options.sign);
  });

  const stop = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove('dragging');
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture?.(event.pointerId);
    options.onCommit?.();
  };
  element.addEventListener('pointerup', stop);
  element.addEventListener('pointercancel', stop);

  element.addEventListener('keydown', (event) => {
    const forward = options.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const back = options.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== forward && event.key !== back) return;
    event.preventDefault();
    const step = (event.shiftKey ? NUDGE_LARGE : NUDGE) * options.sign;
    apply(options.value() + (event.key === forward ? step : -step));
    options.onCommit?.();
  });
}
