import { describe, expect, it } from 'vitest';
import {
  assertWidth,
  createPort,
  createSignalTable,
  formatPort,
  valuesEqual,
} from '../../src/core/signal';

describe('SignalTable', () => {
  it('allocates sequential slot ranges', () => {
    const t = createSignalTable();
    expect(t.alloc(1)).toBe(0);
    expect(t.alloc(8)).toBe(1);
    expect(t.alloc(1)).toBe(9);
    expect(t.size).toBe(10);
  });

  it('defaults every slot to 0', () => {
    const t = createSignalTable();
    const base = t.alloc(4);
    expect(t.getBit(base)).toBe(0);
    expect(t.getBit(base + 3)).toBe(0);
  });

  it('writes and reads single bits', () => {
    const t = createSignalTable();
    const s = t.alloc(1);
    t.setBit(s, 1);
    expect(t.getBit(s)).toBe(1);
    t.setBit(s, 0);
    expect(t.getBit(s)).toBe(0);
  });

  it('stores an 8-bit port as 8 separate slots, low bit first', () => {
    const t = createSignalTable();
    const base = t.alloc(8);
    t.setPort(base, 8, 0b1010_0101);
    expect(t.getBit(base)).toBe(1);
    expect(t.getBit(base + 1)).toBe(0);
    expect(t.getBit(base + 2)).toBe(1);
    expect(t.getBit(base + 7)).toBe(1);
    expect(t.getPort(base, 8)).toBe(0b1010_0101);
  });

  it('accepts a Uint8Array for wide ports', () => {
    const t = createSignalTable();
    const base = t.alloc(16);
    t.setPort(base, 16, new Uint8Array([0x34, 0x12]));
    expect(t.getPort(base, 16)).toEqual(new Uint8Array([0x34, 0x12]));
  });

  it('reads back every bit of a wide port whose width is not a multiple of 8', () => {
    const t = createSignalTable();
    const base = t.alloc(12);
    // `assertWidth` accepts ceil(12 / 8) = 2 bytes on the way in, so the reader
    // must size its buffer to ceil(width / 8) too. Sizing it with `width / 8`
    // floors to 1 byte and silently drops bits 8-11.
    t.setPort(base, 12, new Uint8Array([0x34, 0x12]));
    expect(t.getPort(base, 12)).toEqual(new Uint8Array([0x34, 0x02]));
    expect(t.getBit(base + 9)).toBe(1);
  });

  it('rejects a value that does not fit the port width', () => {
    const t = createSignalTable();
    const base = t.alloc(3);
    expect(() => t.setPort(base, 3, 8)).toThrow(/width/i);
  });

  it('clear() zeroes every allocated slot and keeps size', () => {
    const t = createSignalTable();
    const base = t.alloc(4);
    t.setPort(base, 4, 0b1111);
    t.clear();
    expect(t.getPort(base, 4)).toBe(0);
    expect(t.size).toBe(4);
  });

  it('keeps earlier values while allocating more slots', () => {
    const t = createSignalTable(16);
    const a = t.alloc(1);
    t.setBit(a, 1);
    const b = t.alloc(4);
    t.setPort(b, 4, 0b1010);
    expect(t.getBit(a)).toBe(1);
    expect(t.getPort(b, 4)).toBe(0b1010);
  });

  it('refuses to over-allocate instead of silently corrupting indices', () => {
    const t = createSignalTable(4);
    t.alloc(4);
    expect(() => t.alloc(1)).toThrow(/capacity/i);
  });

  it('never swaps its backing slots, so earlier bases stay valid', () => {
    const t = createSignalTable(8);
    const slots = t.slots;
    expect(slots.length).toBe(8);

    // Fill the table to capacity and write through the captured reference.
    const base = t.alloc(8);
    t.setPort(base, 8, 0b1111_0000);
    expect(slots[base]).toBe(0);
    expect(slots[base + 4]).toBe(1);

    // One slot too many. A grow-on-demand table would reallocate here, which
    // silently invalidates every `base` already handed out (including the
    // `drive` lookup `net.ts` builds over these indices), so the allocation
    // must be refused instead. Swallow the refusal to keep asserting after it.
    let refusal: unknown;
    try {
      t.alloc(1);
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(RangeError);

    expect(t.slots).toBe(slots); // identity: the backing array was not swapped
    expect(t.getPort(base, 8)).toBe(0b1111_0000); // and the values survived
    expect(slots[base]).toBe(0);
    expect(slots[base + 4]).toBe(1);
  });
});

describe('assertWidth', () => {
  it('accepts every value of a 31-bit port, zero included', () => {
    // `fitsWidth` bounded this with `v < 1 << width`, and `<<` converts through
    // int32: `1 << 31` is `-2147483648`, so the comparison read
    // `v < -2147483648` -- false for EVERY non-negative v. `assertWidth(0, 31)`
    // threw, which is the strongest form of the bug: a port whose values were all
    // rejected, and `createWideDefs(31)` hands out defs that produce exactly these
    // values, so `runChecks` turned a correct circuit into an 'invalid' failure.
    expect(() => assertWidth(0, 31)).not.toThrow();
    expect(() => assertWidth(1, 31)).not.toThrow();
    expect(() => assertWidth(12345, 31)).not.toThrow();
    expect(() => assertWidth(2 ** 31 - 1, 31)).not.toThrow();

    // The bound still excludes the first value that is one bit too wide, and the
    // sign check survived the change: `2 ** width` is positive, but only the
    // `v >= 0` half keeps a negative number out.
    expect(() => assertWidth(2 ** 31, 31)).toThrow(/does not fit a 31-bit port/);
    expect(() => assertWidth(-1, 31)).toThrow(/does not fit a 31-bit port/);
  });

  it('bounds a 32-bit port at 0xffff_ffff, as its own arm did', () => {
    // Width 32 never reached the `1 << width` expression, so these values are the
    // ones the fix had to keep behaving exactly as before.
    expect(() => assertWidth(0, 32)).not.toThrow();
    expect(() => assertWidth(0xffff_ffff, 32)).not.toThrow();
    expect(() => assertWidth(0x1_0000_0000, 32)).toThrow(/does not fit a 32-bit port/);
  });

  it('bounds 0, 1 and 2 ** width - 1 in and 2 ** width out at every width 1..32', () => {
    // The sweep is the point. Widths 1-30 and 32 were all correct under
    // `1 << width`; 31 alone was broken, so a test that picks one width -- the
    // 8-bit port every other test in this file uses -- passes either way and
    // would not have caught this. The message names the width so a failure says
    // which arm regressed.
    for (let width = 1; width <= 32; width += 1) {
      expect(() => assertWidth(0, width), `0 at width ${width}`).not.toThrow();
      expect(() => assertWidth(1, width), `1 at width ${width}`).not.toThrow();
      expect(
        () => assertWidth(2 ** width - 1, width),
        `2 ** ${width} - 1 at width ${width}`,
      ).not.toThrow();
      expect(() => assertWidth(2 ** width, width), `2 ** ${width} at width ${width}`).toThrow(
        new RegExp(`does not fit a ${width}-bit port`),
      );
    }
  });
});

describe('Port', () => {
  it('reads through to the table so writes are visible', () => {
    const t = createSignalTable();
    const p = createPort('a', 3, t);
    expect(p.read()).toBe(0);
    p.write(0b101);
    expect(p.read()).toBe(0b101);
    expect(t.getPort(p.base, 3)).toBe(0b101);
  });

  it('throws when written a value wider than the port', () => {
    const t = createSignalTable();
    const p = createPort('a', 3, t);
    expect(() => p.write(0b1000)).toThrow(/width/i);
  });
});

describe('formatPort', () => {
  it('pads binary to the port width', () => {
    expect(formatPort(0b101, 8, 2)).toBe('00000101');
    expect(formatPort(0b101, 1, 2)).toBe('1');
  });

  it('formats decimal and hex', () => {
    expect(formatPort(255, 8, 10)).toBe('255');
    expect(formatPort(255, 8, 16)).toBe('FF');
  });
});

describe('valuesEqual', () => {
  it('compares numbers and byte arrays', () => {
    expect(valuesEqual(3, 3)).toBe(true);
    expect(valuesEqual(3, 4)).toBe(false);
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });
});
