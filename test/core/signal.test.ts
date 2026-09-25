import { describe, expect, it } from 'vitest';
import {
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
    const base = t.alloc(8);
    expect(t.slots).toBe(slots);
    t.setPort(base, 8, 0b1111_0000);
    expect(slots[base]).toBe(0);
    expect(slots[base + 4]).toBe(1);
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
