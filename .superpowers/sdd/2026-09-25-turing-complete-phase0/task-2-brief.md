## Task 2: 信号表与端口（core/signal.ts）

**Files:**
- Create: `src/core/signal.ts`
- Test: `test/core/signal.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Bit = 0 | 1`
  - `type PortValue = number | Uint8Array`
  - `interface SignalTable { readonly slots: Uint8Array; alloc(width: number): number; setBit(slot: number, bit: Bit): void; getBit(slot: number): Bit; setPort(base: number, width: number, v: PortValue): void; getPort(base: number, width: number): PortValue; clear(): void; readonly size: number }`
  - `function createSignalTable(initialSlots?: number): SignalTable`
  - `interface Port { readonly id: string; readonly width: number; readonly base: number; read(): PortValue; write(v: PortValue): void }`
  - `function createPort(id: string, width: number, table: SignalTable): Port`
  - `function formatPort(v: PortValue, width: number, radix: 2 | 10 | 16): string`
  - `function valuesEqual(a: PortValue, b: PortValue): boolean`
  - `function assertWidth(v: PortValue, width: number): void`

- [ ] **Step 1: 写失败测试 `test/core/signal.test.ts`**

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test test/core/signal.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/signal"`

- [ ] **Step 3: 实现 `src/core/signal.ts`**

```ts
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
  if (radix === 2) return n.toString(2).padStart(width, '0');
  if (radix === 16) return n.toString(16).toUpperCase();
  return String(n);
}
```

> 注意实现中的 `growTo`：`table.slots` 是可变引用，`size` 用 getter 暴露。测试里 `t.slots` 的读取必须走 `table.slots`，不要缓存旧的 `Uint8Array`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test test/core/signal.test.ts`
Expected: PASS — 12 passed

- [ ] **Step 5: 补充容量回归测试**

在 `test/core/signal.test.ts` 追加：

```ts
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
```

Run: `pnpm test test/core/signal.test.ts`
Expected: PASS — 15 passed

- [ ] **Step 6: 提交**

```bash
git add src/core/signal.ts test/core/signal.test.ts
git commit -m "feat(core): add bit-level signal table and ports"
```

---

