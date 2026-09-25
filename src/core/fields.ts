import type { Bit } from './signal';

/** Packs bits low-bit-first: bits[0] becomes bit 0 of the result. */
export function packBits(bits: readonly Bit[]): number {
  let out = 0;
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) out |= 1 << i;
  return out >>> 0;
}

export function unpackBits(value: number, count: number): Bit[] {
  const out: Bit[] = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = ((value >>> i) & 1) as Bit;
  return out;
}

export function extractField(value: number, offset: number, width: number): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  return (value >>> offset) & mask;
}

export function insertField(
  value: number,
  offset: number,
  width: number,
  field: number,
): number {
  if (width <= 0) throw new RangeError('field width must be positive');
  const mask = width >= 32 ? 0xffff_ffff : (1 << width) - 1;
  if (field < 0 || field > mask) {
    throw new RangeError(`field ${field} out of range for width ${width}`);
  }
  const cleared = value & ~(mask << offset);
  return (cleared | (field << offset)) >>> 0;
}
