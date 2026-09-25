export type Bit = 0 | 1;
export type PortValue = number | Uint8Array;

export interface SignalTable {
  readonly slots: Uint8Array;
  readonly size: number;
  alloc(width: number): number;
  setBit(slot: number, bit: Bit): void;
  getBit(slot: number): Bit;
  setPort(base: number, width: number, v: PortValue): void;
  getPort(base: number, width: number): PortValue;
  clear(): void;
}

/** True when every bit of `v` above `width` is 0, so `v` fits the port. */
function fitsWidth(v: number, width: number): boolean {
  if (width >= 32) return v <= 0xffff_ffff;
  return v >= 0 && v < 1 << width;
}

export function assertWidth(v: PortValue, width: number): void {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new RangeError(`port value must be an integer, got ${v}`);
    }
    if (!fitsWidth(v, width)) {
      throw new RangeError(`value ${v} does not fit a ${width}-bit port width`);
    }
    return;
  }
  const needed = Math.max(1, Math.ceil(width / 8));
  if (v.length !== needed) {
    throw new RangeError(
      `byte array length ${v.length} does not fit a ${width}-bit port width (expected ${needed})`,
    );
  }
}

/**
 * Fixed-capacity signal table.
 *
 * Deliberately NOT growable: reallocating the backing `Uint8Array` would
 * invalidate every `base` index handed out earlier, and would silently break
 * the `drive` index array that `net.ts` builds over it. A fixed buffer plus a
 * capacity guard is the honest design -- the spec budgets 20,000 expanded
 * instances, which fits in the default 65,536 slots with room to spare.
 */
export function createSignalTable(capacity = 65_536): SignalTable {
  const slots = new Uint8Array(capacity);
  let size = 0;

  const table: SignalTable = {
    slots,
    get size() {
      return size;
    },
    alloc(width: number): number {
      if (width <= 0) throw new RangeError('port width must be positive');
      if (size + width > capacity) {
        throw new RangeError(
          `signal table is full: need ${size + width} slots, capacity is ${capacity}`,
        );
      }
      const base = size;
      size += width;
      return base;
    },
    setBit(slot: number, bit: Bit): void {
      table.slots[slot] = bit;
    },
    getBit(slot: number): Bit {
      return table.slots[slot] === 1 ? 1 : 0;
    },
    setPort(base: number, width: number, v: PortValue): void {
      assertWidth(v, width);
      if (typeof v === 'number') {
        for (let i = 0; i < width; i += 1) {
          table.slots[base + i] = (v >>> i) & 1;
        }
        return;
      }
      for (let i = 0; i < width; i += 1) {
        const byte = v[i >> 3] ?? 0;
        table.slots[base + i] = (byte >> (i & 7)) & 1;
      }
    },
    getPort(base: number, width: number): PortValue {
      if (width <= 8) {
        let out = 0;
        for (let i = 0; i < width; i += 1) out |= table.slots[base + i]! << i;
        return out;
      }
      const bytes = new Uint8Array(width / 8);
      for (let i = 0; i < width; i += 1) {
        if (table.slots[base + i]) bytes[i >> 3]! |= 1 << (i & 7);
      }
      return bytes;
    },
    clear(): void {
      table.slots.fill(0, 0, size);
    },
  };

  return table;
}

export interface Port {
  readonly id: string;
  readonly width: number;
  readonly base: number;
  read(): PortValue;
  write(v: PortValue): void;
}

export function createPort(id: string, width: number, table: SignalTable): Port {
  const base = table.alloc(width);
  return {
    id,
    width,
    base,
    read: () => table.getPort(base, width),
    write: (v: PortValue) => table.setPort(base, width, v),
  };
}

export function valuesEqual(a: PortValue, b: PortValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  const ab = typeof a === 'number' ? numberToBytes(a) : a;
  const bb = typeof b === 'number' ? numberToBytes(b) : b;
  if (ab.length !== bb.length) return false;
  for (let i = 0; i < ab.length; i += 1) if (ab[i] !== bb[i]) return false;
  return true;
}

function numberToBytes(v: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = v & 0xff;
  out[1] = (v >>> 8) & 0xff;
  out[2] = (v >>> 16) & 0xff;
  out[3] = (v >>> 24) & 0xff;
  return out;
}

export function formatPort(v: PortValue, width: number, radix: 2 | 10 | 16): string {
  const n =
    typeof v === 'number'
      ? v
      : Array.from(v).reduce((acc, byte, i) => acc + byte * 2 ** (8 * i), 0);
  // Binary output is exactly `width` characters, so bits above the port width
  // are dropped: a 1-bit port showing 0b101 renders '1'. `% 2 ** width` is used
  // instead of `& ((1 << width) - 1)` so wide (byte-array) values past the
  // 32-bit boundary are still reduced correctly.
  if (radix === 2) return (n % 2 ** width).toString(2).padStart(width, '0');
  if (radix === 16) return n.toString(16).toUpperCase();
  return String(n);
}
