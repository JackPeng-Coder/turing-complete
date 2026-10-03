/**
 * The bit indicator: one square, one meaning.
 *
 * The original marks a bit with a shape rather than a digit -- red with its
 * point on the left for 0, green with its point on the right for 1, olive while
 * nothing has been driven. Shape carries the value alongside colour, so the two
 * states stay apart for a player who cannot separate the red from the green.
 *
 * Shared because both the bottom test panel and the left-hand input readout draw
 * the same cell, and a second copy of the bit extraction would be a second
 * opinion about which end of a byte is bit 0.
 */

/** A cell's state: a known bit, or `'x'` while it is unknown. */
export type Bit = 0 | 1 | 'x';

/**
 * Bit `index` of `value`, counted from the most significant end.
 *
 * `>>>` coerces to int32, so anything past bit 30 -- a pin wider than the
 * language's shift -- is divided out instead of silently wrapped.
 */
export function bitOf(value: number, width: number, index: number): number {
  const shift = width - 1 - index;
  if (shift > 30) return Math.floor(value / 2 ** shift) % 2;
  return (value >>> shift) & 1;
}

/** Every bit of `value` at `width`, most significant first. */
export function bitsOf(value: number, width: number): Bit[] {
  const bits: Bit[] = [];
  for (let i = 0; i < width; i += 1) bits.push(bitOf(value, width, i) as Bit);
  return bits;
}

/** One cell. `label` is the title a pointer shows, never the cell's text. */
export function bitElement(bit: Bit, label?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `bit bit-${bit}`;
  if (label) span.title = label;
  return span;
}
